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

describe("SAGA Compensation", () => {
  it("should call compensate handlers in reverse order on failure", async () => {
    const compensated: string[] = [];

    // step1: succeeds, has compensate
    registry.register(
      defineSkill({
        name: "step1_pre",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true, data: "step1_done" }),
        compensate: async (_params, _result) => {
          compensated.push("step1");
        },
      }),
    );

    // step2: always fails
    registry.register(
      defineSkill({
        name: "main_saga",
        dependencies: ["step1_pre"],
        handler: async () => {
          throw new Error("main failed");
        },
      }),
    );

    await expect(engine.execute("main_saga")).rejects.toThrow("main failed");

    // step1_pre's compensate should have been called
    expect(compensated).toEqual(["step1"]);
  });

  it("should compensate multiple steps in reverse order", async () => {
    const compensated: string[] = [];
    const executed: string[] = [];

    registry.register(
      defineSkill({
        name: "hookA",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => {
          executed.push("A");
          return { success: true, data: "A_done" };
        },
        compensate: async () => {
          compensated.push("A");
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "hookB",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => {
          executed.push("B");
          return { success: true, data: "B_done" };
        },
        compensate: async () => {
          compensated.push("B");
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "main_multi",
        dependencies: ["hookA", "hookB"],
        handler: async () => {
          throw new Error("main boom");
        },
      }),
    );

    await expect(engine.execute("main_multi")).rejects.toThrow("main boom");
    expect(executed).toEqual(["A", "B"]);
    expect(compensated).toEqual(["B", "A"]); // reverse order
  });

  it("should not compensate steps without compensate handler", async () => {
    const compensated: string[] = [];

    registry.register(
      defineSkill({
        name: "no_comp",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true }),
        // no compensate handler
      }),
    );

    registry.register(
      defineSkill({
        name: "with_comp",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true, data: "ok" }),
        compensate: async () => {
          compensated.push("with_comp");
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "fails",
        dependencies: ["no_comp", "with_comp"],
        handler: async () => {
          throw new Error("fail");
        },
      }),
    );

    await expect(engine.execute("fails")).rejects.toThrow("fail");
    expect(compensated).toEqual(["with_comp"]);
  });

  it("should handle compensation errors gracefully", async () => {
    registry.register(
      defineSkill({
        name: "bad_comp_pre",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => ({ success: true, data: "done" }),
        compensate: async () => {
          throw new Error("compensation failed");
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "bad_comp_main",
        dependencies: ["bad_comp_pre"],
        handler: async () => {
          throw new Error("main fail");
        },
      }),
    );

    // Should still throw the original error, not the compensation error
    await expect(engine.execute("bad_comp_main")).rejects.toThrow("main fail");
  });
});
