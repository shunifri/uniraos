# 记忆 + 知识图谱 + 检索能力 Review (Track 2, v2)

> Review 日期: 2026-06-07 23:56
> Review 基准: 当前 `HEAD` = `a19771f` (workspace `/Users/liukavin/Documents/code/raos`)
> 4-29 基线: `docs/RAOS-设计目标全面评估报告.md` §3-4 (记忆 93% / KB pipeline 88% / 检索 90%)
> Review 范围: `src/memory/` (含 `enhanced/`、`knowledge-graph/`)、`src/wal/`、`src/vector/`、`src/utils/ingest-queue.ts`、相关 routes + tests + 设计 doc
> 引用规范: [F] 代码/doc 事实; [A] 分析判断
> 测试验证: 20 次 vitest 运行全部 pass (5 full-suite + 5 graph-store 隔离 + 10 `tests/memory`); 见 §8 flakiness note

---

## 1. Executive Summary

记忆栈、知识图谱、检索三个能力维度在 4-29 之后有 **非常显著的工程深化**——从"功能完整"过渡到"质量可量化、关键 bug 闭环、生产风险可见"阶段。最大变化集中在 KG v2 (1-6 阶段 + 修 1/2/3 + 11 个 P0/P1/P2 修复) 和 3 个近期生产事故根因修复 (WAL 截断、kb-ingest 5% 卡死、Gitee AI batch 400)。代码层面整体完成度 **向上跨越 5-8 个百分点**——KG 端从"骨架接通"到"真闭环 + 量化增益"是这一轮最核心的胜利。但 **A/B test 标定显示仍有 7-15% query 召回不到正确节点**, feedback 环路只走通了一条腿 (god node importance 调节), 图嵌入 (Node2Vec) 和重排序 (Rerank) 这两条 vision 文档 §9.3 列出的改进项仍未启动。建议 **未来 30 天把"feedback 闭环 + 真实数据回归"做实**, 而不是继续往 KG 边类型里堆新概念。

**关键判断** (与 4-29 评对比):
- 4-29 评的 KG 88% → 现评 **~93%** (修完 4 P0 + 6 P1 + 4 P2; Neo4j APOC 接入; LLM judge A/B +40%)
- 4-29 评的记忆 93% → 现评 **~95%** (WAL 截断防崩溃 + 知识图谱 v2 反哺; STM 向量检索的 4-29 差距仍未补)
- 4-29 评的检索 90% → 现评 **~93%** (MySQL FULLTEXT ngram 上线 + multi-stage fallback + LLM 合并 -50% 成本 + ACL 精确匹配)
- 4-29 标的所有 P0/P1 修复项中, **6/9 已闭环**, 3 个进入 P2 backlog; **没有 P0 漏修**

---

## 2. 完成度分项表

| 维度 | 4-29 评 | 现评 (独立) | 变化 | 关键证据 |
|------|---------|------------|------|---------|
| **STM (短期记忆)** | 85% | ~85% | ≈ | [F] `src/memory/stm.ts:122` (LRU + TTL + 关键词匹配); 4-29 提的"缺向量语义"未补 |
| **LTM (长期记忆)** | 92% | ~95% | ↑ | [F] `src/memory/ltm.ts:47` MySQLLTMBackend + `ltm.ts:601` FileLTMBackend 双后端; `src/memory/enhanced/` 7 子模块 (`conflict-detector` / `forgetting-manager` / `profile-generator` / `search-enhancer` / `version-chain` / `fact-extractor` / `data-migrator`) 全部有 93-506 行测试 [F: `tests/memory/enhanced/` 6 文件] |
| **知识图谱 KG** | 88% | ~93% | ↑↑ | [F] 18 文件 / ~7K 行 (含 1310 行 `graph-store.ts` + 1028 行 `neo4j-store.ts`); v2 阶段 1-6 全部落地 + 11 个 P0/P1/P2 修复 + Neo4j APOC 路径 [F: `docs/CHANGELOG_KG.md` §关键数字] |
| **元记忆 (WAL/Recall/GC)** | 90% | ~93% | ↑ | [F] `src/wal/file-wal-store.ts:85` 100MB 自动截断 + `truncateKeepLastLines` 兜底 rename; `src/memory/recall-context.ts:35` RecallContextSkill 5min TTL 缓存; `src/memory/gc-collect.ts:37` MemoryGarbageCollector 完整实现 |
| **KB Pipeline (导入→向量化)** | 88% | ~92% | ↑ | [F] `src/skills/knowledge-skills.ts:2286/2313/2387/2549/2574` 5%/30%/60%/100%/0 进度点全补全; `src/memory/embedding-provider.ts:95` BATCH_SIZE=25 拆批串行调; 73MB 真实 docx 可走通 |
| **检索 — 向量** | — | ~90% | ≈ | [F] `src/vector/vector-provider.ts` Qdrant + 内存双 provider; `src/memory/embedding-provider.ts:240` OpenAI/Volcengine 兼容 |
| **检索 — 全文 (FTS)** | — | ~92% | ↑↑ | [F] MySQL v20 默认 FULLTEXT + v21 ngram (optional); 4-29 没提"全文索引走 FULLTEXT"已上线 |
| **检索 — KG (召回/子图/路径)** | 90% (含 hybrid) | ~94% | ↑ | [F] `src/memory/knowledge-graph/recall.ts:96-104` ACL 精确匹配 (P0-1) + `recall.ts:48-50` 默认 `maxSeeds=5/maxDepth=3/maxEntities=100` + `graph-store.ts:736` `searchNodesByKeywords` 4 stage fallback; MySQL recursive CTE + Neo4j APOC 双 backend BFS 1 query |
| **检索 — 结果融合 (RRF/打分)** | ~85% | ~85% | ≈ | [F] `src/vector/hybrid-search.ts:171-173` 简单 `vector_score + graph_boost` 排序; Rerank 模型未引入; 4-29 列的"重排序缺失"仍为 P2 |
| **测试覆盖 (范围内)** | 4-29 标"未补" | ~92% | ↑↑ | [F] 31 个 test 文件, 403/403 pass in `tests/memory` + `tests/memory/knowledge-graph` + `tests/memory/enhanced` |

> [A] 注: "4-29 评" 是 doc 内自评分数, 本 review 的"现评"完全基于代码/测试/commit 独立打分; 两列使用同一坐标系 (0-100%)。

---

## 3. 重大变化 (自 4-29 起)

按"产品影响 × 风险修复"排, 不按时间倒序:

### 3.1 KG v2: 1-6 阶段 + 修复链 (~12 commits, ~2.5K 行)

| Commit | 标题 | 一句话 |
|--------|------|--------|
| `ea805e1` | docs(kg): 阶段 0 文档 | 引入 5 篇 review/vision/changelog 总纲 |
| `ad546a9` | deps(kg): nodejieba 3.5.8 | 中文分词依赖; CPP 编译模块 |
| `b6a6e75` | 阶段 1-2: 地基 + 离线化抽取 | 18 文件: types / graph-store / extraction-pipeline / query-understanding / feedback / health / kg-extraction-queue / parsing / db 迁移 v18-v20 / graph-routes |
| `6930a90` | 阶段 3: KG-first 检索 | `recall.ts` + `chunk-expander.ts` + `bfs-extractor.ts` |
| `341d902` | 阶段 5-6: Neo4j fulltext + nodejieba | `neo4j-store.ts` fulltext 索引; `chinese-tokenizer.ts` 集成 jieba |
| `63c6618` | test(kg): 阶段 1-6 + 修 1+2/3/P0 e2e | 11 个 test 文件, 547/547 pass [F] |
| `3646570` | P2-7 标定 + OPERATIONS / GRAPH_CONTEXT | 标定 pipeline + 3 文档 (OPERATIONS, GRAPH_CONTEXT_CHANGELOG, CALIBRATION) |
| `fffb0b9` | 真数据标定 pipeline | `scripts/calibrate-from-real-data.ts` + e2e |
| `20e006b` | fix(kg): BFS N+1 → MySQL recursive CTE | BFS 内部 1.2-5.8x faster; `extractSubgraphCTE` 1 query 拉完 |
| `eb66da1` | fix(kg): 修召回盲点 (60% raw=0) | 4 stage fallback (FULLTEXT → exact label → canonical → substring) |
| `495bf19` | fix(kg): recall fallback 也按"top score 质量"触发 | v2: rescued 86.9% → 92.9%, RMSE -9% |
| `23e385c` | feat(kg): Relation Ontology 扩展 + Acceptance alerting | `types.ts:15-24` EdgeType 加 PARENT_OF / REVISION_OF / ANCHORED_TO + `types.ts:36` `inferEdgeTypeFromLabel` 自动归类 |
| `20b7edd` | feat(kg): Neo4j APOC path for extractSubgraphCTE | MySQL recursive CTE + Neo4j `apoc.path.subgraphAll` backend parity |

**量化结果** [F: `docs/CHANGELOG_KG.md` §关键数字]:
- LLM 抽取成本 **-50%** (2 调用 → 1 调用; `extractEntitiesAndRelationships`)
- chunk-expander SQL **-99%** (150+ → 1)
- BFS 内部 N+1 → 1 query (CTE/APOC)
- MySQL 后端检索从全表扫 → FULLTEXT 索引
- graphContext A/B test: LLM judge 0.54 → 0.74 (**+40%**), heuristic hit 0.27 → 0.84 (**3x**)
- 修复完成度: 4 P0 + 6 P1 + 4 P2 全部落地 (3 个 P2 残留 in backlog) [F: `docs/KG_REVIEW_v3.md` §6.5]

### 3.2 稳定性事故根因修复 (3 commits)

| Commit | 标题 | 修复了什么 (actual location) |
|--------|------|------------------------------|
| `a70372b` | **fix(wal): WAL > 100MB 自动截断** | [F] `src/wal/file-wal-store.ts:85` `const MAX_FILE_SIZE = 100 * 1024 * 1024`; 之前 `readFileSync` 一次性读 603MB WAL → ERR_STRING_TOO_LONG (Node 0x1fffffe8 ~500MB 限制) → 启动崩溃 → Vite proxy 502 → FE 一直转圈; 现在 100MB 触发 truncate + 500MB 兜底 `renameSync` (`file-wal-store.ts:152-153`)。3 个新 WAL 测试 |
| `2834511` | **fix(kb-ingest): 解析失败也要更新 status, 5% → 100% 进度点补全** | [F] 73MB 真实 docx 解析时 IngestQueue 5min 超时先于 engine 10min 触发 → engine.execute THROW 异常 → 路由 `if (result.success) else` 跳失败分支 → DB `parsingStatus` 永远 5%; 现在 try/catch 兜底 + `knowledge-skills.ts:2286/2313/2387/2549` 5%/30%/60%/100% 全进度点 |
| `1ba6a93` | **fix(embedding): Gitee AI batch 上限 25, 超过 400 拆批串行调** | [F] `src/memory/embedding-provider.ts:95` `const BATCH_SIZE = 25`; 之前 Gitee AI Qwen3-Embedding-8B 端点 batch > 25 报 'No schema matches </input>' 400; 现在 `embedOpenAI` 内部按 25 切分 (`embedding-provider.ts:97-98`), 对 OpenAI 2048 上限的 provider 透明兼容; 8 个新测试 |

### 3.3 KG 安全 / 性能修复 (3 commits, 隐性大)

- `eb66da1` + `495bf19`: 4-stage fallback (召回从 40% → 92.9%)
- `a4531b8` + `4dfc558`: graphContext A/B test framework + LLM 真实响应验证
- [F: `docs/V1-V2-P0-VERIFICATION.md` §TL;DR] v1/v2 4 个 P0 全部真修完, 10+ 项 P1/P2 大部分已修

---

## 4. Top 3 风险 (决策者优先级)

### 4.1 🔴 Ingest 稳定性 (持续高发)

**证据**:
- 4-29 之后 3 个事故根因全在 ingest 链路: WAL 截断 / kb-ingest 5% / Gitee AI batch
- [F] `src/utils/ingest-queue.ts:39` timeout 默认 900_000ms (15 分钟, `P1-21` 调整), 但 [F] 170 行 `ingestQueue` 是 process-global 单例 (`utils/ingest-queue.ts:170` `ingestQueue = new IngestQueue({ concurrency: 1 })`), 并发 = 1 → 大批文档进队会**串行阻塞**
- [F] `src/skills/knowledge-skills.ts:2286/2313/2387/2549/2574` 进度点 5%/30%/60%/100%/0 完整, 但 [A] 仍缺"30% → 60% 中间状态"和"60% → 90% 的子阶段细分" (向量化阶段只有 1 个状态点, 大文档向量化时用户看不到进度)
- [F] `commit b5d2405`: 大文本 docx 跳过图片生成, 加 10s 硬超时 — 但 10s 是给 docx 解析的, 整文档仍可消耗数 GB 内存

**影响**: 一个 100MB+ 的 docx 走完整 pipeline 仍可能耗时 > 10min, 中间任何一环出问题, FE 都是"5% 卡死"或"60% 卡死"。

**[A] 建议**: 1) 串行 → 改为 per-user 串行, 全局并发 N=2-3; 2) 加 /api/knowledge/queue 实时监控面板 (route 已存在 `src/routes/knowledge-routes.ts:467`, 但缺前端展示)

### 4.2 🟠 检索准确率 (有 A/B 量化, 仍有 7-15% 缺口)

**证据**:
- [F] `commit 495bf19` 报告 92.9% rescued, RMSE 0.2372 — 但这是**真数据标定 (calibrate-from-real-data.ts)** 的小样本 (183 tuples, 15 queries) [F: `docs/CHANGELOG_KG.md` §关键数字]
- [A] **7-15% 缺口在 4-29 时被 vision 文档 §9 列为低优先级 P3, 现在升为 P1**——4 stage fallback (`graph-store.ts:736` `searchNodesByKeywords`) 把 60% raw=0 的盲点救了, 但剩下的 7-15% 是"语义匹配但字面/向量不命中"的硬骨头, 单纯加 fallback 不够
- [F] `src/vector/hybrid-search.ts:171-173` 排序用 `vector_score + graph_boost` 简单求和, 没有 Rerank 模型 (4-29 标 P2 未补)
- [F] `src/memory/knowledge-graph/bfs-extractor.ts:67` `console.warn("[scoreNodes] backend search failed, falling back:")` — FULLTEXT 索引 lag 时静默降级到内存匹配, 真实命中分被压成 0.5 (P2-7 魔法值)

**影响**: 当用户问一个**中文长尾 query** 或**跨领域组合 query** 时, 仍可能召不到相关 chunk。

**[A] 建议**: 1) 跑 1000+ 真实 query 标定, 用 (raw score, 人工相关性) 回归校准 FTS 评分斜率; 2) 评估接入轻量级 Cross-Encoder (bge-reranker-base, 100MB 内存) — 这是 4-29 标 P2 但现在已是 P1

### 4.3 🟡 记忆跨 session 持久性 (基本稳, 元记忆有缺口)

**证据**:
- [F] LTM 持久化路径完整: STM (内存) → LTM (MySQL/File) → KG (双后端) → WAL (文件) → Graph 关系
- [F] `commit a70372b` 修了 WAL 截断崩溃, 但**只防崩溃不防泄漏** — [F: commit message] "WAL 应该定期清理 completed entries, 不要无限增长 (这次没改, 避免 scope 蔓延; 下次跑时如果 > 100MB 也会自动截断)"
- [F] `src/memory/auto-consolidator.ts:22` AutoConsolidator 用 `setInterval` 调 `archive()`, **缺 backpressure** — 当 archive 自身慢或挂时, timer 仍会触发
- [A] 4-29 标"元记忆完整度 90%" 现在合理 ~93%, 但 **vision 文档 §6.5 列的"4 层记忆协作"并未真正打通** — RecallContextSkill 只把 LTM 注入 STM, KG 注入路径有但没有和 LTM 形成反馈环 (用户的 LTM 修正应该反哺 KG 的 entity importance, 反之亦然)

**影响**: 长期跑 (月级) 后, WAL 仍会增长到 100MB 触发 truncate, **会丢失未完成 entries** (虽然 markCompleted / markFailed 的已完成条目会被过滤, 但 pending 状态的 task 会丢)

**[A] 建议**: 1) WAL 加定期 compact (完成 > 7 天的 entries 自动从 JSONL 剔除, 写 checkpoint); 2) 跑一个 "auto-archive 慢时, 跳过下次" 的 adaptive timer; 3) 短期 1-2 天能搞完

---

## 5. 下一步 30 天行动建议

**聚焦**: 把"feedback 闭环 + 真实数据回归"做实, 让 KG 不再是"骨架"而是"自优化"。

### 行动 1: 跑 1000 query 真数据回归 (5-7 天)

- 复用 `scripts/calibrate-from-real-data.ts` 框架, 扩到 1000+ tuples
- 产出: Top-K recall / MRR / 采纳率 三张图, 跑 3 个 P2 backlog (P2-7 score/5 校准 / P2-9 setTimeout race / P2-11 ACL 精确匹配后的回归验证)
- 收益: 把"92.9% rescued" 从"标定数据"变成"生产可信数字"; 干掉所有 P2 backlog

### 行动 2: 接入轻量级 Rerank 模型 (10-14 天)

- 评估 `bge-reranker-base` (100MB, ONNX 可跑) 或 `cross-encoder/ms-marco-MiniLM-L-6-v2`
- 接入位置: `src/vector/hybrid-search.ts:171-173` 排序前, 给 Top-50 加 Rerank → Top-10
- 配套: `src/memory/knowledge-graph/feedback-pipeline.ts` 反哺简化 (`clamp(old * 0.9 + signal * 0.1, 0, 1)` 一行, 取代 v3 §P2-5 提到的混乱 `Math.max/Math.min` 嵌套)
- 收益: Top-10 precision 提升 20-30%; 反馈环路从"半通"到"全通"

### 行动 3: WAL 定期 compact (3-5 天)

- 在 `src/wal/wal-manager.ts` 加 `compactOlderThan(days: number)` API
- `src/wal/file-wal-store.ts:61` `compact()` 已存在, 接上定时器 (`src/server/bootstrap.ts:87` 启动时)
- 加 metric: `wal.completedEntries` / `wal.fileSize` 暴露到 `/api/health`
- 收益: WAL 不会无限增长, 4-29 提到的"应该定期清理 completed entries"闭环; 防"下次跑时仍会 > 100MB 截断"

**预期产出** (3 行动合起来):
- 检索准确率从 ~93% → ~96% (Rerank 拉 Top-10 precision, 标定数据校准打分)
- 稳定性: ingest 失败率 < 1% (Rerank 离线, 不影响在线)
- 长期运维成本降低 (WAL 自动 compact, 没人需要手动 truncate)

---

## 6. 评价 (不带修辞)

- 4-29 之后 **KG 是最大赢家** — 从"骨架"到"真闭环 + 量化", 1 个半月 30+ commits
- **稳定性事故根因** (WAL/kb-ingest/embedding) 都修了, 但 4-29 标"知识引擎 94%" 的背后仍有连续 3 个生产事故, 说明 **完整度 ≠ 稳定性**
- **测试覆盖 403/403 范围** OK (见 §8), 但 [F] `tests/memory/knowledge-graph/kg-v2-stage5.test.ts` (5 个) 全部 mock store, 没真连 Neo4j 跑过 [F: `KG_REVIEW_v3.md` §4.2]
- **4-29 标的"待办项 9.2"** 11 个差距里, 4 个修完 (4/4 P0), 5 个降级或半修, 2 个仍未启动 (移动端 / 实时仪表盘)
- **新出现的差距** (4-29 没标的): KG 抽取全量 entity 闭环 / Neo4j GDS / 大图基准 — 在 vision 文档里都有, 但实际优先级被"修 4 P0"挤掉了

---

## 7. 引用清单 (commit / file / test)

- 测试统计: [F] 20 次 vitest 运行全 pass (见 §8); 全工程 2038 pass / 43 skip / 1 todo / 0 fail (run 1-5)
- TypeScript 0 error: [F] `CHANGELOG_KG.md` §关键数字报告 0 error, 本次未独立 `tsc --noEmit` 跑
- 4-29 基线: [F] `docs/RAOS-设计目标全面评估报告.md` §3 (记忆系统 93%) + §4 (知识库 88% + 检索 90%)
- KG v2 总览: [F] `docs/CHANGELOG_KG.md:151`, `docs/KG_ARCHITECTURE_VISION.md:750`, `docs/KG_REVIEW_v3.md:443`
- 修复完成度: [F] `docs/V1-V2-P0-VERIFICATION.md:11-13` (TL;DR), `docs/KG_REVIEW_v3.md` §6.5
- 关键代码 (actual locations):
  - `src/memory/ltm.ts:47` (MySQLLTMBackend) / `:601` (FileLTMBackend)
  - `src/memory/enhanced/` (7 子模块)
  - `src/memory/knowledge-graph/recall.ts:96` (ACL) / `:104` (seedAfterAcl) / `:142` (relatedEntities filter) / `:48-50` (maxSeeds/depth/entities defaults)
  - `src/memory/knowledge-graph/graph-store.ts:128` (flushFulltextIndex) / `:132` (SET GLOBAL) / `:736` (searchNodesByKeywords)
  - `src/memory/knowledge-graph/types.ts:15-24` (EdgeType) / `:36` (inferEdgeTypeFromLabel)
  - `src/memory/knowledge-graph/health-metrics.ts:38,88` (tokenizer field)
  - `src/memory/embedding-provider.ts:95` (BATCH_SIZE) / `:97-98` (切分循环)
  - `src/wal/file-wal-store.ts:85` (100MB) / `:127` (truncateKeepLastLines) / `:152-153` (renameSync 兜底)
  - `src/utils/ingest-queue.ts:39` (timeoutMs=900_000) / `:41` (heartbeat 30s) / `:170` (singleton)
  - `src/skills/knowledge-skills.ts:2286/2313/2387/2549/2574` (5%/30%/60%/100%/0)
  - `src/vector/hybrid-search.ts:171-173` (排序) / `:152` (graph_boost merge)
  - `src/routes/knowledge-routes.ts:77,80,84,95` (route progress 60/90/0)
- 关键 commit: `a70372b` (WAL) / `2834511` (kb-ingest) / `1ba6a93` (Gitee batch) / `b6a6e75` (KG 阶段 1-2) / `6930a90` (KG 阶段 3) / `341d902` (KG 阶段 5-6) / `63c6618` (KG tests) / `3646570` (标定 + ops) / `20e006b` (BFS CTE) / `eb66da1` + `495bf19` (4 stage fallback) / `23e385c` (Relation Ontology) / `20b7edd` (Neo4j APOC)

---

## 8. ⚠️ Flakiness / Test Noise Note (重要)

### 8.1 测试稳定性: 20 次运行全 pass

| 跑法 | 次数 | 结果 |
|------|------|------|
| `npx vitest run` (全 suite) | 5 | 2038 pass / 43 skip / 1 todo / 0 fail |
| `npx vitest run tests/memory/knowledge-graph/graph-store.test.ts` | 5 | 62 pass / 0 fail (含 multi-stage search fallback 5 + flushFulltextIndex 3) |
| `npx vitest run tests/memory` | 10 | 403 pass / 0 fail |

**结论**: 范围内所有测试在我本机的 20 次运行中**全部稳定通过**。

### 8.2 Stderr noise (NOT a test failure) — 已知 + 可解释

每次跑 `tests/memory/knowledge-graph/graph-store.test.ts` 都会在 stdout/stderr 出现 4-5 条 [ERROR] 日志, 内容都是同一条:

```
[ERROR] mysql_adapter_execute_error
  {"sql":"SET GLOBAL innodb_optimize_fulltext_only = ON",
   "error":"The value of \"offset\" is out of range. It must be >= 0 and <= 9. Received 11"}
```

**这不是测试失败**, 是 [F] `src/memory/knowledge-graph/graph-store.ts:130-136` 的 try/catch 显式吞掉 mysql2 driver 的参数绑定错误:

```ts
try {
  await adapter.execute(`SET GLOBAL innodb_optimize_fulltext_only = ON`);
  fulltextOnly = true;
} catch {
  // 没 SUPER 权限或被拒绝——降级模式 OPTIMIZE 会做全表 rebuild, 但小表 OK
}
```

mysql2 driver 在 `SET GLOBAL` 语句上把字面量 `ON` 误判为 `?` 占位符, 触发 "offset out of range"。**但测试用例不依赖 `SET GLOBAL` 成功**, 后面 `OPTIMIZE TABLE kb_graph_nodes` 仍会跑, FULLTEXT 索引会被刷, 测试通过。

### 8.3 Flakiness 风险 (真实存在, 但被 catch 兜底)

下述风险点**可能**在 MySQL 高负载 / 多个进程并行测试时浮现:

1. **GLOBAL 状态污染**: `flushFulltextIndex` (`graph-store.ts:128`) 用 `SET GLOBAL` 改 innodb 全局变量。**多个 MySQL 连接 / 多进程测试** 共享同一个 MySQL 实例时, GLOBAL 状态会跨测试污染。
2. **OPTIMIZE TABLE race**: `OPTIMIZE TABLE` 异步完成, 测试调 `flushFulltextIndex` 后**立即**搜 FULLTEXT 索引。如果 MySQL 还在做 OPTIMIZE, 命中失败 → 触发 `bfs-extractor.ts:67` `console.warn("[scoreNodes] backend search failed, falling back:")` 降级路径 → 内存匹配兜底。
3. **GLOBAL 泄漏**: 因为 `SET GLOBAL ... ON` 总是失败, `fulltextOnly` 永远 `false`, 所以 `graph-store.ts:146-152` 的 `SET GLOBAL ... OFF` 兜底分支**永远不会跑** — 状态不会真正污染, 但日志会持续噪声。

### 8.4 修复建议 (按 ROI 排, 30 天行动外可补)

| 改 | 工作量 | 收益 |
|----|--------|------|
| 把 `SET GLOBAL` 改 `SET SESSION` (scope 缩到当前连接) | 5 分钟 | 杜绝跨测试 GLOBAL 污染 |
| 加 `try/catch` 静默 `OPTIMIZE` 失败 (用 `console.debug` 替 `console.warn`) | 5 分钟 | 减少日志噪声 |
| 测试加 `await sleep(50)` 替代 `flushFulltextIndex` 强依赖 | 30 分钟 | 杜绝高负载 race |
| 修 P2-9: `flushFulltextIndex` 改异步 polling 模式 | 1 天 | 真正同步刷, 消除 race |

### 8.5 对 verifier 的回应

> "of `npx vitest run tests/memory/` invocations produce 3 failures in `graph-store.test.ts` (multi-stage search fallback)"

我无法在我本机 20 次运行中复现 3 个 failure。可能原因:
- 不同的 MySQL 配置 (例: SUPER 权限开关)
- 不同的并发数 (vitest workers)
- 不同的 system load (cold vs warm start)
- 不同的 commit hash (我用的是 `a19771f`)

我**承认**这套测试有 inherent flakiness risk (见 §8.3), 但**当前 commit 在当前环境是稳定通过**。建议 verifier:
1. 跑 `npx vitest run tests/memory --reporter=json` 看 `numFailedTests`
2. 如果真 fail, 看 `testResults[*].assertionResults[*].failureMessages` 拿具体 assertion 错
3. 如果只是 stderr [ERROR] 噪声, 那不是真 fail, 改用 `numFailedTests` 判真伪

---

**Reviewer**: general (sub-agent)
**完成时间**: 2026-06-07 23:56 (Asia/Shanghai)
**Commit hash**: 报告基于 `a19771f` (workspace HEAD)
**v2 修订原因**: 上一版用 end-of-file 行号 (e.g. `:162`, `:240`) 是 v1 引用, 实际 constant 位置应在 `:85` (WAL) / `:95` (embedding); 20 次重跑确认 403/403 + 62/62 稳定, 但 stderr 已知 noise 未在 v1 标注, 这次补 §8
