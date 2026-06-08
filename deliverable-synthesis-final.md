# RAOS 整体 Executive 报告 (2026-06-08)

> **受众**: 决策者 (PM / 领导) · 开会用 · 双视角 (独立重评 + 对比 4-29 基线)
> **基线**: `docs/RAOS-设计目标全面评估报告.md` (2026-04-29, 自评平均 94.2%) [F: §1, 表头]
> **当前 HEAD**: `a19771f` (2026-06-07) · **窗口**: 4-29 → 6-07, 共 **132 commits** [F: `git log --since="2026-04-29" --oneline | wc -l`]
> **引用规范**: [F] = file:line / commit hash / 测试数 事实; [A] = 分析判断; 每项完成度必带 [F] 证据
> **粒度**: 完成度 90% 这种粗粒度, 不给小数; 不出现具体函数名 / API endpoint / 完整类名

---

## 1. Executive Summary

**当前独立重评总体完成度 ≈ 91%, 较 4-29 自评 94% 下降约 3 个百分点**。下降并非真退步, 而是**基线虚标被独立审计挤出**: 4-29 文档 9.1 节至少有 3 处 "已修复" 声明与代码不符 (5 个 it.skip + 3 个 describe.skip + 11 个 it.skip, 共 19 个被跳过的"隐性谎言"), 真实代码成熟度比自评低。**最大进步**是"生产可运维性"被补齐 — 部署维度从 4-29 完全未量化到 88%, 知识图谱从骨架升级为真闭环, 嵌入场景 chat 5 轮串联修复稳定可用。**最大风险**是 **4-29 评估基线与代码系统性脱节** — 决策者依此 doc 拍板的判断会失真 (Reflection / 动态团队 / 超时保护, 全部声称已修但实际未落地)。**未来 30 天建议**: (1) 1 周内校准 4-29 文档 9.1 节"已修复"项, 该修修该删删; (2) 2 周内修 Ingest 串行阻塞 + 监控补 5 条业务 alert, 把静默故障可见化。

---

## 2. 5 大支柱完成度对照表 (独立重评 vs 4-29)

| 支柱 | 当前 % | 4-29 % | Δ | 关键证据 (≤ 1 行) |
|------|-------:|-------:|---:|---------------------|
| **决策智能** | 88% | 96% | **-8** | Orchestrator 80→85% 是唯一真增量 [F: Track1 §2]; Simple 95 / ReAct 90 / Team 88 / Plan 80 [F]; 4-29 9.1 节 3 处"已修复"全失实 (19 skipped) [F: Track1 §3.2] |
| **记忆系统** | 93% | 93% | 0 | LTM 95 (MySQL/File 双后端 + 7 子模块) / STM 85 (仍无向量) / KG 93 / Meta 93 [F: Track2 §2]; WAL 100MB 自动截断 + 知识图谱 v2 反哺 [F] |
| **知识引擎** | 92% | 94% | -2 | KB pipeline 92 (5/30/60/100% 进度点补全 + 73MB 真实 docx 走通) / 检索综合 ~93 (FULLTEXT ngram + multi-stage fallback + ACL 精确匹配) [F: Track2 §2]; Rerank 模型仍未引入, 仍有 7-15% 缺口 |
| **交互界面** | 90% | 93% | -3 | 页面 90 (15→20+ 页, 新增 FormDesigner/WorkflowDesigner/AppsPage/Connections/Approvals) / 表单 90 (8→20 widget) / 工作流 88 (持平) / 嵌入 82 (4-29 未单评) [F: Track3 §1] |
| **基础设施** | 91% | 95% | -4 | Skill 93 / 权限 92 (P0 6 项安全漏洞一次修) / 进化 87 / **部署 88 (4-29 未量化, 新维度)** [F: Track4 §1]; 51 commits, 482 基础设施测试全过 [F] |
| **总体 (粗粒度)** | **~91%** | 94% | **-3** | 132 commits / 20 次 vitest 全过 / 1 个 P0 严重脱节 (决策基线) [F] |

> [A] 5 个支柱里 4 个下降, 总数也下降, 表面看是"退步"。**真实情况是 4-29 自评用了"已修复"但代码未实装的乐观口径, 独立重评更接近生产现实**。5 周净增: 部署 (新维度 88%) + KG 闭环 + Embed 稳定性 + 表单 widget ×2.5 + Plan 模式 (第 4 智能体级别, 首次建档), 实际能力显著增长。

---

## 3. 自 4-29 起的重大变化 (按"用户能看到的"优先级, 12 条)

> 时间倒序 132 个 commit 不全列, 只挑**直接影响 PM/领导视角**的 12 条。每条 = commit hash + 一句话 + 所属 track。

### 用户体验 / 端到端路径 (3 条)

1. **`14394e6` 嵌入场景 chat 串联修复 (P1-28/32/34/36 合并)** [Track3] — 嵌入 iframe 内 "提出修改意见" → 自动建对话 → 加载历史 → 工具框溢出 → 数组结果改"获取到 N 条", 5 轮迭代闭环
2. **`e2268bd` 商业化 UI 升级** [Track3] — 表格操作列 + 主题升级, 管理后台整体观感
3. **`eacd015` AppDesignCard → Chat autoMessage 端到端接通** [Track3] — 嵌入客户点"试用/修改"自动跳转 Chat + 自动发首条消息, 5 轮迭代的 v5 final

### 知识引擎 / 检索 (3 条)

4. **`b6a6e75` KG v2 阶段 1-2 地基** [Track2] — 18 文件 / ~2.5K 行: graph-store / extraction-pipeline / query-understanding / feedback / health / kg-extraction-queue, 阶段 0-6 闭环
5. **`eb66da1` + `495bf19` 召回盲点修复 (60% raw=0 → 92.9% rescued)** [Track2] — 4 stage fallback (FULLTEXT → exact label → canonical → substring) + score 质量触发, RMSE -9%
6. **`20e006b` BFS N+1 → MySQL recursive CTE** [Track2] — 子图提取 1.2-5.8x faster, 1 query 拉完

### 稳定性事故根因修复 (3 条)

7. **`a70372b` WAL 100MB 自动截断** [Track2] — 之前 603MB WAL 一次性读 → 字符串超长 → 启动崩溃 → Vite proxy 502 → FE 一直转圈; 现在 100MB 触发 + 500MB 兜底 rename
8. **`2834511` KB 导入 5% → 100% 进度点补全** [Track2] — 73MB docx 解析时 5min 超时先于 10min 触发 → status 永远 5%, 现在 try/catch + 全 4 个进度点都落
9. **`1ba6a93` Embedding batch 25 拆批** [Track2] — Gitee AI Qwen3-Embedding-8B 端点 batch > 25 报 400, 现在串行切批, 对 OpenAI 2048 透明

### 部署 / 基础设施 (2 条)

10. **`962f265` → `a19771f` 部署脚本 5 连击** [Track4] — 凭据改 env / 容器 USER raos / set -euo pipefail / Apple Silicon multi-arch 真验证 (OCI manifest 2 arch) / NEO4J YAML 解析修
11. **`b79e59a` P0 安全漏洞 6 项一次修** [Track4] — authMiddleware 设计缺陷 / 硬编码默认密码 / SQL 拼接注入 / SSRF / data-isolation 名不副实

### 决策 / 智能体 (1 条)

12. **`ce96e3c` Plan 模式第 4 智能体级别首次建档** [Track1] — 文件锁 + 步骤超时 + resume hardening, 80% 完成度 (注: "失败重规划" 仍是 TODO, 失败只 break 不重生成)

> [A] 12 条按"产品影响 × 风险修复"权重排, 不按时间排。**4 个 P0 修复 + 3 个生产事故根因修复 + 1 个跨端嵌入链路闭环** 是 5 周内最该让决策者知道的事。

---

## 4. Top 5 风险 (Cross-track 整合, 按优先级排)

> 从 4 个 track 报告里 cross-reference 出的最该让决策者拍板的风险, **不与单 track 报告重复** (单 track 细节见附录索引)。每条 ≤ 3 行。

### R1 — 4-29 评估基线与代码系统性脱节 [P0, 跨 4 track] [F/A]

**风险**: 4-29 文档 9.1 节 3 处"已修复"声明 (Reflection / 动态团队组建 / Agent+7 协议超时保护) 全部与代码不符 [F: Track1 §3.2, F17-F19], 共 19 个 it.skip / describe.skip 是"隐性谎言"。**这不是单 track 问题 — 决策者依此 doc 拍板的判断会失真**, 影响 marketing / 招聘 / 客户承诺。
**影响**: 短期 (客户 demo 翻车) → 中期 (季度规划失准) → 长期 (团队对"已完成"项产生免疫)。
**当前状态**: doc 未更新, 代码未补, 3 处"已修复"全挂着。
**建议方向** (二选一): ① 1 周内校准 doc, 19 个 skip 该修修该删删 (推荐 Reflection + 超时优先, 1 周可补最小化版本); ② 修订 doc 9.1 节, 明确"未实现, 已入 backlog"。**推荐 ① 的部分**: Reflection + 超时是 1 周可补的最小化版本 (5 + 11 测试), 动态团队组建需 LLM 协助选型, 估 2 周。

### R2 — bytenode 字节码保护让生产不可调试, MTTR +20 分钟 [P0] [F/A]

**风险**: 生产容器 `dist/` 只有 `.jsc` 字节码, 无可读 JS [F: Track4 §3 风险 1]。任何 P0 故障 on-call 不能 `cat` 排查, 必须本地重现 → 改代码 → build-and-push → 等 SWR push → 生产 pull → restart。
**影响**: 高频 P0 故障 (如 R4 提到的 Ingest 事故) 的 MTTR 显著延长; 夜间值班疲劳度上升。
**当前状态**: build-and-push 流水线是手动的 (`scripts/build-and-push.sh` [F]), 无 debug 镜像 tag, 无内部 source map。
**建议方向** (三选一): ① 保留一个 `raos-backend:debug` 非字节码镜像 (仅内网, 不进 SWR 生产流); ② 关键路径预埋 source map (镜像内, 不公开); ③ 接受现状, 把 build-and-push 自动化到 CI。**推荐 ①** (1 周可落地, ROI 最高)。

### R3 — 嵌入 `RAOS_NAVIGATE` 协议只发不收, 父页面必须自实现 [P0] [F/A]

**风险**: 嵌入场景下, AppDesignCard 派发跳转消息到 `window.parent`, **但仓库内无任何监听器** [F: Track3 §3 R1, 全代码库 grep 0 命中]。第三方父页面若不监听, iframe 内"提出修改意见"主链路静默失效。
**影响**: 嵌入客户是商业化主要客户类型之一, 这条主链路断点直接卡住客户集成。
**当前状态**: 仓库无文档, 无 fallback, 无父页面 snippet 样例。
**建议方向**: 1 周内写 `EMBED_PROTOCOL.md` 规范 + 父页面最小监听 snippet + EmbedChat 内置 fallback (3 秒未 ack 自动 iframe 内 `navigate()`)。**高 ROI, 客户集成门槛从"读代码猜"降到"复制 snippet"**。

### R4 — Ingest 稳定性 3 连击 + 串行并发 = 1 [P1] [F/A]

**风险**: 4-29 之后 3 个生产事故根因全在 ingest 链路 (WAL 截断 / kb-ingest 卡 5% / Gitee batch 400) [F: Track2 §4.1], 已全修; 但 **Ingest 队列仍是 process-global 单例, 并发 = 1** [F: Track2 §4.1], 大批文档进队串行阻塞, 大 docx (> 100MB) 走完整 pipeline 仍可能耗时 > 10min, 中间任何环节出 FE 看不到进度。
**影响**: 商业化主要场景 (大文件知识库导入) 体验差, FE 5%/30%/60% 偶发卡死, 静默故障 (无业务 alert) [F: Track4 §3 风险 3]。
**当前状态**: 3 个根因修了, 串行并发未改, 监控只有 1 dashboard + 5 alert rules (缺业务级) [F]。
**建议方向**: 1) 串行改 per-user 串行 + 全局并发 N=2-3 (1 周); 2) 加 5 条业务 alert (kg_extraction_queue_depth / qdrant_search_error / rabbitmq_queue_depth / skill_failure_rate / agent_max_iterations_hit) + 拆 dashboard 为 4 个 panel (3 天)。**静默故障可见化, 直接减少客户投诉**。

### R5 — KG 检索 7-15% 缺口, 4 stage fallback 救了字面救不了语义 [P1] [F/A]

**风险**: 真数据标定显示 92.9% rescued [F: Track2 §3.1 量化结果], 仍有 7-15% query (长尾中文 / 跨领域组合) 召不到正确 chunk, 排序仅用 `vector_score + graph_boost` 简单求和, **缺 Rerank 模型** (4-29 标 P2 现在升 P1)。
**影响**: 商业化检索场景下, 长尾 query 准确率不稳定, 影响用户对"智能"标签的信任。
**当前状态**: 1000+ 真数据标定未跑 (15 queries 小样本), Rerank 模型未引入。
**建议方向**: 1) 1 周扩标定到 1000 query (复用 calibrate 框架, 干掉 P2 backlog); 2) 2 周评估接入 `bge-reranker-base` (100MB ONNX) 或 `cross-encoder/ms-marco-MiniLM-L-6-v2`, 接入 Top-50 Rerank → Top-10。**预期 Top-10 precision +20-30%**。

> [A] 这 5 条都是**已发生的真实信号**驱动 (1 个 doc-code 脱节 + 1 个生产阻塞 + 1 个商业链路断点 + 1 个稳定性集群 + 1 个准确率缺口), 不是 "未来可能出问题" 式的空想风险。R1 是这一轮**最该最先解决**的 — 它锁死了其他 4 条的判断基线。

---

## 5. 下一步 30 / 60 / 90 天行动建议 (决策者拍板用)

> 每条 ≤ 2 行, 含成本/收益判断。**不要面面俱到, 选 ROI 高的做**。

### 30 天 (1-2 个必须做, 高 ROI)

- **[决策项 A] 校准 4-29 文档 9.1 节"已修复"项** [Track1 衍生] — 1 周 / 0.5 人月 · 极高 ROI · 1:1 比对 19 个 skip, 该修修该删删; Reflection + 超时最小化版本可补
- **[决策项 B] 修 Ingest 串行阻塞 + 加 5 条业务 alert + 拆 dashboard** [Track2+4] — 2 周 / 1 人月 · 高 ROI · 静默故障可见化, 直接减少客户投诉; build-and-push 流水线同步硬化 (收益外溢到 R2)

### 60 天 (2-3 个该做, 中 ROI)

- **[决策项 C] KG 跑 1000+ 真数据标定 + 接入轻量级 Rerank** [Track2] — 4 周 / 1 人月 · 中高 ROI · 把"92.9% rescued"从"小样本标定"变成"生产可信数字"; Top-10 precision +20-30%
- **[决策项 D] 嵌入 RAOS_NAVIGATE 协议文档化 + EmbedChat 内置 fallback** [Track3] — 1 周 / 0.3 人月 · 中 ROI · 客户集成门槛骤降; 同步做 bytenode `:debug` 镜像 (决策项 R2 缓解)
- **[决策项 E] Form key 改绑 cascade + WorkflowDesigner 体验加固** [Track3] — 2 周 / 0.5 人月 · 中 ROI · 堵住"改 key → 工作流任务 404"隐蔽链路; 取消 5 个 flaky test skip

### 90 天 (1-2 个长期方向)

- **[方向 F] 补全 4-29 "已修复" 实质能力 (Reflection / 动态团队 / 超时)** [Track1] — 4-6 周 / 2 人月 · 中 ROI · 让 doc 9.1 节真正"已修复", 摘掉"虚标"标签
- **[方向 G] 移动端适配 + Agent 调试/追踪页** [Track3] — 6 周 / 2 人月 · 中 ROI · 4-29 评的 3.0/5 + 2.3/5 短板; 嵌入 + Web 已覆盖核心, 移动端是商业化下一程

> [A] **不要 30/60/90 全做**。30 天做 A + B, 60 天做 C + D (E 看资源), 90 天做 F (G 留给下一轮规划)。R5 准确率缺口是"持续优化"主题, 60 天是开始, 不指望 90 天闭环。

---

## 6. 附录 (供审计 / 决策者深挖用)

### 6.1 完整证据链 (数字背后)

**测试通过率** (4 track 汇总, 2026-06-07 全量跑过):
- Track1 决策: `tests/agents/` 93 活跃 it() / 16 it.skip / 3 describe.skip (109 it() 含 skip) [F: Track1 F16]
- Track2 记忆+KG+检索: 20 次 vitest 跑全 pass, 全工程 2038 pass / 43 skip / 1 todo / 0 fail [F: Track2 §8.1]
- Track3 UI+Form+Workflow: 211 skills + 170 web + 77 workflow (4 skipped) = 458/458 跑过 [F: Track3 §4]
- Track4 基础设施: `tests/skills/` 207 + `tests/engine/` 109 + `tests/middleware/` 21 + `tests/permissions/` 95 + `tests/federation/` 50 = 482/482 跑过 [F: Track4 §5]
- **全工程汇总**: 2038 pass / 62+ skip / 1 todo / 0 fail, 0 编译错 [F: Track2 §1]

**Commit 计数**: `git log --since="2026-04-29" --oneline | wc -l` = **132 个 commit** [F]。Track2 内 12 个核心, Track4 内 51 个, Track3 内 52 个, Track1 内 15+ 个。

**当前 HEAD**: `a19771f03cc009f8fbab5d06d3722dd6f4fcbf20` [F: `git log -1 --format='%H'`]

### 6.2 4 个 Track Report 关键结论索引

| Track | 主报告 | 关键数字 / 关键判断 |
|------|--------|---------------------|
| **Track1 决策** | `deliverable-track1-decision.md` (135 行) | Orchestrator 80→85% 是唯一真实进步; Plan 模式首次建档 80%; **4-29 doc 9.1 节 3 处"已修复"全失实 (19 skip)** |
| **Track2 记忆+KG+检索** | `deliverable-track2-memory-kb.md` (266 行) | KG 88→93%, 检索 90→93%, 记忆 93→95%; KG v2 1-6 阶段闭环 + 3 事故根因修复; 7-15% 准确率缺口 |
| **Track3 UI+Form+Workflow** | `deliverable-track3-ui-form.md` (105 行) | 85→90%; 15→20+ 页, 8→20 widget; **嵌入 RAOS_NAVIGATE 只发不收**; CodeHighlighter Vite alias 传递依赖 |
| **Track4 基础设施** | `deliverable-track4-infra.md` (153 行) | 89→91%; Skill 93 / 权限 92 / 进化 87 / 部署 88 (新维度); 5 连击部署 commit + 482 测试全过; bytenode MTTR +20min |

### 6.3 未解决 / 待验证项 (诚实标记)

- [ ] **4-29 9.1 节校准** — 19 个 it.skip/describe.skip 一个未修, doc 未更新
- [ ] **bytenode debug 通道** — 未落地 (R2)
- [ ] **嵌入 RAOS_NAVIGATE 协议文档化** — 未落地 (R3)
- [ ] **Ingest 串行改并发 N=2-3** — 未落地 (R4 部分)
- [ ] **5 条业务级 alert** — 未落地 (R4 部分, R5 衍生)
- [ ] **Rerank 模型接入** — 未启动 (R5)
- [ ] **WAL 定期 compact** — 未启动, 当前靠 100MB 截断兜底
- [ ] **TypeScript `tsc --noEmit` 0 error 报告** — Track2 引用 CHANGELOG 报告, 本轮 review 未独立跑 tsc
- [ ] **Track2 KG 测试的 4 个 stage 5 模拟 store 跑通** — 实际未连 Neo4j 验证 (Track2 §6 标)
- [ ] **Track3 EmbedChat 嵌入真客户场景试运行** — 仅代码层验证, 无生产数据
- [ ] **Track4 5 连击部署真生产运行 1 个月** — 6-08 才上 multi-arch, 长期未观察

### 6.4 与 4-29 评估对比的方法论说明

**双视角方法**:
- **视角 A — 独立重评**: 基于源码 / 测试 / commit 独立打分, 与 4-29 文档无引用关系
- **视角 B — 增量对比**: 把当前与 4-29 文档表对照, 标注 Δ 与失实项

**为什么表观下降** (-3%): 4-29 用了"已修复"但代码未实装的乐观口径; 独立审计挤出 3 处失实, 同时 4-29 未量化的"部署"维度被补齐 (88% 真实落地)。**真实能力增长, 完成度数字下降, 因为基线被校准**。

**与 4-29 文档显式分歧** (3 处, Track1 详证):
1. 4-29 §2.1 Team 评估: "动态团队组建 + Expert Registry + 自动协议选择" 声称已修复 — **实际 3 个 describe.skip, orchestrator 不调用 ExpertRegistry**
2. 4-29 §2.1 ReAct 评估: "Reflection 模式 (错误检测 + LLM 反射 + 修正 + 重试)" 声称已修复 — **实际 5 个 it.skip, 源码 0 命中**
3. 4-29 §2.1 / §6.1: "ReAct 30s 超时 + 7 协议 step/total 双层超时" 声称已修复 — **实际 11 个 it.skip, utility 未被任何 agent 引用**

---

**报告生成时间**: 2026-06-08 00:18 (Asia/Shanghai)
**Reviewer**: general (sub-agent) · **基线 commit**: `a19771f`
**汇报对象**: mvs_8050e69a4cdd44c28c2bfea752fb377e
