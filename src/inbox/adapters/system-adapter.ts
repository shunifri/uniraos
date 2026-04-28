/**
 * System Adapter — 将系统通知/告警转换为 InboxItem
 */

import type { CreateInboxItemInput } from "../inbox-types.js";

export interface SystemAdapter {
  toInboxItem(event: any): Promise<CreateInboxItemInput>;
}

export function createSystemAdapter(): SystemAdapter {
  return {
    async toInboxItem(event: any): Promise<CreateInboxItemInput> {
      return {
        userId: event.userId || "system",
        type: event.type || "notification",
        category: event.category || "system_alert",
        source: "system",
        sourceId: event.id,
        title: event.title,
        description: event.description,
        priority: event.priority || "normal",
        payload: {
          content: event.content,
          link: event.link,
          metadata: event.metadata,
        },
      };
    },
  };
}
