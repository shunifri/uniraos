/**
 * Inbox Zustand Store
 *
 * 管理 Inbox 的状态：items、unreadCount、panelOpen 等
 */

import { create } from "zustand";
import { api } from "../api";
import { useAuthStore } from "./auth";

export interface InboxItem {
  id: string;
  userId: string;
  type: "approval" | "notification" | "task" | "alert";
  category: string;
  source: string;
  sourceId?: string;
  title: string;
  description?: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "unread" | "read" | "pending" | "completed" | "dismissed";
  payload: any;
  aiSuggestion?: any;
  aggregateCount?: number;
  conversationId?: string;
  dueAt?: number;
  createdAt: number;
}

export interface InboxStats {
  unreadCount: number;
  pendingApprovals: number;
  pendingTasks: number;
  unreadNotifications: number;
  upcomingReminders: number;
}

interface InboxState {
  // 数据
  items: InboxItem[];
  stats: InboxStats;
  selectedItemId: string | null;
  loading: boolean;

  // UI 状态
  panelOpen: boolean;
  activeTab: "pending" | "completed" | "notifications" | "reminders";

  // 动作
  fetchItems: (filter?: any) => Promise<void>;
  fetchStats: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  completeItem: (id: string, action?: string, data?: any) => Promise<void>;
  dismissItem: (id: string) => Promise<void>;
  selectItem: (id: string | null) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  setActiveTab: (tab: InboxState["activeTab"]) => void;

  // SSE 推送处理
  handleNewItem: (item: InboxItem) => void;
  handleItemUpdate: (id: string, status: string) => void;

  // SSE 连接管理
  connectSSE: () => void;
  disconnectSSE: () => void;
}

let sseConnection: EventSource | null = null;
let sseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let sseLastPongAt = 0;
let sseRetryCount = 0;
const SSE_HEARTBEAT_TIMEOUT = 45000;  // 45s 未收到任何消息则认为断开
const SSE_MAX_RETRIES = 10;           // 最大重试次数

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  stats: { unreadCount: 0, pendingApprovals: 0, pendingTasks: 0, unreadNotifications: 0, upcomingReminders: 0 },
  selectedItemId: null,
  loading: false,
  panelOpen: false,
  activeTab: "pending",

  async fetchItems(filter = {}) {
    set({ loading: true });
    try {
      const query = new URLSearchParams();
      Object.entries(filter).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          query.set(key, String(value));
        }
      });
      const url = `/api/inbox${query.toString() ? `?${query.toString()}` : ""}`;
      const res: any = await api.get(url);
      if (res.success) {
        set({ items: res.items || [] });
      }
    } catch (e) {
      console.error("[InboxStore] fetchItems failed:", e);
    } finally {
      set({ loading: false });
    }
  },

  async fetchStats() {
    try {
      const res: any = await api.get("/api/inbox/stats");
      if (res.success) {
        set({ stats: res.data });
      }
    } catch (e) {
      console.error("[InboxStore] fetchStats failed:", e);
    }
  },

  async markAsRead(id: string) {
    try {
      await api.post(`/api/inbox/${id}/read`);
      set((state) => ({
        items: state.items.map((item) => (item.id === id ? { ...item, status: "read" } : item)),
      }));
      get().fetchStats();
    } catch (e) {
      console.error("[InboxStore] markAsRead failed:", e);
    }
  },

  async completeItem(id: string, action?: string, data?: any) {
    try {
      await api.post(`/api/inbox/${id}/complete`, { action, formData: data });
      set((state) => ({
        items: state.items.map((item) => (item.id === id ? { ...item, status: "completed" } : item)),
        selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
      }));
      get().fetchStats();
    } catch (e) {
      console.error("[InboxStore] completeItem failed:", e);
    }
  },

  async dismissItem(id: string) {
    try {
      await api.post(`/api/inbox/${id}/dismiss`);
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
        selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
      }));
      get().fetchStats();
    } catch (e) {
      console.error("[InboxStore] dismissItem failed:", e);
    }
  },

  selectItem(id: string | null) {
    set({ selectedItemId: id });
  },

  togglePanel() {
    set((state) => {
      const next = !state.panelOpen;
      if (next) {
        // 打开时刷新数据
        get().fetchItems({ status: "unread,pending" });
        get().fetchStats();
      }
      return { panelOpen: next };
    });
  },

  setPanelOpen(open: boolean) {
    set({ panelOpen: open });
    if (open) {
      get().fetchItems({ status: "unread,pending" });
      get().fetchStats();
    }
  },

  setActiveTab(tab: InboxState["activeTab"]) {
    set({ activeTab: tab });
    const filter: any = {};
    if (tab === "pending") filter.status = "unread,pending";
    if (tab === "completed") filter.status = "completed";
    if (tab === "notifications") filter.type = "notification";
    if (tab === "reminders") filter.type = "task";
    get().fetchItems(filter);
  },

  handleNewItem(item: InboxItem) {
    set((state) => {
      // 如果已存在则更新，否则插入到头部
      const exists = state.items.find((i) => i.id === item.id);
      if (exists) {
        return {
          items: state.items.map((i) => (i.id === item.id ? item : i)),
        };
      }
      return { items: [item, ...state.items] };
    });
    get().fetchStats();
  },

  handleItemUpdate(id: string, status: string) {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status: status as any } : item)),
    }));
    get().fetchStats();
  },

  connectSSE() {
    if (sseConnection?.readyState === EventSource.OPEN) return;
    if (sseConnection?.readyState === EventSource.CONNECTING) return;

    const token = useAuthStore.getState().token;
    const url = `/api/inbox/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;

    const es = new EventSource(url);
    sseConnection = es;
    sseLastPongAt = Date.now();

    // 启动心跳超时检测
    if (sseHeartbeatTimer) {
      clearInterval(sseHeartbeatTimer);
    }
    sseHeartbeatTimer = setInterval(() => {
      if (!sseConnection) return;
      const elapsed = Date.now() - sseLastPongAt;
      if (elapsed > SSE_HEARTBEAT_TIMEOUT) {
        console.warn(`[Inbox SSE] heartbeat timeout (${elapsed}ms), forcing reconnect...`);
        es.close();
        sseConnection = null;
        if (sseHeartbeatTimer) {
          clearInterval(sseHeartbeatTimer);
          sseHeartbeatTimer = null;
        }
        setTimeout(() => get().connectSSE(), 1000);
      }
    }, 10000);

    const updateLastPong = () => {
      sseLastPongAt = Date.now();
    };

    es.addEventListener("connected", () => {
      console.log("[Inbox SSE] connected");
      updateLastPong();
    });

    es.addEventListener("new_item", (e) => {
      updateLastPong();
      try {
        const data = JSON.parse(e.data);
        if (data.item) {
          get().handleNewItem(data.item);
        }
      } catch (err) {
        console.error("[Inbox SSE] failed to parse new_item:", err);
      }
    });

    es.addEventListener("item_updated", (e) => {
      updateLastPong();
      try {
        const data = JSON.parse(e.data);
        if (data.itemId && data.status) {
          get().handleItemUpdate(data.itemId, data.status);
        }
      } catch (err) {
        console.error("[Inbox SSE] failed to parse item_updated:", err);
      }
    });

    es.addEventListener("chat_message", (e) => {
      updateLastPong();
      try {
        const data = JSON.parse(e.data);
        const item = data.item;
        if (item) {
          // 显示全局通知
          import("antd").then(({ message }) => {
            message.info({
              content: item.title || "新消息",
              duration: 5,
            });
          }).catch(() => {});
          // 同时刷新 stats 和 items
          get().handleNewItem(item);
        }
      } catch (err) {
        console.error("[Inbox SSE] failed to parse chat_message:", err);
      }
    });

    es.addEventListener("heartbeat", () => {
      updateLastPong();
    });

    es.onerror = () => {
      es.close();
      sseConnection = null;
      if (sseHeartbeatTimer) {
        clearInterval(sseHeartbeatTimer);
        sseHeartbeatTimer = null;
      }

      sseRetryCount++;
      if (sseRetryCount > SSE_MAX_RETRIES) {
        console.error(`[Inbox SSE] max retries (${SSE_MAX_RETRIES}) exceeded, giving up.`);
        return;
      }

      const delay = Math.min(5000 * Math.pow(2, sseRetryCount - 1), 60000);
      console.warn(`[Inbox SSE] error, reconnecting in ${delay}ms... (retry ${sseRetryCount}/${SSE_MAX_RETRIES})`);
      setTimeout(() => get().connectSSE(), delay);
    };

    es.onopen = () => {
      sseRetryCount = 0; // 连接成功重置重试计数
      updateLastPong();
      // 连接成功后立即刷新 stats 和 items
      get().fetchStats();
      get().fetchItems({ status: "unread,pending", pageSize: 20 });
    };
  },

  disconnectSSE() {
    if (sseHeartbeatTimer) {
      clearInterval(sseHeartbeatTimer);
      sseHeartbeatTimer = null;
    }
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
    }
  },
}));

// 页面可见性变化时检查 SSE 健康度
function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    const elapsed = Date.now() - sseLastPongAt;
    if (!sseConnection || sseConnection.readyState !== EventSource.OPEN || elapsed > SSE_HEARTBEAT_TIMEOUT) {
      console.warn("[Inbox SSE] page visible but connection unhealthy, reconnecting...");
      if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
      }
      if (sseHeartbeatTimer) {
        clearInterval(sseHeartbeatTimer);
        sseHeartbeatTimer = null;
      }
      sseRetryCount = 0; // 用户回到页面，给一次立即重试的机会
      useInboxStore.getState().connectSSE();
    }
  }
}
document.addEventListener("visibilitychange", handleVisibilityChange);
