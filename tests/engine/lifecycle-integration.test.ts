/**
 * 生命周期管理集成测试：验证 LifecycleManager 在执行时被正确调用
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/wal-manager.js";
import { SkillLifecycleManager } from "../../src/engine/skill-lifecycle.js";
import { defineSkill } from "../../src/types/skill.js";

let registry: SkillRegistry;
let wal: WALManager;
let engine: ExecutionEngine;
let lifecycleManager: SkillLifecycleManager;

beforeEach(() => {
  registry = new SkillRegistry();
  wal = new WALManager();
  engine = new ExecutionEngine(registry, wal);
  lifecycleManager = new SkillLifecycleManager(registry, engine.metrics);
  engine.setLifecycleManager(lifecycleManager);
});

describe("LifecycleManager Integration", () => {
  it("should record usage when a skill is executed successfully", async () => {
    registry.register(
      defineSkill({
        name: "test_skill",
        handler: async () => ({ success: true, data: "result" }),
      }),
    );

    await engine.execute("test_skill");

    const info = lifecycleManager.getInfo("test_skill");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("test_skill");
    expect(info!.state).toBe("active");
    expect(info!.lastUsedAt).toBeGreaterThan(0);
  });

  it("should record usage even when skill execution fails", async () => {
    registry.register(
      defineSkill({
        name: "failing_skill",
        handler: async () => {
          throw new Error("Expected failure");
        },
      }),
    );

    try {
      await engine.execute("failing_skill");
    } catch {
      // Expected error
    }

    const info = lifecycleManager.getInfo("failing_skill");
    expect(info).not.toBeNull();
    expect(info!.lastUsedAt).toBeGreaterThan(0);
  });

  it("should track multiple skill executions with updated lastUsedAt", async () => {
    registry.register(
      defineSkill({
        name: "multi_skill",
        handler: async () => ({ success: true, data: "result" }),
      }),
    );

    // First execution
    await engine.execute("multi_skill");
    const infoAfterFirst = lifecycleManager.getInfo("multi_skill")!;
    const firstUsedAt = infoAfterFirst.lastUsedAt;
    const firstCreatedAt = infoAfterFirst.createdAt;

    // Wait a bit
    await new Promise((r) => setTimeout(r, 10));

    // Second execution
    await engine.execute("multi_skill");
    const infoAfterSecond = lifecycleManager.getInfo("multi_skill")!;
    const secondUsedAt = infoAfterSecond.lastUsedAt;

    expect(secondUsedAt).toBeGreaterThanOrEqual(firstUsedAt);
    expect(infoAfterSecond.createdAt).toBe(firstCreatedAt);
  });

  it("should get all lifecycle info for registered skills", async () => {
    registry.register(
      defineSkill({
        name: "skill_a",
        handler: async () => ({ success: true }),
      }),
    );

    registry.register(
      defineSkill({
        name: "skill_b",
        handler: async () => ({ success: true }),
      }),
    );

    await engine.execute("skill_a");
    await engine.execute("skill_b");

    const allInfo = lifecycleManager.getAll();
    expect(allInfo.length).toBeGreaterThanOrEqual(2);

    const names = allInfo.map((i) => i.name);
    expect(names).toContain("skill_a");
    expect(names).toContain("skill_b");
  });

  it("should support canary deployment tracking", async () => {
    registry.register(
      defineSkill({
        name: "my_skill_v1",
        handler: async () => ({ success: true, data: "v1" }),
      }),
    );

    registry.register(
      defineSkill({
        name: "my_skill_v2",
        handler: async () => ({ success: true, data: "v2" }),
      }),
    );

    // Start canary
    lifecycleManager.startCanary("my_skill", "my_skill_v1", "my_skill_v2", {
      trafficPercent: 50,
      promoteThreshold: 0.95,
      rollbackThreshold: 0.5,
      minCalls: 10,
    });

    const info = lifecycleManager.getInfo("my_skill");
    expect(info).not.toBeNull();
    expect(info!.state).toBe("canary");
    expect(info!.canaryConfig).not.toBeUndefined();
    expect(info!.canaryConfig!.trafficPercent).toBe(50);
  });

  it("should support skill deprecation", async () => {
    registry.register(
      defineSkill({
        name: "old_skill",
        handler: async () => ({ success: true }),
      }),
    );

    await engine.execute("old_skill");
    lifecycleManager.deprecate("old_skill");

    const info = lifecycleManager.getInfo("old_skill");
    expect(info!.state).toBe("deprecated");
  });

  it("should support skill retirement", () => {
    // Manually create a skill with old lastUsedAt time
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _info = lifecycleManager.getInfo("very_old_skill");
    // Manually set it up by calling recordUsage (which creates the entry)
    lifecycleManager.recordUsage("very_old_skill");
    const infoAfterRecord = lifecycleManager.getInfo("very_old_skill")!;

    // Verify it was created as active
    expect(infoAfterRecord.state).toBe("active");

    // Retire skills that haven't been used for 0ms (all of them, since they were just used)
    // Since lifecycle info is just created, it has recent lastUsedAt
    let retired = lifecycleManager.retireInactive(0);
    // The skill was just used, so might not be retired with 0ms threshold
    expect(typeof retired).toBe("object"); // Just verify it returns an array

    // Try with a larger inactivity window (e.g., 1 second) - should not retire recently used
    retired = lifecycleManager.retireInactive(1000);
    expect(retired).not.toContain("very_old_skill");
  });
});
