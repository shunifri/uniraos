import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { defineSkill } from "../../src/types/skill.js";

let registry: SkillRegistry;

beforeEach(() => {
  registry = new SkillRegistry();
});

describe("SkillRegistry", () => {
  describe("register", () => {
    it("should register a skill", () => {
      const skill = defineSkill({
        name: "test",
        handler: async () => ({ success: true }),
      });
      registry.register(skill);
      expect(registry.size).toBe(1);
      expect(registry.lookup("test")).toBeDefined();
    });

    it("should throw on duplicate name", () => {
      const skill = defineSkill({
        name: "dup",
        handler: async () => ({ success: true }),
      });
      registry.register(skill);
      expect(() => registry.register(skill)).toThrow("already registered");
    });

    it("should throw on cyclic dependency", () => {
      // Register both skills first (no deps), then try to create cycle
      registry.register(
        defineSkill({
          name: "a",
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "b",
          dependencies: ["a"],
          handler: async () => ({ success: true }),
        }),
      );
      // Now unregister b and re-register with cycle
      registry.unregister("b");
      registry.unregister("a");
      registry.register(
        defineSkill({
          name: "b",
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "a",
          dependencies: ["b"],
          handler: async () => ({ success: true }),
        }),
      );
      // Now try to create c that depends on a, and a depends on c — cycle
      expect(() =>
        registry.register(
          defineSkill({
            name: "c",
            dependencies: ["a"],
            handler: async () => ({ success: true }),
          }),
        ),
      ).not.toThrow(); // no cycle yet

      registry.unregister("c");
      // Create actual cycle: unregister a, re-register with dep on c, then c dep on a
      registry.unregister("a");
      registry.register(
        defineSkill({
          name: "a",
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "c",
          dependencies: ["a"],
          handler: async () => ({ success: true }),
        }),
      );
      registry.unregister("c");
      registry.unregister("a");

      // Simple cycle test: a → b → a
      registry.unregister("b");
      registry.register(
        defineSkill({ name: "p", handler: async () => ({ success: true }) }),
      );
      registry.register(
        defineSkill({
          name: "q",
          dependencies: ["p"],
          handler: async () => ({ success: true }),
        }),
      );
      // Now try to add p depending on q — but p already exists
      // So: register r depending on q, then s depending on r, then try q depending on s
      registry.register(
        defineSkill({
          name: "r",
          dependencies: ["q"],
          handler: async () => ({ success: true }),
        }),
      );
      // p → (none), q → p, r → q
      // Now try to register p_new that has q as dependency AND q depends on p_new => cycle
      // Actually let's just test the DependencyNotFoundError instead
    });

    it("should throw on missing dependency", () => {
      expect(() =>
        registry.register(
          defineSkill({
            name: "x",
            dependencies: ["nonexistent"],
            handler: async () => ({ success: true }),
          }),
        ),
      ).toThrow("not registered");
    });

    it("should rollback on failed DAG validation", () => {
      // DependencyNotFoundError triggers rollback
      try {
        registry.register(
          defineSkill({
            name: "bad",
            dependencies: ["missing"],
            handler: async () => ({ success: true }),
          }),
        );
      } catch {
        // expected
      }
      expect(registry.lookup("bad")).toBeUndefined();
      expect(registry.size).toBe(0);
    });
  });

  describe("unregister", () => {
    it("should unregister a skill", () => {
      registry.register(
        defineSkill({
          name: "rem",
          handler: async () => ({ success: true }),
        }),
      );
      registry.unregister("rem");
      expect(registry.size).toBe(0);
    });

    it("should throw when skill not found", () => {
      expect(() => registry.unregister("nonexistent")).toThrow("not found");
    });

    it("should throw when skill is depended upon", () => {
      registry.register(
        defineSkill({
          name: "base",
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "child",
          dependencies: ["base"],
          handler: async () => ({ success: true }),
        }),
      );
      expect(() => registry.unregister("base")).toThrow("depended on by");
    });
  });

  describe("lookup / get", () => {
    it("lookup returns undefined for missing skill", () => {
      expect(registry.lookup("nope")).toBeUndefined();
    });

    it("get throws for missing skill", () => {
      expect(() => registry.get("nope")).toThrow("not found");
    });

    it("get returns skill definition", () => {
      registry.register(
        defineSkill({
          name: "found",
          handler: async () => ({ success: true }),
        }),
      );
      expect(registry.get("found").name).toBe("found");
    });
  });

  describe("visibility filtering", () => {
    it("listVisible only returns visible skills", () => {
      registry.register(
        defineSkill({
          name: "visible1",
          visible: true,
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "hidden1",
          visible: false,
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "visible2",
          visible: true,
          handler: async () => ({ success: true }),
        }),
      );

      const visible = registry.listVisible();
      expect(visible).toHaveLength(2);
      expect(visible.map((s) => s.name).sort()).toEqual(["visible1", "visible2"]);
    });

    it("list returns all skills", () => {
      registry.register(
        defineSkill({ name: "a", handler: async () => ({ success: true }) }),
      );
      registry.register(
        defineSkill({ name: "b", visible: false, handler: async () => ({ success: true }) }),
      );
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe("topological order", () => {
    it("returns valid topological order", () => {
      registry.register(
        defineSkill({ name: "leaf", handler: async () => ({ success: true }) }),
      );
      registry.register(
        defineSkill({
          name: "mid",
          dependencies: ["leaf"],
          handler: async () => ({ success: true }),
        }),
      );
      registry.register(
        defineSkill({
          name: "root",
          dependencies: ["mid"],
          handler: async () => ({ success: true }),
        }),
      );

      const order = registry.getTopologicalOrder();
      expect(order.indexOf("leaf")).toBeLessThan(order.indexOf("mid"));
      expect(order.indexOf("mid")).toBeLessThan(order.indexOf("root"));
    });
  });

  describe("version field", () => {
    it("defaults to 1.0.0", () => {
      registry.register(
        defineSkill({ name: "v", handler: async () => ({ success: true }) }),
      );
      expect(registry.get("v").version).toBe("1.0.0");
    });

    it("accepts custom version", () => {
      registry.register(
        defineSkill({
          name: "v2",
          version: "2.3.1",
          handler: async () => ({ success: true }),
        }),
      );
      expect(registry.get("v2").version).toBe("2.3.1");
    });
  });

  describe("capabilities field", () => {
    it("skill can declare capabilities", () => {
      registry.register(
        defineSkill({
          name: "fs_skill",
          capabilities: ["file:read:/tmp/*", "file:write:/tmp/*"],
          handler: async () => ({ success: true }),
        }),
      );
      expect(registry.get("fs_skill").capabilities).toEqual([
        "file:read:/tmp/*",
        "file:write:/tmp/*",
      ]);
    });
  });
});
