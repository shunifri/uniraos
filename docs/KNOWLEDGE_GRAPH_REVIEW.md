# RAOS 知识图谱全链路 Review

> 文档版本: v1.0  
> 评审范围: 从知识提取 → 存储 → 检索的全流程  
> 核心模块: `src/memory/knowledge-graph/`, `src/skills/graph-skills.ts`, `src/kb-graph-sync.ts`

---

## 1. 架构全景

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           知识提取层 (Extraction)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  LTM Store Skill    KB Ingest/Share    LLM Relation Extract    Tag Overlap  │
│       ↓                  ↓                     ↓                    ↓       │
│  onFactStored()    syncKBToUserGraph()  extractRelationships()  TEMPORAL   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                           存储层 (Storage)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  KnowledgeGraphManager (per-user, lazy-init)                                │
│       ├─ GraphStore (MySQL) ── kb_graph_nodes / kb_graph_edges              │
│       └─ Neo4jGraphStore ── KBNode labels + dynamic rel types               │
│                                                                              │
│  特性: LRU Cache(10k/5min) │ owner_id 多租户隔离 │ 自动 fallback             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                           检索层 (Retrieval)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  BFS Subgraph    graphSearch(P3)    pathSearch    RecallContext    Skills   │
│  querySubgraph()  kb_doc 检索        shortestPath   STM 注入      graph_*  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 核心设计决策

| 决策 | 实现 | 评价 |
|------|------|------|
| 存储后端 | MySQL(默认) + Neo4j(可选)，`GRAPH_STORE_BACKEND` 切换 | ✅ 灵活，但 Neo4j 能力未充分利用 |
| 多租户 | `owner_id` 字段隔离，每用户独立 manager 实例 | ✅ 清晰 |
| 初始化策略 | Lazy async + fallback（Neo4j 连不上自动切 MySQL） | ✅ 健壮 |
| 缓存 | 双端 LRU (10k entries, 5min TTL) | ✅ 防止 OOM |
| 预计算 | 社区检测 + 中心节点，1h TTL + force 开关 | ⚠️ 全量计算，大图谱有性能隐患 |

---

## 2. 知识提取链路深度分析

### 2.1 提取来源矩阵

知识图谱的节点和边来自 **4 个入口**，覆盖度差异明显：

| 来源 | 触发时机 | 节点类型 | 边类型 | 覆盖度 |
|------|---------|---------|--------|--------|
| **LTM 事实存储** (`ltm_store` skill → `onFactStored`) | 每次模型/用户存储长期记忆 | `ltm` / `entity` / `concept` / `kb_document` | `EXTRACTED` / `TEMPORAL` / `PERSONAL` | 🔴 **核心但浅层** |
| **KB 文档同步** (`kb-graph-sync.ts`) | 文档共享/删除时 | `kb_document` | `EXTRACTED` (related_to) | 🟡 仅共享场景 |
| **LLM 关系抽取** (`relationship-extractor.ts`) | 显式调用 `extractRelationships()` | 动态实体 | `INFERRED` | 🟢 能力存在但**未在主线使用** |
| **批量 LTM 同步** (`syncFromLTM`) | 手动 `/api/graph/sync` | `ltm` | `TEMPORAL` / `PERSONAL` | 🟡 手动触发 |

### 2.2 `onFactStored()` — 主提取逻辑拆解

```typescript
// 伪代码流程
async onFactStored(entry) {
  1. 推断节点类型 (根据 tags: kb_document / entity / concept / ltm)
  2. 处理个人信息关联 (user_name → user_* 的 PERSONAL 边)
  3. 创建/更新节点 (label = entry.key)
  4. 若 entry.relation 存在 → 创建 EXTRACTED 边
  5. 与现有节点匹配共享 tags → 最多创建 5 条 TEMPORAL 边
}
```

**关键问题：**

1. **节点语义贫瘠**: 节点 label 直接等于 LTM 的 `key`（如 `"user_pref"`、`"dark_mode"`），而非从中提取的**实体**。图谱本质上是在为 LTM 的 KV 对建立索引，而非构建语义知识网络。
2. **PERSONAL 边过度特化**: 硬编码 `user_name` → `user_*` 的关联逻辑，仅服务于"用户画像"场景，不具备通用性。
3. **TEMPORAL 边数量上限 5**: `tagRelations.slice(0, 5)` 这个硬截断可能遗漏重要的共现关系。
4. **LLM 关系抽取未被集成**: `relationship-extractor.ts` 提供了 `extractRelationships(text, llmProvider)`，但代码搜索显示它**从未在主线流程中被调用**。当前所有边都是基于规则（tag 重叠、relation 参数）而非 LLM 理解生成的。

### 2.3 KB 文档与图谱的鸿沟

知识库文档（`kb_ingest` → `KnowledgeBase.ingest()`）的入库流程是：

```
文档 → 分块 → 向量化 → MySQL (kb_documents / kb_chunks / kb_keywords)
        ↓
    [图谱侧？] 仅有手动标签透传，无内容级实体抽取
```

**发现**: KB 文档只有在以下情况才会进入图谱：
- 文档被共享时，`syncKBToUserGraph()` 手动创建一个 `kb_document` 节点
- 手动调用 `onFactStored` 并标记 `type: "kb_document"`

**文档内容的实体、概念、关系完全没有自动抽取进图谱**。这意味着 KB 搜索（向量+关键词）和图搜索是两个几乎独立的系统，仅在 `graphSearch()` 中做了浅层拼接。

### 2.4 关系抽取模块评估 (`relationship-extractor.ts`)

```typescript
// LLM 抽取提示词设计
prompt = `从以下文本中提取实体之间的关系。返回 JSON 数组...
要求: sourceLabel, targetLabel, relation, confidence`
```

| 维度 | 评估 |
|------|------|
| 提示词质量 | ✅ 中文适配，有示例，要求 confidence |
| 关系归一化 | ✅ `normalizeRelationType()` 将中文关系映射到英文标准词 |
| 错误处理 | ✅ try/catch 静默失败，不阻塞流程 |
| **集成度** | 🔴 **零集成** — 模块存在但无调用方 |
| 置信度阈值 | `>= 0.3` 且标签长度 `<= 50`，过滤合理 |

---

## 3. 存储层深度分析

### 3.1 双后端实现对比

| 维度 | GraphStore (MySQL) | Neo4jGraphStore |
|------|-------------------|-----------------|
| 数据表/结构 | `kb_graph_nodes` + `kb_graph_edges` | `(:KBNode {ownerId})` + 动态关系类型 |
| 节点去重 | ✅ `deduplicateNodes()` 实现完整 | ✅ 复用相同逻辑 |
| 邻居查询 | `getEdgesOf()` + `IN` 批量查询 | `MATCH (a)-[r]-(b)` 原生图遍历 |
| 路径查找 | 应用层 BFS (`bfs-extractor.ts`) | 仍用应用层 BFS，**未用 Neo4j 原生最短路径** |
| 社区检测 | 应用层 Louvain (TS 实现) | 仍用应用层 Louvain，**未用 Neo4j GDS** |
| 连接管理 | MySQL 连接池复用 | 每个 session 新建/关闭 session |
| 大图谱表现 | `getAllNodes()` 全表加载，性能瓶颈 | 同样全量加载，未发挥 Neo4j 优势 |

### 3.2 MySQL 后端的具体问题

**Schema 设计:**
```sql
kb_graph_nodes: id, owner_id, label, type, tags(JSON), properties(JSON), community_id, created_at
kb_graph_edges: id, owner_id, source_id, target_id, type, label, weight, created_at
```

- ✅ `owner_id` 索引保证多租户隔离查询效率
- ⚠️ `tags` 和 `properties` 用 JSON 文本存储，无法直接利用 MySQL JSON 函数索引
- ⚠️ 缺少 `(owner_id, type)` 复合索引（`findNodesByType` 会全表扫描）
- ⚠️ `getAllNodes()` / `getAllEdges()` 被频繁调用（社区检测、评分、BFS seed），大用户图谱时这是 **O(n) 全量加载**

### 3.3 Neo4j 后端的未充分利用

Neo4j 集成文档（`NEO4J_INTEGRATION.md`）宣称支持 APOC 和 GDS，但代码实际状况：

```typescript
// 实际代码中 Neo4j 只被当作"能存图数据的 MySQL"
// 所有图算法（BFS、最短路径、社区检测、中心性）都在 TS 层重新实现
```

| Neo4j 原生能力 | 是否使用 | 当前替代方案 |
|---------------|---------|-------------|
| `shortestPath()` / `apoc.algo.dijkstra()` | ❌ 否 | `findShortestPath()` 手写 BFS |
| `gds.louvain` 社区检测 | ❌ 否 | `detectCommunities()` 手写 Louvain |
| `gds.degree` 中心性 | ❌ 否 | `identifyGodNodes()` 全量排序 |
| 全文索引 (full-text index) | ❌ 否 | `scoreNodes()` 全量扫描 + 字符串匹配 |
| 向量索引 (vector index) | ❌ 否 | 无 |

**结论**: Neo4j 后端当前是"能跑 Cypher CRUD 的 MySQL 替代品"，没有发挥原生图数据库的任何算法优势。对于大图谱场景，这导致大量数据在网络和 TS 运行时之间往返。

---

## 4. 检索链路深度分析

### 4.1 检索能力矩阵

| 检索方式 | 入口 | 核心算法 | 适用场景 | 质量评估 |
|---------|------|---------|---------|---------|
| **BFS 子图查询** | `querySubgraph()` | Seed scoring + BFS expansion | 通用图探索 | 🟡 种子发现太浅 |
| **文档图搜索** | `graphSearch()` | BFS + GodNode boost + Community boost | KB 文档检索 (P3) | 🟡 仅对已有 kb_document 节点有效 |
| **路径搜索** | `pathSearch()` / `getPath()` | BFS shortest path | 关系推理 | 🟢 功能完整但使用率低 |
| **社区概览** | `getCommunities()` | Louvain | 图谱结构理解 | 🟡 全量重算成本高 |
| **Recall 增强** | `RecallContextSkill` | BFS(depth=2, maxNodes=3) + 注入 STM | 上下文记忆 | 🟡 深度和节点数限制过严 |
| **Graph Skills** | `graph_query` / `graph_path` / `graph_communities` | 同上 | Agent 工具调用 | 🟢 权限过滤完整 |

### 4.2 `querySubgraph()` — BFS 子图提取

```typescript
async function extractSubgraph(store, query, options) {
  1. 分词 query → terms
  2. scoreNodes(store, terms) ──→ 加载**所有节点**到内存，逐条字符串匹配
  3. 取 top maxSeeds(默认3) 作为种子
  4. BFS 扩展，maxDepth(默认3), maxNodes(默认50)
  5. 收集种子节点间的所有边
}
```

**`scoreNodes()` 的问题（性能瓶颈）:**

```typescript
const allNodes = await store.getAllNodes();  // 🔴 全量加载
for (const node of allNodes) {
  // label 匹配 +3, tag 匹配 +2, value 匹配 +1
  // 支持 ZH_TAG_MAP 跨语言映射（健康→health 等）
}
```

- **时间复杂度**: O(n) 每查询，n = 用户节点总数
- **无索引利用**: 纯内存字符串匹配，不依赖数据库索引
- **无语义匹配**: 没有 embedding 相似度，"深度学习" 和 "神经网络" 不会被关联

**BFS 扩展的问题:**

- `getNeighbors()` 每次查询邻居，对于 MySQL 后端是 1次 edges 查询 + 1次 nodes 批量查询，对于深度 3、分支因子 5 的场景，约 30 次 DB 往返
- 虽有 LRU 缓存缓解，但缓存命中率依赖访问模式

### 4.3 `graphSearch()` — P3 知识库文档检索

这是知识图谱与 KB 搜索的核心结合点，流程设计如下：

```
Phase 1: BFS 子图查询 (maxSeeds=3, maxDepth=3, maxNodes=50)
    ↓
Phase 2: 过滤出 type === 'kb_document' 的节点
    ↓
Phase 3: 若不足 limit 个，用 GodNode 邻居扩展
    ↓
Phase 4: 若仍不足，用 Community 内其他文档补充
    ↓
Phase 5: 计算 score (0.7 基础分 + 种子/中心/社区加分)
```

**设计亮点:**
- GodNode 和 Community 的 fallback 机制合理，能在直接匹配不足时扩展相关文档
- `allowedDocIds` ACL 过滤与知识库权限体系打通

**关键缺陷:**

1. **对 kb_document 节点的强依赖**: 如果用户没有通过共享/手动方式把 KB 文档写入图谱，`graphSearch()` 永远返回空。它不是在"从文档内容中发现实体"，而是在"从已有的文档节点中找相关项"。
2. **评分公式过于简单**:
   ```typescript
   let score = 0.7;
   if (seedNodes.includes(docNode.id)) score += 0.15;
   if (godNodes.includes(docNode.id)) score += 0.1;
   if (communityId) score += min(commSize * 0.005, 0.05);
   ```
   缺少基于内容相关性的动态评分，三个加分项的上限只有 0.3，区分度有限。
3. **matchType 永远为 `graph_subgraph`**: 代码中定义了 `graph_path` 和 `graph_community` 两种类型，但实际只返回 `graph_subgraph`。

### 4.4 与混合检索的集成 (`kb_search`)

`KnowledgeBase.search()` 实现了向量+关键词的 RRF 混合检索，但**当前并未调用 `graphSearch()`**。

```typescript
// kb_search 当前流程
keywordSearch() ──┐
                  ├─→ RRF 融合 ──→ 结果
semanticSearch() ─┘

// 理论上 graphSearch 可以：
// 1. 作为 pre-filter 缩小候选 docIds
// 2. 作为 post-rerank 对结果进行图结构 boost
// 但当前两种集成方式都未实现
```

`classifyQuery()` 函数将查询分为 `factual/relational/discovery/hybrid`，但**分类结果未影响任何检索策略**。

### 4.5 `RecallContextSkill` — 记忆召回中的图增强

```typescript
// 在 LTM 搜索后，若图谱非空
const subgraph = await graphManager.querySubgraph(query, { maxNodes: 3, maxDepth: 2 });
for (const node of subgraph.nodes) {
  if (!memories.some(m => m.key === node.label)) {
    memories.push({ key: node.label, value: node.properties.value, tags: node.tags });
  }
}
```

- ✅ 图查询失败被 try/catch 保护，不影响主流程
- ⚠️ `maxNodes: 3` 限制过严，图遍历的价值被大幅压缩
- ⚠️ 注入 STM 的 key 是 `recall:${node.label}`，可能与 LTM 记忆的 key 冲突或重复

---

## 5. 安全与权限

### 5.1 已实现的权限控制

| 场景 | 实现 | 评价 |
|------|------|------|
| Graph Routes API | `pm.requireAuth` + `pm.requirePermission(API.MEMORY_READ/WRITE)` | ✅ 标准权限中间件 |
| KB 文档图过滤 | `allowedDocIds` = ownDocIds + sharedDocIds (经 role/dept 规则计算) | ✅ 细粒度 |
| graph_query/path/communities skills | 内部复用相同的 KB + ShareRepository 逻辑 | ✅ 一致性 |
| 多租户隔离 | `owner_id` 字段 + manager per-user | ✅ 数据隔离 |

### 5.2 权限盲区

- `graph_deduplicate` skill 中 `store.deduplicateNodes()` 返回 Promise 但**未被 await**，可能导致竞态条件
- Neo4j 后端中 `removeEdge()` 的 Cypher 查询未限定 `ownerId`，理论上可能删除其他用户的边（虽然 edge ID 是 UUID 碰撞概率极低）

---

## 6. 测试覆盖评估

```
tests/memory/knowledge-graph/
├── manager.test.ts          ✅ 覆盖 onFactStored, BFS, path, stats, sync, precompute, graphSearch
├── integration.test.ts      ✅ E2E: store→query→path, persistence, community, god nodes
├── bfs-extractor.test.ts    ✅ BFS 和最短路径算法
├── community-detection.test.ts ✅ Louvain 算法
├── graph-store.test.ts      ✅ MySQL CRUD, 去重, 缓存
├── relationship-extractor.test.ts ✅ LLM 抽取 + Tag 关系
├── scoring.test.ts          ✅ GodNode + Surprise 评分

性能测试:
├── tests/performance/kg-retrieval.benchmark.ts  ✅ 混合检索 vs 图谱增强对比
├── tests/performance/graph-query-perf.test.ts   ✅ 图查询性能
```

**测试质量**: 功能测试覆盖全面，但缺少：
- Neo4j 后端的集成测试（测试都基于 MySQL）
- 大图谱（>10k 节点）的性能基准
- 并发写入的竞态条件测试

---

## 7. 问题清单与风险等级

| # | 问题 | 位置 | 风险 | 修复成本 |
|---|------|------|------|---------|
| 1 | **Neo4j 未发挥原生图算法优势** | `neo4j-store.ts` | 🔴 高 | 中 |
| 2 | **BFS seed 发现是全量 O(n) 扫描** | `bfs-extractor.ts:scoreNodes` | 🔴 高 | 低 |
| 3 | **社区检测全量加载 + 多轮迭代** | `community-detection.ts` | 🔴 高 | 中 |
| 4 | **LLM 关系抽取零集成** | `relationship-extractor.ts` | 🟡 中 | 低 |
| 5 | **KB 文档内容未自动抽取实体进图谱** | `knowledge-skills.ts` | 🟡 中 | 高 |
| 6 | **graphSearch 永远只返回 `graph_subgraph` 类型** | `manager.ts:graphSearch` | 🟡 中 | 低 |
| 7 | **graph_deduplicate skill 未 await Promise** | `graph-skills.ts:168` | 🟡 中 | 极低 |
| 8 | **预计算锁是 boolean 而非真正互斥锁** | `manager.ts:precomputeLock` | 🟡 中 | 低 |
| 9 | **TEMPORAL 边硬上限 5 条** | `manager.ts:169` | 🟢 低 | 低 |
| 10 | **Query 分类结果未影响检索策略** | `knowledge-skills.ts:classifyQuery` | 🟢 低 | 中 |
| 11 | **Neo4j removeEdge 未限定 ownerId** | `neo4j-store.ts:361` | 🟢 低 | 极低 |

---

## 8. 优化建议路线图

### 8.1 短期（1-2 周，低成本高收益）

1. **修复异步 bug**
   - `graph-skills.ts` line 168: `await store.deduplicateNodes()`
   - `neo4j-store.ts` line 365: Cypher 增加 `ownerId` 限定

2. **优化 BFS seed 发现**
   - MySQL: 增加 `(owner_id, label)` 前缀索引，用 `LIKE` 查询代替全量加载
   - Neo4j: 创建全文索引，用 `db.index.fulltext.queryNodes` 做语义搜索

3. **集成 LLM 关系抽取到 LTM Store**
   - 在 `onFactStored()` 中，当 `value` 是长文本时，异步调用 `extractRelationships()`
   - 将抽取出的关系作为 `INFERRED` 边写入图谱

4. **修复 `graphSearch` matchType**
   - 根据实际命中路径（seed/godNode/community）返回正确的 matchType

### 8.2 中期（1 个月）

5. **Neo4j 后端原生算法适配**
   - 新增 `useNativeAlgorithms` 开关
   - 路径查询: `apoc.algo.dijkstra` 或 `gds.shortestPath`
   - 社区检测: `gds.louvain.stream()`
   - 中心性: `gds.degree.stream()`
   - 保留 MySQL 后端的 TS 实现作为 fallback

6. **KB 文档内容级图谱抽取**
   - 在 `KnowledgeBase.ingest()` 或解析队列中，对文档 chunk 调用实体/关系抽取
   - 将抽取的实体作为 `entity` / `concept` 节点，与 `kb_document` 节点建立 `EXTRACTED` 边
   - 这样 `graphSearch` 才能基于内容而非仅元标签工作

7. **引入向量相似度辅助 seed 发现**
   - 为 GraphNode 增加 `embedding` 字段（复用 `EmbeddingProvider`）
   - BFS seed 阶段用向量最近邻替代纯字符串匹配

### 8.3 长期（2-3 个月）

8. **增量社区检测**
   - 当前 Louvain 每次全量重算，大图谱不可扩展
   - 实现增量更新策略：新节点/边只影响局部社区结构
   - 或完全迁移到 Neo4j GDS 的增量模式

9. **GraphRAG 深度集成**
   - 让 `KnowledgeBase.search()` 在 RRF 融合前，先用 `graphSearch` 做 pre-filter
   - 或做 post-rerank：根据节点在子图中的 centrality 调整最终得分
   - 让 `classifyQuery` 的结果真正影响策略（relational 查询优先用 pathSearch，discovery 用 community）

10. **图谱质量监控**
    - 新增 metrics: 平均度数、连通分量数量、孤立节点比例、社区集中度
    - 定时任务检测并清理孤儿节点、重复边
    - 前端 dashboard 增加"图谱健康度"指标

---

## 9. 关键代码指标

| 指标 | 数值 |
|------|------|
| 核心源码文件数 | 9 (`src/memory/knowledge-graph/*.ts`) |
| 核心代码行数 | ~3,500 行 (含两个存储后端) |
| 测试文件数 | 7 + 2 性能测试 |
| 测试覆盖率 | 功能覆盖全面，Neo4j 分支覆盖不足 |
| 对外 API (Skills) | 4 个 (`graph_query`, `graph_path`, `graph_communities`, `graph_deduplicate`) |
| REST API 端点 | 5 个 (`/graph/data`, `/stats`, `/query`, `/sync`, `/communities`) |
| 前端可视化 | ECharts 力导向图，支持社区着色、中心节点高亮 |

---

## 10. 总结

RAOS 知识图谱是一个**架构设计合理、工程实现扎实**的系统：

- ✅ **存储抽象优秀**: 双后端、懒加载、自动 fallback、LRU 缓存都体现了良好的工程思维
- ✅ **权限模型完整**: 从 API 到 Skill 到存储层的 ACL 一脉相承
- ✅ **前端可视化可用**: ECharts 力导向图 + 社区检测着色提供了直观的图谱洞察
- ✅ **测试基础设施完善**: 功能测试 + 性能 benchmark 都有覆盖

但当前系统处于 **"图结构已就绪，图智能未释放"** 的阶段：

- 🔴 **提取层太浅**: 图谱是 LTM 的"影子"，而非独立的知识网络。LLM 关系抽取能力闲置，KB 文档内容未进图谱。
- 🔴 **检索层太重**: 核心算法（BFS、社区检测、最短路径）在 TS 层重复实现，未利用 Neo4j 的原生能力，导致大图谱性能堪忧。
- 🟡 **与主检索链路脱节**: `kb_search` 仍是向量+关键词的天下，图谱检索没有真正参与 RRF 融合。

**下一步最优先行动**: 若使用 Neo4j 后端，应当用 Cypher/GDS 替换手写的 BFS 和社区检测；若主要使用 MySQL 后端，应当为 `scoreNodes` 增加数据库索引过滤，避免每查询全量加载。同时，将 LLM 关系抽取接入 `onFactStored` 的异步流程，是提升图谱"知识密度"的最快途径。

---

## 相关 commit

| SHA | 标题 | 与本文档关系 |
|-----|------|--------------|
| [`ea805e1`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **docs(kg): 阶段 0 文档** | 本文档是这次 commit 引入的——v1 review |
| [`b6a6e75`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **阶段 1-2: 地基 + 离线化抽取** | "LLM 抽取逻辑收敛成一份" + `graph_deduplicate` 等 P1 修复都在这里 |

详细索引见 [CHANGELOG_KG.md §Commit Map](CHANGELOG_KG.md#-commit-mapcommit--docs)。

## P0 验证

`docs/V1-V2-P0-VERIFICATION.md` 有 4 个 P0（v1 2 个 + v2 2 个）逐项 grep + tsc 验证结果：**3 个真修完，1 个（BFS 内部 N+1）部分修**。
