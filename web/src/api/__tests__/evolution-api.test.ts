import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getEvolutionControllerConfig,
  updateEvolutionControllerConfig,
  getPendingApprovals,
  approveEvolution,
  rejectEvolution,
  getLifecycle,
  searchMarketplace,
} from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Evolution API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getEvolutionControllerConfig should call GET /api/evolution/config", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ enabled: true }));
    await getEvolutionControllerConfig();
    expect(mockFetch).toHaveBeenCalledWith("/api/evolution/config", expect.any(Object));
  });

  it("updateEvolutionControllerConfig should call POST /api/evolution/config", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await updateEvolutionControllerConfig({ budget: 200 });
    expect(mockFetch).toHaveBeenCalledWith("/api/evolution/config", expect.objectContaining({ method: "POST", body: JSON.stringify({ budget: 200 }) }));
  });

  it("getPendingApprovals should call GET /api/evolution/approvals", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ approvals: [] }));
    await getPendingApprovals();
    expect(mockFetch).toHaveBeenCalledWith("/api/evolution/approvals", expect.any(Object));
  });

  it("approveEvolution should call POST /api/evolution/approvals/:id/approve", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await approveEvolution("app-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/evolution/approvals/app-1/approve", expect.objectContaining({ method: "POST" }));
  });

  it("rejectEvolution should call POST /api/evolution/approvals/:id/reject", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await rejectEvolution("app-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/evolution/approvals/app-1/reject", expect.objectContaining({ method: "POST" }));
  });

  it("getLifecycle should call GET /api/lifecycle", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ skills: [] }));
    await getLifecycle();
    expect(mockFetch).toHaveBeenCalledWith("/api/lifecycle", expect.any(Object));
  });

  it("searchMarketplace should call GET /api/marketplace with query", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ results: [] }));
    await searchMarketplace("email");
    expect(mockFetch).toHaveBeenCalledWith("/api/marketplace?q=email", expect.any(Object));
  });
});
