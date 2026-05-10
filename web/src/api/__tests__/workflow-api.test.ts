import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getWorkflowTasks, getWorkflowTaskForm, completeWorkflowTask,
  getWorkflowDefinition, createWorkflowDefinition, updateWorkflowDefinition,
  validateWorkflowDefinition, testWorkflowDefinition,
} from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Workflow API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getWorkflowTasks should call GET /api/workflow/tasks with query params", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: [], pagination: { total: 0 } }));
    const result = await getWorkflowTasks({ page: 2, pageSize: 10, status: "pending" });
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/tasks?page=2&pageSize=10", expect.any(Object));
    expect(result).toEqual({ success: true, data: [], pagination: { total: 0 } });
  });

  it("getWorkflowTasks should use defaults when no params", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: [], pagination: { total: 0 } }));
    await getWorkflowTasks();
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/tasks?page=1&pageSize=20", expect.any(Object));
  });

  it("getWorkflowTaskForm should call GET /api/workflow/tasks/:taskId/form", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { fields: [] } }));
    const result = await getWorkflowTaskForm(42);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/tasks/42/form", expect.any(Object));
    expect(result).toEqual({ success: true, data: { fields: [] } });
  });

  it("completeWorkflowTask should call POST /api/workflow/tasks/:taskId/complete", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: {} }));
    const body = { action: "approve", comment: "LGTM" };
    const result = await completeWorkflowTask(42, body);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/tasks/42/complete", expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
    expect(result).toEqual({ success: true, data: {} });
  });

  it("getWorkflowDefinition should call GET /api/workflow/definitions/:key", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { key: "wf-1" } }));
    const result = await getWorkflowDefinition("wf-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/definitions/wf-1", expect.any(Object));
    expect(result).toEqual({ success: true, data: { key: "wf-1" } });
  });

  it("createWorkflowDefinition should call POST /api/workflow/definitions", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { key: "wf-new" } }));
    const payload = { key: "wf-new", name: "New Workflow" };
    const result = await createWorkflowDefinition(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/definitions", expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }));
    expect(result).toEqual({ success: true, data: { key: "wf-new" } });
  });

  it("updateWorkflowDefinition should call PUT /api/workflow/definitions/:key", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: {} }));
    const payload = { name: "Updated" };
    const result = await updateWorkflowDefinition("wf-1", payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/definitions/wf-1", expect.objectContaining({ method: "PUT", body: JSON.stringify(payload) }));
    expect(result).toEqual({ success: true, data: {} });
  });

  it("validateWorkflowDefinition should call POST /api/workflow/definitions/:key/validate", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: { valid: true, errors: [] } }));
    const result = await validateWorkflowDefinition("wf-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/definitions/wf-1/validate", expect.objectContaining({ method: "POST" }));
    expect(result).toEqual({ success: true, data: { valid: true, errors: [] } });
  });

  it("testWorkflowDefinition should call POST /api/workflow/definitions/:key/test", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: {} }));
    const result = await testWorkflowDefinition("wf-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/workflow/definitions/wf-1/test", expect.objectContaining({ method: "POST" }));
    expect(result).toEqual({ success: true, data: {} });
  });
});
