import { describe, it, expect, beforeEach, vi } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/wal-manager.js";
import { defineSkill, defineSystemSkill } from "../../src/types/skill.js";
import { createMetaSkills, createSkillFromApproval, resolveParams, injectCalculateContext } from "../../src/skills/meta-skills.js";
import { getCurrentUserId } from "../../src/user/request-context.js";
import { permissions } from "../../src/permissions/index.js";

vi.mock("../../src/user/request-context.js", () => ({
  requestContext: {
    run: vi.fn((store, callback) => callback()),
    getStore: vi.fn(() => ({ userId: "test_user", requestId: "req-1" })),
  },
  getCurrentUserId: vi.fn().mockReturnValue("test_user"),
}));

vi.mock("../../src/permissions/index.js", () => ({
  permissions: {
    hasSkillPermission: vi.fn().mockResolvedValue(true),
  },
}));

let registry: SkillRegistry;
let wal: WALManager;
let engine: ExecutionEngine;

beforeEach(() => {
  registry = new SkillRegistry();
  wal = new WALManager();
  engine = new ExecutionEngine(registry, wal, { maxDepth: 20, callBudget: 100 });

  // Register some basic skills for composition
  registry.register(
    defineSystemSkill({
      name: "double",
      description: "Doubles a number",
      handler: async (params) => ({ success: true, data: { value: (params.value as number) * 2 } }),
    }),
  );
  registry.register(
    defineSystemSkill({
      name: "add_one",
      description: "Adds one to a number",
      handler: async (params) => ({ success: true, data: { value: (params.value as number) + 1 } }),
    }),
  );
  registry.register(
    defineSystemSkill({
      name: "greet",
      description: "Greets a person",
      handler: async (params) => ({ success: true, data: { message: `Hello, ${params.name}!` } }),
    }),
  );
  registry.register(
    defineSystemSkill({
      name: "fail_skill",
      description: "Always fails",
      handler: async () => ({ success: false, error: new Error("Intentional failure") }),
    }),
  );
  registry.register(
    defineSystemSkill({
      name: "calculate",
      description: "Expression calculator",
      handler: async (params) => {
        const { expression, context } = params as { expression: string; context?: Record<string, unknown> };
        const { safeEvaluateExpression } = await import("../../src/utils/safe-expression.js");
        try {
          const result = safeEvaluateExpression(expression, context ?? {});
          return { success: true, data: { expression, result } };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
        }
      },
    }),
  );
});

describe("skill_compose", () => {
  it("should require name and steps", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_compose");
    const result = await skill.handler({ name: "", steps: [] }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("name 和 steps 参数必填");
  });

  it("should reject non-existent skills in steps", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_compose");
    const result = await skill.handler(
      {
        name: "test_compose",
        steps: [{ skill: "nonexistent", params: {} }],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Skill 不存在");
  });

  it("should reject duplicate skill names", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_compose");
    const result = await skill.handler(
      {
        name: "double",
        steps: [{ skill: "add_one", params: { value: 1 } }],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Skill 已存在");
  });

  it("should create and register a composed skill with direct registration", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_compose");
    const result = await skill.handler(
      {
        name: "double_then_add",
        description: "Double then add one",
        steps: [
          { skill: "double", params: { value: "$input.value" }, outputKey: "doubled" },
          { skill: "add_one", params: { value: "$steps.doubled.value" }, outputKey: "final" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(true);
    expect(result.data.status).toBeUndefined(); // direct registration, not pending
    expect(registry.get("double_then_add")).toBeDefined();

    // Execute the composed skill
    const composed = registry.get("double_then_add");
    const execResult = await composed.handler({ value: 5 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(execResult.success).toBe(true);
    expect(execResult.data.doubled).toEqual({ value: 10 });
    expect(execResult.data.final).toEqual({ value: 11 });
  });

  it("should support sequential execution with $input references", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "greet_and_double",
        steps: [
          { skill: "greet", params: { name: "$input.name" }, outputKey: "greeting" },
          { skill: "double", params: { value: "$input.value" }, outputKey: "doubled" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("greet_and_double");
    const result = await composed.handler({ name: "Bob", value: 7 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.greeting).toEqual({ message: "Hello, Bob!" });
    expect(result.data.doubled).toEqual({ value: 14 });
  });

  it("should stop sequential execution on step failure", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "fail_early",
        steps: [
          { skill: "double", params: { value: "$input.value" }, outputKey: "ok" },
          { skill: "fail_skill", params: {}, outputKey: "bad" },
          { skill: "add_one", params: { value: 1 }, outputKey: "skipped" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("fail_early");
    const result = await composed.handler({ value: 5 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(false);
    expect(result.data.ok).toEqual({ value: 10 });
    expect(result.data.bad).toBeUndefined();
    expect(result.data.skipped).toBeUndefined();
    expect(result.error?.message).toContain("fail_skill");
  });

  it("should support parallel execution", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "parallel_greet_double",
        mode: "parallel",
        steps: [
          { skill: "greet", params: { name: "$input.name" }, outputKey: "greeting" },
          { skill: "double", params: { value: "$input.value" }, outputKey: "doubled" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("parallel_greet_double");
    const result = await composed.handler({ name: "Alice", value: 3 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.greeting).toEqual({ message: "Hello, Alice!" });
    expect(result.data.doubled).toEqual({ value: 6 });
  });

  it("should auto-inject context for calculate steps", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "calc_composed",
        steps: [
          { skill: "double", params: { value: "$input.value" }, outputKey: "doubled" },
          { skill: "calculate", params: { expression: "doubled.value + 10" }, outputKey: "result" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("calc_composed");
    const result = await composed.handler({ value: 5 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.doubled).toEqual({ value: 10 });
    expect(result.data.result).toEqual({ expression: "doubled.value + 10", result: 20 });
  });

  it("should use default outputKey when not specified", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "default_keys",
        steps: [{ skill: "double", params: { value: "$input.value" } }],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("default_keys");
    const result = await composed.handler({ value: 4 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.double).toEqual({ value: 8 });
  });
});

describe("createSkillFromApproval (composed)", () => {
  it("should create and execute composed skill from approval", async () => {
    const approval = {
      name: "approval_composed",
      description: "Test composed skill from approval",
      code: JSON.stringify({
        metaType: "composed",
        name: "approval_composed",
        description: "[组合] Test",
        steps: [
          { skill: "double", params: { value: "$input.value" }, outputKey: "doubled" },
          { skill: "add_one", params: { value: "$steps.doubled.value" }, outputKey: "final" },
        ],
        mode: "sequential",
      }),
      capabilities: [],
      generatedBy: "test_user",
    };

    const skill = await createSkillFromApproval(approval, engine);
    expect(skill.name).toBe("approval_composed");

    const result = await skill.handler({ value: 3 }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.doubled).toEqual({ value: 6 });
    expect(result.data.final).toEqual({ value: 7 });
  });

  it("should support parallel mode from approval", async () => {
    const approval = {
      name: "approval_parallel",
      description: "Parallel composed skill",
      code: JSON.stringify({
        metaType: "composed",
        name: "approval_parallel",
        description: "[组合] Parallel",
        steps: [
          { skill: "greet", params: { name: "$input.name" }, outputKey: "greeting" },
          { skill: "double", params: { value: "$input.value" }, outputKey: "doubled" },
        ],
        mode: "parallel",
      }),
      capabilities: [],
      generatedBy: "test_user",
    };

    const skill = await createSkillFromApproval(approval, engine);
    const result = await skill.handler({ name: "Test", value: 5 }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.greeting).toEqual({ message: "Hello, Test!" });
    expect(result.data.doubled).toEqual({ value: 10 });
  });

  it("should throw on unknown metaType", async () => {
    const approval = {
      name: "bad_type",
      description: "Unknown type",
      code: JSON.stringify({ metaType: "unknown", name: "bad_type" }),
      capabilities: [],
      generatedBy: "test_user",
    };

    await expect(createSkillFromApproval(approval, engine)).rejects.toThrow("未知的 meta skill 类型");
  });
});

describe("skill_from_template", () => {
  it("should create transform skill from template", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_from_template");
    const result = await skill.handler(
      {
        name: "uppercase_transform",
        description: "Convert to uppercase",
        template: "transform",
        config: { inputField: "text", outputField: "result", expression: "text.toUpperCase()" },
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(true);
    expect(registry.get("uppercase_transform")).toBeDefined();
  });

  it("should reject unknown templates", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_from_template");
    const result = await skill.handler(
      {
        name: "bad_template",
        template: "nonexistent",
        config: {},
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(false);
  });
});

describe("skill_unregister", () => {
  it("should unregister a dynamic skill", async () => {
    createMetaSkills(registry, engine);
    registry.register(defineSkill({ name: "temp_skill", handler: async () => ({ success: true, data: {} }) }));

    const skill = registry.get("skill_unregister");
    const result = await skill.handler({ name: "temp_skill" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(registry.lookup("temp_skill")).toBeUndefined();
  });

  it("should fail to unregister non-existent skill", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_unregister");
    const result = await skill.handler({ name: "nonexistent" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(false);
  });
});

describe("skill_info", () => {
  it("should return skill info", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_info");
    const result = await skill.handler({ name: "double" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe("double");
  });

  it("should fail for non-existent skill", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_info");
    const result = await skill.handler({ name: "nonexistent" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(false);
  });
});

describe("skill_list_all", () => {
  it("should list all skills", async () => {
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_list_all");
    const result = await skill.handler({}, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.count).toBeGreaterThan(0);
    expect(Array.isArray(result.data.skills)).toBe(true);
  });
});

describe("skill_optimizer", () => {
  it("should analyze skill metrics", async () => {
    createMetaSkills(registry, engine);
    // Execute a skill first to generate metrics
    await engine.execute("double", { value: 5 });

    const skill = registry.get("skill_optimizer");
    const result = await skill.handler({ name: "double" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});


describe("skill_compose edge cases", () => {
  it("should reject without user context", async () => {
    vi.mocked(getCurrentUserId).mockReturnValueOnce("default");
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_compose");
    const result = await skill.handler(
      { name: "test", steps: [{ skill: "double", params: { value: 1 } }] },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("需要登录用户");
  });

  it("should reject when user lacks permission for a step skill", async () => {
    vi.mocked(permissions.hasSkillPermission).mockResolvedValueOnce(false);
    createMetaSkills(registry, engine);
    const skill = registry.get("skill_compose");
    const result = await skill.handler(
      { name: "test", steps: [{ skill: "double", params: { value: 1 } }] },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("无权执行");
  });

  it("should continue parallel execution when one step fails", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "parallel_partial_fail",
        mode: "parallel",
        steps: [
          { skill: "double", params: { value: "$input.value" }, outputKey: "ok" },
          { skill: "fail_skill", params: {}, outputKey: "bad" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("parallel_partial_fail");
    const result = await composed.handler({ value: 5 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    // Parallel mode does not short-circuit; both execute
    expect(result.data.ok).toEqual({ value: 10 });
    // fail_skill returns { success: false, error: ... } without data, so result.data.bad is undefined
    // but the composed skill itself returns success: true because parallel mode aggregates all results
    expect(result.success).toBe(true);
  });

  it("should handle composed skill with no outputKey using skill name as key", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "no_output_key",
        steps: [
          { skill: "double", params: { value: "$input.value" } },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("no_output_key");
    const result = await composed.handler({ value: 3 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.double).toEqual({ value: 6 });
  });

  it("should support calculate with multiple prior step references", async () => {
    createMetaSkills(registry, engine);
    const compose = registry.get("skill_compose");
    await compose.handler(
      {
        name: "multi_calc",
        steps: [
          { skill: "double", params: { value: "$input.a" }, outputKey: "doubled" },
          { skill: "add_one", params: { value: "$input.b" }, outputKey: "incremented" },
          { skill: "calculate", params: { expression: "doubled.value + incremented.value" }, outputKey: "sum" },
        ],
      },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    const composed = registry.get("multi_calc");
    const result = await composed.handler({ a: 5, b: 10 }, { traceId: "t2", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);
    expect(result.success).toBe(true);
    expect(result.data.sum).toEqual({ expression: "doubled.value + incremented.value", result: 21 });
  });
});
