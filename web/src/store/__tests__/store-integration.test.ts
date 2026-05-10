import { describe, it, expect } from "vitest";
import { useAuthStore } from "../auth";
import { useInboxStore } from "../inbox-store";

describe("Store integration", () => {
  it("auth logout should not crash when inbox store has no SSE connection", () => {
    useAuthStore.setState({
      token: "token",
      user: { id: "1", username: "u", displayName: "U", roles: [] },
    });
    useInboxStore.setState({ items: [], panelOpen: true });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useInboxStore.getState().panelOpen).toBe(true);
  });

  it("auth state should compute roles consistently across setters", () => {
    useAuthStore.getState().setUser({
      id: "1",
      username: "admin",
      displayName: "Admin",
      roles: [{ id: "r1", name: "admin" }],
    });
    expect(useAuthStore.getState().isAdmin).toBe(true);
    expect(useAuthStore.getState().isDeveloper).toBe(true);

    useAuthStore.getState().setUser({
      id: "1",
      username: "user",
      displayName: "User",
      roles: [{ id: "r2", name: "viewer" }],
    });
    expect(useAuthStore.getState().isAdmin).toBe(false);
    expect(useAuthStore.getState().isDeveloper).toBe(false);
  });
});
