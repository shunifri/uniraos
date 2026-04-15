import { describe, it, expect } from "vitest";
import { permissions } from "../../src/permissions/index.js";
import { SkillRegistry } from "../../src/registry/skill-registry.js";

describe("Permissions API (Unit Tests)", () => {
  describe("Constants Exports", () => {
    it("should expose constants", () => {
      expect(permissions.constants).toBeDefined();
      expect(permissions.constants.API).toBeDefined();
      expect(permissions.constants.MENU).toBeDefined();
      expect(permissions.constants.ROLES).toBeDefined();
    });

    it("should expose helpers", () => {
      expect(permissions.helpers).toBeDefined();
    });

    it("should expose middleware factory", () => {
      expect(typeof permissions.createMiddleware).toBe("function");
    });

    it("should expose checker factory", () => {
      expect(typeof permissions.checker).toBe("function");
    });
  });

  describe("Permission Checker", () => {
    it("should create permission checker", () => {
      const checker = permissions.checker(["read", "write"]);
      expect(checker).toBeDefined();
    });

    it("should check exact permissions", () => {
      const checker = permissions.checker(["read", "write"]);
      expect(checker.has("read")).toBe(true);
      expect(checker.has("write")).toBe(true);
      expect(checker.has("execute")).toBe(false);
    });

    it("should check hasAny", () => {
      const checker = permissions.checker(["read", "write"]);
      expect(checker.hasAny(["read", "nonexistent"])).toBe(true);
      expect(checker.hasAny(["nonexistent1", "nonexistent2"])).toBe(false);
    });

    it("should check hasAll", () => {
      const checker = permissions.checker(["read", "write", "execute"]);
      expect(checker.hasAll(["read", "write"])).toBe(true);
      expect(checker.hasAll(["read", "nonexistent"])).toBe(false);
    });

    it("should support wildcard (*) permission", () => {
      const checker = permissions.checker(["*"]);
      expect(checker.has("read")).toBe(true);
      expect(checker.has("write")).toBe(true);
      expect(checker.has("execute")).toBe(true);
    });

    it("should support resource wildcard (skill:*)", () => {
      const checker = permissions.checker(["skill:*"]);
      expect(checker.has("skill:test.execute")).toBe(true);
      expect(checker.has("skill:another.read")).toBe(true);
      expect(checker.has("config.read")).toBe(false);
    });

    it("should support action wildcard (skill:*.execute)", () => {
      const checker = permissions.checker(["skill:*.execute"]);
      expect(checker.has("skill:test.execute")).toBe(true);
      expect(checker.has("skill:another.execute")).toBe(true);
      expect(checker.has("skill:test.read")).toBe(false);
    });

    it("should handle no permissions", () => {
      const checker = permissions.checker([]);
      expect(checker.has("read")).toBe(false);
      expect(checker.hasAny(["read"])).toBe(false);
      expect(checker.hasAll(["read"])).toBe(false);
    });
  });
});
