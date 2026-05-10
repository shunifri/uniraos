import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InboxPanel from "../InboxPanel";
import { useInboxStore } from "../../../store/inbox-store";

vi.mock("../../../store/inbox-store", () => ({
  useInboxStore: vi.fn(),
}));

describe("InboxPanel", () => {
  const mockSetActiveTab = vi.fn();
  const mockSetPanelOpen = vi.fn();
  const mockFetchStats = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useInboxStore as any).mockReturnValue({
      items: [],
      stats: { unreadCount: 3, pendingApprovals: 1, pendingTasks: 0, unreadNotifications: 2, upcomingReminders: 0 },
      loading: false,
      activeTab: "pending",
      setActiveTab: mockSetActiveTab,
      setPanelOpen: mockSetPanelOpen,
    });
    (useInboxStore as any).getState = () => ({ fetchStats: mockFetchStats });
  });

  it("should render panel title", () => {
    render(<InboxPanel />);
    expect(screen.getByText("收件箱")).toBeInTheDocument();
  });

  it("should display unread badge when unreadCount > 0", () => {
    render(<InboxPanel />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("should call setPanelOpen(false) when close button clicked", () => {
    render(<InboxPanel />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(mockSetPanelOpen).toHaveBeenCalledWith(false);
  });

  it("should call setActiveTab when tab changed", () => {
    render(<InboxPanel />);
    const completedTab = screen.getByText("已处理");
    fireEvent.click(completedTab);
    expect(mockSetActiveTab).toHaveBeenCalledWith("completed");
  });

  it("should fetch stats on mount", () => {
    render(<InboxPanel />);
    expect(mockFetchStats).toHaveBeenCalled();
  });
});
