# RAOS 决策智能体 Review (2026-06-07, Attempt 2)

> **代码基准**: master @ `a19771f` (2026-06-07)  
> **对比基线**: `docs/RAOS-设计目标全面评估报告.md` (2026-04-29)  
> **评审范围**: `src/agents/` (5 个核心文件 + 7 个协议 + ExpertRegistry + timeout-utils) · `src/routes/agent-routes.ts` · `src/llm/agent-loop.ts` · `tests/agents/` (10 个文件, 109 个 it 用例含 skip)  
> **方法**: 双视角 — A) 独立重评现状  B) 增量对比 4-29 基线

---

## 一、Executive Summary

RAOS 决策智能体在 **Orchestrator 层** 有真实、可量化的进步（80% → 85%），主要来自会话持久化、应用 systemPrompt/KB 注入、数据可视化引导等"工程硬化"改动 [F: `agent-routes.ts:66-189`, `:1027-1063`; `orchestrator.ts:776-845`]。Simple / ReAct / Team / Plan 三个核心智能体的**功能完成度本身没有显著提升** —— ReAct 仍无真正的 Reflection 能力、Team 仍缺动态组建能力、ReAct + 7 个协议执行器**都未实装 step/total 超时保护** (doc 声称已修但源码 0 命中) [F: `src/agents/timeout-utils.ts` 仅有未引用 utility, `grep -rn "withTimeout\|checkTotalTimeout" src/agents/` 0 命中]。**最关键的风险是 4-29 doc 9.1 节 3 处"已修复"声明 (Reflection / 动态团队组建 / 超时保护) 均与代码不符** [F: `4-29 doc L468-469, L474`; `react-agent.test.ts:364,410,455,531,572` × 5 it.skip; `dynamic-team.test.ts:63,106,190` × 3 describe.skip; `timeout-protection.test.ts:145,185,212,261,282,310,353,407,433,466,494` × 11 it.skip]—— 决策者依据旧 doc 做出的判断会与现实脱节。

---

## 二、完成度分项

| 智能体 | 当前 (06-07) | 4-29 基线 | Δ | 关键证据 [F] |
|---|---|---|---|---|
| **Simple Agent** | ~95% | 95% | — | `simple-agent.ts:18-134`：单 LLM 调用 + 流式 + Profile；设计已稳定，5 周内无功能变更 |
| **ReAct Agent** | ~90% | 90% | — (功能未变, P1-29 是稳定性) | `react-agent.ts:40` (maxIter=30) · `:299-327` (hitMax 强制 final summary) · `:224-241` (user_confirm 暂停等待) · **`:364,410,455,531,572` 5 个 reflection 测试全 `it.skip`, 注释 "TODO: reflection feature not yet implemented"** |
| **Team Agent** | ~88% | 88% | — (4 高级协议仍简化, 动态组建未实装) | `team-agent.ts:90-108` 路由 7 个协议 · `protocols/market-based.ts:202` `costPerToken ?? 1` 兜底说明成本模型未真用上 · **`dynamic-team.test.ts:63,106,190` 三个 `describe.skip` 块** · `orchestrator.ts` 无 `analyzeTaskRequirements/formTeam` 方法 (专家注册表 `expert-registry.ts` 存在但**未被 orchestrator 调用**) |
| **Orchestrator** | ~85% | 80% | **+5% ↑** | `orchestrator.ts:776-845` `analyzeConversationMemory` (fire-and-forget, 防抖 10s) · `agent-routes.ts:66-189` `loadAppSystemPrompt` (P1-23 放宽 draft/applied 状态) · `agent-routes.ts:1027-1063` `loadHistoryFromDb` (MySQL/SQLite 双后端持久化) · `agent-routes.ts:179-181` (P1-31 角色锁定 + chart_generate 引导) |
| **Plan Agent** (4-29 之后新增为第 4 级) | ~80% | 未评 | 首次建档 | `plan-agent.ts:21-265` 4 类流式事件；`:115, :248` 失败时仅 `break`，**未真正重规划**；`ce96e3c` 加文件锁 + 步骤超时 + resume hardening，但核心"re-plan on failure"未实现 |

**测试覆盖 (修订)**: `tests/agents/` + `tests/agents/protocols/` 共 109 个 `it()` (含 skip) [F]：

| 分布 | 数量 | 来源 |
|---|---|---|
| 活跃 `it()` | **93** | 10 文件 (含 protocols/parse-helpers.test.ts:21) |
| `it.skip` | **16** | 5 (reflection) + 11 (timeout-protection) —— **两类独立的未实装能力** |
| `describe.skip` | **3** | 全在 dynamic-team.test.ts (analyzeTaskRequirements / formTeam / runTeamStream) |

> ⚠️ **修订前报 (Attempt 1) 的错误**: 此前报告写"16 it.skip 几乎全在 reflection, 3 describe.skip 全在 dynamic-team", 把 reflection 和 timeout 混为一谈。Verifier 指出实际 11/16 在 `timeout-protection.test.ts`、5/16 在 `react-agent.test.ts` 的 reflection 块, 两者是**两类独立未实装能力, 不应合并叙述**。

---

## 三、自 4-29 以来的重大变化

### 3.1 真实落地的能力 (10 条)

| 类别 | 改动 | 证据 |
|---|---|---|
| 稳定 | **P1-29**: ReAct `maxIterations` 15→30, hitMax 时强制 final summary 调一次无 tool LLM | `112ebb3`, `react-agent.ts:40`, `:299-327` |
| 稳定 | **P1-30**: `TeamAgent.createSubAgent` 读 `config.maxIterations`, 修复子 agent 硬编码 10 bug | `2983e01`, `team-agent.ts:75-88` |
| 稳定 | **P1-23**: `loadAppSystemPrompt` 接受 `draft + applied` 两态, 刚保存未"应用"也能注入 | `3381e2c`, `agent-routes.ts:76` |
| 稳定 | **P1-31**: 角色锁定移除"数据图表"禁令 + 显式 `chart_generate` 引导 | `f11c096`, `agent-routes.ts:179-181` |
| 能力 | **Plan 模式**: 第 4 智能体级别; 文件锁、步骤超时、resume hardening | `ce96e3c` (3 类 concurrency fix) |
| 能力 | **Plan 流事件**: `text_delta` 替代 `message` 事件, 前端兼容 | `90eae81`, `plan-agent.ts:255-264` |
| 架构 | **流式重构**: SSE 端点废弃, 统一走 WebSocket; 新增 `/agent/chat/start` 入口; `stream_complete` 显式事件 | `4cf1fd3`, `b9a540f`, `c5c6e81`, `7ce8705`, `850317f`, `219a26c`, `3ce00d5` |
| 架构 | **数据隔离**: form/custom-skill/conversation Repository 强制 `userId/ownerId` 过滤 | `8a05be6` |
| 架构 | **记忆系统加固**: 跨重启 `loadHistoryFromDb` (MySQL/SQLite 双适配) + `kb_references` 显式事件 | `agent-routes.ts:614-619, 644-650, 1027-1063` |
| 体验 | **嵌入场景**: `?app=…` / URL autoMessage / 持久化 streamId / 角色锁定支持数据可视化 | `14394e6`, `eacd015`, `7ce8705`, `f11c096` |

### 3.2 标为"已修复"但实际未落地 — 3 类独立缺陷 [A]

> 4-29 doc 在 9.1 节的"已修复"声明中, **至少 3 项与代码不符**。每一项都是独立的未实装能力, 决策者若信以为真, 会把三类风险都误判为已闭环。

| 4-29 doc 声明 [F] | 现实证据 [F] | 范围 |
|---|---|---|
| **L468-469, 9.1#1**: "Team 协议实现深度不足 → 已修复: 动态团队组建 + Expert Registry + 自动协议选择" | `tests/agents/dynamic-team.test.ts:63,106,190` 三处 `describe.skip`；`orchestrator.ts` 无 `analyzeTaskRequirements` / `formTeam` 方法；`expert-registry.ts` 类存在但**未被 orchestrator 调用** (`grep -n "expertRegistry\|ExpertRegistry" src/agents/orchestrator.ts` 0 命中) | Team 维度 |
| **L469, 9.1#2 + L60, 2.1**: "缺少 Reflection 模式 → 已修复: 错误检测 + LLM反射分析 + 修正策略注入 + 重试" | `react-agent.test.ts:364, 410, 455, 531, 572` 全部 `it.skip`，注释 `// TODO: reflection feature not yet implemented in ReactAgent`；`grep -rn "reflectionEnabled\|maxReflections\|reflection" src/` 0 命中 | ReAct 维度 |
| **L474, 9.1#7 + L86, 2.1**: "Agent 缺少超时保护 → 已修复: ReAct 30s 超时 + 7 种协议 step/total 双层超时" | `src/agents/timeout-utils.ts:11,27` 定义了 `withTimeout` + `checkTotalTimeout` 但 **`grep -rn "withTimeout\|checkTotalTimeout" src/agents/` 0 命中** (未导入未调用) — 数据库连接器 (`src/services/database-connector.ts:60`) 有自己的本地 `withTimeout`, 与 agents 无关；`tests/agents/timeout-protection.test.ts` 共 11 个 `it.skip` (L145,185,212,261,282,310,353,407,433,466,494), 注释 `// TODO: chatTimeout / stepTimeout / totalTimeout not yet implemented` | 稳定性维度 |

---

## 四、Top 3 风险

### 风险 1: 决策基线与代码脱节 (3 处"已修复"全部不成立) [P0, 高置信]
**影响**: 4-29 doc 第二节 (2.1 Team 评估) 和第九节 (9.1#1, #2, #7) 至少 **3 处"已修复"声明**与代码不符：Reflection (5 个 it.skip)、动态团队组建 (3 个 describe.skip)、Agent + 7 协议超时保护 (11 个 it.skip + utility 未引用) [F]。Stakeholder / 投资者若继续引用此 doc 做判断, 结论会失真。  
**建议方向** (不写代码): 重新校核 4-29 doc 9.1 节"已修复"项的每一项, 与代码 / 测试 1:1 比对; 把未真正落地的项要么补上, 要么从 doc 移除,**避免下一份报告也累积这种偏差**。若只补一个, 优先补 9.1#2 (Reflection) — 因为它是 doc 9.1 节第一条 #2, 也是决策者最容易引用的"前沿 Agent 模式"承诺。

### 风险 2: Team 高级协议仍是"框架"而非"能力" [P1]
**影响**: A2A / CONTRACT_NET / MARKET_BASED / BLACKBOARD 4 个协议都有代码, 但实现浅 (`market-based.ts:202` 成本全 `?? 1`、`contract-net.ts:190` 评分仅按 confidence); 无真实业务负载验证. ExpertRegistry 7 个专家 profile (含 researcher/coder/analyst/writer/planner/reviewer/creative/domain_expert) **未被编排器消费** (4-29 doc 9.1#1 声称已修, 但 risk 1 已证伪).  
**建议方向**: 要么把其中 1-2 个协议 (建议 CONTRACT_NET + BLACKBOARD, 与现有 SWARM/HIERARCHICAL 形成对照) 做深度硬化 + 真实 case 验证, 要么把这 4 个协议标为 "experimental" 从 docs 摘出来、避免对客户做能力承诺。

### 风险 3: Orchestrator 策略选择仍是启发式 [P1]
**影响**: `quickAnalyzeStrategy` (`orchestrator.ts:848-951`) 靠正则 + LLM JSON 决策, 无 outcome 反馈; 话题变化检测看 `topicChange` 标记 (LLM 自行决定) 而非真实 diff; 目前没有"哪种策略在哪种 query 上成功率高"的 telemetry 闭环.  
**建议方向**: 在 `analyzeStrategy` 决定上落 `metadata` (level/protocol/teamSize/iterations/duration/success), 汇总到 metrics 表; 30 天内跑出"策略选择 → 用户反馈 / 任务完成度"基线, 再决定是否引入分类模型替代正则。

---

## 五、下一步 30 天行动建议 (决策者拍板项)

- **[决策项 A] 三处"已修复"doc-代码不一致, 二选一** [A]: 4-29 doc 9.1#1 / #2 / #7 全部与代码不符. 二选一: ① 2 周内补齐 3 个最小可用版本 (Reflection 5 测试 + Dynamic team 3 describe + Timeout 11 测试), 加 6-8 个真测试替代 16 个 it.skip; ② 修订 doc 9.1 节, 明确"未实现, 已加入 backlog". **推荐 ① (部分)** — Reflection + 超时是 1 周可补的最小化版本, 动态团队组建需要 LLM 协助选型, 估 2 周.
- **[决策项 B] Team 协议定级** [A]: 把 4 个高级协议按"生产可用 / 实验性"两档归类; 实验性不进 marketing 资料、不出现在客户 demo 路径上。**推荐**: HIERARCHICAL/SEQUENTIAL/SWARM = 准生产, A2A/CONTRACT_NET/MARKET_BASED/BLACKBOARD = 实验性, 文档明确标注。
- **[决策项 C] Orchestrator 加 telemetry 钩子** [A]: 30 天内先做最薄的 `strategy_metrics` 表 (level/protocol/iterations/duration/success/regen_count), 跑通后再说"策略学习"; 不要先投入训练分类模型.
- **[决策项 D] Plan "失败重规划" vs "快速失败"** [A]: `plan-agent.ts:115, :248` 检测到失败就 `break` —— 是有意设计还是 TODO? 若是有意, 写进 doc; 若是 TODO, 排到下个 sprint (估算 1 周)。
- **[决策项 E] 清理测试欠账 (修订为精确数字)** [A]: **16 个 `it.skip` (5 reflection + 11 timeout) + 3 个 `describe.skip` (dynamic team) = 19 个被跳过的"隐性谎言"**。跑 `vitest run` 报告说"通过", 但 skipped 不算覆盖。建议下个 sprint 把 19 个拆成两类: 一类真实现, 一类删除, **任何 PR 都不允许新增 it.skip 而不附 explanation**。

---

## 附录: 关键事实引用清单 (供 audit)

| ID | 引用 |
|---|---|
| F1 | `src/agents/simple-agent.ts:18-134` Simple Agent 实现 |
| F2 | `src/agents/react-agent.ts:40` maxIter 默认 30 |
| F3 | `src/agents/react-agent.ts:299-327` hitMax 强制 final summary |
| F4 | `src/agents/react-agent.ts:224-241` user_confirm 流式等待 |
| F5 | `src/agents/team-agent.ts:90-108` 7 协议路由 |
| F6 | `src/agents/team-agent.ts:75-88` createSubAgent 读 config.maxIterations (P1-30) |
| F7 | `src/agents/orchestrator.ts:687-771` analyzeStrategy (LLM 决策) |
| F8 | `src/agents/orchestrator.ts:776-845` analyzeConversationMemory (fire-and-forget) |
| F9 | `src/agents/orchestrator.ts:848-951` quickAnalyzeStrategy (regex 启发式) |
| F10 | `src/agents/plan-agent.ts:115, :248` 失败时 break, 未真重规划 |
| F11 | `src/routes/agent-routes.ts:66-189` loadAppSystemPrompt |
| F12 | `src/routes/agent-routes.ts:76` draft+applied 双状态 (P1-23) |
| F13 | `src/routes/agent-routes.ts:179-181` 角色锁定 + chart_generate 引导 (P1-31) |
| F14 | `src/routes/agent-routes.ts:1027-1063` loadHistoryFromDb (MySQL/SQLite) |
| F15 | `src/routes/agent-routes.ts:1007-1023` agent_done / kb_references 事件落库 |
| F16 | `tests/agents/` + `tests/agents/protocols/` 总计: 93 活跃 it() / 16 it.skip / 3 describe.skip (109 it() 含 skip) |
| F17 | `tests/agents/react-agent.test.ts:364,410,455,531,572` 5 个 reflection `it.skip` (TODO 注释) |
| F18 | `tests/agents/dynamic-team.test.ts:63,106,190` 3 个 `describe.skip` |
| F19 | `tests/agents/timeout-protection.test.ts:145,185,212,261,282,310,353,407,433,466,494` 11 个 timeout `it.skip` (chatTimeout / stepTimeout / totalTimeout 注释 "TODO: ... not yet implemented") |
| F20 | `src/agents/timeout-utils.ts:11,27` `withTimeout` + `checkTotalTimeout` 定义存在 |
| F21 | `grep -rn "withTimeout\|checkTotalTimeout" src/agents/` 0 命中 (utility 未被 agents / protocols 引用) |
| F22 | `src/services/database-connector.ts:60` 数据库连接器有自己的本地 `withTimeout`, 与 agents 无关 |
| F23 | `src/agents/expert-registry.ts` 类存在, 未被 `orchestrator.ts` 引用 (`grep -n "expertRegistry\|ExpertRegistry" src/agents/orchestrator.ts` 0 命中) |
| F24 | `src/agents/protocols/market-based.ts:202` `costPerToken ?? 1` 兜底 |
| F25 | commit `a19771f` 当前 master 头 |
| F26 | commit `112ebb3` P1-29 maxIter + hitMax 总结 |
| F27 | commit `2983e01` P1-30 TeamAgent config.maxIterations |
| F28 | commit `3381e2c` P1-23 draft 状态注入 |
| F29 | commit `f11c096` P1-31 角色锁定 + chart_generate |
| F30 | commit `ce96e3c` Plan hardening (file lock + timeout) |
| F31 | 4-29 doc L468-469 "已修复" 声明 (Reflection / 动态团队) |
| F32 | 4-29 doc L474 + L86 "已修复" 声明 (Agent + 7 协议超时保护) |
| F33 | 4-29 doc L85 "PlanAgent 检测到失败但不重新生成计划" (未修复) |

---

*报告生成时间: 2026-06-07 23:50 (Asia/Shanghai) · 评审人: general · 数据快照: master@a19771f*

*Attempt 2 修订说明: 修正了 (1) it() 总数 72→93 (含 skip=109); (2) 16 it.skip 拆分为 5 reflection + 11 timeout 两类独立未实装能力; (3) 4-29 doc 9.1#7 (超时保护) 标为"已修复"但实际未实装, 是 verifier 指出的第三处失实. 其余结构与结论保持.*
