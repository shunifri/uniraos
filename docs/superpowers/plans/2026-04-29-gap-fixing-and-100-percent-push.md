# RAOS 差距修复 + 五大支柱 100% 推进 — 实施计划

> **目标**: 修复评估报告中的关键差距，将五大支柱达成度推向 100%  
> **阶段**: 5 个阶段，逐步推进  
> **预计工期**: 2-3 周

---

## 阶段 1: 稳定性止血（P0）— 立即执行

### 1.1 Agent 超时保护
**问题**: ReAct 循环和协议执行器无 LLM 调用超时，可能导致请求挂起  
**文件**: `src/agents/react-agent.ts`, `src/agents/protocols/*.ts`  
**方案**: 
- ReAct Agent: `Promise.race(chat, timeout)`，默认 30s LLM 调用超时
- 协议执行器: 每个协议步骤增加 60s 总超时
- 可配置: `maxExecutionTimeMs` 参数

### 1.2 对话历史持久化
**问题**: 对话历史仅在内存 Map 中，服务器重启丢失  
**文件**: `src/agents/orchestrator.ts`, `src/db/` (新增表)  
**方案**:
- 新增 `conversation_history` 表（SQLite/MySQL）
- 字段: `user_id`, `conversation_id`, `role`, `content`, `timestamp`, `tool_calls?`
- Orchestrator 读写时自动 sync 到数据库
- 启动时从数据库加载最近 N 条

### 1.3 核心 Agent 测试覆盖
**问题**: ReAct/Plan/7种协议执行逻辑零测试  
**文件**: `tests/agents/`  
**方案**:
- `react-agent.test.ts`: 测试工具调用循环、用户确认、错误处理、记忆注入
- `team-agent.test.ts`: 测试 SEQUENTIAL/HIERARCHICAL/SWARM 协议执行
- `protocol-executors.test.ts`: 测试剩余 4 种协议的基础执行
- 使用 mock LLM provider 和 mock engine

---

## 阶段 2: 功能完善（P1）— 第 2 周

### 2.1 Service Task 实际调用
**问题**: 工作流引擎的 service_task 节点无法实际调用外部服务  
**文件**: `src/workflow/engine.ts`  
**方案**:
- service_task 节点配置增加 `serviceType` 字段 (`http`, `skill`, `webhook`)
- `http`: 调用外部 HTTP API（使用 `http_call` skill 或内置 fetch）
- `skill`: 调用内部 Skill（使用 `engine.execute`）
- `webhook`: 发送 POST 请求到配置的 URL

### 2.2 Parallel Gateway 真并行
**问题**: 当前为顺序执行，非真并行  
**文件**: `src/workflow/engine.ts`  
**方案**:
- 使用 `Promise.all()` 并行执行所有分支
- 每个分支独立上下文，结果合并
- 测试覆盖并发场景

### 2.3 KB 测试覆盖
**问题**: KnowledgeBase 类和 kb_ingest/kb_search 无专用测试  
**文件**: `tests/skills/knowledge-base.test.ts`  
**方案**:
- 测试文档导入 pipeline（mock 解析器和 embedding）
- 测试混合检索（mock 向量搜索结果）
- 测试图谱同步（mock graphManager）
- 测试共享文档权限过滤

---

## 阶段 3: 体验提升（P2）— 第 2-3 周

### 3.1 可视化 Workflow Designer（前端）
**问题**: 最大前端 gap，工作流只能代码创建  
**文件**: `web/src/pages/WorkflowDesigner.tsx` (新建)  
**方案**:
- 基于 React Flow 或自研 SVG 画布
- 左侧节点面板（拖放 start/user_task/service_task/gateway/end）
- 中间画布（连接节点）
- 右侧属性面板（配置节点参数）
- 导出为 JSON 保存到后端

### 3.2 Skill 编辑器/创建器（前端）
**问题**: Skills 只能查看执行，不可创建编辑  
**文件**: `web/src/pages/SkillEditor.tsx` (新建)  
**方案**:
- 表单编辑：name/version/description/timeout/retry/capabilities
- ParamSchema 可视化编辑器（添加/删除字段，选择类型）
- Handler 代码编辑器（CodeEditor 组件复用）
- 测试运行按钮（调用 skill_test）

### 3.3 Agent 调试/追踪页面（前端）
**问题**: 无法查看 ReAct 循环的思考过程  
**文件**: `web/src/pages/AgentTrace.tsx` (新建)  
**方案**:
- 展示 ReAct 循环的每一步（思考→工具调用→结果）
- 时间线可视化
- 显示 Memory 召回上下文
- 显示 Skill 调用链

---

## 阶段 4: 性能优化（P3）— 第 3 周

### 4.1 向量搜索可扩展性
**问题**: LTM 和 KB 将所有向量加载到 JS 内存  
**文件**: `src/memory/ltm.ts`, `src/skills/knowledge-skills.ts`  
**方案**:
- 引入分页：每次只加载 top-K 向量的 embedding
- 或使用 Qdrant 客户端直接查询（不加载到内存）
- 批量处理：大查询分批次执行

### 4.2 大规模图谱验证
**问题**: 百万节点图谱性能未验证  
**文件**: `tests/performance/kg-large-scale.benchmark.ts`  
**方案**:
- 生成 10万/100万节点 synthetic graph
- 测试 graphSearch 延迟
- 测试社区检测耗时
- 输出性能报告

---

## 阶段 5: 前沿能力（P4）— 第 3-4 周

### 5.1 Reflection 模式
**问题**: ReAct Agent 无法自我修正  
**文件**: `src/agents/react-agent.ts`  
**方案**:
- 执行失败后，分析错误原因
- 生成修正方案（重新规划工具调用）
- 限制重试次数（最多 3 次 reflection）

### 5.2 动态团队组建
**问题**: Team Agent 需预先配置成员  
**文件**: `src/agents/orchestrator.ts`, `src/agents/team-agent.ts`  
**方案**:
- Orchestrator 根据任务分析自动选择专家角色
- 动态创建 TeamConfig（不依赖预配置）
- 专家角色库：研究员、工程师、设计师、审核员等

### 5.3 重排序模型
**问题**: 结果排序仅靠 RRF 分数  
**文件**: `src/skills/knowledge-skills.ts`  
**方案**:
- 引入轻量级 Cross-Encoder（如 ms-marco-MiniLM-L-6-v2 的 ONNX 版本）
- 对 top-20 候选结果进行重排序
- 提升检索准确率 5-15%

---

## 执行顺序

```
Week 1 (P0 稳定性)
├── Agent 超时保护
├── 对话历史持久化
└── 核心 Agent 测试覆盖

Week 2 (P1 功能 + P2 体验启动)
├── Service Task 实际调用
├── Parallel Gateway 真并行
├── KB 测试覆盖
└── Workflow Designer 前端启动

Week 3 (P2 体验完成 + P3 性能)
├── Skill 编辑器前端
├── Agent 调试页面
├── 向量搜索可扩展性
└── 大规模图谱验证

Week 4 (P4 前沿)
├── Reflection 模式
├── 动态团队组建
└── 重排序模型
```

---

## 里程碑

| 阶段 | 达成度目标 | 关键交付 |
|------|-----------|----------|
| 阶段 1 完成 | 基础设施 92% → 95% | 零超时挂起、历史不丢失、Agent 有测试 |
| 阶段 2 完成 | 知识引擎 88% → 92% | Service Task 可用、Parallel 真并行、KB 有测试 |
| 阶段 3 完成 | 交互界面 82% → 90% | Workflow Designer、Skill 编辑器、Agent 调试 |
| 阶段 4 完成 | 记忆系统 90% → 95% | 向量可扩展、大规模图谱验证 |
| 阶段 5 完成 | 决策智能 85% → 95% | Reflection、动态团队、重排序 |

**最终目标**: 五大支柱平均达成度 **95%+**
