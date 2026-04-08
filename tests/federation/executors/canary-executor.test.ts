import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanaryActionExecutor } from "../../../src/federation/executors/canary-executor.js";
import type { SkillLifecycleManager } from "../../../src/engine/skill-lifecycle.js";
import type { SkillRegistry } from "../../../src/registry/index.js";
import type { MetricsCollector } from "../../../src/engine/metrics.js";
import type { EvolutionAction } from "../../../src/federation/types.js";

function makeAction(overrides: Partial<EvolutionAction> = {}): EvolutionAction {
  return {
    type: "canary",
    skillName: "my_skill",
    payload: {},
    priority: 40,
    requiresApproval: false,
    ...overrides,
  };
}

describe("CanaryActionExecutor", () => {
  let lifecycle: SkillLifecycleManager;
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let executor: CanaryActionExecutor;

  beforeEach(() => {
    lifecycle = {
      evaluateCanary: vi.fn(),
      promoteCanary: vi.fn(),
      rollbackCanary: vi.fn(),
      startCanary: vi.fn(),
    } as unknown as SkillLifecycleManager;

    registry = {} as unknown as SkillRegistry;
    metrics = {} as unknown as MetricsCollector;

    executor = new CanaryActionExecutor(lifecycle);
  });

  it("has correct actionType", () => {
    expect(executor.actionType).toBe("canary");
  });

  it("promotes canary when evaluation is 'promote'", async () => {
    (lifecycle.evaluateCanary as ReturnType<typeof vi.fn>).mockReturnValue("promote");

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(lifecycle.promoteCanary).toHaveBeenCalledWith("my_skill");
    expect(lifecycle.rollbackCanary).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain("promoted");
  });

  it("rolls back canary when evaluation is 'rollback'", async () => {
    (lifecycle.evaluateCanary as ReturnType<typeof vi.fn>).mockReturnValue("rollback");

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(lifecycle.rollbackCanary).toHaveBeenCalledWith("my_skill");
    expect(lifecycle.promoteCanary).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain("rolled back");
  });

  it("continues without action when evaluation is 'continue'", async () => {
    (lifecycle.evaluateCanary as ReturnType<typeof vi.fn>).mockReturnValue("continue");

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(lifecycle.promoteCanary).not.toHaveBeenCalled();
    expect(lifecycle.rollbackCanary).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain("continuing");
  });

  it("returns failure when evaluation is 'not_canary'", async () => {
    (lifecycle.evaluateCanary as ReturnType<typeof vi.fn>).mockReturnValue("not_canary");

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(lifecycle.promoteCanary).not.toHaveBeenCalled();
    expect(lifecycle.rollbackCanary).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("not in canary");
  });

  it("passes the correct skillName to evaluateCanary", async () => {
    (lifecycle.evaluateCanary as ReturnType<typeof vi.fn>).mockReturnValue("continue");

    await executor.execute(makeAction({ skillName: "another_skill" }), { registry, metrics });

    expect(lifecycle.evaluateCanary).toHaveBeenCalledWith("another_skill");
  });

  it("includes skill name in all result messages", async () => {
    const skillName = "target_skill";

    for (const evaluation of ["promote", "rollback", "continue", "not_canary"] as const) {
      (lifecycle.evaluateCanary as ReturnType<typeof vi.fn>).mockReturnValue(evaluation);
      const result = await executor.execute(makeAction({ skillName }), { registry, metrics });
      expect(result.message).toContain(skillName);
    }
  });
});
