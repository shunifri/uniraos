import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFederationStatus } from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Federation API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getFederationStatus should call GET /api/federation/status", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ peers: 3, active: true }));
    const result = await getFederationStatus();
    expect(mockFetch).toHaveBeenCalledWith("/api/federation/status", expect.any(Object));
    expect(result).toEqual({ peers: 3, active: true });
  });
});
