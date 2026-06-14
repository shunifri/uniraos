/**
 * Delivery Router — 投递路由决策引擎
 *
 * 决策逻辑：
 * 1. 事件优先级 → 决定打扰程度
 * 2. 用户在线状态 + 当前位置 → 决定投递渠道
 * 3. 事件关联对话 → 决定是否内嵌到 Chat 流
 */

import { log } from "../utils/logger.js";
import { inboxEventBus } from "./inbox-events.js";
import { getGlobalExecutionEngine } from "../engine/execution-engine.js";
import type { InboxItem, DeliveryEvent, DeliveryDecision } from "./inbox-types.js";

export class DeliveryRouter {
  /**
   * 核心决策方法
   */
  async route(event: DeliveryEvent): Promise<DeliveryDecision> {
    const { item, userOnline, userLocation, relatedConversationId } = event;

    // 决策 1: 紧急事件直接投递到 Chat（即使不在关联页面）
    if (item.priority === "urgent") {
      if (relatedConversationId && userOnline) {
        return {
          channel: "chat",
          timing: "immediate",
          targetConversationId: relatedConversationId,
          reason: "urgent_priority",
        };
      }
      // 用户不在线时，回退到 email（如有）否则 inbox，避免落入未实现的 push 通道
      return {
        channel: "email",
        timing: "immediate",
        targetConversationId: relatedConversationId,
        reason: "urgent_priority_offline_fallback",
      };
    }

    // 决策 2: 高优事件 + 用户在关联对话 → Chat 内嵌
    if (item.priority === "high" && relatedConversationId && userLocation?.includes("chat")) {
      return {
        channel: "chat",
        timing: "immediate",
        targetConversationId: relatedConversationId,
        reason: "high_priority_related_conversation",
      };
    }

    // 决策 3: 审批类 + 有 deadline → Inbox +  Badge
    if (item.type === "approval" && item.dueAt) {
      const hoursUntilDue = (item.dueAt - Date.now()) / 3600000;
      if (hoursUntilDue < 24) {
        return {
          channel: userOnline ? "inbox" : "email",
          timing: "immediate",
          targetConversationId: relatedConversationId,
          reason: "approval_approaching_deadline",
        };
      }
    }

    // 决策 4: 普通事件 → Inbox Badge（不打断用户）
    return {
      channel: "inbox",
      timing: "immediate",
      targetConversationId: relatedConversationId,
      reason: "default_inbox",
    };
  }

  /**
   * 投递到 Chat 流（SSE 推送）
   */
  async deliverToChat(item: InboxItem, conversationId: string): Promise<void> {
    log("info", "delivery_router_chat", { itemId: item.id, conversationId });
    // 通过 inbox SSE 推送到前端（以 chat_message 事件类型）
    inboxEventBus.emitInboxEvent({
      type: "chat_message",
      userId: item.userId,
      item,
    });
  }

  /**
   * 投递到 Inbox 面板（Badge 提醒）
   */
  async deliverToInbox(item: InboxItem): Promise<void> {
    log("info", "delivery_router_inbox", { itemId: item.id });
    // InboxItem 已创建，Badge 数自动更新
    // TODO: 通过 SSE 推送 inbox_update 事件刷新前端 Badge
  }

  /**
   * 投递到 Email
   */
  async deliverToEmail(item: InboxItem): Promise<void> {
    log("info", "delivery_router_email", { itemId: item.id });
    try {
      const engine = getGlobalExecutionEngine();
      if (!engine) {
        log("warn", "delivery_router_email_no_engine", { itemId: item.id });
        return;
      }
      const { getUserById } = await import("../db/user-repository.js");
      const user = await getUserById(item.userId);
      if (!user?.email) {
        log("warn", "delivery_router_email_no_recipient", { itemId: item.id, userId: item.userId });
        return;
      }
      const result = await engine.execute("email_send", {
        connection: "default",
        to: user.email,
        subject: item.title,
        body: item.description || item.title,
      });
      if (!result.success) {
        log("error", "delivery_router_email_failed", { itemId: item.id, error: (result.error as any)?.message });
      }
    } catch (err: any) {
      log("error", "delivery_router_email_error", { itemId: item.id, error: err.message });
    }
  }

  /**
   * 投递到 IM
   */
  async deliverToIM(item: InboxItem): Promise<void> {
    log("info", "delivery_router_im", { itemId: item.id });
    try {
      const engine = getGlobalExecutionEngine();
      if (!engine) {
        log("warn", "delivery_router_im_no_engine", { itemId: item.id });
        return;
      }
      const result = await engine.execute("im_bot_send", {
        connection: "default",
        content: `${item.title}\n\n${item.description || ""}`,
      });
      if (!result.success) {
        log("error", "delivery_router_im_failed", { itemId: item.id, error: (result.error as any)?.message });
      }
    } catch (err: any) {
      log("error", "delivery_router_im_error", { itemId: item.id, error: err.message });
    }
  }
}

// 单例
let routerInstance: DeliveryRouter | null = null;

export function getDeliveryRouter(): DeliveryRouter {
  if (!routerInstance) {
    routerInstance = new DeliveryRouter();
  }
  return routerInstance;
}
