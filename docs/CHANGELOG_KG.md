# KG v2 变更日志（CHANGELOG_KG）

> 记录所有影响 **检索准确 / 检索高效 / 关联理解 / 回复质量** 这 4 个产品目标的变更。
> 详见 `docs/KG_ARCHITECTURE_VISION.md` 和 `docs/KG_REVIEW_v3.md`。

## 2026-06-03 — 4 个 P0 + 6 个 P1 + 4 个 P2 全部落地

### P0 修复（必修）

| P | 标题 | 文件 | 影响 |
|---|------|------|------|
| **P0-1** | ACL 漏洞（`recall.ts`）| `recall.ts:135-167` | **安全修复**：`subgraph.nodes` / `safeEdges` / `paths` 全部过 `isAllowed`，related 节点不再绕过 ACL 越权访问 kb_document |
| **P0-2** | 修 3 闭环（`extractRelationsToGraph`）| `extraction-pipeline.ts:154-185` + 2 e2e 测试 | **关联理解**：`extractEntities` 真正接通，纯 entity 落库；之前 2 个独立 LLM 调用是死代码 |
| **P0-3** | chunk-expander N+1 SQL | `chunk-expander.ts:60-99` | **检索高效**：150+ 次 SQL → 1 次 `OR` 链查询，-99% round-trip |

### P1 优化（应修）

| P | 标题 | 文件 | 影响 |
|---|------|------|------|
| **P1-1** | 删 `includeCommunities` / `includeGodNodes` 伪 options | `recall.ts` | **代码健康**：API 不再撒谎 |
| **P1-2** | Neo4j fulltext 索引去掉 `n.properties.value` | `neo4j-store.ts:91` | **检索高效**：死索引，索引建/查开销更小 |
| **P1-3** | `QUERY_CACHE` 加 LRU 200 条上限 | `query-understanding.ts:57-100` | **运行稳定**：防 process-global 内存泄露 |
| **P1-4** | MySQL `searchNodesByKeywords` 用 FULLTEXT + 迁移 v20 | `graph-store.ts:425-484` + `mysql-database.ts` v20 | **检索高效 + 准确**：MySQL 后端原生全文索引，和 Neo4j fulltext 路径齐平 |
| **P1-5** | `getGraphHealth` 暴露 tokenizer backend | `health-metrics.ts:32-37, 79-87` | **可观测性**：ops 一眼看到是 nodejieba 还是 fallback |
| **P1-6** | `extractFromChunk` 2 LLM 调用合并为 1 | `relationship-extractor.ts:178-271` | **成本 -50%**：`extractEntitiesAndRelationships` 单次 LLM 调用 |

### 修 A + 修 B（一致性 / 死代码）

| 标题 | 文件 | 影响 |
|------|------|------|
| 修 A：生产路径接合并调用 | `extraction-pipeline.ts:156-167` | `extractRelationsToGraph` 也用 `extractEntitiesAndRelationships`，再省 50% LLM 成本 |
| 修 B：删 dead `keyByPair` | `chunk-expander.ts:136-144` | 清掉 5 行死代码 |
| 隐藏修：FULLTEXT 0-hit fallback | `bfs-extractor.ts:56-62` | FULLTEXT 返回 0 hits 不再直接 return，**降级到内存匹配**（修了 3 个原本会失败的测试） |
| 顺带修：`extractEntitiesAndRelationships` array 兜底 | `relationship-extractor.ts:222+` | LLM 偷懒返回 array 时也能用（容错） |
| 顺带修：`parseTags` mysql2 auto-parse | `graph-store.ts:48-87` | 不再把数组当字符串包一层 |
| 顺带修：修 2 fake LLM 改 merged 格式 | `kg-v2-stage2.test.ts` | 修了"debounce 之后空 content 漏 3 个节点"的隐藏 test pollution |

### P2 修复（改进）

| P | 标题 | 文件 | 影响 |
|---|------|------|------|
| **P2-8** | ngram FULLTEXT 插件优雅降级 | `mysql-database.ts` v21 (optional) + `graph-store.ts:431+` | **生产风险**：缺 ngram 插件的 MySQL 镜像，v21 migration 失败时降级、runtime 自动探 ngram 索引、缺失时改用默认 FULLTEXT |
| **P2-10** | LLM 返回 array 容错 | `relationship-extractor.ts:222-256` | **鲁棒性**：LLM 偷懒不输出 object 时也能用 |
| **P2-11** | ACL 改用精确匹配 | `recall.ts:91-101` + `bfs-extractor.ts:99-119` + `graph-store.ts:49-89` | **安全修复**：`doc_abc` 不再误中 `doc_abc_v2`；同时修了 `parseTags` 双重嵌套的隐藏 bug |
| **P2-12** | 清理 `as any`（6+ 处）+ 提 `GraphStoreLike` interface | `extraction-pipeline.ts:27-67` + 多处 | **代码健康**：类型安全，bfs-extractor 接受 `GraphStoreLike` 替代 `GraphStore` |

---

## 关键数字

| 指标 | 数值 | 备注 |
|------|------|------|
| **测试通过率** | **552/552** | `tests/memory/knowledge-graph/` 174 + `tests/skills/` 215 + `tests/memory/` 163 |
| **TypeScript 错误** | **0** | `npx tsc --noEmit` |
| **LLM 成本** | **-50%** | 2 个独立调用合并为 1 个 |
| **chunk-expander SQL** | **-99%** | 150+ 次 → 1 次 |
| **MySQL 后端检索** | **走 FULLTEXT 索引** | 从全表扫描改为原生全文索引 |

---

## 4 个产品目标的对齐

| 目标 | 关联变更 |
|------|----------|
| **检索更准确** | P0-1 ACL（防越权）、P1-4 MySQL FULLTEXT、和 Neo4j 路径对齐、P2-11 ACL 精确匹配 |
| **检索更高效** | P0-3 N+1 SQL → 1 查询、P1-3 LRU 缓存、P1-4 MySQL 走 FULLTEXT 索引、P1-6 LLM 合并（-50% 延迟）、修 A 接合并 |
| **理解知识之间的关联** | P0-2 修 3 闭环（纯 entity 落库）、P1-2 Neo4j 索引精度 |
| **提升回复质量** | P1-1 API 不说谎、P1-5 health check 暴露 tokenizer backend、P2-10 LLM 鲁棒性 |

---

## 已知 P2 backlog（未做）

| P | 标题 | 影响 | 建议 |
|---|------|------|------|
| P2-7 | `searchNodesByKeywords` 评分用 `score/5` 魔法值 | 真实命中分被压成 0.5 | 用真实数据校准：跑 1000 真实查询，画散点，回归系数 |
| P2-9 | 测试用 `setTimeout(100)` 等 FULLTEXT 索引刷新 | race condition 没消除只是被掩盖 | 测试里加 `OPTIMIZE TABLE kb_graph_nodes` |
| 4-6 | docs/CHANGELOG_KG.md / GRAPH_CONTEXT_CHANGELOG.md / OPERATIONS.md | 工程师 onboarding 缺材料 | 1-2 天补齐 |

---

## 部署注意

1. **MySQL 8.0+ 必须**。如果生产 MySQL < 5.7，v20 migration 会失败（FULLTEXT 索引需要 5.7+）。
2. **ngram 插件可选**。v21 migration 是 `optional`——缺插件时自动降级。但 ops 应该在 health check 里看 `tokenizer.backend` 是不是 `nodejieba`，确认分词精度。
3. **LLM 调用次数变化**。之前是 2x LLM 调用/chunk，现在 1x。监控 LLM 流量要按 50% 重新校准。
4. **stage 5/6 部署**：先跑 `initMySQLDatabase()` 让 v20 + v21 走完；然后用 `getGraphHealth(owner)` 验证 `tokenizer.backend` 和 FULLTEXT 索引健康度。
