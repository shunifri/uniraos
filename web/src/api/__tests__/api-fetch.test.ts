import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, api, pageImageUrl, videoFrameUrl } from "../index";
import {
  installFetchMock,
  uninstallFetchMock,
  makeJsonResponse,
  makeTextResponse,
} from "../../test-utils/api-test-utils";

// Mutable auth state so individual tests can toggle token / logout behaviour
const mockAuthState = {
  token: "test-token",
  logout: vi.fn(),
};

vi.mock("../../store/auth", () => ({
  useAuthStore: {
    getState: () => mockAuthState,
  },
}));

describe("apiFetch", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
    mockAuthState.token = "test-token";
    mockAuthState.logout.mockClear();
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("should inject Bearer token when token exists", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    await apiFetch("/api/test");
    const [, options] = mockFetch.mock.calls[0];
    expect((options.headers as Headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("should not inject Authorization when token is null", async () => {
    mockAuthState.token = null;
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    await apiFetch("/api/test");
    const [, options] = mockFetch.mock.calls[0];
    expect((options.headers as Headers).get("Authorization")).toBeNull();
  });

  it("should auto-set Content-Type to application/json for string body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    await apiFetch("/api/test", { method: "POST", body: JSON.stringify({ foo: 1 }) });
    const [, options] = mockFetch.mock.calls[0];
    expect((options.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("should not override existing Content-Type header", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    await apiFetch("/api/test", {
      method: "POST",
      body: JSON.stringify({ foo: 1 }),
      headers: { "Content-Type": "text/plain" },
    });
    const [, options] = mockFetch.mock.calls[0];
    expect((options.headers as Headers).get("Content-Type")).toBe("text/plain");
  });

  it("should not set Content-Type when body is not a string", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    const form = new FormData();
    await apiFetch("/api/test", { method: "POST", body: form as any });
    const [, options] = mockFetch.mock.calls[0];
    expect((options.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("should call logout on 401 response", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ error: "Unauthorized" }, 401));
    const res = await apiFetch("/api/test");
    expect(res.status).toBe(401);
    expect(mockAuthState.logout).toHaveBeenCalledTimes(1);
  });

  it("should not call logout on non-401 response", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }, 200));
    await apiFetch("/api/test");
    expect(mockAuthState.logout).not.toHaveBeenCalled();
  });

  it("should forward other fetch options", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    await apiFetch("/api/test", { method: "PATCH", cache: "no-cache" as any });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("PATCH");
    expect(options.cache).toBe("no-cache");
  });
});

describe("api helpers", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
    mockAuthState.token = "test-token";
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("api.get should fetch and parse JSON on success", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: [1, 2] }));
    const result = await api.get("/api/items");
    expect(result).toEqual({ success: true, data: [1, 2] });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/items");
    expect(options.method).toBeUndefined();
  });

  it("api.post should send JSON body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: "123" }));
    const result = await api.post("/api/items", { name: "foo" });
    expect(result).toEqual({ id: "123" });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ name: "foo" }));
  });

  it("api.post should work without body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
    await api.post("/api/action");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.body).toBeUndefined();
  });

  it("api.put should send JSON body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ updated: true }));
    await api.put("/api/items/1", { name: "bar" });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("PUT");
    expect(options.body).toBe(JSON.stringify({ name: "bar" }));
  });

  it("api.del should send DELETE request", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ deleted: true }));
    await api.del("/api/items/1");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("DELETE");
  });

  it("api.del should support request body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ deleted: true }));
    await api.del("/api/items", { ids: ["1", "2"] });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("DELETE");
    expect(options.body).toBe(JSON.stringify({ ids: ["1", "2"] }));
  });

  it("should throw Error with message from JSON error body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Not found" }, 404));
    await expect(api.get("/api/missing")).rejects.toThrow("Not found");
  });

  it("should fallback to statusText when error body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce(makeTextResponse("Bad Gateway", 502, "Bad Gateway"));
    await expect(api.get("/api/down")).rejects.toThrow("Bad Gateway");
  });
});

describe("URL utilities", () => {
  beforeEach(() => {
    mockAuthState.token = "test-token";
  });

  it("pageImageUrl should append token as query param when present", () => {
    const url = pageImageUrl("doc-1", 3);
    expect(url).toContain("/api/knowledge/documents/doc-1/pages?page=3");
    expect(url).toContain("token=test-token");
  });

  it("pageImageUrl should not append token when absent", () => {
    mockAuthState.token = null;
    const url = pageImageUrl("doc-1", 3);
    expect(url).toBe("/api/knowledge/documents/doc-1/pages?page=3");
  });

  it("videoFrameUrl should append token as query param when present", () => {
    const url = videoFrameUrl("doc-2", "/frames/001.jpg");
    expect(url).toContain("/api/knowledge/documents/doc-2/frame?path=%2Fframes%2F001.jpg");
    expect(url).toContain("token=test-token");
  });
});
