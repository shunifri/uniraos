# RAOS 知识图谱全链路 Review（v2 增量）

> 文档版本: v2.0  
> 评审范围: `src/memory/knowledge-graph/`、`src/skills/graph-skills.ts`、`src/skills/knowledge-skills.ts`（图谱相关片段）、`src/services/parsing-queue.ts`（图谱同步片段）、`src/kb-graph-sync.ts`、`src/routes/graph-routes.ts`、`src/user/user-session.ts`  
> 与 v1 的关系: 在 `docs/KNOWLEDGE_GRAPH_REVIEW.md`（v1.0，2024-05）基础上做**增量 review**——只覆盖 v1 之后代码的状态变化、新发现的问题与未修复的旧 bug，不重复 v1 已经写清楚的全景图。

---

## 0. TL;DR

v1.0 review 写完之后，代码又演进了一轮，核心变化是 **LLM 关系抽取已经从"零集成"变成了"在两个地方都跑起来了"**——`kb_ingest` 主线和 `ParsingQueue` 后台都会调 `extractRelationships`。

但这一轮增量引入了 **3 个真实的 bug** 和 **2 处重复逻辑**，v1 列出的多个高风险问题（Neo4j 原生算法未用、`scoreNodes` 全表扫描、图谱与主检索脱节）依然没有修。

按"现在最该修"排：

| 优先级 | 问题 | 类别 |
|--------|------|------|
| 🔴 P0 | `e.relation` 字段在 `GraphEdge` 上不存在 → 边去重**永远不命中**，每次 LLM 抽取都会写新边 | Bug |
| 🔴 P0 | `EdgeType` 类型被代码绕过（写入 `"PERSONAL"` / `"CONTAINS"` / `"LLM_EXTRACTED"`） | Bug / 类型 |
| 🟠 P1 | `graph_deduplicate` skill 漏 `await`，返回的 `Promise` 被当结果读 | Bug |
| 🟠 P1 | `parsing-queue` 与 `knowledge-skills` 各自实现了一份 LLM 抽取，逻辑、限制、anchor 节点都不同 | 重复 |
| 🟠 P1 | `user-session.ts` 默认 `neo4j`，`manager.ts` 构造函数默认 `mysql`——后端默认配置不一致 | 配置 / 一致性 |
| 🟡 P2 | v1 列出的 Neo4j 原生算法适配、`scoreNodes` 索引化、图谱×主检索融合 仍未推进 | 演进债务 |

---

## 1. v1 → v2 状态对比

### 1.1 v1 的判断在当前代码里仍然成立

| v1.0 判断 | 当前代码状态 | 变化 |
|----------|------------|------|
| 节点 label = LTM `key`，语义贫瘠 | `manager.ts:117` 仍 `label: entry.key` | 未变 |
| `onFactStored` 中 PERSONAL 边硬编码 | `manager.ts:99-150` 仍是 `user_*` 前缀匹配 | 未变 |
| TEMPORAL 边硬上限 5 | `manager.ts:169` `.slice(0, 5)` | 未变 |
| `graphSearch` 永远只返回 `graph_subgraph` | `manager.ts:360` `matchType: 'graph_subgraph'` 写死 | 未变 |
| Neo4j 后端未用 GDS / APOC | `neo4j-store.ts` 全部 CRUD Cypher，无 `gds.*` 调用 | 未变 |
| `scoreNodes` 全量加载 + 字符串匹配 | `bfs-extractor.ts:37-60` 仍是 `getAllNodes()` 内存匹配 | 未变 |
| `kb_search` 主流程不调 `graphSearch` | 已有入口（见 §1.3）但实际命中条件严苛 | 部分修 |
| `classifyQuery` 结果未影响策略 | `knowledge-skills.ts:2997` 已用 `classified.type` 决定走图谱 | **已修** |
| `kb_graph_nodes` 缺 `(owner_id, type)` 复合索引 | `db/database.ts:997` 仍是单列 | 未变 |

### 1.2 v1 的判断**已被推翻**

v1 写：

> `extractRelationships()` **从未在主线流程中被调用**。

这条判断**不成立了**。当前代码里 LLM 关系抽取已经在 3 个主流程里被使用：

1. **`kb_ingest` 主流程**（`src/skills/knowledge-skills.ts:2510-2630`）
   ```typescript
   const relations = await extractRelationships(chunkText, llmProvider);
   // 分批处理：chunkSize=3000, overlap=500
   // 每段最多 20 个关系
   // 创建 doc anchor (kb_doc_<docId>) 并把抽取的实体都连过去
   // 边类型: "LLM_EXTRACTED"（注意：绕过 EdgeType 类型，见 §2.2）
   ```

2. **`ParsingQueue` 文档解析完成回调**（`src/services/parsing-queue.ts:599-635` 和 `1266-1302`）
   ```typescript
   const relations = await extractRelationships(docContent.slice(0, 2000), llmProvider);
   // 一次性取前 2000 字符
   // 最多 30 个关系
   // 边类型: "LLM_EXTRACTED"
   ```

3. **`ParsingQueue` 音视频 segment 处理**（`src/services/parsing-queue.ts:585-593`）
   ```typescript
   for (const segment of segments.slice(0, 10)) {
     await graphManager.onFactStored({...});
   }
   ```

v1 还写：

> `classifyQuery` 的分类结果**未影响任何检索策略**。

当前 `knowledge-skills.ts:2997` 已经这样写：
```typescript
if ((classified.type === 'relational' || classified.type === 'discovery') && graphManager) {
  // 走图谱增强检索
}
```
所以 v1 的"分类未生效"这条也要更新为**部分生效**：`relational` 和 `discovery` 会触发 `graphSearch`，但 `factual` / `hybrid` 仍然走混合检索，没拿到图谱增强。

### 1.3 v1 没提但 v2 看到的新增能力

- **`kb_search` 已经接入了 `graphSearch` 作为 pre-filter**（`knowledge-skills.ts:2997-3052`）：当分类是 relational/discovery 时，先用 `graphSearch` 拿一批 docId，再把这些 docId 作为 `searchWithCollections` 的硬过滤，最后给结果打 `graph_boost`。
- **`graphSearch` 内部实现了 GodNode + Community 的 fallback 补全**（`manager.ts:282-324`）：直接匹配不足时，按中心节点→社区两个层级的邻居扩展。
- **`hybrid-search.ts` 也接入了图谱**（`hybrid-search.ts:122-167`）：作为后置 enrichment，`graph_boost` 字段被合并进最终排序。
- **Neo4j 后端在 `user-session.ts:78` 成为默认后端**（环境变量未设置时），与 `manager.ts:31` 的 `mysql` 默认值不一致——见 §2.4。

---

## 2. v2 新发现的 Bug

### 2.1 🔴 P0 — `e.relation` 字段不存在，边去重失效

**位置**:
- `src/services/parsing-queue.ts:631` / `:1298`
- `src/skills/knowledge-skills.ts:2600-2601`

**Bug 描述**:
`GraphEdge` 类型定义在 `src/memory/knowledge-graph/types.ts:14-22`：

```typescript
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;       // ← 只有 type
  label: string;        // ← 关系描述在这里
  weight: number;
  createdAt: number;
}
```

**没有 `relation` 字段**。但代码在 LLM 抽取后去重时这样写：

```typescript
// parsing-queue.ts:631
if (existingEdges.every((e: EdgeWithRelation) => e.relation !== rel.relation)) {
  await store.addEdge(sourceNode.id, targetNode.id, "LLM_EXTRACTED", rel.relation);
}
```

由于 `e.relation` 永远是 `undefined`，`undefined !== rel.relation` 永远为 `true`，**意味着每条抽取的关系都会被写入图谱，无视是否已存在同源同目标的边**。

`knowledge-skills.ts:2597-2611` 的写法同样有问题：

```typescript
const existingEdges = await store.getEdgesBetween(sourceNode.id, targetNode.id);
const hasEdge = existingEdges.some(e =>
  e.relation === rel.relation ||
  e.relation === normalizeRelationType(rel.relation)
);
```

`e.relation` 永远是 `undefined`，所以 `hasEdge` 永远是 `false`——**dedup 逻辑形同虚设**。

**影响**:
- 一份 10k 字的文档被 `kb_ingest` 处理一次，会产生几十到上百条重复边（同源同目标但 `id` 不同）。
- 同一节点（"用户"、"深色模式"）会从不同 LLM 抽取中重复建边。
- BFS / 社区检测 / 评分都会因重复边而失真。

**修复方向**:
1. 把 `e.relation` 改成 `e.label`（`GraphEdge.label` 就是关系描述）。
2. 或者在 `GraphEdge` 上**新增**一个 `relation: string` 字段（语义化的关系类型），并把所有 addEdge 写入时把 `label` 和 `relation` 分别填上。

建议选方案 1（最小修改），同时把方案 2 作为长期演进——因为现在 `label` 同时承担了"人类可读的关系名"和"关系类型"两个语义，比较糊。

**测试**:
- `tests/memory/knowledge-graph/manager.test.ts` 的 EXTRACTED edge 测试没用 `e.relation`，所以没暴露。
- `tests/memory/knowledge-graph/relationship-extractor.test.ts` 只测了 `extractRelationships` 函数本身，不测去重路径。

需要新增 e2e 测试：写两次相同 `(source, target, relation)`，断言 `getEdgesBetween().length === 1`。

---

### 2.2 🔴 P0 — `EdgeType` 类型被绕过，写入 `PERSONAL` / `CONTAINS` / `LLM_EXTRACTED`

**位置**:
- `manager.ts:148, 579` — `addEdge(... "PERSONAL", edgeLabel)`
- `knowledge-skills.ts:2617, 2623` — `addEdge(... "CONTAINS", "mentions_in_doc")`
- `parsing-queue.ts:632, 1299` — `addEdge(... "LLM_EXTRACTED", rel.relation)`

**类型定义**:
```typescript
// types.ts:2
export type EdgeType = "EXTRACTED" | "INFERRED" | "TEMPORAL";
```

代码里却传了 5 种字面量，其中 3 种 (`PERSONAL`/`CONTAINS`/`LLM_EXTRACTED`) 不在定义里。

**为什么 TS 没报错**:
- `neo4j-store.ts:330` 用了 `edge.type.replace(/[^a-zA-Z0-9_]/g, '_')`，把 `type` 字段当字符串用。
- `manager.ts:148` 的 `addEdge` 是 `any` 接收（`store: any | null`），所以类型校验被绕过。
- `graph-store.ts:303` 的 SQL 直接 `INSERT INTO ... VALUES (... type, ...)`，DB 层也只认字符串。

**影响**:
- 编译期类型系统**没有起到任何约束作用**，未来加新边类型时容易拼错。
- `manager.ts:570-578` 的 "deduplicate 保留较早节点，转移关系" 完全靠运行时字符串比较，如果某天类型字面量改名（如 `EXTRACTED` → `EXTRACTED_FROM`），需要全局搜索替换。
- `tests/memory/knowledge-graph/manager.test.ts:57` 断言 `edges.some(e => e.type === "EXTRACTED")` 是对的，但没人测过 `PERSONAL`/`CONTAINS`/`LLM_EXTRACTED`——意味着新增的边类型**没有任何回归测试**。

**修复方向**:
```typescript
// types.ts
export type EdgeType =
  | "EXTRACTED"      // 来自 ltm_store / relation 参数
  | "INFERRED"       // 来自 LLM 关系抽取
  | "TEMPORAL"       // 来自 tag 重叠
  | "PERSONAL"       // 来自个人信息聚合（user_* 系列）
  | "CONTAINS"       // 来自 doc anchor → 实体
  | "LLM_EXTRACTED"; // 来自 LLM 关系抽取（与 INFERRED 的语义区分待定）
```

然后在 `manager.ts:10-12` 的 `KnowledgeGraphManager` 上加 `private backend: string` 的类型保护 / 在 `addEdge` 入参加 `EdgeType` 类型断言。

建议**保留 v1 写的 3 个 + 加上这 3 个** = 6 种。

---

### 2.3 🟠 P1 — `graph_deduplicate` skill 漏 `await`，且 Promise 当结果读

**位置**: `src/skills/graph-skills.ts:171-180`

```typescript
handler: async (params) => {
  // ...
  const store = await gm.getStore();
  const result = store.deduplicateNodes();   // ← 漏 await
  return {
    success: true,
    data: {
      merged: result.merged,                 // ← undefined
      removed: result.removed,               // ← undefined
      message: `去重完成：合并 ${result.merged} 个节点，移除 ${result.removed} 个重复节点`
    }
  };
}
```

**影响**:
- 实际去重在后台跑，前端却立即看到 success + 全是 `undefined` 的"完成"消息。
- 错乱的 UX + 没有任何错误处理（如果去重失败也无从知晓）。

**修复**: 加 `await`：
```typescript
const result = await store.deduplicateNodes();
```

**测试**: `tests/skills/knowledge-skills.test.ts` 没有 `graph_deduplicate` 的用例（其他 3 个 graph skill 也没专门测）——需要补。

---

### 2.4 🟠 P1 — 后端默认配置不一致

**位置**:
- `src/user/user-session.ts:78` — `process.env.GRAPH_STORE_BACKEND || "neo4j"`
- `src/memory/knowledge-graph/manager.ts:31` — `backend: string = process.env.GRAPH_STORE_BACKEND || "mysql"`

**当前行为**:
- `user-session.ts` 永远先传 `neo4j` 给 `KnowledgeGraphManager` 构造函数。
- 构造函数拿到 `neo4j` 后调 `createStore()`，里面 `verifyConnection()`，**失败才 fallback 到 mysql**。
- 但如果用户**没有 Neo4j 服务**，每次 `getOrCreate` 都会做一次连接验证（带超时），多用户场景下首次启动有明显延迟。
- 反过来，如果环境变量显式设了 `GRAPH_STORE_BACKEND=mysql`，`user-session.ts:78` 的 `||` 会 fallback 到 `"mysql"`，但默认值 `"neo4j"` 仍然存在歧义。

**影响**:
- 文档（`NEO4J_INTEGRATION.md`）和实际默认行为对不上——开发者按文档走会以为默认是 MySQL。
- 部署到没有 Neo4j 的环境时，需要**显式** `GRAPH_STORE_BACKEND=mysql` 才能避免启动延迟。
- 单元测试里 `new KnowledgeGraphManager("test-owner")` 不传 backend 参数，**fallback 到 mysql**——和真实运行路径不一致。

**修复**: 统一两处的默认值。建议改成：
- `user-session.ts:78` → `process.env.GRAPH_STORE_BACKEND || "mysql"`
- 在环境变量缺失时给一条启动日志明示当前选了什么后端。
- 给 `manager.ts:31` 的 `backend` 形参加一个 Zod / TS 字面量联合保护：`"mysql" | "neo4j"`，避免拼错。

---

## 3. 重复逻辑：`ParsingQueue` vs `knowledge-skills` 的 LLM 抽取

v1 review 没专门提这点，但 v2 看到这是**最大的可维护性风险**。

**对比表**：

| 维度 | `kb_ingest`（`knowledge-skills.ts:2507-2630`） | `ParsingQueue`（`parsing-queue.ts:596-636`） | `ParsingQueue` 本地解析（`parsing-queue.ts:1263-1303`） |
|------|------------------|------------------|------------------|
| 入库内容 | 用户传入的 `content` 或 `parsedContent` | `getDocumentContent()` 返回的内容 | 同上 |
| 内容截断 | 分批 3000 字符，overlap 500 | 前 2000 字符 | 前 2000 字符 |
| 每批关系数 | ≤ 20 | — | ≤ 30 |
| 文档锚点 | `kb_doc_<docId>` 显式创建 | 不创建 | 不创建 |
| 边类型 | `LLM_EXTRACTED` | `LLM_EXTRACTED` | `LLM_EXTRACTED` |
| 标签 | 文档 tags | 文档 tags | 文档 tags |
| 实体类型推断 | `inferEntityType(normalizedSource, rel.relation)` | 硬编码 `"entity"` | 硬编码 `"entity"` |
| 实体去重 | `nodeCache`（Map）+ 跨分片缓存 | 每次都查 `findNodeByLabel` | 同上 |
| 节点 ID 模式 | `ext_<timestamp>_<random>` | `extracted_<timestamp>_<random>` | `extracted_<timestamp>_<random>` |
| 是否连到 doc anchor | ✅ 是 | ❌ 否 | ❌ 否 |
| 错误处理 | try/catch + warn log | try/catch + warn log | try/catch + warn log |

**真实风险**:
- 同一份文档可能会被 `kb_ingest` 和 `ParsingQueue` **各跑一次 LLM 抽取**（取决于入库路径）——产生双倍节点和双倍边。
- 即使 `e.relation` bug 修了，三处去重逻辑仍然是各自的 `nodeCache` / `findNodeByLabel`，没有共享——并发场景下还是会写重复节点。
- 三处对内容截断的策略不同（3000+overlap vs 2000）会导致抽取覆盖度不一致。

**修复方向**:
1. 抽一个 `extractRelationsToGraph({ graphManager, docId, docName, content, tags, options })` 公共函数，统一以下参数：
   - `chunkSize` / `overlap`
   - `maxRelationsPerChunk`
   - `createDocAnchor: boolean`
   - `inferEntityType: (label, relation) => NodeType`
2. `kb_ingest` 和 `ParsingQueue` 调同一个函数。
3. 在 `kb_ingest` 入口加幂等检查：同一 `docId` 的 LLM 抽取只跑一次（可用 `kb_graph_nodes` 里查 `kb_doc_<docId>` 节点是否存在 + 一个 `properties._extractedAt` 时间戳）。

---

## 4. v1 列出的高风险项当前状态

为了让 v1 文档不至于被读者忽略，下面把 v1 风险表里**还没修**的项单独列出来（v1 review 编号沿用）：

| v1 # | 问题 | 当前状态 | 建议 |
|------|------|---------|------|
| 1 | Neo4j 未发挥原生图算法优势 | 完全未动 | 见 §5.1 |
| 2 | BFS seed 发现是全量 O(n) 扫描 | 完全未动 | 见 §5.2 |
| 3 | 社区检测全量加载 + 多轮迭代 | 完全未动 | 见 §5.3 |
| 5 | KB 文档内容未自动抽取实体进图谱 | **部分修**（`kb_ingest` 现在调 LLM 抽取） | 见 §5.4 |
| 6 | `graphSearch` 永远只返回 `graph_subgraph` | 未动 | 见 §5.5 |
| 7 | `graph_deduplicate` 未 await | **已发现（v2 §2.3）** | 修 |
| 8 | 预计算锁是 boolean 而非真正互斥锁 | 未动 | 见 §5.6 |
| 11 | Neo4j `removeEdge` 未限定 `ownerId` | 未动 | 简单修复 |

---

## 5. 仍需推进的演进项（按 ROI 排序）

### 5.1 Neo4j 原生算法适配（高 ROI，仅在生产用 Neo4j 时）

v1 已经写过。补充一点：**当前 Neo4j 后端的连接管理是每次操作都 `session()` 新建/关闭**（看 `neo4j-store.ts` 所有方法），开销非常大。需要：
- 用 `driver.session({ defaultAccessMode: neo4j.session.READ })` 复用 session
- 写操作包在 `session.executeWrite()` 里，读操作在 `executeRead()` 里
- 用连接池（`maxConnectionPoolSize` / `connectionAcquisitionTimeout`）配置

### 5.2 `scoreNodes` 索引化（低成本高收益）

`bfs-extractor.ts:37` 的 `getAllNodes()` 是性能瓶颈。如果继续用 MySQL：
- 加 `(owner_id, label)` 复合索引已经存在（`db/database.ts:996`）——但 `scoreNodes` 没用上
- 把 `scoreNodes` 改成 DB 端 LIKE 查询：`WHERE owner_id = ? AND (label LIKE ? OR tags LIKE ?)`
- 至少加一个 label 前缀索引：`WHERE owner_id = ? AND label LIKE 'term%'`

如果切到 Neo4j：
- 创建 full-text index：`CREATE FULLTEXT INDEX node_search IF NOT EXISTS FOR (n:KBNode) ON EACH [n.label, n.tags, n.properties.value]`
- `scoreNodes` 改为 `CALL db.index.fulltext.queryNodes('node_search', $queryTerms) YIELD node, score`

### 5.3 社区检测增量更新

`community-detection.ts:46-103` 的 Louvain 每次都全量迭代 50 轮。Louvain 的 hot 优化（增量 Louvain）能在常数时间内合并新节点而不重启：
- 节点 v 加入社区 C 的 ΔQ 公式已经有了
- 增量实现：只对新增节点跑一次邻居评估，更新 `sigmaTot`
- 需要在 `onFactStored` / `addEdge` 里加一个"待重新评估"标记队列

### 5.4 KB 文档内容级图谱抽取

v1 写的"内容未进图谱"已经修了一半（`kb_ingest` 现在调 LLM 抽取），但：
- LLM 抽取只覆盖了 `relational` 关系，**没抽取实体本身**——节点是靠 LLM 抽取的"关系对"里的 source/target 自动创建的，没有"主语/宾语之外的实体"
- 没有 chunk 级别的 entity 节点，导致 `graphSearch` 拿到的 subgraph 只能从 doc anchor 跳到 LLM 抽取的 entity，**跳数**够但**密度**不够
- 建议在 `extractRelationships` 之前或之后，再调一次 `extractEntities`（同一个 prompt 的简化版），把文档里的所有命名实体（不一定是 relation 两端）也建出来

### 5.5 `graphSearch` 匹配类型返回错误的修复

`manager.ts:337-367` 的循环里 `matchType` 写死。实际应该按命中路径返回：
```typescript
if (subgraphResult.seedNodes.includes(docNode.id)) {
  matchType = 'graph_subgraph';
  // 种子节点——直接语义命中
} else if (this.precomputed.godNodes?.some(g => g.id === docNode.id)) {
  matchType = 'graph_path';
  // 通过中心节点中转
} else if (docNode.communityId !== undefined) {
  matchType = 'graph_community';
  // 通过社区发现
}
```

这样前端能根据 `matchType` 决定"高亮哪条路径"。

### 5.6 预计算锁的真正互斥

`manager.ts:26` 是 `private precomputeLock = false;`。
`ensurePrecomputed()` line 187 检查 `if (this.precomputeLock) return;` 然后置 true。
**问题**：
- 在异步操作 `await detectCommunities(store)` 之间，其他调用也读到了 `precomputeLock === false`（因为它是同步读，但 JS 是单线程的，所以不会并发读）
- 实际上 JS 单线程 + `async/await` 的执行模型意味着锁没起作用——`await` 之后的代码会被丢回 microtask 队列，期间同一个锁的判断早就过去了
- 真正的问题是：第一次 `ensurePrecomputed` 跑到一半时，第二次进来的 `ensurePrecomputed` 看到 `precomputed.communities === null` 且 `precomputeLock === false`（因为 `precomputeLock = true` 还没执行）——会**并发跑两次** `detectCommunities`

修复方案：用 `Promise` 形式的 inflight tracker：
```typescript
private precomputeInflight: Promise<void> | null = null;
async ensurePrecomputed(force = false): Promise<void> {
  const now = Date.now();
  if (!force && this.precomputed.communities && (now - this.precomputed.lastComputed) < ONE_HOUR) return;
  if (this.precomputeInflight) return this.precomputeInflight;
  this.precomputeInflight = (async () => { /* ... */ })();
  try { await this.precomputeInflight; } finally { this.precomputeInflight = null; }
}
```

---

## 6. 可观测性 / 监控缺口

当前图谱系统**没有任何健康度指标**暴露出来：
- 没有 `getStats()` 之外的 `getHealth()` —— 拿不到平均度数、孤立节点比例、连通分量数
- 前端 `/api/graph/stats` 只返回 node/edge/community 数量，看不到图谱"是否健康"
- 没有图谱大小上限的告警——一个用户的图谱能涨到多大没有保护

建议新增 `getGraphHealth()`：

```typescript
async getGraphHealth(): Promise<{
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  isolatedNodeCount: number;     // degree === 0
  orphanNodeCount: number;       // 只有 self-loop 或没有出边
  connectedComponents: number;
  topCommunitySize: number;      // 最大社区节点数
  communitySizeStdDev: number;   // 社区分布标准差
  kbDocumentCoverage: number;    // type=kb_document 节点 / KB 实际文档数
  relationTypeDistribution: Record<EdgeType, number>;
}>
```

然后：
- 在 `/api/graph/health` 暴露
- 在前端图谱页面加一个"健康度卡片"
- 大于阈值（比如孤立节点 > 50%）时主动调 `deduplicateNodes` 或提示用户

---

## 7. 行动项清单（按优先级）

| 优先级 | 行动 | 估时 | 涉及文件 |
|--------|------|------|---------|
| 🔴 P0 | 修 `e.relation` → `e.label`（或加新字段） | 1h | `parsing-queue.ts:631, 1298`、`knowledge-skills.ts:2597-2611` |
| 🔴 P0 | 修 `EdgeType` 字面量联合（加 `PERSONAL` / `CONTAINS` / `LLM_EXTRACTED`） | 1h | `types.ts`、所有 addEdge 调用点 |
| 🟠 P1 | 修 `graph_deduplicate` 漏 await | 5min | `graph-skills.ts:172` |
| 🟠 P1 | 统一 `ParsingQueue` 和 `kb_ingest` 的 LLM 抽取逻辑 | 4h | 抽公共函数、改 3 个调用点 |
| 🟠 P1 | 统一后端默认值（`user-session.ts` 改 `mysql`） | 30min | `user-session.ts:78` + 启动日志 |
| 🟠 P1 | 加图谱 e2e 测试：写两次同源同目标，断言边数 = 1 | 2h | `tests/memory/knowledge-graph/` |
| 🟡 P2 | 修 `graphSearch` 返回正确 `matchType` | 1h | `manager.ts:337-367` |
| 🟡 P2 | 修预计算锁为 Promise inflight tracker | 1h | `manager.ts:26, 178-223` |
| 🟡 P2 | 修 Neo4j `removeEdge` 加 ownerId 限定 | 30min | `neo4j-store.ts:365` |
| 🟡 P2 | Neo4j session 复用 + 连接池 | 3h | `neo4j-store.ts` |
| 🟢 P3 | 加 `getGraphHealth()` 与 `/api/graph/health` | 4h | `manager.ts` + `routes/graph-routes.ts` |
| 🟢 P3 | 增量 Louvain 实现 | 1d | `community-detection.ts` + `manager.ts` |
| 🟢 P3 | Neo4j 全文索引 + `scoreNodes` 用 `queryNodes` | 1d | `neo4j-store.ts` + `bfs-extractor.ts` |
| 🟢 P3 | 单独抽 `extractEntities`，补全 KB 文档实体抽取 | 1d | `relationship-extractor.ts` + 调用方 |

---

## 8. 一句话总结

v1 写"LLM 关系抽取零集成"——这条 v2 翻案，已经接进了 `kb_ingest` 和 `ParsingQueue` 主线。

但接进去的过程**让两个 P0 bug 浮了上来**：
- `e.relation` 字段不存在，导致边去重永远不命中（重复边会一直累积）
- `EdgeType` 类型被绕过，图谱里已经悄悄冒出来 6 种关系类型但类型系统只声明了 3 种

短期最该做的事是修这两个 P0 + 修一个早就该修的 P1 (`graph_deduplicate` 漏 await) + 把 LLM 抽取逻辑收敛成一份。这四件事做完，图谱系统的"地基"才算稳。

中期再谈 Neo4j 原生算法、`scoreNodes` 索引化、图谱×主检索融合这些 v1 提了但没动的事。
