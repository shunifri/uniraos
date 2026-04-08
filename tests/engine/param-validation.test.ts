import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { SkillRegistry } from "../../src/registry/index.js";
import { WALManager } from "../../src/wal/index.js";
import { defineSkill } from "../../src/types/index.js";

describe("ExecutionEngine Parameter Validation", () => {
  let engine: ExecutionEngine;
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
    const wal = new WALManager();
    engine = new ExecutionEngine(registry, wal);

    registry.register(defineSkill({
      name: "typed_skill",
      handler: async (params) => ({ success: true, data: params }),
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name" },
          count: { type: "number", description: "Count" },
        },
        required: ["name"],
      },
    }));

    registry.register(defineSkill({
      name: "untyped_skill",
      handler: async (params) => ({ success: true, data: params }),
    }));
  });

  it("should pass when required params are provided", async () => {
    const result = await engine.execute("typed_skill", { name: "test", count: 5 });
    expect(result.success).toBe(true);
  });

  it("should fail when required param is missing", async () => {
    await expect(engine.execute("typed_skill", { count: 5 }))
      .rejects.toThrow(/name/);
  });

  it("should skip validation for skills without paramSchema", async () => {
    const result = await engine.execute("untyped_skill", { anything: "goes" });
    expect(result.success).toBe(true);
  });
});
