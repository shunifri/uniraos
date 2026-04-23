/**
 * Workflow Engine Lite — 轻量级工作流引擎类型定义
 *
 * 设计原则：
 * - 借鉴 xstate 状态机模型（States/Transitions/Guards/Actions/Context）
 * - JSON DSL 而非 BPMN XML（AI 友好，LLM 可直接生成和修改）
 * - 嵌入式而非独立服务（与 RAOS 同一进程）
 */

// ===== 流程定义（静态模板） =====

/** 流程定义 */
export interface WorkflowDefinition {
  id: number;
  name: string;
  key: string;
  version: number;
  category?: string;
  definition: WorkflowSpec;
  formSchema?: FormSchema;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** 流程定义 DSL（JSON） */
export interface WorkflowSpec {
  key: string;
  name: string;
  nodes: WorkflowNode[];
  starterConstraints?: StarterConstraint[];  // 流程级发起人限制
}

/** 工作流节点 */
export type WorkflowNode =
  | StartEventNode
  | EndEventNode
  | UserTaskNode
  | ServiceTaskNode
  | ExclusiveGatewayNode
  | ParallelGatewayNode;

/** 基础节点 */
interface BaseNode {
  id: string;
  type: string;
  name?: string;
  next?: string;
}

/** 开始事件 */
export interface StartEventNode extends BaseNode {
  type: "start_event";
  next: string;
}

/** 结束事件 */
export interface EndEventNode extends BaseNode {
  type: "end_event";
}

/** 审批人策略配置 */
export interface ApproverConfig {
  type: "user" | "role" | "role_dept" | "starter" | "starter_manager" | "starter_director" | "expression";
  value?: string;           // userId / roleId / expression
  deptId?: string;          // role_dept 时生效
}

/** 会签策略 */
export interface SignPolicy {
  mode: "sequential" | "parallel";      // 顺序 / 并行
  condition: "all" | "any" | "majority"; // 通过条件
  minCount?: number;        // majority 时的最少通过数
}

/** 发起人限制 */
export interface StarterConstraint {
  type: "role" | "department";
  value: string;
  message?: string;
}

/** 用户任务（需要人工处理） */
export interface UserTaskNode extends BaseNode {
  type: "user_task";
  form?: FormSchema;
  assigneePolicy?: string;          // 兼容旧策略："starter", "starter.manager", "starter.director", 或具体用户ID
  assignee?: string;                // 兼容旧策略：固定分配人
  approvers?: ApproverConfig[];     // 新策略：审批人配置（优先于 assignee/assigneePolicy）
  signPolicy?: SignPolicy;          // 新策略：会签策略
  candidateUsers?: string[];        // 候选人
  candidateGroups?: string[];       // 候选角色/组
  actions?: TaskAction[];           // 允许的操作（approve/reject/transfer/delegate）
  dueDuration?: string;             // 超时时间（ISO 8601 duration，如 "PT2H"）
  reminder?: ReminderConfig;        // 提醒配置
}

/** 服务任务（自动执行） */
export interface ServiceTaskNode extends BaseNode {
  type: "service_task";
  service: string;                  // 服务标识，如 "email_notification", "im_bot_send"
  config?: Record<string, unknown>; // 服务配置
  compensation?: string;            // 补偿服务标识（Saga 模式）
}

/** 排他网关（条件分支 if/else） */
export interface ExclusiveGatewayNode extends BaseNode {
  type: "exclusive_gateway";
  conditions: GatewayCondition[];
}

/** 并行网关（AND 分裂/汇聚） */
export interface ParallelGatewayNode extends BaseNode {
  type: "parallel_gateway";
  mode: "split" | "join";           // split: 分裂为并行分支; join: 等待所有分支完成
  branches?: string[];              // split 模式下的分支节点ID列表
}

/** 网关条件 */
export interface GatewayCondition {
  name?: string;
  expression: string;               // 表达式，如 "${amount} >= 5000" 或 "default"
  next: string;
}

/** 任务操作 */
export type TaskAction = "approve" | "reject" | "transfer" | "delegate" | "return";

/** 提醒配置 */
export interface ReminderConfig {
  type: "escalate" | "remind" | "auto_approve" | "cancel";
  duration: string;                 // ISO 8601 duration
  message?: string;
}

/** 表单定义 */
export interface FormSchema {
  fields: FormField[];
}

/** 表单字段 */
export interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "radio" | "checkbox" | "textarea" | "date" | "file" | "user" | "department";
  required?: boolean;
  options?: Array<{ id: string; label: string }>;
  placeholder?: string;
  defaultValue?: unknown;
  validation?: ValidationRule[];
}

/** 验证规则 */
export interface ValidationRule {
  type: "required" | "min" | "max" | "pattern" | "email";
  value?: unknown;
  message?: string;
}

// ===== 流程实例（运行时） =====

/** 流程实例状态 */
export type InstanceStatus = "running" | "completed" | "cancelled" | "suspended" | "error";

/** 流程实例 */
export interface WorkflowInstance {
  id: number;
  definitionId: number;
  definitionVersion: number;
  businessKey?: string;
  starter?: string;
  status: InstanceStatus;
  currentNodeId?: string;
  variables: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
}

// ===== 任务（运行时） =====

/** 任务状态 */
export type TaskStatus = "pending" | "claimed" | "completed" | "cancelled";

/** 任务类型 */
export type TaskType = "user_task" | "service_task";

/** 工作流任务 */
export interface WorkflowTask {
  id: number;
  instanceId: number | null;
  nodeId: string;
  nodeName?: string;
  taskType: TaskType;
  assignee?: string;
  candidateUsers?: string[];
  candidateGroups?: string[];
  status: TaskStatus;
  formData?: Record<string, unknown>;
  comment?: string;
  action?: TaskAction;
  dueDate?: number;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  signGroup?: string;       // 会签组标识（nodeId）
}

// ===== 变量（运行时） =====

/** 变量类型 */
export type VariableType = "string" | "number" | "boolean" | "json" | "date";

/** 流程变量 */
export interface WorkflowVariable {
  id: number;
  instanceId: number;
  name: string;
  value: string;
  type: VariableType;
}

// ===== 守卫条件（Guards） =====

/** 守卫表达式上下文 */
export interface GuardContext {
  variables: Record<string, unknown>;
  instance: WorkflowInstance;
  task?: WorkflowTask;
}

/** 守卫引擎 */
export interface GuardEngine {
  evaluate(expression: string, context: GuardContext): boolean;
}

// ===== 动作（Actions） =====

/** 动作上下文 */
export interface ActionContext {
  instance: WorkflowInstance;
  task?: WorkflowTask;
  variables: Record<string, unknown>;
  node: WorkflowNode;
}

/** 可逆动作（支持 Saga 补偿） */
export interface ReversibleAction {
  execute(context: ActionContext): Promise<void>;
  compensate?(context: ActionContext): Promise<void>;
}

// ===== 执行引擎 =====

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  instance?: WorkflowInstance;
  task?: WorkflowTask;
  error?: Error;
}

/** 流程推进选项 */
export interface AdvanceOptions {
  action?: TaskAction;
  formData?: Record<string, unknown>;
  comment?: string;
  assignee?: string;          // transfer/delegate 时使用
  variables?: Record<string, unknown>;
}

// ===== 连接配置中心 =====

/** 连接配置 */
export interface Connection {
  id: number;
  name: string;
  type: ConnectionType;
  config: Record<string, unknown>;
  credentials?: string;       // 加密存储的凭证
  isActive: boolean;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** 连接类型 */
export type ConnectionType =
  | "smtp"
  | "imap"
  | "ldap"
  | "exchange"
  | "caldav"
  | "dingtalk"
  | "wecom"
  | "lark"
  | "kafka"
  | "elasticsearch"
  | "prometheus"
  | "ftp"
  | "sftp"
  | "custom";

// ===== 查询参数 =====

/** 审批查询参数 */
export interface ApprovalQueryParams {
  scope?: "my_pending" | "my_submitted" | "my_approved" | "all";
  workflowKey?: string;
  status?: InstanceStatus | InstanceStatus[];
  starter?: string;
  assignee?: string;
  startDate?: number;
  endDate?: number;
  limit?: number;
  offset?: number;
}

/** 任务查询参数 */
export interface TaskQueryParams {
  scope?: "my" | "assigned_to_me" | "created_by_me" | "all";
  status?: TaskStatus | TaskStatus[];
  assignee?: string;
  instanceId?: number;
  dueBefore?: number;
  limit?: number;
  offset?: number;
}

// ===== Repository 接口 =====

export interface IWorkflowRepository {
  createDefinition(def: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">): Promise<WorkflowDefinition>;
  getDefinitionById(id: number): Promise<WorkflowDefinition | undefined>;
  getDefinitionByKey(key: string): Promise<WorkflowDefinition | undefined>;
  listDefinitions(category?: string): Promise<WorkflowDefinition[]>;
  updateDefinition(id: number, updates: Partial<WorkflowDefinition>): Promise<void>;
  deleteDefinition(id: number): Promise<void>;

  createInstance(inst: Omit<WorkflowInstance, "id" | "startedAt">): Promise<WorkflowInstance>;
  getInstanceById(id: number): Promise<WorkflowInstance | undefined>;
  updateInstance(id: number, updates: Partial<WorkflowInstance>): Promise<void>;
  listInstances(params?: ApprovalQueryParams): Promise<{ items: WorkflowInstance[]; total: number }>;

  createTask(task: Omit<WorkflowTask, "id" | "createdAt">): Promise<WorkflowTask>;
  getTaskById(id: number): Promise<WorkflowTask | undefined>;
  getActiveTaskByInstanceAndNode(instanceId: number, nodeId: string): Promise<WorkflowTask | undefined>;
  updateTask(id: number, updates: Partial<WorkflowTask>): Promise<void>;
  listTasks(params?: TaskQueryParams): Promise<{ items: WorkflowTask[]; total: number }>;

  setVariable(instanceId: number, name: string, value: unknown, type?: string): Promise<void>;
  getVariable(instanceId: number, name: string): Promise<unknown>;
  getVariables(instanceId: number): Promise<Record<string, unknown>>;

  createConnection(conn: Omit<Connection, "id" | "createdAt" | "updatedAt">): Promise<Connection>;
  getConnectionById(id: number): Promise<Connection | undefined>;
  getConnectionByName(name: string): Promise<Connection | undefined>;
  listConnections(type?: string): Promise<Connection[]>;
  updateConnection(id: number, updates: Partial<Connection>): Promise<void>;
  deleteConnection(id: number): Promise<void>;
}

// ===== 内置审批模板 =====

/** 内置模板 */
export interface WorkflowTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  spec: WorkflowSpec;
  formSchema?: FormSchema;
}
