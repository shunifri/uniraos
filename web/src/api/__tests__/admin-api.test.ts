import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getUsers, createUser, updateUser, deleteUser,
  getDepartments, createDept, deleteDept,
  getRoles, createRole, getResources,
} from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Admin API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getUsers should call GET /api/users", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ users: [] }));
    const result = await getUsers();
    expect(mockFetch).toHaveBeenCalledWith("/api/users", expect.any(Object));
    expect(result).toEqual({ users: [] });
  });

  it("createUser should call POST /api/users", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, user: { id: "1" } }));
    const payload = { username: "alice", password: "secret", displayName: "Alice" };
    const result = await createUser(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/users", expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }));
    expect(result).toEqual({ success: true, user: { id: "1" } });
  });

  it("updateUser should call PUT /api/users/:userId", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    const result = await updateUser("user-1", { displayName: "Bob" });
    expect(mockFetch).toHaveBeenCalledWith("/api/users/user-1", expect.objectContaining({ method: "PUT", body: JSON.stringify({ displayName: "Bob" }) }));
    expect(result).toEqual({ success: true });
  });

  it("deleteUser should call DELETE /api/users/:userId", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    const result = await deleteUser("user-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/users/user-1", expect.objectContaining({ method: "DELETE" }));
    expect(result).toEqual({ success: true });
  });

  it("getDepartments should call GET /api/departments", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ departments: [] }));
    await getDepartments();
    expect(mockFetch).toHaveBeenCalledWith("/api/departments", expect.any(Object));
  });

  it("createDept should call POST /api/departments", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await createDept({ name: "Engineering" });
    expect(mockFetch).toHaveBeenCalledWith("/api/departments", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Engineering" }) }));
  });

  it("deleteDept should call DELETE /api/departments/:deptId", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await deleteDept("dept-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/departments/dept-1", expect.objectContaining({ method: "DELETE" }));
  });

  it("getRoles should call GET /api/roles", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ roles: [] }));
    await getRoles();
    expect(mockFetch).toHaveBeenCalledWith("/api/roles", expect.any(Object));
  });

  it("createRole should call POST /api/roles", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, role: { id: "r1" } }));
    await createRole({ name: "editor" });
    expect(mockFetch).toHaveBeenCalledWith("/api/roles", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "editor" }) }));
  });

  it("getResources should call GET /api/resources", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ resources: [] }));
    await getResources();
    expect(mockFetch).toHaveBeenCalledWith("/api/resources", expect.any(Object));
  });
});
