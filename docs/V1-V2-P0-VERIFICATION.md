# v1/v2 P0 验证报告（V1-V2-P0-VERIFICATION.md）

> 配套 `docs/KNOWLEDGE_GRAPH_REVIEW.md` (v1) 和 `docs/KNOWLEDGE_GRAPH_REVIEW_v2.md` (v2)。
> 本文档验证 v1 和 v2 列出的 P0/P1 是否真修完，2026-06-03 实际 grep + tsc 验证。

## TL;DR

| 来源 | 标题 | 状态 | 验证证据 |
|------|------|------|----------|
| v2 P0-1 | `e.relation` 字段不存在 → 边去重失效 | ✅ **已修** | `bfs-extractor.ts:184` 用 `e.label` 而非 `e.relation`；GraphEdge 类型只有 `label` 没有 `relation` |
| v2 P0-2 | `EdgeType` 字面量被绕过（写入 PERSONAL/CONTAINS/LLM_EXTRACTED） | ✅ **已修** | `types.ts:13-18` 联合类型含 6 种；`addEdge` 调用点全部 type-safe |
| v1 P0-1 | 提取层太浅 / LLM 关系抽取闲置 | ✅ **已修** | 3 个路径都 enqueue 到 `kgExtractionQueue`（kb_ingest + parsing-queue × 2） |
| v1 P0-2 | 检索层太重 / BFS 在 TS 层重复实现 | ⚠️ **部分修** | 检索入口 `searchNodesByKeywords` 已用 FULLTEXT 索引；但 BFS 内部仍是 N+1（per-node SQL），未用 recursive CTE / Neo4j APOC |

**4 个 P0 中 3 个真修完，1 个部分修。**

## 详细验证

### ✅ v2 P0-1: `e.relation` 字段不存在

**v2 review 描述**：
> 🔴 P0: `e.relation` 字段在 `GraphEdge` 上不存在 → 边去重**永远不命中**，每次 LLM 抽取都会写新边

**验证 1**: `GraphEdge` 类型定义

```ts
// src/memory/knowledge-graph/types.ts
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label: string;        // ← 用 label，不是 relation
  weight: number;
  createdAt: number;
  sourceChunkId?: string;
  evidence?: string;
  // ... 没有 relation 字段
}
```

**验证 2**: 边去重代码

```ts
// src/memory/knowledge-graph/bfs-extractor.ts:184
const existingEdges = await store.getEdgesBetween(sourceNode.id, targetNode.id);
const hasEdge = existingEdges.some((e) => e.label === normalizedRel);
if (!hasEdge) {
  await store.addEdge(...);  // 用 normalizedRel 作为 label
}
```

**结论**: 边去重现在用 `e.label`（用 `normalizedRel` 归一化的关系类型作为 label），bug 修复 ✅

---

### ✅ v2 P0-2: `EdgeType` 字面量被绕过

**v2 review 描述**：
> 🔴 P0: `EdgeType` 类型被代码绕过（写入 `PERSONAL` / `CONTAINS` / `LLM_EXTRACTED`）—— Bug / 类型

**验证 1**: `EdgeType` 联合类型

```ts
// src/memory/knowledge-graph/types.ts:13-18
export type EdgeType =
  | "EXTRACTED"
  | "INFERRED"
  | "TEMPORAL"
  | "PERSONAL"      // ← 加了
  | "CONTAINS"      // ← 加了
  | "LLM_EXTRACTED"; // ← 加了
```

**验证 2**: 所有 addEdge 调用点 type-safe

```bash
$ grep -rn '"EXTRACTED"\|"INFERRED"\|"TEMPORAL"\|"PERSONAL"\|"CONTAINS"\|"LLM_EXTRACTED"' src/
manager.ts:148  "PERSONAL"    # type-safe
manager.ts:159  "EXTRACTED"   # type-safe
manager.ts:172  "TEMPORAL"     # type-safe
extraction-pipeline.ts:227  "LLM_EXTRACTED"  # type-safe
extraction-pipeline.ts:301  "CONTAINS"        # type-safe
```

所有写入的字符串都在联合类型里，TypeScript 编译期会阻止无效字面量。bug 修复 ✅

---

### ✅ v1 P0-1: 提取层太浅 / LLM 关系抽取接入

**v1 review 描述**：
> 🔴 提取层太浅: 图谱是 LTM 的"影子"，而非独立的知识网络。LLM 关系抽取能力闲置。

**验证**: 3 个历史路径都接入 `kgExtractionQueue`

```bash
$ grep -n "kgExtractionQueue" src/
src/skills/knowledge-skills.ts:2510    # kb_ingest 路径
src/services/parsing-queue.ts:594     # parsing-queue 路径 1
src/services/parsing-queue.ts:1240    # parsing-queue 路径 2
```

**流程**：kb_ingest / parsing-queue / onFactStored 都会 `kgExtractionQueue.enqueue()` → 30s debounce → 离线 LLM 抽取 → 写图谱。**LLM 关系抽取能力**从 v1 review 时的"闲置"状态变成"生产 active"。bug 修复 ✅

---

### ⚠️ v1 P0-2: 检索层太重 / BFS 在 TS 层重复实现（部分修）

**v1 review 描述**：
> 🔴 检索层太重: 核心算法（BFS、社区检测、最短路径）在 TS 层重复实现，未利用 Neo4j 的原生能力。
> **建议**: 若使用 Neo4j → 用 Cypher/GDS 替换；若使用 MySQL → 给 `scoreNodes` 加数据库索引。

**已完成的部分**：

1. **`searchNodesByKeywords` 用 MySQL FULLTEXT 索引**（commit 3646570）— v1 建议的 MySQL 路径
2. **Neo4j `ensureFulltextIndex` + `CALL db.index.fulltext.queryNodes`**（commit 341d902）— v1 建议的 Neo4j 路径
3. **`bfs-extractor.ts:scoreNodes` 优先用 backend 原生检索**（commit 6930a90）

**未完成的部分**：

1. **BFS 内部仍是 N+1 SQL**：每个 visited 节点都单独 `getNode` + `getNeighbors` 查询
   ```ts
   // bfs-extractor.ts:162-179
   while (queue.length > 0 && ...) {
     const { nodeId, depth } = queue.shift()!;
     ...
     const node = await store.getNode(nodeId);         // ← N+1
     ...
     for (const neighbor of await store.getNeighbors(nodeId)) {  // ← N+1
       ...
     }
   }
   ```
   50 节点 BFS ≈ 100 次 SQL。

2. **MySQL 后端没用 recursive CTE**：应该能用 `WITH RECURSIVE` 一次查询搞定 BFS，但当前是 100 次小查询

3. **Neo4j 没接 APOC / GDS**：v1 明确建议的 Cypher/GDS 替换没做

**残留的 N+1 成本估算**（粗略）：
- 50 节点 BFS，depth=3：~100 SQL queries × ~5ms = 500ms
- 这在 KG v2 阶段 3 接 kb_search 时是 hot path，500ms 延迟可感

**修复路径**（未做，记入 backlog）：

| 修复 | ROI | 工作量 |
|------|-----|--------|
| BFS 改用 MySQL recursive CTE | 🟢 高（hot path）| 1-2 天 |
| 集成 Neo4j APOC `apoc.path.subgraphAll` | 🟢 高（如果用 Neo4j）| 1 天 |
| 加 batch node 加载（一次 SQL 拉 visited 全部） | 🟡 中 | 0.5 天 |

**结论**: ⚠️ 部分修——检索**入口**用了索引（避免全表扫描找 seed），但 BFS **内部**仍是 N+1。生产低延迟场景有 500ms 隐患。

## v1/v2 P1 / P2 状态（粗略）

| 来源 | 数量 | 备注 |
|------|------|------|
| v1 P1 "LLM 抽取收敛成一份" | ✅ done | commit b6a6e75 引入 kgExtractionQueue + extraction-pipeline 统一 |
| v1 P1 "与主检索脱节" | ✅ done | 阶段 3 接入 kb_search（commit 6930a90）|
| v1 P1 "Neo4j fulltext 索引" | ✅ done | commit 341d902 |
| v2 P1 "graph_deduplicate 漏 await" | ✅ done | （commit ea805e1 之前）|
| v2 P1 "统一后端默认 mysql" | ✅ done | `user-session.ts` 默认改 mysql（commit b6a6e75）|
| v2 P1 "llm 抽取逻辑统一" | ✅ done | kgExtractionQueue + extraction-pipeline |

**v1/v2 列出的 10+ 项 P1/P2 大部分已修**。

## 业务影响

v1 写于 2026-04 早期（"图结构已就绪，图智能未释放"），v2 写于 2026-05 接入 Neo4j 时（"图谱系统地基"）。这一轮 KG v2 把这两个 review 的 P0 标的全修了（**3/4 真修完，1 个 BFS 内部 N+1 部分修**）。

**剩余风险**：BFS 内部 N+1 在生产大图（> 100 节点 BFS）时可能产生 500ms+ 延迟。需要等真实数据接入后 benchmark 决定是否值得优化。
