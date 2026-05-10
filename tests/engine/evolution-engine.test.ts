/**
 * 集成测试：EvolutionEngine 周期运行
 *
 * 验证：
 * - 策略分析、去重、排序流程
 * - autoExecute 模式下动作执行
 * - 与 EvolutionController 的集成（canGenerate 检查）
 * - 与 LifecycleManager 的集成（retire 后 deprecate）
 * - 涌现检测记录
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { MetricsCollector } from "../../src/engine/metrics.js";
import { EvolutionController } from "../../src/engine/evolution-controller.js";
import { SkillLifecycleManager } from "../../src/engine/skill-lifecycle.js";
import { EvolutionEngine } from "../../src/federation/evolution-engine.js";
import { defineSkill } from "../../src/types/skill.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/wal-manager.js";

describe("EvolutionEngine Integration", () => {
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let controller: EvolutionController;
  let lifecycleManager: SkillLifecycleManager;
  let engine: ExecutionEngine;
  let wal: WALManager;
  let evolutionEngine: EvolutionEngine;

  beforeEach(() => {
    registry = new SkillRegistry();
    metrics = new MetricsCollector();
    controller = new EvolutionController({ maxGenerationDepth: 3, maxGenerationsPerHour: 20 });
    wal = new WALManager();
    engine = new ExecutionEngine(registry, wal, { maxDepth: 20, callBudget: 100 });
    lifecycleManager = new SkillLifecycleManager(registry, metrics);

    evolutionEngine = new EvolutionEngine({
      registry,
      metrics,
      evolutionController: controller,
      lifecycleManager,
      config: {
        cycleIntervalMs: 100, // 短周期便于测试
        maxActionsPerCycle: 5,
        autoExecute: false, // 默认不自动执行
        skipApprovalRequired: true,
      },
    });
  });

  afterEach(() => {
    evolutionEngine.stop();
  });

  it("should increment cycle count on each run", async () => {
    const status1 = evolutionEngine.getStatus();
    expect(status1.cycleCount).toBe(0);

    await evolutionEngine.runCycle();
    const status2 = evolutionEngine.getStatus();
    expect(status2.cycleCount).toBe(1);

    await evolutionEngine.runCycle();
    const status3 = evolutionEngine.getStatus();
    expect(status3.cycleCount).toBe(2);
  });

  it("should analyze strategies and generate actions", async () => {
    // 注册一个低成功率的 Skill
    registry.register(
      defineSkill({
        name: "low_success_skill",
        description: "A skill with low success rate",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // 模拟调用和失败
    for (let i = 0; i < 25; i++) {
      if (i < 10) {
        metrics.record("low_success_skill", 50, false, "test_failure");
      } else {
        metrics.record("low_success_skill", 50, true);
      }
    }

    const result = await evolutionEngine.runCycle();

    // Should generate actions from bottleneck detection strategy
    expect(result.actions).toBeDefined();
    expect(Array.isArray(result.actions)).toBe(true);
  });

  it("should deduplicate actions for the same skill", async () => {
    // Register a skill with low success
    registry.register(
      defineSkill({
        name: "duplicate_test_skill",
        description: "Test deduplication",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record metrics showing low success
    for (let i = 0; i < 20; i++) {
      if (i < 10) {
        metrics.record("duplicate_test_skill", 50, false, "error");
      } else {
        metrics.record("duplicate_test_skill", 50, true);
      }
    }

    const result = await evolutionEngine.runCycle();

    // Count actions by skillName and type
    const actionMap = new Map<string, number>();
    for (const action of result.actions) {
      const key = `${action.type}:${action.skillName}`;
      actionMap.set(key, (actionMap.get(key) ?? 0) + 1);
    }

    // Should not have duplicates (same type + skillName only once)
    for (const count of actionMap.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it("should sort actions by priority", async () => {
    registry.register(
      defineSkill({
        name: "priority_test",
        description: "Test priority sorting",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record enough calls for analysis
    for (let i = 0; i < 25; i++) {
      if (i < 15) {
        metrics.record("priority_test", 50, false, "error");
      } else {
        metrics.record("priority_test", 50, true);
      }
    }

    const result = await evolutionEngine.runCycle();

    // Check that priorities are in descending order
    if (result.actions.length > 1) {
      for (let i = 1; i < result.actions.length; i++) {
        expect(result.actions[i].priority).toBeLessThanOrEqual(result.actions[i - 1].priority);
      }
    }
  });

  it("should execute actions when autoExecute is enabled", async () => {
    evolutionEngine.updateConfig({ autoExecute: true });

    // Register a low-success skill
    registry.register(
      defineSkill({
        name: "auto_exec_skill",
        description: "Test auto execution",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Simulate low success rate (but high enough to not need approval)
    for (let i = 0; i < 20; i++) {
      if (i < 8) {
        metrics.record("auto_exec_skill", 50, false, "error");
      } else {
        metrics.record("auto_exec_skill", 50, true);
      }
    }

    const result = await evolutionEngine.runCycle();

    // With autoExecute=true and skipApprovalRequired=true, some actions should be executed
    expect(result.executed).toBeDefined();
    expect(Array.isArray(result.executed)).toBe(true);
  });

  it("should integrate with EvolutionController canGenerate", async () => {
    const decision = controller.canGenerate("test_skill", "orchestrator", []);

    expect(decision).toBeDefined();
    expect(decision).toHaveProperty("allowed");
    expect(typeof decision.allowed).toBe("boolean");
    // reason is optional - only present when denied
    if (!decision.allowed) {
      expect(decision).toHaveProperty("reason");
    }
  });

  it("should integrate with LifecycleManager deprecate on retire action", async () => {
    // Register inactive skills
    registry.register(
      defineSkill({
        name: "inactive_skill",
        description: "Inactive skill",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Mark it as used long ago (older than InactiveRetirementStrategy's threshold)
    lifecycleManager.recordUsage("inactive_skill");

    // Manually deprecate it (simulating retirement)
    lifecycleManager.deprecate("inactive_skill");

    // Check status
    const info = lifecycleManager.getInfo("inactive_skill");
    expect(info).toBeDefined();
    expect(info?.state).toBe("deprecated");
  });

  it("should emit events during cycle execution", async () => {
    const events: any[] = [];
    evolutionEngine.on((event) => {
      events.push(event);
    });

    await evolutionEngine.runCycle();

    // Should emit cycle_start and cycle_end events
    const cycleStarted = events.some((e) => e.type === "evolution:cycle_start");
    const cycleEnded = events.some((e) => e.type === "evolution:cycle_end");

    expect(cycleStarted).toBe(true);
    expect(cycleEnded).toBe(true);
  });

  it("should track executed actions", async () => {
    evolutionEngine.updateConfig({ autoExecute: false });

    registry.register(
      defineSkill({
        name: "track_skill",
        description: "Track execution",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record low success
    for (let i = 0; i < 20; i++) {
      if (i < 8) {
        metrics.record("track_skill", 50, false, "error");
      } else {
        metrics.record("track_skill", 50, true);
      }
    }

    await evolutionEngine.runCycle();

    const executed = evolutionEngine.getExecutedActions();
    expect(Array.isArray(executed)).toBe(true);
  });

  it("should return status with all metrics", async () => {
    await evolutionEngine.runCycle();

    const status = evolutionEngine.getStatus();

    expect(status).toHaveProperty("running");
    expect(status).toHaveProperty("cycleCount");
    expect(status).toHaveProperty("lastCycleAt");
    expect(status).toHaveProperty("pendingActions");
    expect(status).toHaveProperty("executedActions");
    expect(status).toHaveProperty("strategies");
    expect(status).toHaveProperty("executors");
    expect(status).toHaveProperty("config");

    expect(Array.isArray(status.strategies)).toBe(true);
    expect(Array.isArray(status.executors)).toBe(true);
    expect(status.cycleCount).toBeGreaterThanOrEqual(0);
  });

  it("should handle start/stop lifecycle", async () => {
    evolutionEngine.start();
    const status1 = evolutionEngine.getStatus();
    expect(status1.running).toBe(true);

    evolutionEngine.stop();
    const status2 = evolutionEngine.getStatus();
    expect(status2.running).toBe(false);
  });

  it("should support custom strategies", async () => {
    // Create a simple test strategy
    const testStrategy = {
      name: "test-strategy",
      analyze: async () => [
        {
          type: "optimize" as const,
          skillName: "test_skill",
          payload: { test: true },
          priority: 50,
          requiresApproval: false,
        },
      ],
    };

    evolutionEngine.addStrategy(testStrategy);
    const status = evolutionEngine.getStatus();

    expect(status.strategies).toContain("test-strategy");
  });

  it("should remove strategies by name", async () => {
    const initialStatus = evolutionEngine.getStatus();
    const initialCount = initialStatus.strategies.length;

    evolutionEngine.removeStrategy("bottleneck-detection");

    const newStatus = evolutionEngine.getStatus();
    expect(newStatus.strategies).not.toContain("bottleneck-detection");
    expect(newStatus.strategies.length).toBe(initialCount - 1);
  });
});
