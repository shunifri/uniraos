# RAOS 可持续推进计划 (2026 Q3)

> **来源**: RAOS 能力 review 团队任务 (plan_9a1a3524) synthesis 报告, 5 轨全 PASS, 见 `deliverable-synthesis-final.md`.
> **基线**: HEAD `a19771f` · 总体完成度 91% · 4-29 自评 94% (虚标 3 处)
> **筛选标准**: RAOS 是高分险项目 (智能体 OS + KG, 决策影响大), 排除需要长期生产运行验证的项, 保留代码/文档/单测可立即验证的项.
> **节奏**: 每批 2 周, 每周末 team review, 8 周后重跑 RAOS 能力 review 对比基线.

---

## Week 1-2: 立即推进 (高 ROI)

| # | 行动 | 来源 | 工时 | 风险 | 验证方式 |
|---|------|------|------|------|---------|
| 1 | 校准 4-29 doc 9.1+9.2 节"已修复"项 — 19 skip 拆: 5 reflection + 11 timeout 补最小化版, 3 动态团队 + 1 Parallel Gateway 入 backlog | 决策项 A | 1 周 / 0.5 人月 | 极低 | 全工程 test pass + 19 skip 1:1 对照 |
| 2 | 嵌入 RAOS_NAVIGATE 协议文档化 (`EMBED_PROTOCOL.md` + 父页面最小 snippet + EmbedChat 内置 3s fallback) | 决策项 D 部分 | 2 天 / 0.1 人月 | 极低 | 文档 review + EmbedChat 单测 |
| 3 | 跨项目禁新增 it.skip (CI lint rule, 含 .todo() 替代方案) | Track1 决策项 E | 1 天 / 0.1 人月 | 极低 | 故意写个 it.skip → CI 报错 |

## Week 3-4: 中期推进 (中高 ROI, 纯代码)

| # | 行动 | 来源 | 工时 | 风险 | 验证方式 |
|---|------|------|------|------|---------|
| 4 | Ingest 串行改 per-user 串行 + 全局并发 N=2-3 | 决策项 B 部分 | 1 周 / 0.5 人月 | 中 (改并发需压测) | 全工程 test pass + 50 docx 并发导入压测 |
| 5 | Form key cascade: FormDesigner 改 key 时同步更新 `workflow_form_bindings` | Track3 R3 | 1 周 / 0.5 人月 | 低 (纯代码 + 单测) | 改 key → 工作流任务仍 200, 不 404 |
| 6 | KG 1000 query 标定 (复用 `scripts/calibrate-from-real-data.ts` 框架, 干掉 P2 backlog) | 决策项 C 部分 | 1 周 / 0.5 人月 | 极低 (纯评估) | recall ≥ 92.9% baseline |

## Week 5-8: 长期推进 (中 ROI)

| # | 行动 | 来源 | 工时 | 风险 | 验证方式 |
|---|------|------|------|------|---------|
| 7 | 补 Reflection/动态团队/超时 实质实现 (摘 4-29 虚标) | 方向 F 部分 | 3-4 周 / 1.5 人月 | 中 (新功能 + 单测) | 19 it.skip 全 fix, doc 9.1 改"已实现" |
| 8 | WAL 定期 compact 自动化 (cron + 监控) | Track2 R3 | 1 周 / 0.3 人月 | 低 | 跑 7 天, WAL 文件大小稳定在阈值下 |
| 9 | CodeHighlighter Vite alias pin `react-syntax-highlighter` 版本 + dev smoke | Track3 R2 | 1 天 / 0.1 人月 | 极低 | 升级 antd-x 时 CodeHighlighter 不破 |

## 暂存 (需长期生产运行验证, 不进本轮)

| 行动 | 暂存原因 | 何时重启 |
|------|---------|---------|
| 5 业务 alert 阈值 (queue_depth / search_error / skill_failure_rate / max_iterations_hit) | 阈值要生产真实告警触发才能校准, 拍脑袋阈值要么误报要么漏报 | RAOS 稳定运行 1 季度后, 用真实告警历史数据校准 |
| Rerank 模型 (bge-reranker-base / cross-encoder/ms-marco-MiniLM) AB test | Top-10 precision +20-30% 是理论预期, 没真数据 | RAG 流量稳定 + 1k 真 query 标定后 |
| bytenode `:debug` 镜像 MTTR 实测 | MTTR 改善需要生产事故触发, 跟事故走 | 不可计划, 出 P0 时启用 |
| 移动端 + Agent 调试页 | 长期 production rollout, 不是本 review 范围 | 下一轮规划 |
| KG stage5 真 Neo4j 验证 | 需要真 Neo4j 实例 + 调通, 跟部署轨 | 跟部署轨一起 |
| Track4 5 连击部署真生产运行 1 月观察 | 6-08 才上 multi-arch, 长期未观察 | 上线后 1 季度评估 |

## 高分险项目追加: 灰度规则

所有 Week 3-8 项, 即使代码 + 单测通过, 也必须:
- **5% 流量灰度 1 周** → 25% 1 周 → 50% 1 周 → 100%
- 任一阶段 P0 故障 → **自动回滚 0%**
- 灰度期间观察 log + alert + 客户投诉, 不只看 test pass
- 由 on-call 工程师每周末 review 一次, 决定下一档开关

## 节奏

- **每批 2 周**, 独立可验证
- 每周末 team review: 推进进度 + 风险信号 + 决策项 A 校准后是否要回写 4-29 doc
- 暂存项每季度评估 (3 个月一次), 决定是否重启
- 8 周后重跑一次 RAOS 能力 review (5 轨 + synthesis), 跟这次基线对比

## 总工时

- Week 1-2: 0.7 人月
- Week 3-4: 1.5 人月
- Week 5-8: 1.9 人月
- **8 周合计 ~4.1 人月** (1 工程师满负荷 + 0.5 工程师配套 review)

## Cross-reference

- RAOS 能力 review 团队任务 synthesis 报告: `deliverable-synthesis-final.md`
- 4 轨独立 deliverable: `deliverable-track{1,2,3,4}-*.md`
- 4-29 基线 doc: `docs/RAOS-设计目标全面评估报告.md`
- 已知 11 项未解决 / 待验证: `deliverable-synthesis-final.md` §6.3
