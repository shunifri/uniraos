import { describe, it, expect, vi } from "vitest";
import { SkillMarketplace } from "../../src/skills/skill-marketplace.js";
import type { SkillRegistry } from "../../src/registry/index.js";
import { createHash } from "crypto";

describe("SkillMarketplace checksum (P2)", () => {
  const mockRegistry = {
    register: vi.fn(),
    lookup: vi.fn().mockReturnValue(null),
  } as unknown as SkillRegistry;

  it("should import skill with valid checksum", () => {
    const marketplace = new SkillMarketplace(mockRegistry);
    const handlerCode = "return { success: true, data: 42 };";
    const checksum = createHash("sha256")
      .update(JSON.stringify({ name: "test-skill", code: handlerCode }))
      .digest("hex");

    const result = marketplace.importSkill({
      formatVersion: "1.0",
      name: "test-skill",
      version: "1.0.0",
      description: "Test",
      capabilities: [],
      dependencies: [],
      handlerCode,
      visible: true,
      timeout: 30000,
      retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
      exportedAt: Date.now(),
      checksum,
    });

    expect(result.success).toBe(true);
  });

  it("should reject skill with invalid checksum", () => {
    const marketplace = new SkillMarketplace(mockRegistry);
    const handlerCode = "return { success: true, data: 42 };";

    const result = marketplace.importSkill({
      formatVersion: "1.0",
      name: "test-skill",
      version: "1.0.0",
      description: "Test",
      capabilities: [],
      dependencies: [],
      handlerCode,
      visible: true,
      timeout: 30000,
      retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
      exportedAt: Date.now(),
      checksum: "invalid",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("校验和不匹配");
  });

  it("should reject skill without checksum in production", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const marketplace = new SkillMarketplace(mockRegistry);
    const handlerCode = "return { success: true, data: 42 };";

    const result = marketplace.importSkill({
      formatVersion: "1.0",
      name: "test-skill",
      version: "1.0.0",
      description: "Test",
      capabilities: [],
      dependencies: [],
      handlerCode,
      visible: true,
      timeout: 30000,
      retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
      exportedAt: Date.now(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("生产环境禁止导入无校验和");

    process.env.NODE_ENV = originalNodeEnv;
  });
});
