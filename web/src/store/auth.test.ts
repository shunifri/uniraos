import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAuthStore } from "./auth";

describe("auth store", () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      isAdmin: false,
      isDeveloper: false,
      isAnonymous: false,
      embeddedRole: undefined,
    });
    mockFetch.mockClear();
    globalThis.fetch = mockFetch;
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should have initial null state", () => {
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAdmin).toBe(false);
    expect(state.isDeveloper).toBe(false);
    expect(state.isAnonymous).toBe(false);
  });

  // ---------- login ----------

  it("login should set token and user on success", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        token: "test-token",
        user: { id: "1", username: "test", displayName: "Test", roles: [{ id: "1", name: "admin" }] },
      }),
    } as Response);

    await useAuthStore.getState().login("test", "password");
    const state = useAuthStore.getState();
    expect(state.token).toBe("test-token");
    expect(state.user?.username).toBe("test");
    expect(state.isAdmin).toBe(true);
    expect(state.isDeveloper).toBe(true);
    expect(state.isAnonymous).toBe(false);
  });

  it("login should throw on failure", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, error: "Invalid credentials" }),
    } as Response);

    await expect(useAuthStore.getState().login("test", "wrong")).rejects.toThrow("Invalid credentials");
  });

  // ---------- loginAnonymous ----------

  it("loginAnonymous should set token, user and isAnonymous on success", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        token: "anon-token",
        user: { id: "2", username: "guest_1234_abcd", displayName: "游客1234", roles: [{ id: "r1", name: "anonymous" }] },
      }),
    } as Response);

    await useAuthStore.getState().loginAnonymous("13800138000");
    const state = useAuthStore.getState();
    expect(state.token).toBe("anon-token");
    expect(state.user?.displayName).toBe("游客1234");
    expect(state.isAnonymous).toBe(true);
    expect(state.isAdmin).toBe(false);
    expect(localStorage.getItem("raos-anon-phone")).toBe("13800138000");
  });

  it("loginAnonymous should throw on failure", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, error: "Invalid phone" }),
    } as Response);

    await expect(useAuthStore.getState().loginAnonymous("13800138000")).rejects.toThrow("Invalid phone");
  });

  // ---------- checkSession ----------

  it("checkSession should refresh user state when token is valid", async () => {
    useAuthStore.setState({ token: "valid-token" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: "1", username: "test", displayName: "Test", roles: [{ name: "developer" }] } }),
    } as Response);

    await useAuthStore.getState().checkSession();
    const state = useAuthStore.getState();
    expect(state.user?.username).toBe("test");
    expect(state.isDeveloper).toBe(true);
    expect(state.isAnonymous).toBe(false);
  });

  it("checkSession should logout when response is 401", async () => {
    useAuthStore.setState({ token: "expired-token", user: { id: "1", username: "u", displayName: "U", roles: [] } });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    } as Response);

    await useAuthStore.getState().checkSession();
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it("checkSession should silently return when no token", async () => {
    useAuthStore.setState({ token: null });
    await useAuthStore.getState().checkSession();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("checkSession should logout on network error", async () => {
    useAuthStore.setState({ token: "some-token", user: { id: "1", username: "u", displayName: "U", roles: [] } });
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await useAuthStore.getState().checkSession();
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  // ---------- setUser ----------

  it("setUser should update user and recompute roles", () => {
    useAuthStore.getState().setUser({
      id: "3",
      username: "admin2",
      displayName: "Admin2",
      roles: [{ id: "r1", name: "admin" }],
    });
    const state = useAuthStore.getState();
    expect(state.user?.username).toBe("admin2");
    expect(state.isAdmin).toBe(true);
    expect(state.isDeveloper).toBe(true);
  });

  it("setUser should detect anonymous role", () => {
    useAuthStore.getState().setUser({
      id: "4",
      username: "anon",
      displayName: "Anon",
      roles: [{ id: "r2", name: "anonymous" }],
    });
    expect(useAuthStore.getState().isAnonymous).toBe(true);
  });

  // ---------- logout ----------

  it("logout should clear state", () => {
    useAuthStore.setState({ token: "abc", user: { id: "1", username: "u", displayName: "U", roles: [] } });
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAdmin).toBe(false);
    expect(state.isDeveloper).toBe(false);
  });

  // ---------- hasPermission ----------

  it("hasPermission should return true for admin with any permission", () => {
    useAuthStore.setState({ isAdmin: true });
    expect(useAuthStore.getState().hasPermission("anything")).toBe(true);
  });

  it("hasPermission should check user permissions", () => {
    useAuthStore.setState({
      isAdmin: false,
      user: { id: "1", username: "u", displayName: "U", roles: [], permissions: ["files.read"] },
    });
    expect(useAuthStore.getState().hasPermission("files.read")).toBe(true);
    expect(useAuthStore.getState().hasPermission("files.write")).toBe(false);
  });

  // ---------- persist ----------

  it("should persist only token to localStorage", () => {
    useAuthStore.setState({ token: "persisted-token" });
    // Zustand persist runs asynchronously; force a rehydration check
    const stored = localStorage.getItem("raos-auth");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.state.token).toBe("persisted-token");
    expect(parsed.state.user).toBeUndefined();
  });
});
