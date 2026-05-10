/**
 * Scheduler Worker — Bull Job 处理器
 *
 * 当 Bull 队列中的任务到期时，此处理器被调用：
 * 1. 从 MySQL 加载事件详情
 * 2. 执行 action（创建 InboxItem / 发送消息 / 调用 Skill 等）
 * 3. 更新状态
 * 4. 处理升级策略
 */

import { log } from "../utils/logger.js";
import { getSchedulerService } from "./scheduler-service.js";
import { getInboxService } from "../inbox/inbox-service.js";
import { getDeliveryRouter } from "../inbox/delivery-router.js";
import { getGlobalExecutionEngine } from "../engine/execution-engine.js";
import type { InboxType, InboxCategory, InboxPriority } from "../inbox/inbox-types.js";

export interface JobData {
  eventId: string;
}

export async function processScheduleJob(jobData: JobData): Promise<void> {
  const { eventId } = jobData;
  const scheduler = getSchedulerService();
  const inbox = getInboxService();

  const event = await scheduler.getEvent(eventId);
  if (!event) {
    log("warn", "schedule_worker_event_not_found", { eventId });
    return;
  }

  if (event.status === "cancelled") {
    log("info", "schedule_worker_event_cancelled", { eventId });
    return;
  }

  log("info", "schedule_worker_processing", { eventId, type: event.type, action: event.actionConfig.type });

  try {
    // 更新状态为 triggered
    await scheduler.updateStatus(eventId, "triggered", Date.now());

    // 执行 action
    await executeAction(event);

    // 更新状态为 completed
    await scheduler.updateStatus(eventId, "completed", undefined);

    log("info", "schedule_worker_completed", { eventId });
  } catch (err: any) {
    log("error", "schedule_worker_failed", { eventId, error: err.message });
    await scheduler.updateStatus(eventId, "failed", undefined);

    // 如果配置了重试，可以在这里处理
    if (event.retryCount < 3) {
      // 重试逻辑由 Bull 的 attempts/backoff 自动处理
    }
  }
}

async function executeAction(event: any): Promise<void> {
  const action = event.actionConfig;

  switch (action.type) {
    case "inbox": {
      // 创建 InboxItem
      const inboxService = getInboxService();
      const type: InboxType = action.payload.type ||
        (event.type === "reminder" || event.type === "deadline" ? "task" : "notification");
      const category: InboxCategory = action.payload.category || "user_reminder";
      const priority: InboxPriority = action.payload.priority || "normal";

      await inboxService.createItem({
        userId: event.userId,
        type,
        category,
        source: event.source,
        sourceId: event.sourceId,
        title: action.payload.title || action.payload.message || "定时提醒",
        description: action.payload.content || action.payload.description || action.payload.message,
        priority,
        payload: {
          content: action.payload.content || action.payload.message,
          metadata: action.payload.metadata,
        },
        conversationId: action.targetConversationId,
      });
      break;
    }

    case "chat": {
      // 通过 SSE 推送到 Chat
      const deliveryRouter = getDeliveryRouter();
      await deliveryRouter.deliverToChat({
        id: `chat_${Date.now()}`,
        userId: event.userId,
        type: "notification",
        category: "agent_proactive",
        source: event.source,
        title: action.payload.title || "系统消息",
        description: action.payload.text,
        priority: "normal",
        status: "unread",
        payload: { content: action.payload.text },
        createdAt: Date.now(),
      } as any, action.targetConversationId || "");
      break;
    }

    case "email": {
      try {
        const engine = getGlobalExecutionEngine();
        if (!engine) {
          log("warn", "schedule_worker_email_no_engine", { eventId: event.id });
          break;
        }
        const { getUserById } = await import("../db/user-repository.js");
        const user = await getUserById(event.userId);
        const to = (action.payload.to as string) || user?.email;
        if (!to) {
          log("warn", "schedule_worker_email_no_recipient", { eventId: event.id, userId: event.userId });
          break;
        }
        const result = await engine.execute("email_send", {
          connection: (action.payload.connection as string) || "default",
          to,
          subject: (action.payload.subject as string) || action.payload.title || "定时提醒",
          body: (action.payload.body as string) || action.payload.content || action.payload.message || "",
        });
        if (!result.success) {
          log("error", "schedule_worker_email_failed", { eventId: event.id, error: (result.error as any)?.message });
        }
      } catch (err: any) {
        log("error", "schedule_worker_email_error", { eventId: event.id, error: err.message });
      }
      break;
    }

    case "im": {
      try {
        const engine = getGlobalExecutionEngine();
        if (!engine) {
          log("warn", "schedule_worker_im_no_engine", { eventId: event.id });
          break;
        }
        const result = await engine.execute("im_bot_send", {
          connection: (action.payload.connection as string) || "default",
          content: (action.payload.content as string) || action.payload.message || action.payload.text || action.payload.title || "定时提醒",
        });
        if (!result.success) {
          log("error", "schedule_worker_im_failed", { eventId: event.id, error: (result.error as any)?.message });
        }
      } catch (err: any) {
        log("error", "schedule_worker_im_error", { eventId: event.id, error: err.message });
      }
      break;
    }

    case "skill": {
      // 调用指定 skill
      log("info", "schedule_worker_skill", { eventId: event.id, skillName: action.payload.skillName });
      // TODO: 集成 execution engine
      break;
    }

    default: {
      log("warn", "schedule_worker_unknown_action", { eventId: event.id, actionType: action.type });
    }
  }
}
