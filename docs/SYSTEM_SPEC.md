# RAOS 系统说明书

> **Recursive Agent Operating System** — 模块级 API 契约、数据模型与扩展规范  
> **版本**: v2.0 + Phase 3  
> **日期**: 2026-04-28

---

## 目录

1. [模块清单与接口契约](#1-模块清单与接口契约)
2. [数据模型](#2-数据模型)
3. [状态机定义](#3-状态机定义)
4. [错误码规范](#4-错误码规范)
5. [配置规范](#5-配置规范)
6. [扩展点详细规范](#6-扩展点详细规范)

---

## 1. 模块清单与接口契约

### 1.1 核心引擎模块

#### ExecutionEngine
```typescript
// 入口: src/engine/index.ts
interface ExecutionEngine {
  execute(skillName: string, params: any, context: ExecutionContext): Promise<ExecutionResult>;
  executeWithTimeout(skillName: string, params: any, timeoutMs: number): Promise<ExecutionResult>;
  executeBatch(requests: BatchRequest[]): Promise<ExecutionResult[]>;
}

interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: ExecutionError;
  durationMs: number;
  callTree: CallNode[];
}

interface ExecutionContext {
  userId: string;
  sessionId: string;
  callBudget: number;      // 剩余调用预算（防止无限递归）
  depth: number;           // 当前递归深度
  parentSkill?: string;    // 父 Skill 名称
}
```

**关键约束**:
- 递归深度上限: 10（可配置）
- 调用预算上限: 100（可配置）
- 单次执行超时: 由 Skill 的 `timeout` 字段决定，默认 30000ms

#### SkillRegistry
```typescript
// 入口: src/registry/index.ts
interface SkillRegistry {
  register(definition: SkillDefinition): void;
  unregister(name: string): void;
  get(name: string, version?: string): SkillDefinition | undefined;
  list(options?: { visible?: boolean; category?: string }): SkillDefinition[];
  getVersions(name: string): string[];
  switchVersion(name: string, version: string): boolean;
  validateDAG(): { valid: boolean; cycles: string[][] };
}
```

#### AsyncTaskManager
```typescript
// 入口: src/engine/index.ts
interface AsyncTaskManager {
  create<T>(executor: () => Promise<T>, options?: TaskOptions): AsyncTaskHandle<T>;
  waitFor<T>(handle: AsyncTaskHandle<T>, timeout?: number): Promise<T>;
  cancel(handle: AsyncTaskHandle<any>): boolean;
  getProgress(handle: AsyncTaskHandle<any>): number;
}
```

### 1.2 LLM 模块

#### LLMProvider (抽象接口)
```typescript
// 入口: src/llm/types.ts
interface LLMProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>;
  embed(texts: string[]): Promise<number[][]>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
}

interface ChatResponse {
  content: string;
  usage?: { prompt: number; completion: number; total: number };
  model?: string;
}
```

**实现类**:
| 类名 | 支持模型 | 特点 |
|------|---------|------|
| `OpenAIProvider` | GPT-4 / GPT-3.5 / 兼容接口 | 通用，支持 function calling |
| `ClaudeProvider` | Claude 3 Opus/Sonnet/Haiku | 长上下文，推理能力强 |

#### ModelRouter
```typescript
// 入口: src/llm/model-router.ts
interface ModelRouter {
  register(config: ModelConfig): void;
  select(task: TaskProfile): string;  // 返回 modelId
  route(task: TaskProfile): LLMProvider;
}

interface TaskProfile {
  type: "chat" | "embed" | "vision" | "tts";
  complexity?: "simple" | "standard" | "complex";
  costPriority?: boolean;
  latencyPriority?: boolean;
}
```

### 1.3 记忆模块

#### UserSessionManager
```typescript
// 入口: src/user/user-session.ts
interface UserSessionManager {
  getOrCreate(userId: string): UserSession;
  destroy(userId: string): void;
  getMemoryBackend(userId: string): "file" | "enhanced";
}

interface UserSession {
  userId: string;
  stm: ShortTermMemory;
  ltm: LongTermMemory;
  graphManager?: KnowledgeGraphManager;
  agentLoop?: AgentLoop;
  createdAt: number;
  lastActiveAt: number;
}
```

#### ShortTermMemory
```typescript
interface ShortTermMemory {
  store(key: string, value: any, options?: { ttl?: number; tags?: string[] }): void;
  retrieve(query: string, options?: RetrieveOptions): MemoryItem[];
  forget(key: string): boolean;
  flush(): void;
}
```

#### LongTermMemory
```typescript
interface LongTermMemory {
  store(item: MemoryItem): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<MemoryItem[]>;
  searchByVector(vector: number[], options?: VectorSearchOptions): Promise<MemoryItem[]>;
  archive(olderThanMs: number): Promise<number>;  // 返回归档数量
}
```

### 1.4 知识库模块

#### KnowledgeBase
```typescript
// 入口: src/skills/knowledge-skills.ts
interface KnowledgeBase {
  ingest(document: DocumentInput): Promise<string>;  // 返回 docId
  search(query: string, options?: KBSearchOptions): Promise<SearchResult[]>;
  hybridSearch(query: string, options?: HybridOptions): Promise<SearchResult[]>;
  graphSearch(query: string, options?: GraphOptions): Promise<GraphResult[]>;
  delete(docId: string): Promise<boolean>;
}

interface DocumentInput {
  title: string;
  content?: string;
  filePath?: string;
  mimeType: string;
  metadata?: Record<string, any>;
}
```

**检索能力矩阵**:
| 能力 | 状态 | 说明 |
|------|------|------|
| 关键词检索 | ✅ | SQLite FTS / MySQL FULLTEXT |
| 向量检索 | ✅ | Qdrant cosine similarity |
| 混合检索 | ✅ | RRF 融合 |
| 图谱检索 | 🔴 | 代码就绪但未激活 |
| 路径检索 | 🟡 | BFS 实现，性能待优化 |
| 社区检索 | 🟡 | 社区检测实现，schema drift 阻碍 |

### 1.5 工作流模块

#### WorkflowEngine
```typescript
// 入口: src/workflow/engine.ts
interface WorkflowEngine {
  deploy(definition: WorkflowSpec): Promise<WorkflowDefinition>;
  start(definitionId: number, variables?: Record<string, any>, starter?: string): Promise<WorkflowInstance>;
  completeTask(taskId: number, result: TaskResult, userId: string): Promise<TaskCompletionResult>;
  getInstance(instanceId: number): Promise<WorkflowInstance | null>;
  getTaskTasks(userId: string): Promise<WorkflowTask[]>;
}

interface WorkflowSpec {
  name: string;
  key: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  formSchema?: RaosFormSchema;
}

interface WorkflowNode {
  id: string;
  type: "start" | "end" | "task" | "approval" | "gateway" | "script";
  name: string;
  assignee?: string;
  candidateUsers?: string[];
  candidateRoles?: string[];
  candidateDepts?: string[];
  form?: RaosFormSchema;
  actions?: InboxAction[];
  dueDuration?: number;
  script?: string;  // JS code for script node
}
```

### 1.6 收件箱模块

#### InboxService
```typescript
// 入口: src/inbox/inbox-service.ts
interface InboxService {
  createItem(input: CreateInboxItemInput): Promise<InboxItem>;
  getItem(id: string): Promise<InboxItem | null>;
  listItems(query: InboxQuery): Promise<{ items: InboxItem[]; total: number }>;
  markAsRead(id: string): Promise<void>;
  completeItem(id: string, result?: any): Promise<InboxItem | null>;
  completeBySource(source: string, sourceId: string, result?: any): Promise<InboxItem | null>;
  dismissItem(id: string): Promise<void>;
  getStats(userId: string): Promise<InboxStats>;
  aggregateItems(userId: string, options?: AggregateOptions): Promise<InboxItem[]>;
}

interface CreateInboxItemInput {
  userId: string;
  type: "approval" | "notification" | "task" | "alert";
  category: InboxCategory;
  source: string;
  sourceId?: string;
  title: string;
  description?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  payload?: InboxPayload;
  dueAt?: number;
}
```

#### DeliveryRouter
```typescript
// 入口: src/inbox/delivery-router.ts
interface DeliveryRouter {
  route(event: DeliveryEvent): Promise<DeliveryDecision>;
  deliverToChat(item: InboxItem, conversationId: string): Promise<void>;
  deliverToInbox(item: InboxItem): Promise<void>;
  deliverToEmail(item: InboxItem): Promise<void>;
  deliverToIM(item: InboxItem): Promise<void>;
}

interface DeliveryEvent {
  item: InboxItem;
  userOnline: boolean;
  userLocation?: string;        // 当前页面路径
  relatedConversationId?: string;
}

interface DeliveryDecision {
  channel: "chat" | "inbox" | "email" | "im" | "push";
  timing: "immediate" | "delayed" | "batched";
  targetConversationId?: string;
  reason: string;
}
```

### 1.7 调度器模块

#### SchedulerService
```typescript
// 入口: src/scheduler/scheduler-service.ts
interface SchedulerService {
  createEvent(input: CreateScheduledEventInput): Promise<ScheduledEvent>;
  getEvent(id: string): Promise<ScheduledEvent | null>;
  listEvents(query: ScheduledEventQuery): Promise<{ items: ScheduledEvent[]; total: number }>;
  cancelEvent(id: string): Promise<boolean>;
  triggerEvent(id: string): Promise<boolean>;
}

interface CreateScheduledEventInput {
  userId: string;
  type: "reminder" | "deadline" | "recurring" | "conditional";
  triggerConfig: TriggerConfig;
  actionConfig: ActionConfig;
  escalationConfig?: EscalationConfig;
  source: "user" | "system" | "workflow" | "evolution" | "agent";
  sourceId?: string;
}

interface TriggerConfig {
  mode: "absolute" | "relative" | "cron" | "conditional";
  at?: number;          // absolute 时间戳
  delayMs?: number;     // relative 延迟毫秒
  cron?: string;        // cron 表达式
  condition?: string;   // 条件表达式
}
```

### 1.8 表单引擎模块

#### FormRenderer (React)
```typescript
// 入口: web/src/components/form-engine/core/FormRenderer.tsx
interface FormRendererProps {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  onChange?: (data: Record<string, any>) => void;
  onSubmit?: (data: Record<string, any>) => void;
  autoSave?: AutoSaveConfig;
}

interface RaosFormSchema {
  title?: string;
  description?: string;
  fields: RaosFieldSchema[];
  layout?: LayoutConfig;
}

interface RaosFieldSchema {
  key: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "date";
  title: string;
  required?: boolean;
  "ui:widget"?: string;              // 组件映射
  "ui:props"?: Record<string, any>;  // 组件属性
  "x-linkage"?: LinkageRule[];       // 联动规则
  "x-dataSource"?: DataSourceConfig; // 数据源
  "x-permission"?: PermissionConfig; // 权限控制
  "x-asyncValidator"?: string;       // 异步校验
  "x-condition"?: ConditionRule[];   // 条件 Schema
  "x-crossFieldValidation"?: CrossFieldValidationRule[]; // 跨字段校验
}
```

---

## 2. 数据模型

### 2.1 ER 图（核心实体关系）

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   users     │───────│   roles     │       │ departments │
│  (用户)      │  M:N  │  (角色)      │       │  (部门)      │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id          │       │ id          │       │ id          │
│ username    │       │ name        │       │ name        │
│ password_hash│      │ description │       │ parent_id   │
│ department_id│◄─────│ permissions │       │ path        │
│ role_ids    │       └─────────────┘       └─────────────┘
└─────────────┘              │
                             │
┌─────────────┐              │       ┌─────────────┐
│   resources │◄─────────────┘       │ user_roles  │
│  (资源)      │       M:N            │  (关联表)    │
├─────────────┤                      ├─────────────┤
│ id          │                      │ user_id     │
│ name        │                      │ role_id     │
│ type        │                      └─────────────┘
│ path        │
└─────────────┘

┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│ custom_skills│      │ skill_packages  │       │  plugins    │
│ (自定义Skill)│◄─────│  (Skill包)       │       │ (插件)       │
├─────────────┤       ├─────────────────┤       ├─────────────┤
│ id          │       │ id              │       │ id          │
│ name        │       │ name            │       │ name        │
│ code        │       │ skills_json     │       │ manifest    │
│ version     │       │ version         │       │ path        │
│ status      │       │ status          │       │ enabled     │
│ capabilities│       │ metadata        │       └─────────────┘
└─────────────┘       └─────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│ workflow_definitions│       │ workflow_instances  │
│   (流程定义)         │◄─────│   (流程实例)         │
├─────────────────────┤  1:N  ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ name                │       │ definition_id (FK)  │
│ key (unique)        │       │ status              │
│ definition (JSON)   │       │ variables (JSON)    │
│ form_schema (JSON)  │       │ starter_id          │
│ version             │       │ started_at          │
└─────────────────────┘       └─────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│   workflow_tasks    │       │ workflow_variables  │
│   (任务)             │       │   (变量)             │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ instance_id (FK)    │       │ instance_id (FK)    │
│ node_id             │       │ name                │
│ assignee            │       │ value               │
│ status              │       │ type                │
│ due_date            │       └─────────────────────┘
│ form_data (JSON)    │
└─────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│   form_definitions  │       │   form_instances    │
│   (表单定义)         │◄─────│   (表单实例)         │
├─────────────────────┤  1:N  ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ key (unique)        │       │ definition_id (FK)  │
│ name                │       │ data_json           │
│ schema_json (JSON)  │       │ status              │
│ category_id         │       │ submitted_by        │
└─────────────────────┘       └─────────────────────┘

┌─────────────────────┐
│    inbox_items      │
│   (收件箱条目)       │
├─────────────────────┤
│ id (PK)             │
│ user_id             │
│ type                │
│ category            │
│ source              │
│ source_id           │
│ title               │
│ description         │
│ priority            │
│ status              │
│ payload (JSON)      │
│ ai_suggestion (JSON)│
│ due_at              │
│ created_at          │
│ completed_at        │
└─────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│   kb_documents      │       │    kb_chunks        │
│   (知识文档)         │◄─────│   (文档分块)         │
├─────────────────────┤  1:N  ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ title               │       │ doc_id (FK)         │
│ content             │       │ content             │
│ mime_type           │       │ embedding (vector)  │
│ metadata (JSON)     │       │ metadata (JSON)     │
│ status              │       │ chunk_index         │
└─────────────────────┘       └─────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│  kb_graph_nodes     │◄────►│  kb_graph_edges     │
│   (图谱节点)         │  1:N  │   (图谱边)           │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ owner_id            │       │ source_id (FK)      │
│ label               │       │ target_id (FK)      │
│ type                │       │ relation            │
│ tags                │       │ weight              │
│ properties (JSON)   │       │ properties (JSON)   │
│ community_id        │       │ created_at          │
└─────────────────────┘       └─────────────────────┘
```

### 2.2 关键表说明

#### `inbox_items` — 统一收件箱
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(32) | `inbx_` 前缀 + UUID 截断 |
| `user_id` | VARCHAR(64) | 接收用户 |
| `type` | ENUM | approval / notification / task / alert |
| `category` | ENUM | workflow_task / evolution_approval / system_alert / user_reminder / agent_proactive |
| `source` | VARCHAR(32) | 来源系统: workflow / evolution / system / agent |
| `status` | ENUM | unread / read / pending / completed / dismissed |
| `payload` | JSON | 动态内容（actions / schema / metadata 等）|
| `ai_suggestion` | JSON | LLM 审批建议（recommendation / confidence / reason）|

#### `workflow_definitions` — 流程定义
| 字段 | 类型 | 说明 |
|------|------|------|
| `definition` | TEXT | JSON DSL，包含 nodes[] 和 edges[] |
| `form_schema` | TEXT | 流程级表单 Schema（RaosFormSchema）|
| `key` | VARCHAR(64) | 业务键，唯一标识一个流程类型 |
| `version` | INT | 流程版本号 |

#### `kb_graph_nodes` — 知识图谱节点
| 字段 | 类型 | 说明 |
|------|------|------|
| `owner_id` | VARCHAR(64) | 所属用户/租户 |
| `label` | VARCHAR(255) | 节点标签 |
| `type` | VARCHAR(32) | 节点类型: entity / concept / event |
| `tags` | JSON | 标签数组 |
| `properties` | JSON | 扩展属性 |
| `community_id` | VARCHAR(32) | 所属社区（**当前 schema 缺失，需要迁移**）|

---

## 3. 状态机定义

### 3.1 Skill 生命周期状态机

```
                    ┌─────────────┐
                    │   active    │
                    │   (活跃)     │
                    └──────┬──────┘
                           │ 指标恶化
              ┌────────────┼────────────┐
              ↓            ↓            ↓
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ canary  │  │deprecated│  │retired  │
        │(金丝雀) │  │(已废弃)  │  │(已退役) │
        └────┬────┘  └─────────┘  └─────────┘
             │ 指标达标
             ↓
        ┌─────────┐
        │ active  │
        │(提升)   │
        └─────────┘
```

**触发条件**:
| 转换 | 触发条件 | 执行器 |
|------|---------|--------|
| active → canary | 新 Skill 生成或优化后 | CanaryExecutor |
| canary → active | 金丝雀指标达标（成功率 > 阈值）| AdoptExecutor |
| active → deprecated | 新版本替代 / 长期未使用 | RetireExecutor |
| deprecated → retired | 达到淘汰期限 | RetireExecutor |

### 3.2 工作流实例状态机

```
┌─────────┐   启动    ┌─────────┐   完成   ┌─────────┐
│  draft  │─────────►│ running │────────►│completed│
└─────────┘          └────┬────┘          └─────────┘
                          │ 拒绝
                          ↓
                    ┌─────────┐
                    │rejected │
                    └─────────┘
```

**节点状态**:
| 状态 | 说明 |
|------|------|
| `pending` | 等待处理 |
| `active` | 当前激活节点 |
| `completed` | 已完成 |
| `skipped` | 条件不满足跳过 |
| `failed` | 执行失败 |

### 3.3 审批任务状态机

```
┌─────────┐   提交    ┌─────────┐   审批通过  ┌─────────┐
│ pending │─────────►│approving│──────────►│approved │
└─────────┘          └────┬────┘           └─────────┘
                          │ 驳回
                          ↓
                    ┌─────────┐
                    │rejected │
                    └─────────┘
                          │ 转交
                          ↓
                    ┌─────────┐
                    │transferred│
                    └─────────┘
```

### 3.4 熔断器状态机

```
                    失败 < threshold
         ┌──────────────────────────────────┐
         │                                  │
         ↓           失败 ≥ threshold       │
    ┌─────────┐─────────────────────────►┌─────────┐
    │ CLOSED  │                          │  OPEN   │
    │ (正常)  │◄─────────────────────────│ (熔断)  │
    └─────────┘   超时后 half-open 成功    └────┬────┘
         ▲                                      │
         │        half-open 失败                │
         └──────────────────────────────────────┘
              HALF_OPEN (半开)
```

**参数**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| `failureThreshold` | 5 | 触发熔断的连续失败次数 |
| `recoveryTimeoutMs` | 30000 | OPEN → HALF_OPEN 的恢复等待时间 |
| `halfOpenMaxCalls` | 3 | HALF_OPEN 状态下的探测请求数 |

---

## 4. 错误码规范

### 4.1 HTTP API 错误码

| 状态码 | 错误类型 | 说明 | 场景 |
|--------|---------|------|------|
| 400 | `INVALID_PARAMS` | 参数校验失败 | ParamSchema 校验不通过 |
| 400 | `INVALID_JSON` | JSON 解析失败 | 请求体格式错误 |
| 401 | `UNAUTHORIZED` | 未认证 | Token 缺失或过期 |
| 403 | `FORBIDDEN` | 无权限 | Capability 校验失败 / 角色不足 |
| 404 | `SKILL_NOT_FOUND` | Skill 不存在 | 名称错误或已注销 |
| 404 | `WORKFLOW_NOT_FOUND` | 流程不存在 | 实例或定义不存在 |
| 409 | `DAG_CYCLE` | 循环依赖 | Skill 依赖图存在环 |
| 409 | `VERSION_CONFLICT` | 版本冲突 | 切换版本时状态不一致 |
| 422 | `EXECUTION_TIMEOUT` | 执行超时 | Skill 执行超过 timeout |
| 422 | `CIRCUIT_OPEN` | 熔断器开启 | 服务暂时不可用 |
| 429 | `RATE_LIMITED` | 速率限制 | 调用预算耗尽 |
| 500 | `INTERNAL_ERROR` | 内部错误 | 未预期的异常 |
| 503 | `LLM_UNAVAILABLE` | LLM 服务不可用 | Provider 连接失败 |

### 4.2 Skill 执行错误码

| 错误码 | 说明 | 是否可重试 |
|--------|------|-----------|
| `SKILL_TIMEOUT` | 执行超时 | ✅ |
| `SKILL_CRASHED` | 执行崩溃（Worker 异常退出）| ✅ |
| `PRE_DEPENDENCY_FAILED` | AUTO_PRE 依赖失败 | 取决于 errorPropagation |
| `POST_DEPENDENCY_FAILED` | AUTO_POST 依赖失败 | 取决于 errorPropagation |
| `COMPENSATION_FAILED` | SAGA 补偿失败 | ❌（需人工介入）|
| `CAPABILITY_DENIED` | 能力校验失败 | ❌ |
| `DEPTH_EXCEEDED` | 递归深度超限 | ❌ |
| `BUDGET_EXHAUSTED` | 调用预算耗尽 | ❌ |
| `DAG_INVALID` | 依赖图存在环 | ❌ |

### 4.3 进化系统错误码

| 错误码 | 说明 |
|--------|------|
| `EVOLUTION_DEPTH_LIMIT` | 生成深度超过限制 |
| `EVOLUTION_RATE_LIMIT` | 生成速率超过限制 |
| `EVOLUTION_BUDGET_EXHAUSTED` | 进化税耗尽 |
| `EVOLUTION_ALIGNMENT_FAILED` | 价值对齐检查未通过 |
| `EVOLUTION_APPROVAL_PENDING` | 等待人工审批 |
| `EVOLUTION_SANDBOX_FAILED` | Worker 沙箱测试失败 |

---

## 5. 配置规范

### 5.1 环境变量

```bash
# === 服务端口 ===
PORT=3000

# === 数据库 ===
DB_TYPE=sqlite          # sqlite | mysql
DB_PATH=.raos/data.db   # SQLite 路径
MYSQL_PRIMARY_HOST=localhost
MYSQL_PRIMARY_PORT=3307
MYSQL_USER=raos
MYSQL_PASSWORD=         # 生产环境必须设置，禁止默认值
MYSQL_DATABASE=raos

# === Neo4j (可选) ===
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=         # 生产环境必须设置
GRAPH_STORE_BACKEND=mysql   # mysql | neo4j

# === Redis ===
REDIS_HOSTS=localhost:6380
REDIS_PASSWORD=

# === Qdrant ===
QDRANT_URL=http://localhost:6334
QDRANT_HOST=localhost
QDRANT_PORT=6334

# === RabbitMQ ===
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# === LLM ===
OPENAI_API_KEY=         # 必须设置
OPENAI_BASE_URL=https://api.openai.com/v1
CLAUDE_API_KEY=         # 可选
DEFAULT_MODEL=gpt-4o

# === 多模态 ===
MULTIMODAL_ENABLED=false
MULTIMODAL_API_KEY=
MULTIMODAL_VISION_MODEL=gpt-4o
MULTIMODAL_IMAGE_MODEL=dall-e-3

# === 联邦 ===
FEDERATION_ENABLED=false
FEDERATION_NODE_ID=
FEDERATION_DISCOVERY_URL=

# === 进化控制 ===
EVOLUTION_ENABLED=true
EVOLUTION_MAX_DEPTH=3
EVOLUTION_RATE_LIMIT_PER_HOUR=10
EVOLUTION_BUDGET_MAX=1000
EVOLUTION_BUDGET_REGEN_RATE=10
```

### 5.2 配置文件

```json
// config.json (运行时配置，支持热加载)
{
  "agent": {
    "maxIterations": 10,
    "systemPrompt": "...",
    "includeTrace": true
  },
  "memory": {
    "stmMaxSize": 1000,
    "stmTTLMinutes": 60,
    "ltmArchiveThreshold": 7,
    "autoConsolidation": true
  },
  "evolution": {
    "enabled": true,
    "approvalRequired": true,
    "autoDeploy": false,
    "canaryDurationMinutes": 30
  }
}
```

---

## 6. 扩展点详细规范

### 6.1 自定义 Skill 开发规范

#### 代码方式注册
```typescript
import { defineSkill } from "raos/types";

export default defineSkill({
  name: "my_custom_skill",
  visible: true,
  autonomy: "MANUAL",
  description: "我的自定义 Skill",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "输入内容" }
    },
    required: ["input"]
  },
  async execute({ input }, context) {
    // 业务逻辑
    return { result: `Processed: ${input}` };
  }
});
```

#### 动态生成（通过 LLM）
```typescript
// 调用 skill_from_description Skill
const result = await engine.execute("skill_from_description", {
  description: "创建一个能计算斐波那契数列的 Skill",
  testCases: [
    { input: { n: 5 }, expected: 5 },
    { input: { n: 10 }, expected: 55 }
  ]
});
// result.code 包含生成的 Skill 代码
// 经 Worker 沙箱测试 + 人工审批后自动注册
```

#### Skill 清单规范（插件方式）
```json
// skill.json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "skills": [
    {
      "name": "skill_a",
      "entry": "./skills/skill-a.js",
      "visible": true,
      "capabilities": ["read:file"]
    }
  ],
  "permissions": ["file_read"]
}
```

### 6.2 自定义 LLM Provider

```typescript
import { LLMProvider } from "raos/llm/types";

class CustomProvider implements LLMProvider {
  async chat(messages, options) {
    // 调用自定义模型 API
    return { content: "...", usage: { prompt: 100, completion: 50, total: 150 } };
  }

  async *stream(messages, options) {
    // 实现流式输出
    yield { content: "chunk1", done: false };
    yield { content: "", done: true };
  }

  async embed(texts) {
    // 返回向量
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

// 注册
providerManager.setProvider(new CustomProvider(config));
```

### 6.3 自定义表单组件

```typescript
// web/src/components/form-engine/widgets/RegisterMyWidget.ts
import { registerWidget } from "../core/WidgetRegistry";
import MyCustomWidget from "./MyCustomWidget";

registerWidget("myWidget", MyCustomWidget);
```

Schema 中使用:
```json
{
  "key": "customField",
  "type": "string",
  "ui:widget": "myWidget",
  "ui:props": { "customProp": "value" }
}
```

### 6.4 自定义路由

```typescript
// src/routes/my-module-routes.ts
import { Router } from "express";

export function createMyRoutes(deps: RouteDependencies) {
  const router = Router();

  router.get("/api/my-module/data", async (req, res) => {
    // 使用 deps.registry, deps.engine 等
    const result = await deps.engine.execute("my_skill", req.query);
    res.json(result);
  });

  return router;
}

// 在 src/routes/index.ts 中注册
// mountRoutes 会自动扫描并挂载
```

### 6.5 自定义记忆后端

```typescript
import { LTMBackend } from "raos/memory/types";

class CustomLTMBackend implements LTMBackend {
  async store(item: MemoryItem): Promise<void> {
    // 存储到自定义数据库
  }

  async search(query: string): Promise<MemoryItem[]> {
    // 自定义检索逻辑
    return [];
  }

  async archive(olderThanMs: number): Promise<number> {
    // 自定义归档逻辑
    return 0;
  }
}

// 在 bootstrap 中注入
sessionManager.registerBackend("custom", new CustomLTMBackend());
```

---

## 附录 A：术语表

| 术语 | 英文 | 说明 |
|------|------|------|
| Skill | Skill | RAOS 中最小可执行单元，等同于传统架构中的"函数"或"工具" |
| 递归执行 | Recursive Execution | Skill 调用自身或其他 Skill，形成调用树 |
| 可见性 | Visibility | Skill 是否对 LLM 可见（`visible=true`） |
| 自主性 | Autonomy | Skill 的调用方式：MANUAL/AUTO_PRE/AUTO_POST/GUARDIAN |
| WAL | Write-Ahead Log | 预写日志，用于崩溃恢复 |
| STM | Short-Term Memory | 短期记忆（内存缓存） |
| LTM | Long-Term Memory | 长期记忆（持久化存储） |
| 元记忆 | Meta-Memory | 关于记忆的记忆（自动归档、冲突检测） |
| 进化 | Evolution | Skill 的自我生成、优化、测试、部署闭环 |
| 联邦 | Federation | 跨 RAOS 实例的 Skill 共享 |
| 熔断器 | Circuit Breaker | 失败率过高时自动断开，防止级联故障 |
| SAGA | SAGA | 分布式事务补偿模式 |
| 金丝雀 | Canary | 新版本小流量验证 |

## 附录 B：相关文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 架构论文 | `raos.md` | 递归 Skill 抽象的核心理论 |
| 项目 Review | `docs/PROJECT_REVIEW.md` | 目标偏差与风险分析 |
| 架构文档 | `docs/ARCHITECTURE.md` | 系统全景与模块交互 |
| Neo4j 集成 | `docs/NEO4J_INTEGRATION.md` | 图数据库双后端方案 |
| 工作流调研 | `docs/workflow-engine-research.md` | 轻型工作流引擎设计决策 |
| 部署指南 | `DEPLOY.md` | Docker Compose 部署 |
| 运维手册 | `docs/operations/README.md` | 日常运维 |
