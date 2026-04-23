# 成熟工作流系统调研报告

> **调研目标**：为 RAOS 的审批（approval）和任务（task）Skill 设计提供参考，避免从零造轮子，同时避免过度设计。
>
> **调研日期**：2026-04-20

---

## 1. 主流开源工作流引擎对比

### 1.1 四大引擎概览

| 引擎 | 起源 | 核心能力 | 社区活跃度 | 部署模式 | 适合场景 |
|------|------|---------|-----------|---------|---------|
| **Camunda** | Activiti fork (2013) | BPMN 2.0 + DMN + 任务编排 | ⭐⭐⭐⭐⭐ 最活跃 | 独立服务 / SaaS | 复杂业务流程编排、高并发 |
| **Flowable** | Activiti fork (2016) | BPMN + CMMN + DMN + 低代码 | ⭐⭐⭐⭐ 活跃 | 嵌入式 / 独立 | 文档审批、金融服务、合规 |
| **jBPM** | JBoss / Red Hat | BPMN + Drools 规则引擎 + CMMN | ⭐⭐⭐ 稳定 | 嵌入式 / 云原生(Kogito) | 需要规则引擎的业务 |
| **Activiti** | Alfresco | 轻量 BPMN + 云原生 | ⭐⭐ 下降 | 嵌入式 / K8s | 简单流程、Spring Boot 集成 |

### 1.2 关键差异

**Camunda vs Flowable vs jBPM vs Activiti**

| 维度 | Camunda | Flowable | jBPM | Activiti |
|------|---------|---------|------|---------|
| **规则引擎** | DMN 决策表 | DMN 决策表 | **Drools（最强）** | DMN 决策表 |
| **案例管理** | ❌ 已移除 CMMN | ✅ CMMN | ✅ CMMN | ❌ |
| **可视化建模** | Desktop Modeler + Web | Web Modeler + Eclipse | Business Central | Web Modeler |
| **仪表盘** | 企业版 (Operate/Optimize) | 社区版有限 | ✅ 社区版有 | 企业版 |
| **云服务** | ✅ Camunda 8 SaaS | ✅ Flowable Cloud | OpenShift | Alfresco Cloud |
| **Java 版本** | 11+ | 8+ | 11+ | 8+ |
| **Spring Boot** | ✅ Starter | ✅ Starter | ✅ Kogito | ✅ Starter |
| **REST API** | ✅ 完善 | ✅ 完善 | ✅ 完善 | ✅ 完善 |

### 1.3 我们的判断

对于 RAOS 的**approval/task Skill**需求：

- ❌ **不适合引入完整 BPMN 引擎**（Camunda/Flowable/jBPM 都太重，学习曲线陡峭，与 AI Agent 的交互模式不匹配）
- ✅ **适合借鉴其核心概念和设计模式**，自建轻量级工作流层
- ✅ **适合使用状态机模式**处理简单审批流，用 DAG（有向无环图）处理复杂编排

---

## 2. 工作流引擎核心概念（必须借鉴）

无论选择哪个引擎，以下核心概念是通用的：

### 2.1 四层抽象模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: 流程定义 (Process Definition / Workflow Spec)      │
│  - 静态的、可复用的流程模板                                   │
│  - 包含节点、连线、条件、规则                                  │
│  - 类似 "类 (Class)"                                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 流程实例 (Process Instance / Workflow Run)         │
│  - 流程定义的一次具体执行                                     │
│  - 包含当前状态、上下文变量、历史记录                           │
│  - 类似 "对象 (Object)"                                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 任务/活动 (Task / Activity)                        │
│  - 流程实例中的单个工作单元                                   │
│  - 人工任务 (User Task): 需要人处理                           │
│  - 服务任务 (Service Task): 自动执行                          │
│  - 发送任务 (Send Task): 发送消息                             │
│  - 接收任务 (Receive Task): 等待消息                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 执行引擎 (Execution Engine)                        │
│  - 驱动流程流转的核心                                         │
│  - 状态机推进、条件计算、事件分发                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 状态机四要素（来自 Laravel/Symfony 生态的最佳实践）

```typescript
// 状态机配置示例
interface StateMachineConfig {
  states: string[];           // 所有可能状态
  transitions: Transition[];  // 状态转换规则
}

interface Transition {
  name: string;               // "submit", "approve", "reject", "cancel"
  from: string | string[];    // 源状态
  to: string;                 // 目标状态
  guards: Guard[];            // 守卫条件（决定是否允许转换）
  actions: Action[];          // 转换成功后触发的副作用
}

interface Guard {
  check(context: Context): boolean;
}

interface Action {
  execute(context: Context): void;
  compensate?(context: Context): void;  // 回滚操作（Saga 模式）
}
```

**关键设计原则**：
1. **Guards 与 Actions 分离**：Guards 只做判断（无副作用），Actions 只做副作用（不判断）
2. **补偿机制 (Compensation)**：每个 Action 声明自己的 undo 方法，支持业务事务回滚
3. **乐观锁**：状态转换时检查预期状态，防止并发冲突
4. **幂等性**：Action 应安全重试，重复执行应为 no-op

### 2.3 BPMN 2.0 核心元素（简化版）

BPMN 是 ISO 标准，涵盖了 40+ 工作流模式。对于轻量级实现，只需借鉴以下元素：

| 元素 | 符号 | 含义 | 是否需要 |
|------|------|------|---------|
| **开始事件** | ○ | 流程起点 | ✅ 必须 |
| **结束事件** | ○(粗) | 流程终点 | ✅ 必须 |
| **用户任务** | ▭(圆角) | 需要人工处理 | ✅ 必须 |
| **服务任务** | ▭(圆角) | 自动执行 | ✅ 必须 |
| **排他网关** | ◇ | 条件分支（if/else） | ✅ 建议 |
| **并行网关** | ◇(+) | 并行执行 | 🟡 可选 |
| **序列流** | → | 节点连接 | ✅ 必须 |
| **定时器事件** | ○(钟) | 时间触发 | 🟡 可选 |
| **消息事件** | ○(信封) | 消息触发 | 🟡 可选 |
| **边界事件** | ○(虚线附着) | 附加在任务上的事件 | 🟡 可选 |

---

## 3. 40+ 工作流模式速查（Workflow Patterns Initiative）

由荷兰埃因霍温理工大学发起，总结了所有工作流场景的模式。以下是与我们相关的模式：

### 3.1 基础控制流模式（必须支持）

| 模式编号 | 名称 | 说明 | 实现难度 |
|---------|------|------|---------|
| WP-1 | **Sequence** | 顺序执行 A → B | 低 |
| WP-2 | **Parallel Split** | A 同时触发 B 和 C | 低 |
| WP-3 | **Synchronization** | 等待 B 和 C 都完成 | 低 |
| WP-4 | **Exclusive Choice** | 条件分支（if/else） | 低 |
| WP-5 | **Simple Merge** | 多分支汇聚（无需同步） | 低 |

### 3.2 高级分支模式（建议支持）

| 模式编号 | 名称 | 说明 | 实现难度 |
|---------|------|------|---------|
| WP-6 | **Multi-Choice** | 条件多选（可能同时走多条分支） | 中 |
| WP-7 | **Structured Synchronizing Merge** | 同步多分支汇聚 | 中 |
| WP-14 | **Multiple Instances (a priori Run-Time Knowledge)** | for-each 循环执行 | 中 |
| WP-21 | **Structured Loop** | while/for 循环 | 低 |

### 3.3 状态基础模式（审批场景核心）

| 模式编号 | 名称 | 说明 | 实现难度 |
|---------|------|------|---------|
| WP-16 | **Deferred Choice** | 等待多个事件中的第一个 | 中 |
| WP-17 | **Interleaved Parallel Routing** | 任务可并行但需互斥执行 | 高 |
| WP-18 | **Milestone** | 任务只能在特定状态下执行 | 低 |
| WP-23 | **Transient Trigger** | 一次性事件触发 | 低 |
| WP-24 | **Persistent Trigger** | 持久化事件触发（消息缓冲） | 中 |

### 3.4 取消和补偿模式（错误处理）

| 模式编号 | 名称 | 说明 | 实现难度 |
|---------|------|------|---------|
| WP-19 | **Cancel Activity** | 取消某个正在执行的任务 | 中 |
| WP-20 | **Cancel Case** | 取消整个流程实例 | 中 |
| WP-26 | **Compensation** | 回滚已执行的操作（Saga） | 高 |

---

## 4. 对 RAOS 的具体建议

### 4.1 架构定位：轻量级工作流层

RAOS 不是 BPM 平台，而是 AI Agent 平台。审批和任务只是 Skill 的一部分。建议采用**分层架构**：

```
┌────────────────────────────────────────┐
│  AI Agent (LLM  reasoning)             │
│  - 理解用户意图                         │
│  - 选择工作流模板                       │
│  - 填充上下文变量                       │
├────────────────────────────────────────┤
│  Skill 层 (approval_submit/query/approve)│
│  - 封装工作流操作                       │
│  - 对外提供简单的参数接口                 │
├────────────────────────────────────────┤
│  工作流引擎层 (Workflow Engine Lite)      │
│  - 流程定义管理                         │
│  - 流程实例执行                         │
│  - 任务分配与状态推进                    │
├────────────────────────────────────────┤
│  数据层 (SQLite/MySQL)                  │
│  - workflow_definitions 表              │
│  - workflow_instances 表                │
│  - workflow_tasks 表                    │
│  - workflow_variables 表                │
└────────────────────────────────────────┘
```

### 4.2 数据模型设计（建议）

#### workflow_definitions（流程定义）

```sql
CREATE TABLE workflow_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(128) NOT NULL,           -- "报销审批", "请假审批"
  key VARCHAR(64) NOT NULL UNIQUE,      -- "expense_approval"
  version INTEGER DEFAULT 1,
  category VARCHAR(64),                 -- "finance", "hr", "it"
  definition JSON NOT NULL,             -- 流程定义（节点、连线、条件）
  form_schema JSON,                     -- 表单字段定义
  created_by VARCHAR(64),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

definition JSON 结构示例：
```json
{
  "nodes": [
    { "id": "start", "type": "start", "next": "submit" },
    { "id": "submit", "type": "user_task", "name": "提交申请", "assignee": "${starter}", "next": "manager_approval" },
    { "id": "manager_approval", "type": "user_task", "name": "经理审批", "assignee": "${starter.manager}", "next": "gateway_amount" },
    { "id": "gateway_amount", "type": "exclusive_gateway", "conditions": [
      { "expression": "${amount} > 5000", "next": "director_approval" },
      { "expression": "default", "next": "end" }
    ]},
    { "id": "director_approval", "type": "user_task", "name": "总监审批", "assignee": "${starter.director}", "next": "end" },
    { "id": "end", "type": "end" }
  ]
}
```

#### workflow_instances（流程实例）

```sql
CREATE TABLE workflow_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL,
  definition_version INTEGER DEFAULT 1,
  business_key VARCHAR(128),            -- 业务标识（如订单号）
  starter VARCHAR(64),                  -- 发起人
  status VARCHAR(32) DEFAULT 'running', -- running, completed, cancelled, suspended
  current_node_id VARCHAR(64),          -- 当前节点
  variables JSON,                       -- 流程变量（金额、类型等）
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (definition_id) REFERENCES workflow_definitions(id)
);
```

#### workflow_tasks（任务）

```sql
CREATE TABLE workflow_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  node_name VARCHAR(128),
  task_type VARCHAR(32),                -- user_task, service_task
  assignee VARCHAR(64),                 -- 分配给谁
  candidate_users JSON,                 -- 候选人列表
  candidate_groups JSON,                -- 候选角色列表
  status VARCHAR(32) DEFAULT 'pending', -- pending, claimed, completed, cancelled
  form_data JSON,                       -- 表单提交数据
  comment TEXT,                         -- 审批意见
  action VARCHAR(32),                   -- approve, reject, transfer, delegate
  due_date DATETIME,                    -- 截止时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  claimed_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
);
```

#### workflow_variables（流程变量）

```sql
CREATE TABLE workflow_variables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  name VARCHAR(128) NOT NULL,
  value TEXT,
  type VARCHAR(32),                     -- string, number, boolean, json, date
  FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
);
```

### 4.3 流程定义 DSL（领域特定语言）

建议采用 JSON-based 的轻量级 DSL，而非完整的 BPMN XML：

```json
{
  "key": "expense_approval",
  "name": "报销审批",
  "nodes": [
    { "id": "start", "type": "start_event", "next": "fill_form" },
    
    { "id": "fill_form", "type": "user_task", "name": "填写报销单",
      "form": {
        "fields": [
          { "key": "amount", "label": "金额", "type": "number", "required": true },
          { "key": "category", "label": "类别", "type": "select", "options": ["差旅", "办公", "招待"], "required": true },
          { "key": "attachments", "label": "发票附件", "type": "file", "required": true }
        ]
      },
      "next": "manager_approval"
    },
    
    { "id": "manager_approval", "type": "user_task", "name": "经理审批",
      "assignee_policy": "starter.manager",
      "actions": ["approve", "reject", "transfer"],
      "next": "check_amount"
    },
    
    { "id": "check_amount", "type": "exclusive_gateway", "name": "金额检查",
      "conditions": [
        { "name": "大额", "expression": "${amount} >= 5000", "next": "director_approval" },
        { "name": "普通", "expression": "default", "next": "notify_result" }
      ]
    },
    
    { "id": "director_approval", "type": "user_task", "name": "总监审批",
      "assignee_policy": "starter.director",
      "actions": ["approve", "reject"],
      "next": "notify_result"
    },
    
    { "id": "notify_result", "type": "service_task", "name": "通知结果",
      "service": "email_notification",
      "config": { "template": "approval_result", "to": "${starter.email}" },
      "next": "end"
    },
    
    { "id": "end", "type": "end_event", "name": "结束" }
  ]
}
```

### 4.4 与 AI Agent 的交互设计

这是 RAOS 与传统 BPM 平台最大的区别。AI Agent 需要：

1. **自然语言启动流程**：
   ```
   用户："我要报销上周出差的费用"
   AI：理解意图 → 匹配 workflow key="expense_approval" → 启动实例 → 
        填充变量（category="差旅"）→ 调用 user_confirm（填写表单）
   ```

2. **智能任务分配**：
   ```
   AI："经理审批"节点的 assignee 是 "${starter.manager}"
   → ldap_search(查询 starter 的 manager) → 自动填入 assignee
   ```

3. **流程状态自然语言查询**：
   ```
   用户："我的报销申请到哪一步了？"
   AI：approval_query(instance_id) → 读取 current_node_id → 
        "正在等待你的经理王总审批，已提交 2 天"
   ```

4. **流程异常处理**：
   ```
   AI：检测到任务超时 → 自动发送 im_bot_send(提醒审批人) → 
        或询问用户 "是否需要转交给其他人审批？"
   ```

### 4.5 守卫条件 (Guards) 设计

```typescript
// 守卫条件引擎
interface GuardEngine {
  evaluate(expression: string, variables: Record<string, unknown>): boolean;
}

// 表达式语法（简化版 SpEL）
// ${amount} >= 5000                          → 数值比较
// ${category} == "差旅"                       → 字符串比较
// ${amount} >= 5000 && ${category} == "招待"  → 逻辑与
// ${starter.department} == "销售部"            → 对象属性访问
// ${attachments.length} > 0                  → 集合操作
```

### 4.6 事件与定时器

```typescript
// 定时器配置
interface TimerConfig {
  type: "duration" | "date" | "cycle";   // 相对时间 / 绝对时间 / 周期
  value: string;                          // "PT2H" (2小时) / "2026-04-25T09:00:00Z" / "R3/PT1D"
  action: "escalate" | "remind" | "auto_approve" | "cancel";
}

// 事件类型
interface WorkflowEvent {
  type: "task_created" | "task_completed" | "task_timeout" | 
        "instance_started" | "instance_completed" | "instance_cancelled";
  instance_id: number;
  task_id?: number;
  node_id?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
```

### 4.7 补偿与 Saga 模式

对于需要回滚的业务流程：

```json
{
  "nodes": [
    { "id": "deduct_budget", "type": "service_task", "name": "扣减预算",
      "service": "budget_service.deduct",
      "compensation": "budget_service.restore",  // 补偿操作
      "next": "create_po"
    },
    { "id": "create_po", "type": "service_task", "name": "创建采购单",
      "service": "erp.create_po",
      "compensation": "erp.cancel_po",
      "next": "approve_po"
    }
  ]
}
```

当流程取消或回滚时，引擎按**逆序**执行补偿操作。

---

## 5. 与现有 Skill 体系的融合

### 5.1 approval/task Skill 与工作流引擎的关系

```
approval_submit Skill ──┐
approval_query Skill  ──┼──▶ Workflow Engine Lite ──▶ 数据库
approval_approve Skill ─┘
task_create Skill ──────┘
task_query Skill ───────┘
```

**设计原则**：
- Skill 是**对外接口**，提供简单的参数和自然的交互
- 工作流引擎是**内部实现**，处理状态机推进、任务分配、事件触发
- 用户不直接操作工作流引擎，而是通过 AI Agent 调用 Skill

### 5.2 Skill 参数设计（基于工作流引擎）

```typescript
// approval_submit
interface ApprovalSubmitParams {
  workflowKey: string;           // "expense_approval", "leave_approval"
  formData: Record<string, unknown>;  // 表单数据（金额、类别等）
  businessKey?: string;          // 业务标识（如订单号）
  priority?: "low" | "normal" | "high" | "urgent";
}

// approval_query
interface ApprovalQueryParams {
  scope: "my_pending" | "my_submitted" | "my_approved" | "all";
  workflowKey?: string;
  status?: "running" | "completed" | "cancelled";
  startDate?: string;
  endDate?: string;
  limit?: number;
}

// approval_approve
interface ApprovalApproveParams {
  taskId: number;
  action: "approve" | "reject" | "transfer" | "delegate";
  comment?: string;
  transferTo?: string;           // action=transfer 时必填
}

// task_create
interface TaskCreateParams {
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: string;
  priority?: "low" | "normal" | "high";
  tags?: string[];
}

// task_query
interface TaskQueryParams {
  scope: "my" | "assigned_to_me" | "created_by_me" | "all";
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
  dueBefore?: string;
  limit?: number;
}
```

### 5.3 与 plan_and_execute 的协同

`plan_and_execute` 是 RAOS 现有的多步规划 Skill，与工作流引擎的区别：

| 维度 | plan_and_execute | Workflow Engine Lite |
|------|-----------------|---------------------|
| **驱动方式** | AI LLM 动态生成计划 | 预定义流程模板 |
| **持久化** | 内存中（对话级别） | 数据库持久化 |
| **人机交互** | 每步都可能需要用户确认 | 只在 User Task 节点暂停 |
| **适用场景** | 探索性、不确定性高的任务 | 标准化、重复性高的流程 |
| **状态追踪** | 无（依赖对话上下文） | 完整的状态历史和审计 |

**协同方式**：
- 简单审批（单步或两步）：直接用 `plan_and_execute` 或 Skill 组合即可
- 复杂审批（多分支、会签、条件路由）：使用 Workflow Engine Lite
- AI Agent 可以**根据流程复杂度自动选择**：简单流程用 Skill 组合，复杂流程用工作流引擎

---

## 6. 开源库选型建议

### 6.1 Node.js 状态机/工作流库

| 库名 | GitHub Stars | 特点 | 适合场景 |
|------|-------------|------|---------|
| **xstate** | ~28k | 最成熟的状态机库，可视化、TypeScript 友好 | 复杂状态机、需要可视化 |
| **javascript-state-machine** | ~8k | 轻量级、易用 | 简单状态机 |
| **@workflowengine/workflow-engine** | 小众 | 专为 Node.js 设计的工作流引擎 | 完整工作流需求 |
| **node-workflow** | 小众 | 基于 Redis 的分布式工作流 | 分布式场景 |
| **temporalio/sdk-typescript** | ~1k | Temporal 的 TypeScript SDK | 长运行流程、 Saga |

### 6.2 我们的建议

**对于 RAOS 的 Workflow Engine Lite**：

- **不引入外部工作流引擎库**（xstate 虽强大但引入额外复杂度）
- **自建轻量级实现**（约 2000-3000 行代码），原因：
  1. 需求明确且有限（审批 + 任务，非通用 BPM）
  2. 需要深度集成 RAOS 的 Skill 体系、用户体系、权限体系
  3. 数据模型需要与现有 SQLite/MySQL 双端口架构兼容
  4. AI Agent 的交互模式与传统工作流引擎不同

- **但强烈借鉴 xstate 的概念**：
  - States / Transitions / Guards / Actions / Context
  - 状态机的可视化（可导出为 xstate 兼容的 JSON）

---

## 7. 实施建议

### 7.1 分阶段实施

| 阶段 | 内容 | 工作量 | 产出 |
|------|------|--------|------|
| **MVP** | 基础状态机引擎 + 单步审批（提交→审批→结束） | 5-7 天 | workflow_engine.ts + 3张表 |
| **V1** | 条件分支（金额判断）、多级审批、任务分配 | 7-10 天 | 完整 approval Skill  trio |
| **V2** | 并行审批（会签）、定时器（超时提醒）、事件系统 | 7-10 天 | 事件驱动 + 定时任务 |
| **V3** | 补偿机制、子流程、流程模板市场 | 10-14 天 | 企业级完整能力 |

### 7.2 关键设计决策

1. **JSON DSL vs BPMN XML**：选择 JSON DSL（对 AI 更友好，LLM 可直接生成和修改）
2. **嵌入式 vs 独立服务**：选择嵌入式（与 RAOS 同一进程，减少部署复杂度）
3. **同步 vs 异步执行**：User Task 同步阻塞（等待人工操作），Service Task 异步执行
4. **数据库事务**：每个 Transition 在一个事务中执行，Actions 在事务提交后触发（避免长事务）

### 7.3 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 自研引擎功能不足 | 明确边界：只支持审批和任务场景，复杂 BPM 需求引导用户使用 Camunda/Flowable |
| 并发冲突 | 乐观锁（version 字段）+ 唯一约束 |
| 定时器可靠性 | 初期用 setTimeout/interval，后期迁移到独立定时任务调度器 |
| AI 理解流程定义 | 提供自然语言描述字段，LLM 通过 description 理解流程用途 |

---

## 8. 总结

### 8.1 核心结论

1. **不引入完整 BPMN 引擎**（Camunda/Flowable/jBPM 都太重，与 AI Agent 模式不匹配）
2. **自建轻量级 Workflow Engine Lite**（借鉴状态机四要素 + BPMN 核心概念）
3. **JSON-based DSL**（AI 友好，便于 LLM 动态生成和修改流程定义）
4. **四层抽象**：流程定义 → 流程实例 → 任务 → 执行引擎
5. **与 Skill 体系深度融合**：Skill 是对外接口，引擎是内部实现

### 8.2 关键借鉴点

| 来源 | 借鉴内容 |
|------|---------|
| **Camunda** | BPMN 概念、消息关联、边界事件、补偿机制 |
| **Flowable** | 低代码表单、文档审批场景设计 |
| **xstate** | 状态机模型（States/Transitions/Guards/Actions/Context） |
| **Laravel Workflow** | Guards 与 Actions 分离、乐观锁、幂等性设计 |
| **Atlan 工作流** | DAG + 命令模式、依赖表达式（`blockA.SUCCESS \|\| blockB.SUCCESS`） |

### 8.3 下一步行动

1. 设计 Workflow Engine Lite 的核心接口和类型定义
2. 创建数据库表结构（workflow_definitions/instances/tasks/variables）
3. 实现基础状态机引擎（States + Transitions + Guards + Actions）
4. 实现 approval_submit/query/approve Skill（调用引擎）
5. 设计流程定义的 JSON DSL 规范和验证器
6. 提供 3-5 个内置审批模板（报销、请假、采购、IT申请）
