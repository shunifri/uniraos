/**
 * RAOS Core Types - Skill Definition
 */

/** Skill 的调用方式 */
export enum Autonomy {
  /** 需要模型显式调用 */
  MANUAL = "MANUAL",
  /** 自动在父 Skill 执行前调用 */
  AUTO_PRE = "AUTO_PRE",
  /** 自动在父 Skill 执行后调用 */
  AUTO_POST = "AUTO_POST",
  /** 守护级：不可中断 */
  GUARDIAN = "GUARDIAN",
}

/** 重试策略 */
export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  /** 退避上限（ms），防止指数退避无限增长 */
  maxBackoffMs?: number;
  /** 是否添加随机抖动（±25%） */
  jitter?: boolean;
}

/** 熔断器状态 */
export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

/** 熔断器配置 */
export interface CircuitBreakerConfig {
  /** 触发熔断的连续失败次数 */
  failureThreshold: number;
  /** 熔断恢复等待时间（ms） */
  recoveryTimeMs: number;
  /** HALF_OPEN 状态允许的试探请求数 */
  halfOpenRequests: number;
}

/** 异步任务状态 */
export enum TaskStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

/** 异步任务句柄（耗时 Skill 返回此对象） */
export interface AsyncTaskHandle {
  taskId: string;
  status: TaskStatus;
  /** 进度（0~100） */
  progress?: number;
  /** 预计完成时间（ms timestamp） */
  estimatedCompletionAt?: number;
  /** 完成时的结果 */
  result?: unknown;
  /** 失败时的错误 */
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Skill 执行结果 */
export interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: Error;
  /** 如果是异步任务，返回任务句柄 */
  async?: AsyncTaskHandle;
}

/** Skill 处理函数签名 */
export type SkillHandler = (
  params: Record<string, unknown>,
  context: ExecutionContext,
) => Promise<SkillResult>;

/** 补偿函数签名（SAGA 模式：执行失败时回滚已完成的操作） */
export type CompensateHandler = (
  params: Record<string, unknown>,
  result: unknown,
  context: ExecutionContext,
) => Promise<void>;

/** 错误传播策略 */
export interface ErrorPropagation {
  /** AUTO_PRE 失败是否阻断主 Skill 执行（默认 true） */
  preFailureBlocks?: boolean;
  /** AUTO_POST 失败是否影响主 Skill 结果（默认 false） */
  postFailureAffectsResult?: boolean;
}

/** Skill 定义 */
export interface SkillDefinition {
  name: string;
  /** 语义版本号 */
  version: string;
  visible: boolean;
  autonomy: Autonomy;
  dependencies: string[];
  timeout: number;
  retry: RetryPolicy;
  handler: SkillHandler;
  description?: string;
  /** 标记此 Skill 为异步（耗时任务），handler 返回 async 句柄而非直接结果 */
  async?: boolean;
  /** 补偿处理器（SAGA 模式），执行失败时自动回滚 */
  compensate?: CompensateHandler;
  /** 熔断器配置 */
  circuitBreaker?: CircuitBreakerConfig;
  /** Skill 声明的所需权限能力 */
  capabilities?: string[];
  /** 错误传播策略 */
  errorPropagation?: ErrorPropagation;
}

/** 调用追踪条目 */
export interface TraceEntry {
  skillName: string;
  depth: number;
  startTime: number;
  endTime: number;
  success: boolean;
  error?: string;
}

/** 异步任务操作接口（注入到 ExecutionContext 中） */
export interface AsyncTaskOps {
  /** 创建一个异步任务，返回 taskId */
  create(): string;
  /** 报告进度 (0~100) */
  progress(taskId: string, progress: number): void;
  /** 标记任务完成 */
  complete(taskId: string, result: unknown): void;
  /** 标记任务失败 */
  fail(taskId: string, error: string): void;
}

/** 执行上下文 */
export interface ExecutionContext {
  traceId: string;
  callStack: string[];
  depth: number;
  maxDepth: number;
  callBudget: { remaining: number };
  trace: TraceEntry[];
  /** 异步任务操作（仅 async Skill 使用） */
  tasks?: AsyncTaskOps;
}

/** 执行结果（包含追踪信息） */
export interface ExecutionResult extends SkillResult {
  trace: TraceEntry[];
  traceId: string;
}

/** 创建 Skill 定义的便捷方法（允许部分字段使用默认值） */
export function defineSkill(
  partial: Pick<SkillDefinition, "name" | "handler"> &
    Partial<Omit<SkillDefinition, "name" | "handler">>,
): SkillDefinition {
  return {
    visible: true,
    version: "1.0.0",
    autonomy: Autonomy.MANUAL,
    dependencies: [],
    timeout: 30000,
    retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
    description: "",
    ...partial,
  };
}
