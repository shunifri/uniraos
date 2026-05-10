import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listConnections, getConnection, createConnection,
  updateConnection, deleteConnection, testConnection,
} from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Connections API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("listConnections should call GET /api/connections without type", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: [] }));
    const result = await listConnections();
    expect(mockFetch).toHaveBeenCalledWith("/api/connections", expect.any(Object));
    expect(result).toEqual({ success: true, data: [] });
  });

  it("listConnections should append type query when provided", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: [] }));
    await listConnections("mysql");
    expect(mockFetch).toHaveBeenCalledWith("/api/connections?type=mysql", expect.any(Object));
  });

  it("getConnection should call GET /api/connections/:id", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { id: 1, name: "DB" } }));
    const result = await getConnection(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/connections/1", expect.any(Object));
    expect(result).toEqual({ success: true, data: { id: 1, name: "DB" } });
  });

  it("createConnection should call POST /api/connections", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { id: 2 } }));
    const body = { name: "Redis", type: "redis", config: { host: "localhost" } };
    const result = await createConnection(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/connections", expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
    expect(result).toEqual({ success: true, data: { id: 2 } });
  });

  it("updateConnection should call PUT /api/connections/:id", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { id: 1 } }));
    const body = { name: "Updated" };
    const result = await updateConnection(1, body);
    expect(mockFetch).toHaveBeenCalledWith("/api/connections/1", expect.objectContaining({ method: "PUT", body: JSON.stringify(body) }));
    expect(result).toEqual({ success: true, data: { id: 1 } });
  });

  it("deleteConnection should call DELETE /api/connections/:id", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    const result = await deleteConnection(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/connections/1", expect.objectContaining({ method: "DELETE" }));
    expect(result).toEqual({ success: true });
  });

  it("testConnection should call POST /api/connections/:id/test", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { success: true, message: "OK" } }));
    const result = await testConnection(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/connections/1/test", expect.objectContaining({ method: "POST" }));
    expect(result).toEqual({ success: true, data: { success: true, message: "OK" } });
  });
});
