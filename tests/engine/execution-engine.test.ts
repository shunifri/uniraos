import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/wal-manager.js";
import { defineSkill, Autonomy } from "../../src/types/skill.js";

let registry: SkillRegistry;
let wal: WALManager;
let engine: ExecutionEngine;

beforeEach(() => {
  registry = new SkillRegistry();
  wal = new WALManager();
  engine = new ExecutionEngine(registry, wal, { maxDepth: 10, callBudget: 50 });
});

describe("ExecutionEngine", () => {
  it("should execute a simple skill", async () => {
    registry.register(
      defineSkill({
        name: "hello",
        handler: async () => ({ success: true, data: "world" }),
      }),
    );
    const result = await engine.execute("hello");
    expect(result.success).toBe(true);
    expect(result.data).toBe("world");
    expect(result.trace).toHaveLength(1);
  });

  it("should execute AUTO_PRE hooks before main skill", async () => {
    const order: string[] = [];

    registry.register(
      defineSkill({
        name: "pre_hook",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => {
          order.push("pre");
          return { success: true };
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "main_skill",
        dependencies: ["pre_hook"],
        handler: async () => {
          order.push("main");
          return { success: true };
        },
      }),
    );

    await engine.execute("main_skill");
    expect(order).toEqual(["pre", "main"]);
  });

  it("should execute AUTO_POST hooks after main skill", async () => {
    const order: string[] = [];

    registry.register(
      defineSkill({
        name: "post_hook",
        autonomy: Autonomy.AUTO_POST,
        visible: false,
        handler: async () => {
          order.push("post");
          return { success: true };
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "main_skill",
        dependencies: ["post_hook"],
        handler: async () => {
          order.push("main");
          return { success: true };
        },
      }),
    );

    await engine.execute("main_skill");
    expect(order).toEqual(["main", "post"]);
  });

  it("should enforce max depth", async () => {
    // maxDepth is 10, create a chain of 12 AUTO_PRE skills to exceed it
    const names = Array.from({ length: 13 }, (_, i) => `s${i}`);
    for (let i = 0; i < names.length; i++) {
      registry.register(
        defineSkill({
          name: names[i],
          dependencies: i > 0 ? [names[i - 1]] : [],
          autonomy: i > 0 ? Autonomy.AUTO_PRE : Autonomy.MANUAL,
          handler: async () => ({ success: true }),
        }),
      );
    }

    await expect(engine.execute(names[names.length - 1])).rejects.toThrow(
      "Max recursion depth",
    );
  });

  it("should enforce call budget", async () => {
    const smallEngine = new ExecutionEngine(registry, wal, {
      maxDepth: 100,
      callBudget: 3,
    });

    registry.register(
      defineSkill({
        name: "pre1",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true }),
      }),
    );
    registry.register(
      defineSkill({
        name: "pre2",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true }),
      }),
    );
    registry.register(
      defineSkill({
        name: "pre3",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true }),
      }),
    );
    registry.register(
      defineSkill({
        name: "target",
        dependencies: ["pre1", "pre2", "pre3"],
        handler: async () => ({ success: true }),
      }),
    );

    await expect(smallEngine.execute("target")).rejects.toThrow(
      "Call budget exhausted",
    );
  });

  it("should handle skill timeout", async () => {
    registry.register(
      defineSkill({
        name: "slow",
        timeout: 50,
        handler: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { success: true };
        },
      }),
    );

    await expect(engine.execute("slow")).rejects.toThrow("timed out");
  });

  it("should record WAL entries", async () => {
    registry.register(
      defineSkill({
        name: "tracked",
        handler: async () => ({ success: true, data: 42 }),
      }),
    );

    await engine.execute("tracked");
    const entries = wal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("completed");
    expect(entries[0].skillName).toBe("tracked");
  });

  it("should record trace with timing", async () => {
    registry.register(
      defineSkill({
        name: "timed",
        handler: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { success: true };
        },
      }),
    );

    const result = await engine.execute("timed");
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].endTime - result.trace[0].startTime).toBeGreaterThanOrEqual(5);
  });
});
