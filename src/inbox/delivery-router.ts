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
import type { InboxItem, DeliveryEvent, DeliveryDecision } from "./inbox-types.js";

export class DeliveryRouter {
  /**
   * 核心决策方法
   */
  async route(event: DeliveryEvent): Promise<DeliveryDecision> {
    const { item, userOnline, userLocation, relatedConversationId } = event;

    // 决策 1: 紧急事件直接投递到 Chat（即使不在关联页面）
    if (item.priority === "urgent") {
      return {
        channel: relatedConversationId && userOnline ? "chat" : "push",
        timing: "immediate",
        targetConversationId: relatedConversationId,
        reason: "urgent_priority",
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
    // TODO: Phase 4 实现，调用 email_send skill
  }

  /**
   * 投递到 IM
   */
  async deliverToIM(item: InboxItem): Promise<void> {
    log("info", "delivery_router_im", { itemId: item.id });
    // TODO: Phase 4 实现，调用 im_bot_send skill
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
