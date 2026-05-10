import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSTM, getLTM, getArchives, getSchedule, startSchedule, stopSchedule } from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Memory API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getSTM should call GET /api/memory/stm", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ entries: [] }));
    await getSTM();
    expect(mockFetch).toHaveBeenCalledWith("/api/memory/stm", expect.any(Object));
  });

  it("getLTM should call GET /api/memory/ltm", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ entries: [] }));
    await getLTM();
    expect(mockFetch).toHaveBeenCalledWith("/api/memory/ltm", expect.any(Object));
  });

  it("getArchives should call GET /api/memory/archives", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ archives: [] }));
    await getArchives();
    expect(mockFetch).toHaveBeenCalledWith("/api/memory/archives", expect.any(Object));
  });

  it("getSchedule should call GET /api/memory/schedule", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ jobs: [] }));
    await getSchedule();
    expect(mockFetch).toHaveBeenCalledWith("/api/memory/schedule", expect.any(Object));
  });

  it("startSchedule should call POST /api/memory/schedule with action=start", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ started: true }));
    await startSchedule();
    expect(mockFetch).toHaveBeenCalledWith("/api/memory/schedule", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "start" }) }));
  });

  it("stopSchedule should call POST /api/memory/schedule with action=stop", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ stopped: true }));
    await stopSchedule();
    expect(mockFetch).toHaveBeenCalledWith("/api/memory/schedule", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "stop" }) }));
  });
});
