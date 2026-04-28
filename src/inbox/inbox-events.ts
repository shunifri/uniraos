/**
 * Inbox Event Bus — 服务端内部事件总线
 *
 * 用于 InboxService → SSE 推送的解耦通信
 */

import { EventEmitter } from "events";
import type { InboxItem } from "./inbox-types.js";

export interface InboxEvent {
  type: "new_item" | "item_updated" | "stats_changed" | "chat_message";
  userId: string;
  item?: InboxItem;
  itemId?: string;
  status?: string;
}

class InboxEventBus extends EventEmitter {
  emitInboxEvent(event: InboxEvent): void {
    this.emit("inbox_event", event);
    // 也按 userId 广播，便于 SSE 端点过滤
    this.emit(`inbox_event:${event.userId}`, event);
  }
}

export const inboxEventBus = new InboxEventBus();
