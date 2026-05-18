/**
 * Plan Execution Types — 计划执行系统类型定义
 */

/** 计划整体状态 */
export type PlanStatus = "draft" | "running" | "paused" | "completed" | "failed" | "cancelled";

/** 单个步骤状态 */
export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** 计划元数据（存于 frontmatter） */
export interface PlanMeta {
  planId: string;
  title: string;
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
  currentStep: number; // 0-based index of current step, -1 if not started
  totalSteps: number;
  conversationId?: string; // 关联对话 ID
  tags?: string[];
  error?: string; // 失败时的错误信息
  lastHeartbeat?: number; // 最后心跳时间戳（用于恢复中断计划）
  scheduledEventIds?: string[]; // 已安排的 Scheduler 事件 ID（用于清理）
}

/** 计划步骤 */
export interface PlanStep {
  index: number;
  taskTitle: string; // 所属 Task 标题
  description: string;
  status: PlanStepStatus;
  optional?: boolean; // 步骤失败时是否继续执行计划
  startedAt?: number;
  finishedAt?: number;
  result?: string; // 执行结果摘要
  error?: string; // 失败原因
  output?: string; // 详细输出
}

/** 解析后的计划 */
export interface ParsedPlan {
  meta: PlanMeta;
  content: string; // 原始内容（不含 frontmatter）
  steps: PlanStep[];
}

/** 计划摘要（用于列表查询） */
export interface PlanSummary {
  planId: string;
  fileName: string;
  title: string;
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
  progress: number; // 0-100
  currentStep: number;
  totalSteps: number;
}

/** 计划执行选项 */
export interface PlanExecuteOptions {
  /** 从第几步开始执行（0-based），默认从当前步骤继续 */
  fromStep?: number;
  /** 每步执行后的延迟（ms），默认 0 立即继续 */
  stepDelayMs?: number;
  /** 是否通过 Scheduler 异步推进（跨 session），默认 false */
  asyncProgress?: boolean;
  /** 单步超时（ms），默认 5 分钟 */
  stepTimeoutMs?: number;
  /** 失败时是否自动重试次数 */
  maxRetries?: number;
  /** 任何步骤失败时是否继续执行后续步骤，默认 false */
  continueOnFailure?: boolean;
}

/** 计划创建输入 */
export interface CreatePlanInput {
  title: string;
  content: string; // 完整的 markdown 内容（不含 frontmatter，或含标准 plan 格式）
  tags?: string[];
  /** 关联对话 ID */
  conversationId?: string;
  /** 如果同名计划已存在，是否覆盖 */
  overwrite?: boolean;
}

/** 执行结果 */
export interface PlanExecutionResult {
  planId: string;
  success: boolean;
  message: string;
  completedSteps: number;
  totalSteps: number;
  failedStep?: number;
  error?: string;
}
