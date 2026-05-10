/**
 * Scheduler Types — 时间感知调度器类型定义
 *
 * 支持：绝对时间、相对延迟、cron 周期性、条件触发
 */

export type ScheduleType = "reminder" | "deadline" | "recurring" | "conditional";
export type ScheduleStatus = "pending" | "triggered" | "completed" | "cancelled" | "failed";
export type ScheduleSource = "user" | "system" | "workflow" | "evolution" | "agent";
export type ActionType = "inbox" | "chat" | "email" | "im" | "webhook" | "skill";

export interface ScheduledEvent {
  id: string;
  userId: string;
  type: ScheduleType;
  triggerConfig: TriggerConfig;
  actionConfig: ActionConfig;
  escalationConfig?: EscalationConfig;
  source: ScheduleSource;
  sourceId?: string;
  status: ScheduleStatus;
  retryCount: number;
  createdAt: number;
  triggeredAt?: number;
  completedAt?: number;
}

export interface TriggerConfig {
  mode: "absolute" | "relative" | "cron" | "conditional";
  at?: number;            // absolute 时间戳
  delayMs?: number;       // relative 延迟毫秒
  cron?: string;          // cron 表达式
  condition?: string;     // 条件表达式
}

export interface ActionConfig {
  type: ActionType;
  payload: Record<string, unknown>;
  targetConversationId?: string;
}

export interface EscalationConfig {
  afterMs: number;        // 多久后升级
  channel: string;        // 升级渠道: "im", "email", "sms"
  repeat?: number;        // 重复提醒次数
  intervalMs?: number;    // 重复间隔
}

export interface CreateScheduledEventInput {
  userId: string;
  type: ScheduleType;
  triggerConfig: TriggerConfig;
  actionConfig: ActionConfig;
  escalationConfig?: EscalationConfig;
  source: ScheduleSource;
  sourceId?: string;
}

export interface ScheduledEventQuery {
  userId?: string;
  type?: ScheduleType | string;
  status?: ScheduleStatus | string;
  source?: ScheduleSource | string;
  page?: number;
  pageSize?: number;
}
