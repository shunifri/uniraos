import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInboxStore } from "./inbox-store";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("./auth", () => ({
  useAuthStore: {
    getState: () => ({ token: "test_token" }),
  },
}));

import { api } from "../api";

describe("useInboxStore (P3)", () => {
  beforeEach(() => {
    useInboxStore.setState({
      items: [],
      stats: { unreadCount: 0, pendingApprovals: 0, pendingTasks: 0, unreadNotifications: 0, upcomingReminders: 0 },
      selectedItemId: null,
      loading: false,
      panelOpen: false,
      activeTab: "pending",
    });
    vi.clearAllMocks();
  });

  it("should have correct initial state", () => {
    const state = useInboxStore.getState();
    expect(state.items).toEqual([]);
    expect(state.stats.unreadCount).toBe(0);
    expect(state.panelOpen).toBe(false);
    expect(state.activeTab).toBe("pending");
  });

  it("fetchItems should update items on success", async () => {
    const mockItems = [
      { id: "1", title: "Task 1", status: "unread" },
      { id: "2", title: "Task 2", status: "pending" },
    ];
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, items: mockItems });

    await useInboxStore.getState().fetchItems({ status: "unread" });

    const state = useInboxStore.getState();
    expect(state.items).toEqual(mockItems);
    expect(state.loading).toBe(false);
    expect(api.get).toHaveBeenCalledWith("/api/inbox?status=unread");
  });

  it("fetchItems should handle error gracefully", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    await useInboxStore.getState().fetchItems();

    const state = useInboxStore.getState();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("fetchStats should update stats", async () => {
    const mockStats = { unreadCount: 5, pendingApprovals: 2, pendingTasks: 1, unreadNotifications: 2, upcomingReminders: 0 };
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    await useInboxStore.getState().fetchStats();

    expect(useInboxStore.getState().stats).toEqual(mockStats);
  });

  it("markAsRead should update item status and fetch stats", async () => {
    useInboxStore.setState({
      items: [{ id: "1", title: "Task", status: "unread" } as any],
    });
    vi.mocked(api.post).mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { unreadCount: 0 } });

    await useInboxStore.getState().markAsRead("1");

    const state = useInboxStore.getState();
    expect(state.items[0].status).toBe("read");
  });

  it("completeItem should update status and deselect", async () => {
    useInboxStore.setState({
      items: [{ id: "1", title: "Task", status: "pending" } as any],
      selectedItemId: "1",
    });
    vi.mocked(api.post).mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { unreadCount: 0 } });

    await useInboxStore.getState().completeItem("1", "approve");

    const state = useInboxStore.getState();
    expect(state.items[0].status).toBe("completed");
    expect(state.selectedItemId).toBeNull();
  });

  it("dismissItem should remove item", async () => {
    useInboxStore.setState({
      items: [{ id: "1", title: "Task" } as any],
    });
    vi.mocked(api.post).mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { unreadCount: 0 } });

    await useInboxStore.getState().dismissItem("1");

    expect(useInboxStore.getState().items).toEqual([]);
  });

  it("selectItem should update selectedItemId", () => {
    useInboxStore.getState().selectItem("1");
    expect(useInboxStore.getState().selectedItemId).toBe("1");

    useInboxStore.getState().selectItem(null);
    expect(useInboxStore.getState().selectedItemId).toBeNull();
  });

  it("togglePanel should toggle panelOpen", () => {
    const store = useInboxStore.getState();
    store.togglePanel();
    expect(useInboxStore.getState().panelOpen).toBe(true);
    store.togglePanel();
    expect(useInboxStore.getState().panelOpen).toBe(false);
  });

  it("setActiveTab should update tab and fetch items", async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, items: [] });

    await useInboxStore.getState().setActiveTab("completed");

    expect(useInboxStore.getState().activeTab).toBe("completed");
  });

  it("handleNewItem should add new item to top", () => {
    useInboxStore.setState({ items: [{ id: "1" } as any] });
    useInboxStore.getState().handleNewItem({ id: "2", title: "New" } as any);

    const items = useInboxStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("2");
  });

  it("handleNewItem should update existing item", () => {
    useInboxStore.setState({ items: [{ id: "1", title: "Old" } as any] });
    useInboxStore.getState().handleNewItem({ id: "1", title: "Updated" } as any);

    expect(useInboxStore.getState().items[0].title).toBe("Updated");
  });

  it("handleItemUpdate should update item status", () => {
    useInboxStore.setState({ items: [{ id: "1", status: "unread" } as any] });
    useInboxStore.getState().handleItemUpdate("1", "read");

    expect(useInboxStore.getState().items[0].status).toBe("read");
  });
});
