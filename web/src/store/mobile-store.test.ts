import { describe, it, expect, beforeEach } from "vitest";
import { useMobileStore } from "./mobile-store";

describe("useMobileStore (P3)", () => {
  beforeEach(() => {
    useMobileStore.setState({ isMobile: false, sidebarOpen: false });
  });

  it("should detect mobile based on window width", () => {
    // Mock window.innerWidth
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 500, writable: true, configurable: true });

    useMobileStore.getState().checkMobile();
    expect(useMobileStore.getState().isMobile).toBe(true);

    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true, configurable: true });
    useMobileStore.getState().checkMobile();
    expect(useMobileStore.getState().isMobile).toBe(false);

    Object.defineProperty(window, "innerWidth", { value: originalWidth, writable: true, configurable: true });
  });

  it("should toggle sidebar", () => {
    const store = useMobileStore.getState();
    store.toggleSidebar();
    expect(useMobileStore.getState().sidebarOpen).toBe(true);
    store.toggleSidebar();
    expect(useMobileStore.getState().sidebarOpen).toBe(false);
  });

  it("should close sidebar", () => {
    useMobileStore.setState({ sidebarOpen: true });
    useMobileStore.getState().closeSidebar();
    expect(useMobileStore.getState().sidebarOpen).toBe(false);
  });
});
