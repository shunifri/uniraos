import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { createDataSkills } from "../../src/skills/data-skills.js";

describe("ip_lookup skill", () => {
  let registry: SkillRegistry;

  beforeEach(async () => {
    registry = new SkillRegistry();
    await createDataSkills(registry);
  });

  it("should be registered", () => {
    const skill = registry.get("ip_lookup");
    expect(skill).toBeDefined();
    expect(skill.name).toBe("ip_lookup");
  });

  it("should return an IP address", async () => {
    const skill = registry.get("ip_lookup");
    const result = await skill.handler({}, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);

    if (result.success) {
      const data = result.data as any;
      expect(data.ip).toBeDefined();
      expect(typeof data.ip).toBe("string");
      // IPv4 format check
      expect(data.ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      expect(data.source).toBeDefined();
    } else {
      // Network may be unavailable in test environment
      expect(result.error).toBeDefined();
    }
  });
});

describe("geo_ip skill", () => {
  let registry: SkillRegistry;

  beforeEach(async () => {
    registry = new SkillRegistry();
    await createDataSkills(registry);
  });

  it("should be registered", () => {
    const skill = registry.get("geo_ip");
    expect(skill).toBeDefined();
    expect(skill.name).toBe("geo_ip");
  });

  it("should require ip parameter", async () => {
    const skill = registry.get("geo_ip");
    const result = await skill.handler({}, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain("ip");
  });

  it("should lookup Google DNS IP location", async () => {
    const skill = registry.get("geo_ip");
    const result = await skill.handler(
      { ip: "8.8.8.8" },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    if (result.success) {
      const data = result.data as any;
      expect(data.ip).toBe("8.8.8.8");
      expect(data.country).toBeDefined();
      expect(data.city).toBeDefined();
      expect(typeof data.lat).toBe("number");
      expect(typeof data.lon).toBe("number");
    } else {
      // Network may be unavailable
      expect(result.error).toBeDefined();
    }
  });

  it("should handle invalid IP gracefully", async () => {
    const skill = registry.get("geo_ip");
    const result = await skill.handler(
      { ip: "not-an-ip" },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    if (result.success) {
      // ip-api may return status: fail for invalid IP
      const data = result.data as any;
      expect(data.status).toBe("fail");
    } else {
      expect(result.error).toBeDefined();
    }
  });
});
