import { describe, it, expect, beforeEach } from "vitest";
import { EvolutionEngine } from "../../src/federation/evolution-engine.js";
import { EvolutionController } from "../../src/engine/evolution-controller.js";
import { SkillLifecycleManager } from "../../src/engine/skill-lifecycle.js";
import { SkillRegistry } from "../../src/registry/index.js";
import { MetricsCollector } from "../../src/engine/metrics.js";
import { defineSkill } from "../../src/types/index.js";

describe("Evolution Loop Integration", () => {
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let controller: EvolutionController;
  let lifecycle: SkillLifecycleManager;
  let engine: EvolutionEngine;

  beforeEach(() => {
    registry = new SkillRegistry();
    metrics = new MetricsCollector();
    controller = new EvolutionController();
    lifecycle = new SkillLifecycleManager(registry, metrics);

    engine = new EvolutionEngine({
      registry,
      metrics,
      evolutionController: controller,
      lifecycleManager: lifecycle,
      config: { autoExecute: true, skipApprovalRequired: true, maxActionsPerCycle: 10 },
    });
  });

  it("should detect bottleneck and suggest optimization", async () => {
    registry.register(defineSkill({
      name: "bad_skill",
      handler: async () => ({ success: false, error: new Error("fail") }),
    }));

    // Simulate poor metrics (30 calls, only 10 successful)
    for (let i = 0; i < 30; i++) {
      metrics.record("bad_skill", 100, i < 10, i >= 10 ? "Error" : undefined);
    }

    const result = await engine.runCycle();
    const optimizeActions = result.actions.filter(a => a.type === "optimize");
    expect(optimizeActions.length).toBeGreaterThan(0);
    expect(optimizeActions[0].skillName).toBe("bad_skill");
  });

  it("should retire inactive non-system skills via auto-execute", async () => {
    registry.register(defineSkill({
      name: "custom_unused_skill",
      handler: async () => ({ success: true }),
    }));

    // Simulate old usage (last called 60 days ago)
    // Access the private records map to inject old data
    const records = (metrics as any).records;
    records.set("custom_unused_skill", [{
      timestamp: Date.now() - 60 * 86400_000,
      durationMs: 100,
      success: true,
    }]);

    const result = await engine.runCycle();

    const retireActions = result.actions.filter(a => a.type === "retire");
    expect(retireActions.some(a => a.skillName === "custom_unused_skill")).toBe(true);

    // With autoExecute + RetireActionExecutor, it should have been executed
    const executed = result.executed.filter(e => e.action.skillName === "custom_unused_skill");
    expect(executed.length).toBeGreaterThan(0);
    expect(executed[0].result.success).toBe(true);
  });

  it("should respect evolution controller red lines", () => {
    // Core skills (stm_*, ltm_*, etc.) should be protected
    const check = controller.canGenerate("stm_read", "evolution-engine", []);
    expect(check.allowed).toBe(false);
  });

  it("should track cycle count and status", async () => {
    await engine.runCycle();
    await engine.runCycle();
    const status = engine.getStatus();
    expect(status.cycleCount).toBe(2);
    expect(status.strategies.length).toBeGreaterThanOrEqual(3);
    expect(status.executors.length).toBeGreaterThanOrEqual(1);
  });
});
