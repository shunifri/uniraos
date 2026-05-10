import { describe, it, expect } from "vitest";
import { CapabilityChecker } from "../../src/engine/capability-checker.js";

describe("CapabilityChecker", () => {
  it("check passes when no capabilities required", () => {
    const checker = new CapabilityChecker();
    checker.setGrants(["file:read:*", "network:outbound:*"]);
    expect(checker.check([])).toEqual([]);
    expect(checker.check(undefined as unknown as string[])).toEqual([]);
  });

  it("check passes when grants cover requirements", () => {
    const checker = new CapabilityChecker();
    checker.setGrants(["file:read:*", "network:outbound:*"]);
    expect(checker.check(["file:read:/tmp/test.txt"])).toEqual([]);
    expect(checker.check(["network:outbound:api.example.com"])).toEqual([]);
  });

  it("check fails when grants insufficient", () => {
    const checker = new CapabilityChecker();
    checker.setGrants(["file:read:*"]);
    const violations = checker.check(["network:outbound:*"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].required).toBe("network:outbound:*");
    expect(violations[0].granted).toContain("file:read:*");
  });

  it("narrow restricts child capabilities to parent grants", () => {
    const checker = new CapabilityChecker();
    const narrowed = checker.narrow(["file:read:*", "network:outbound:*"], [
      "file:read:/tmp/*",
      "network:outbound:*",
      "db:query:users",
    ]);
    expect(narrowed).toEqual(["file:read:/tmp/*", "network:outbound:*"]);
  });

  it("backward compatibility: no grants configured = allow all", () => {
    const checker = new CapabilityChecker();
    // 不调用 setGrants，grants 为空数组
    expect(checker.check(["anything:goes:*"])).toEqual([]);
  });
});
