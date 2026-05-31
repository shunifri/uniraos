import { describe, it, expect, vi } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/wal-manager.js";
import { defineSystemSkill } from "../../src/types/skill.js";
import { createPlanningSkill } from "../../src/skills/planning-skill.js";
import { requestContext } from "../../src/user/request-context.js";

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

function createMockProvider(planJson: object) {
  return {
    chat: vi.fn().mockResolvedValue({ content: JSON.stringify(planJson) }),
  };
}

describe("planning-skill", () => {
  it("should resolve $steps references between steps", async () => {
    const registry = new SkillRegistry();
    const wal = new WALManager();
    const engine = new ExecutionEngine(registry, wal, { maxDepth: 20, callBudget: 100 });

    registry.register(
      defineSystemSkill({
        name: "get_temp",
        description: "Get temperature",
        handler: async () => ({ success: true, data: { temp: 30 } }),
      }),
    );
    registry.register(
      defineSystemSkill({
        name: "weather_advice",
        description: "Weather advice",
        handler: async (params) => ({
          success: true,
          data: { advice: `Temp ${params.temp}, weather ${params.weather}` },
        }),
      }),
    );

    const provider = createMockProvider({
      steps: [
        { skill: "get_temp", params: {}, description: "Get temp" },
        { skill: "weather_advice", params: { temp: "$steps.get_temp.temp", weather: "sunny" }, description: "Advice" },
      ],
    });

    createPlanningSkill(registry, engine, () => provider as any);
    const skill = registry.get("plan_and_execute");
    const result = await skill.handler({ task: "test" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);

    expect(result.success).toBe(true);
    expect(result.data.results[0].success).toBe(true);
    expect(result.data.results[1].success).toBe(true);
    expect(result.data.results[1].data).toEqual({ advice: "Temp 30, weather sunny" });
  });

  it("should auto-inject context for calculate steps", async () => {
    const registry = new SkillRegistry();
    const wal = new WALManager();
    const engine = new ExecutionEngine(registry, wal, { maxDepth: 20, callBudget: 100 });

    registry.register(
      defineSystemSkill({
        name: "get_num",
        description: "Get number",
        handler: async () => ({ success: true, data: { value: 10 } }),
      }),
    );
    registry.register(
      defineSystemSkill({
        name: "calculate",
        description: "Calculator",
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

    const provider = createMockProvider({
      steps: [
        { skill: "get_num", params: {}, description: "Get number" },
        { skill: "calculate", params: { expression: "get_num.value + 5" }, description: "Calc" },
      ],
    });

    createPlanningSkill(registry, engine, () => provider as any);
    const skill = registry.get("plan_and_execute");
    const result = await skill.handler({ task: "test" }, { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any);

    expect(result.success).toBe(true);
    expect(result.data.results[1].data).toEqual({ expression: "get_num.value + 5", result: 15 });
  });

  it("should make $input available to calculate via context", async () => {
    const registry = new SkillRegistry();
    const wal = new WALManager();
    const engine = new ExecutionEngine(registry, wal, { maxDepth: 20, callBudget: 100 });

    registry.register(
      defineSystemSkill({
        name: "calculate",
        description: "Calculator",
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

    const provider = createMockProvider({
      steps: [
        { skill: "calculate", params: { expression: "input.base * 2" }, description: "Calc" },
      ],
    });

    createPlanningSkill(registry, engine, () => provider as any);
    const skill = registry.get("plan_and_execute");
    const result = await skill.handler(
      { task: "test", base: 7 },
      { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any,
    );

    expect(result.success).toBe(true);
    expect(result.data.results[0].data).toEqual({ expression: "input.base * 2", result: 14 });
  });
});
