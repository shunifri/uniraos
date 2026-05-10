import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSkills, registerSkill, deleteSkill, executeSkill } from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: { getState: () => ({ token: "test-token", logout: vi.fn() }) },
}));

describe("Skills API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getSkills should call GET /api/skills", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse([{ name: "test_skill" }]));
    const result = await getSkills();
    expect(mockFetch).toHaveBeenCalledWith("/api/skills", expect.any(Object));
    expect(result).toEqual([{ name: "test_skill" }]);
  });

  it("registerSkill should call POST /api/skills", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, message: "Skill registered" }));
    const payload = { name: "new_skill", visible: true };
    const result = await registerSkill(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/skills",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
    expect(result).toEqual({ success: true, message: "Skill registered" });
  });

  it("deleteSkill should call DELETE /api/skills/:name", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    const result = await deleteSkill("old_skill");
    expect(mockFetch).toHaveBeenCalledWith("/api/skills/old_skill", expect.objectContaining({ method: "DELETE" }));
    expect(result).toEqual({ success: true });
  });

  it("executeSkill should call POST /api/execute with skillName", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: "result" }));
    const result = await executeSkill("skill_1", { input: "hello" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/execute",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ skillName: "skill_1", params: { input: "hello" } }) }),
    );
    expect(result).toEqual({ success: true, data: "result" });
  });
});
