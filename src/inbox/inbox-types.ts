/**
 * Inbox Types — 统一收件箱类型定义
 *
 * 所有需要用户被动响应的事件统一抽象为 InboxItem
 */

export type InboxType = "approval" | "notification" | "task" | "alert";

export type InboxCategory =
  | "workflow_task"
  | "evolution_approval"
  | "system_alert"
  | "user_reminder"
  | "agent_proactive";

export type InboxPriority = "low" | "normal" | "high" | "urgent";
export type InboxStatus = "unread" | "read" | "pending" | "completed" | "dismissed";

export interface InboxItem {
  id: string;
  userId: string;
  type: InboxType;
  category: InboxCategory;
  source: string;
  sourceId?: string;
  title: string;
  description?: string;
  priority: InboxPriority;
  status: InboxStatus;
  payload: InboxPayload;
  aiSuggestion?: AISuggestion;
  aggregateGroupId?: string;
  aggregateCount?: number;
  conversationId?: string;
  scheduledAt?: number;
  dueAt?: number;
  createdAt: number;
  completedAt?: number;
}

export interface InboxPayload {
  // 审批类
  schema?: any;
  actions?: InboxAction[];
  formData?: Record<string, any>;
  resultData?: Record<string, any>;

  // 通知类
  content?: string;
  link?: string;

  // 聚合
  aggregatedItems?: InboxItem[];

  // 通用
  metadata?: Record<string, any>;
}

export interface InboxAction {
  action: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface AISuggestion {
  recommendation: "approve" | "reject" | "review";
  confidence: number;
  reasoning: string;
  risks?: string[];
  sources?: string[];
}

export interface CreateInboxItemInput {
  userId: string;
  type: InboxType;
  category: InboxCategory;
  source: string;
  sourceId?: string;
  title: string;
  description?: string;
  priority?: InboxPriority;
  payload?: InboxPayload;
  conversationId?: string;
  scheduledAt?: number;
  dueAt?: number;
}

export interface InboxQuery {
  userId?: string;
  type?: InboxType | string;
  category?: InboxCategory | string;
  status?: InboxStatus | string;
  priority?: InboxPriority | string;
  source?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc" | string;
}

export interface InboxStats {
  unreadCount: number;
  pendingApprovals: number;
  pendingTasks: number;
  unreadNotifications: number;
  upcomingReminders: number;
}

export interface AggregateOptions {
  timeWindowMs?: number;
  similarityThreshold?: number;
  enabled?: boolean;
}

export interface DeliveryEvent {
  item: InboxItem;
  userOnline: boolean;
  userLocation?: string;     // 当前页面路径
  relatedConversationId?: string;
}

export interface DeliveryDecision {
  channel: "chat" | "inbox" | "email" | "im" | "push";
  timing: "immediate" | "delayed" | "batched";
  targetConversationId?: string;
  reason: string;
}
