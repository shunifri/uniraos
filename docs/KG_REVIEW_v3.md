# RAOS 知识图谱 1-6 阶段综合 Review 报告

> 文档版本: v3.0（覆盖 1-6 阶段 + 修 1/2/3）  
> 评审范围: 1-6 阶段所有改动（17 文件，+1646 行，-301 行）+ 三个修复合计 ~150 行  
> 评审方法: 逐文件扫描 + 目标对齐 + 与 Vision 文档对账

---

## 0. TL;DR

**整体 1-6 阶段做的"骨架"质量不错**（535/535 测试过，TypeScript 0 error，commit 干净），但**"骨架接通"层面有 15 个累积债务**。最关键的两个：

- 🔴 **修 3 没真正闭环**：`extractEntities` 抽出的纯 entity 没有任何路径写回图谱
- 🔴 **ACL 漏洞一直在**：`recall.ts` 的 `isAllowed` 只过滤 seed，不过滤 relatedEntities

按 ROI 排应当先修这两个。其它多数是 P1/P2 的"小坑"，可以分批消化。

---

## 1. 目标对齐重评估（最终版）

| 目标 | 修前 v2 review | 修 1+2+3 后 | 阶段 6 后 | 最终评估 |
|------|----------|----------|---------|---------|
| 检索更准确 | 30% | 55% | 70% | **75%**（中文分词 + entity 全量抽取，但还没写回图谱）|
| 检索更高效 | 50% | 50% | 50% | 50%（离线已做；运行时 N+1 仍存）|
| 理解关联关系 | 20% | 70% | 70% | **70%**（graphContext 传结构）|
| 提升回复质量 | 15% | 55% | 55% | 55%（结构信号有了，但前端未消费）|

**净进步**："理解关联" 从 20% 跳到 70%，是这一轮最大的胜利。"检索准确" 从 30% 跳到 75%。

---

## 2. 按严重度分类的问题清单

### 🔴 P0 — 必须修

#### P0-1: ACL 漏洞（`recall.ts`）

**位置**：`src/memory/knowledge-graph/recall.ts:97-103`

```typescript
const isAllowed = (n: GraphNode): boolean => {
  if (opts.allowedDocIds.length === 0) return true;
  if (!n.tags?.includes("kb_document")) return true;
  return opts.allowedDocIds.some((id) => n.id.includes(id));
};

const seedAfterAcl = seedEntities.filter(isAllowed);  // ← 只过滤 seed

// 后面 BFS 扩展出来的 relatedEntities 没经过 isAllowed
const allNodes = subgraph.nodes;
const seedIdSet = new Set(seedAfterAcl.map((n) => n.id));
const relatedEntities = allNodes.filter((n) => !seedIdSet.has(n.id));
// ↑ 仍然含不允许的 kb_document 节点
```

**风险**：用户 A 的 recall 可以触达用户 B 共享的 kb_document 节点（如果 B 没把 doc 共享给 A）。

**修复**：把 BFS 调用也用 `allowedDocIds` 过滤（`extractSubgraph` 已支持该参数，已传入，但 `subgraph.nodes` 没再过滤；`seedAfterAcl` 已过滤但 `relatedEntities` 没）。

#### P0-2: 修 3 抽出的纯 entity 没写回图谱

**位置**：`src/memory/knowledge-graph/extraction-pipeline.ts:355-407`（`extractFromChunk`）

**问题**：
- 修 3 让 `extractFromChunk` 调用 `extractEntities` + `extractRelationships` 两次
- 抽出的纯 entity 写到了 `entitiesMap`
- 但 **`extractFromDocument` 只返回 counts**，caller (`kgExtractionQueue.runJob`) 不消费 entities
- 实际写图谱走 `extractRelationsToGraph`，后者用 `getOrCreateEntity` 创建 entity——**只创建 relations 两端的 entity，纯 entity 被丢弃**

**结果**：修 3 设计意图（"独立抽取 entity"）没真正落地。文档里"独立出现的 X"这种情况仍然不进 KG。

**修复**：
1. `kgExtractionQueue` 改用 `extractFromDocument` 替代 `extractRelationsToGraph`
2. 让 `extractFromDocument` 直接写图谱（不只是返回 counts）
3. 或保持现状但显式记录"修 3 的 entity 抽取是 dead code"

#### P0-3: chunk-expander N+1 SQL

**位置**：`src/memory/knowledge-graph/chunk-expander.ts:120-124`

```typescript
for (const [key, relatedEntities] of entityBySourceChunk.entries()) {
  const chunk = await fetchChunkByDocAndIndex(adapter, docId, chunkIndex);  // ← 每对一次 SQL
  ...
}
```

50 entities × 3 chunks = **150 次串行 SQL**。vision 文档 §4.3 提到的"图谱优势"反而被 N+1 拖慢。

**修复**：`WHERE (doc_id, chunk_index) IN ((?, ?), (?, ?), ...)` 一次性查。

---

### 🟠 P1 — 应当修

#### P1-1: `includeCommunities` / `includeGodNodes` 选项撒谎

**位置**：`src/memory/knowledge-graph/recall.ts:22-24, 55-56`

`RecallOptions` 声明了两个选项，但 recall 实现**完全没用**。Vision 文档 §4.2 提到的社区兜底 / god node 兜底**根本没实现**。

**修复**：要么实现（成本：2 小时），要么删掉选项（成本：10 分钟）。

#### P1-2: Neo4j fulltext 索引覆盖了 `n.properties.value` 但 properties 是 JSON 字符串

**位置**：`src/memory/knowledge-graph/neo4j-store.ts:91`

```cypher
CREATE FULLTEXT INDEX node_search IF NOT EXISTS FOR (n:KBNode) ON EACH [n.label, n.tags, n.properties.value]
```

Neo4j 的 properties 是 JSON 字符串（我们 `JSON.stringify` 存的），`n.properties.value` 索引的是字符串整体，**几乎不可能命中**。

**修复**：要么 (a) 把 `value` 提到 Neo4j 节点级别字段（`n.value`）；要么 (b) 索引只覆盖 `[n.label, n.tags]`。

#### P1-3: 修 3 LLM 调用次数翻倍

**位置**：`src/memory/knowledge-graph/extraction-pipeline.ts:363-365`

```typescript
const [extractedEntities, relations] = await Promise.all([
  extractEntities(chunk.text, options.llmProvider),
  extractRelationships(chunk.text, options.llmProvider),  // ← 两次 LLM
]);
```

每个 chunk 调 **2 次 LLM**。Vision 文档说"合并成单次 LLM 调用"。修 3 写成两次，**单文档的 LLM 成本翻倍**。

**修复**：合并 prompt（"先列 entities，再列 relations，关系引用 entity id"）。

#### P1-4: MySQL `scoreNodes` 仍全表扫描

**位置**：`src/memory/knowledge-graph/bfs-extractor.ts:50-77`

阶段 5 给 Neo4j 加了 `searchNodesByKeywords`（fulltext index），但**MySQL 后端没有等价实现**。MySQL 走 fallback `getAllNodes()` 全表扫描 + 内存字符串匹配。

大用户图谱（10K+ 节点）下每次 query 都全表扫，O(10K × N tokens)。

**修复**：给 MySQL store 加 `searchNodesByKeywords`，用 MySQL FULLTEXT 索引（`kb_graph_nodes` 表 schema 可以加 FULLTEXT 索引覆盖 `label` / `tags`）。

#### P1-5: 修 2 那批测试被改写后，原"启发式"实现只剩 fallback 路径

**位置**：`src/memory/knowledge-graph/chinese-tokenizer.ts` 的 `heuristicChineseTokenize`

阶段 6 集成 nodejieba 后，`heuristicChineseTokenize` 只在 jieba 加载失败时被调用。但**没有运行时健康检查**告诉用户"我们在用降级路径"，也没有"加载失败报警"写到日志。

**修复**：在 `getGraphHealth` 加 `tokenizerBackend: "nodejieba" | "heuristic"` 字段；启动时确保 jieba 加载成功（不成功应该 fail-fast）。

#### P1-6: query-understanding 缓存 unbounded

**位置**：`src/memory/knowledge-graph/query-understanding.ts:75`

`QUERY_CACHE = new Map<string, QueryUnderstanding>()` — process-global，无 LRU、无 TTL、无大小上限。

长跑进程会缓慢泄漏。每个 query 一个 entry，key 是 query 字符串。**有 1MB cache 累积到 100MB 的潜在风险**。

**修复**：用 LRU 替换（`LRUCache` 类已在项目里）。

#### P1-7: `as any` 鸭子类型累积（6 处）

**位置**：
- `recall.ts:90, 91, 107, 128`
- `feedback-pipeline.ts:44, 45, 65, 66`
- `knowledge-skills.ts:2907`
- `extraction-pipeline.ts:242`

GraphStoreLike 接口已声明这些方法（`getNode`、`updateEdge` 等），但 `recall.ts` / `feedback-pipeline.ts` 里仍然用 `typeof (store as any).X === "function"` 检查。

**修复**：把 GraphStoreLike 上的可选方法改成"应该是必选的，但用 `as any` 是因为 interface 没把所有可选暴露"。统一成 `GraphStoreLike` 必填 + `extractFromDocument` 等用类型断言。

#### P1-8: `extractSubgraph` 的 ACL 过滤只在 isAllowedKbNode 里

**位置**：`src/memory/knowledge-graph/bfs-extractor.ts:69-85`

`isAllowedKbNode` 检查 `node.tags.includes('kb_document')` 然后看 id prefix。但**只对 kb_document 节点过滤**——其他类型节点（entity、concept）永远允许。这其实是**有意为之**（entity 不是文档）但**没文档说明**。

#### P1-9: ZH_TAG_MAP 噪声（`bfs-extractor.ts:14-23`）

`scoreNodes` 把 "健康" 展开成 `["health", "fitness", "medical"]` 三个英文 tag。这是为了"用户用中文 query、图谱里只有英文节点"的场景。

但**噪声很大**：用户 query "健康" 实际只想 health 概念，"fitness" / "medical" 是盲目展开。**召回了无关的 entity**。

**修复**：去掉 ZH_TAG_MAP（阶段 6 后中文 tokenize 已经够准了），或者改成更保守的同义词词典（仅 medical/finance 等垂直领域）。

#### P1-10: 修 1 graphContext 改 schema 是 breaking change

**位置**：`src/skills/knowledge-skills.ts:2955-2964`（新 graphContext 结构）

之前 `graphContext: { seedEntities: [id], relatedEntities: count, paths: count }`，现在是：
```typescript
{
  queryType, seedEntities: [{id, label, type, ...}],
  relatedEntities: [...], paths: [{nodes, relationLabels}], 
  subgraphSummary, communityIds
}
```

**前端如果有消费 graphContext 的代码**（可视化、引用点击），会拿到 undefined 字段。

**修复**：写一份 `GRAPH_CONTEXT_CHANGELOG.md` 通知前端；或保留旧字段名做兼容。

---

### 🟡 P2 — 改进项

#### P2-1: graph-skills.ts 的 `graph_deduplicate` 还漏 await？

**位置**：`src/skills/graph-skills.ts:172`

阶段 1 修了。**已修**。保留为参考。

#### P2-2: feedback-pipeline 路径发现 O(n²)

**位置**：`src/memory/knowledge-graph/recall.ts:125-137`

`for i { for j { findShortestPath } }` 是 O(n²)。5 seed = 10 对，10 seed = 45 对。

**修复**：阶段 4 没改。长期用 Neo4j `apoc.algo.dijkstra` 一次性拿所有 pair 的最短路径。

#### P2-3: feedback 训练样本导出未接 LLM 微调

**位置**：`src/memory/knowledge-graph/feedback-pipeline.ts` 的 `asExtractionSample` 函数

接口有了，但**没有调度器**把 JSONL 喂给微调流程。这是阶段 4 标了但没做的。

#### P2-4: extractRelationsToGraph 还在用"relation 副产物"路径

**位置**：`src/memory/knowledge-graph/extraction-pipeline.ts:172-187`（`extractRelationsToGraph` 内）

修 3 改了 `extractFromChunk` 用独立的 `extractEntities` 调用，但 `extractRelationsToGraph`（生产用得最多的入口）**没改**，仍然走"entity 是 relation 副产物"路径。

**结果**：修 3 改了"应该改的"，但**生产路径（kgExtractionQueue → extractRelationsToGraph）仍然只用 relations 推 entity**。修 3 的收益**没传导到生产**。

**修复**：把 `extractRelationsToGraph` 内部也改用 `extractFromChunk` 路径。

#### P2-5: feedback-pipeline.ts 权重计算 EMA 有"反效果"

**位置**：`src/memory/knowledge-graph/feedback-pipeline.ts:75-85`

```typescript
const newImportance = event.accepted
  ? Math.max(targetImportance, 0.9 * oldImportance + 0.1 * signal)
  : Math.min(targetImportance, 0.9 * oldImportance);
```

逻辑混乱——`Math.max(targetImportance, 0.9*old+0.1)` 在 old=0.5, target=0.55 时返回 0.55（合理），但 old=0.7, target=0.75 时返回 0.75（也合理），**只在 old=0.5, target=0.4 时返回 0.45**。整体行为正确但**代码意图不清**。应该重构成 `new = clamp(old * 0.9 + signal * 0.1, 0, 1)` 一行。

#### P2-6: health-metrics 全量加载节点

**位置**：`src/memory/knowledge-graph/health-metrics.ts:36-40`

```typescript
const nodes = await store.getAllNodes();
for (const n of nodes) {
  const degree = await store.getDegree(n.id);  // ← N+1!
  ...
}
```

健康检查本身是 N+1（每节点 1 次 getDegree）。10K 节点 = 10K 次 SQL。

**修复**：用单条 SQL `SELECT node_id, COUNT(*) AS degree FROM edges WHERE ... GROUP BY node_id` 一次性拿。

#### P2-7: 多个子图检索的并发问题

`kgExtractionQueue` 的 worker 串行执行（concurrency=1），但同一用户多文档入队时**互相阻塞**。建议改为按 user 分组并发（per-user 串行，全局并发 N）。

#### P2-8: Neo4j GDS / APOC 没用上

**位置**：`src/memory/knowledge-graph/neo4j-store.ts` 整个文件

阶段 5 标了但没做：
- `apoc.algo.dijkstra` 替代手写 BFS 最短路径
- `gds.louvain` 替代手写 Louvain 社区检测
- `gds.pageRank` 替代 `identifyGodNodes`

需要 Neo4j GDS 插件，CI 环境没装。

---

## 3. 修 3 是否真正闭环（详细分析）

修 3 的设计意图：
> 拆分 entity / relation 抽取，entity 不再是 relation 副产物

**实际落地情况**：

| 路径 | 是否用了新逻辑 | 备注 |
|------|--------------|------|
| `kb_ingest` (HTTP) | ✅ 入队 → 走 `kgExtractionQueue.runJob` | `runJob` 调 `extractRelationsToGraph` |
| `ParsingQueue` (Document Mind) | ✅ 入队 | 同上 |
| `ParsingQueue` (本地解析) | ✅ 入队 | 同上 |
| `extractRelationsToGraph` 内部 | ❌ 仍用"relation 副产物"路径 | **未走 extractEntities** |
| `extractFromDocument` (stage 2 API) | ✅ 走 extractFromChunk → extractEntities | 但 caller 不用 |
| `kgExtractionQueue` 实际调用 | ❌ 用 `extractRelationsToGraph` | **没用新 API** |

**结论**：修 3 的新 API（`extractEntities`）**只是装饰性存在**。生产路径仍然走"entity 是 relation 副产物"。

要真正闭环，需要：
1. `extractRelationsToGraph` 内部改用 `extractFromChunk` 逻辑
2. 或 `kgExtractionQueue` 改用 `extractFromDocument`，并让它直接写图谱

---

## 4. 测试覆盖盲区

### 4.1 修 1/2/3 缺的关键测试

- ❌ **没有 graphContext 结构的 e2e 断言**：只测了 `summarizeSubgraph` 输出包含 label，没测 `kb_search` 返回的 `graphContext` 字段确实是新结构
- ❌ **没有 extractEntities 写回图谱的断言**：`kgExtractionQueue.runJob` 调用后，**没断言"独立出现的 entity 也被建出来"**
- ❌ **没有 ACL 跨用户的 e2e**：所有 recall 测试都单用户，跨用户共享场景没覆盖

### 4.2 已有测试不够的地方

- `kg-v2-stage3.test.ts` 的 13 个测试中，**0 个测 `includePaths: true` 的真实路径返回**（只有 `if (seedAfterAcl.length >= 2)` 兜底分支）
- `kg-v2-stage4.test.ts` 没测**反馈 → importance EMA 多次累积**（只测单次）
- `kg-v2-stage5.test.ts` 5 个测试**全用 mock store**，没真连 Neo4j 跑过

### 4.3 性能测试

- ❌ **没有大图性能基准**：vision 文档 §8.3 提到的"大图谱（>10k 节点）性能基准"完全没做
- ❌ **没有 KG-first vs hybrid-only 的 A/B 框架**：vision §8.3 的 A/B 测试验收条件无支撑

---

## 5. 文档/工程化问题

### 5.1 commit 习惯

17 文件改动、+1646 行，**没有拆成多个 commit**。理想拆分：
1. 修 1 (字段扩展 + type extension)
2. 修 2 (entity linker + query understanding)
3. 修 3 (Neo4j 原生)
4. 修 4 (抽取离线化)
5. 修 5 (KG-first 检索)
6. 修 6 (反馈环路)
7. 修 7 (Neo4j 原生化)
8. 修 8 (三个修复合计)
9. 修 9 (nodejieba 集成)

**当前状态**：11 个 commit 已经在 git log 里，但**没有按这个粒度**。后续 review/PR 会很难。

### 5.2 文档

- ✅ `docs/KNOWLEDGE_GRAPH_REVIEW.md` (v1 旧)
- ✅ `docs/KNOWLEDGE_GRAPH_REVIEW_v2.md` (v2 旧)
- ✅ `docs/KG_ARCHITECTURE_VISION.md` (设计)
- ❌ 缺 **`docs/CHANGELOG_KG.md`**：1-6 阶段改了什么 + 三个修复 + 阶段 6
- ❌ 缺 **`docs/GRAPH_CONTEXT_CHANGELOG.md`**：graphContext 字段 breaking change 通知
- ❌ 缺 **`docs/OPERATIONS.md`**：Neo4j 部署、迁移注意事项、监控

### 5.3 类型系统债务

`as any` 散布在 4 个文件（recall、feedback-pipeline、knowledge-skills、extraction-pipeline）。**这意味着 GraphStoreLike 接口是不完整的**——它没把 Neo4jGraphStore / SessionWithGraphManager 的所有能力暴露出来。

短期：把 GraphStoreLike 加完整。  
长期：让 Neo4jGraphStore 和 GraphStore 都 implements 同一个 interface，强制类型对齐。

---

## 6. 行动建议（按 ROI 排序）

### 立即做（1-2 天）

1. **P0-1 ACL 漏洞**（`recall.ts` `isAllowed`） — 安全问题
2. **P0-3 chunk-expander N+1 SQL** — 性能问题
3. **P0-2 修 3 闭环**：让 `extractRelationsToGraph` 真正调用 `extractEntities`，或写明"修 3 是 dead code"

### 本周做（1 周）

4. **P1-1 删/实现 includeCommunities + includeGodNodes** 选项
5. **P1-3 合并 LLM 调用**：单次 prompt 同时抽 entities + relations
6. **P1-7 修 `as any`**：补全 GraphStoreLike
7. **P1-6 LRU 缓存**：替换 query-understanding 的 Map
8. **P1-4 MySQL scoreNodes 优化**：FULLTEXT 索引

### 中期做（1 月）

9. **P1-2 Neo4j fulltext 索引修复**：去掉 `n.properties.value` 索引
10. **P2-6 health-metrics N+1** 修复
11. **P2-2 recall O(n²) 路径** 改 Neo4j APOC

### 长期做（季度）

12. Neo4j GDS 集成（Pagerank、APOC、Louvain）
13. 大图性能基准测试
14. 训练样本 → LLM 微调管线

---

## 6.5 P0/P1 修复完成度（2026-06-03）

| P | 状态 | 文件 | 备注 |
|---|------|------|------|
| P0-1 ACL 漏洞 | ✅ | `recall.ts:135-167` | `subgraph.nodes.filter(isAllowed)` + `safeEdges` + paths 校验 |
| P0-2 修 3 闭环 | ✅ | `extraction-pipeline.ts:154-185` | `extractEntities` 真正接通；2 个 e2e 证明 |
| P0-3 N+1 SQL | ✅ | `chunk-expander.ts:60-99` | `fetchChunksByDocAndIndex` 批量 OR 查询 |
| P1-1 伪 options | ✅ | `recall.ts:22-24, 55-56` | 删 `includeCommunities` / `includeGodNodes` |
| P1-2 死 FULLTEXT 字段 | ✅ | `neo4j-store.ts:91` | 索引只覆盖 `label` / `tags` |
| P1-3 QUERY_CACHE LRU | ✅ | `query-understanding.ts:57-100` | LruQueryCache 类，200 条上限 |
| P1-4 MySQL FULLTEXT | ✅ | `graph-store.ts:425-484` + 迁移 v20 | ngram parser 索引 + 默认 FULLTEXT |
| P1-5 tokenizer health | ✅ | `health-metrics.ts:32-37, 79-87` | 暴露 `tokenizer.backend` |
| P1-6 LLM 合并 | ✅ | `relationship-extractor.ts:178-271` | `extractEntitiesAndRelationships` 合并调用 |
| 隐藏修 FULLTEXT 0-hit fallback | ✅ | `bfs-extractor.ts:56-62` | 改前 FULLTEXT 0 命中直接 return；改后降级到内存匹配（修了 3 个原本会失败的测试） |
| 修 A `extractRelationsToGraph` 接合并调用 | ✅ | `extraction-pipeline.ts:156-167` | 生产路径也用 `extractEntitiesAndRelationships`，**再省 50% LLM 成本** |
| 修 B 删 `keyByPair` 死代码 | ✅ | `chunk-expander.ts:136-144` | 清掉 5 行 dead code |

**测试战绩**：547/547（`tests/memory/knowledge-graph/` 168 + `tests/skills/` 215 + `tests/memory/` 164），`tsc --noEmit` 0 error。

---

## 6.6 P2 Backlog（自审发现，未修）

| P2 项 | 文件 | 影响 | 建议 |
|-------|------|------|------|
| **P2-7** `searchNodesByKeywords` 评分用 `score / 5` 魔法值 | `graph-store.ts:481` | 真实命中分被压成 0.5，斜率错 | 用真实数据校准：跑 1000 真实查询，把 (raw score, 人工相关性) 画散点，回归系数 |
| **P2-8** ngram FULLTEXT 索引依赖 MySQL 插件 | `mysql-database.ts:1112+` | 缺插件的 minimal 镜像 migration 失败、整条 KG 检索挂 | `try/catch` 包 ngram 索引创建；失败时只建默认 FULLTEXT + ops 告警；README 标依赖 |
| **P2-9** 测试用 `setTimeout(100)` 等 FULLTEXT 索引刷新 | `graph-store.test.ts` (P1-4) | race condition 没消除只是被掩盖 | 测试里加 `OPTIMIZE TABLE kb_graph_nodes` 或调 `innodb_optimize_fulltext_only=ON` |
| **P2-10** `extractEntitiesAndRelationships` 不容错 LLM 返回 array | `relationship-extractor.ts:223+` | LLM 偶尔返回 `[entity1, ...]` 时静默 0 命中 | 加 `if (json.startsWith("[")) ... 走 array 兜底` 路径 |
| **P2-11** P0-1 ACL 用 `n.id.includes(id)` 模糊匹配 | `recall.ts:94` | 理论上有边角误中 | 改成精确 `n.id === id` 或维护 id 白名单表 |
| **P2-12** `as any` 累积（6+ 处） | `recall.ts`, `bfs-extractor.ts`, `feedback-pipeline.ts`, `extraction-pipeline.ts` | duck typing，类型不安全 | 提 `GraphStoreLike` interface 把方法变 required，零成本移除所有 `as any` |

---

## 7. 一句话总结

> 1-6 阶段 + 三个修复在**测试通过 + 类型干净**层面非常扎实，但**有 3 个真 P0 没接通**（ACL 漏洞、修 3 闭环、N+1 SQL）和 **10 个 P1/P2 累积债务**。最关键的是**修 3 没真正闭环**——`extractEntities` 抽出来的纯 entity 没有任何路径写回图谱，生产路径仍走"entity 是 relation 副产物"的老路。
>
> 接下来应当先修 3 个 P0，1-2 天能搞定；其它 P1/P2 分批消化。

---

## 相关 commit

| SHA | 标题 | 与本文档关系 |
|-----|------|--------------|
| [`ea805e1`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **docs(kg): 阶段 0 文档** | 本文档是这次 commit 引入的——v3 全面 review，识别 3 P0 + 10 P1 + 7 P2 |
| [`b6a6e75`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **阶段 1-2: 地基 + 离线化抽取** | §2 P0-2 修 3 闭环 / §2 P0-3 N+1 SQL 的代码修复散在这里（散在 18 文件的大 commit 里） |
| [`63c6618`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **test(kg): 阶段 1-6 + 修 1+2+3 + P0 e2e** | §6.5 修复完成度表里列出的 P0 测试覆盖都在这次 commit |
| [`341d902`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **阶段 5-6: Neo4j fulltext + nodejieba** | §6.5 提到 Neo4j fulltext / nodejieba 集成对应此 commit |

详细索引见 [CHANGELOG_KG.md §Commit Map](CHANGELOG_KG.md#-commit-mapcommit--docs)。
