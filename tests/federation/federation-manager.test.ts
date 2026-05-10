/**
 * 集成测试：FederationManager 跨实例协调
 *
 * 验证：
 * - FederationManager.syncAndRecommend() 使用 mock transport
 * - DefaultRecommendationStrategy 推荐逻辑（adopt/upgrade/optimize）
 * - acceptRecommendation 触发 migration
 * - 跨实例协调正常工作
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FederationManager, DefaultRecommendationStrategy } from "../../src/federation/federation-manager.js";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { MetricsCollector } from "../../src/engine/metrics.js";
import { defineSkill } from "../../src/types/skill.js";
import type {
  FederationTransport,
  FederatedMetricsSnapshot,
  SkillRecommendation,
  FederationEvent,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  InstanceProfile,
} from "../../src/federation/types.js";
import type { SkillMigrationManager } from "../../src/federation/skill-migration.js";

/** Mock FederationTransport for testing */
class MockTransport implements FederationTransport {
  private handlers: Map<string, (payload: any) => Promise<any>> = new Map();
  private broadcastResults: { instanceId: string; result: any }[] | null = null;

  async broadcast(messageType: string, payload: any): Promise<{ instanceId: string; result: any }[]> {
    // If preset results are available, return them
    if (this.broadcastResults !== null) {
      return this.broadcastResults;
    }

    // Otherwise, call registered handlers
    const results = [];
    for (const [type, handler] of this.handlers) {
      if (type === messageType) {
        try {
          const result = await handler(payload);
          results.push({ instanceId: "remote-instance", result });
        } catch (e) {
          results.push({ instanceId: "remote-instance", result: { error: String(e) } });
        }
      }
    }
    return results;
  }

  onReceive(messageType: string, handler: (payload: any) => Promise<any>): void {
    this.handlers.set(messageType, handler);
  }

  setBroadcastResults(results: { instanceId: string; result: any }[]): void {
    this.broadcastResults = results;
  }

  clearBroadcastResults(): void {
    this.broadcastResults = null;
  }
}

/** Mock SkillMigrationManager for testing */
class MockMigrationManager implements SkillMigrationManager {
  async pullSkill(sourceInstance: string, skillName: string): Promise<{ success: boolean; reason?: string }> {
    return { success: true, reason: `Pulled ${skillName} from ${sourceInstance}` };
  }

  async pushSkill(): Promise<void> {
    // No-op
  }
}

describe("FederationManager Integration", () => {
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let transport: MockTransport;
  let migration: MockMigrationManager;
  let manager: FederationManager;
  let emittedEvents: FederationEvent[] = [];

  beforeEach(() => {
    registry = new SkillRegistry();
    metrics = new MetricsCollector();
    transport = new MockTransport();
    migration = new MockMigrationManager();
    emittedEvents = [];

    manager = new FederationManager({
      registry,
      metrics,
      transport,
      migration,
      instanceId: "local-instance",
      strategy: new DefaultRecommendationStrategy(),
    });

    manager.on((event) => {
      emittedEvents.push(event);
    });
  });

  afterEach(() => {
    manager.stop();
    transport.clearBroadcastResults();
  });

  it("should initialize with correct instance ID", () => {
    const profile = manager.getLocalProfile();

    expect(profile).toBeDefined();
    expect(profile.instanceId).toBe("local-instance");
    expect(profile).toHaveProperty("version");
    expect(profile).toHaveProperty("capabilities");
    expect(profile).toHaveProperty("skillCount");
  });

  it("should return empty recommendations initially", () => {
    const recommendations = manager.getRecommendations();

    expect(Array.isArray(recommendations)).toBe(true);
    expect(recommendations.length).toBe(0);
  });

  it("should emit heartbeat event when sending heartbeat", async () => {
    emittedEvents = [];

    await manager.sendHeartbeat();

    const heartbeatEvent = emittedEvents.find((e) => e.type === "federation:heartbeat");
    expect(heartbeatEvent).toBeDefined();
    expect(heartbeatEvent?.data.instanceId).toBe("local-instance");
  });

  it("should generate adopt recommendations for high-quality remote skills", async () => {
    // Register a local skill
    registry.register(
      defineSkill({
        name: "local_skill",
        description: "Local skill",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record metrics for local skill (moderate quality)
    metrics.record("local_skill", 50, true); // 50ms latency
    for (let i = 0; i < 10; i++) {
      metrics.record("local_skill", 50, true);
    }

    // Simulate remote snapshot with a new high-quality skill
    const remoteSnapshot: FederatedMetricsSnapshot = {
      instanceId: "remote-1",
      timestamp: Date.now(),
      skills: [
        {
          name: "advanced_skill",
          version: "1.0",
          totalCalls: 100,
          successRate: 0.95, // High success rate
          avgLatencyMs: 30,
          p95LatencyMs: 50,
        },
      ],
    };

    transport.setBroadcastResults([{ instanceId: "remote-1", result: remoteSnapshot }]);

    const recommendations = await manager.syncAndRecommend();

    // Should recommend adopting the high-quality remote skill
    const adoptRec = recommendations.find((r) => r.action === "adopt" && r.skillName === "advanced_skill");
    expect(adoptRec).toBeDefined();
    if (adoptRec) {
      expect(adoptRec.sourceInstance).toBe("remote-1");
      expect(adoptRec.confidence).toBeGreaterThan(0);
    }
  });

  it("should generate upgrade recommendations when remote version is better", async () => {
    // Register local skill with lower quality
    registry.register(
      defineSkill({
        name: "test_skill",
        description: "Test skill",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record local metrics (lower quality)
    for (let i = 0; i < 20; i++) {
      if (i < 5) {
        metrics.record("test_skill", 100, false, "error");
      } else {
        metrics.record("test_skill", 100, true);
      }
    }

    // Simulate remote snapshot with better version
    const remoteSnapshot: FederatedMetricsSnapshot = {
      instanceId: "remote-2",
      timestamp: Date.now(),
      skills: [
        {
          name: "test_skill",
          version: "2.0",
          totalCalls: 50,
          successRate: 0.95, // Much better
          avgLatencyMs: 30,  // Much faster
          p95LatencyMs: 45,
        },
      ],
    };

    transport.setBroadcastResults([{ instanceId: "remote-2", result: remoteSnapshot }]);

    const recommendations = await manager.syncAndRecommend();

    // Should recommend upgrading
    const upgradeRec = recommendations.find((r) => r.action === "upgrade" && r.skillName === "test_skill");
    expect(upgradeRec).toBeDefined();
    if (upgradeRec) {
      expect(upgradeRec.sourceInstance).toBe("remote-2");
      expect(upgradeRec.reason).toContain("性能更优");
    }
  });

  it("should generate optimize recommendations for low-success-rate skills", async () => {
    // Register local skill with poor performance
    registry.register(
      defineSkill({
        name: "poor_skill",
        description: "Poor performing skill",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record many failures
    for (let i = 0; i < 25; i++) {
      if (i < 15) {
        metrics.record("poor_skill", 100, false, "error");
      } else {
        metrics.record("poor_skill", 100, true);
      }
    }

    const recommendations = await manager.syncAndRecommend();

    // Should recommend optimizing
    const optimizeRec = recommendations.find((r) => r.action === "optimize" && r.skillName === "poor_skill");
    expect(optimizeRec).toBeDefined();
    if (optimizeRec) {
      expect(optimizeRec.sourceInstance).toBe("self");
      expect(optimizeRec.reason).toContain("成功率偏低");
    }
  });

  it("should emit recommendation event when recommendations are generated", async () => {
    registry.register(
      defineSkill({
        name: "test_skill",
        description: "Test",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record metrics
    for (let i = 0; i < 20; i++) {
      if (i < 10) {
        metrics.record("test_skill", 100, false, "error");
      }
    }

    emittedEvents = [];

    const remoteSnapshot: FederatedMetricsSnapshot = {
      instanceId: "remote-3",
      timestamp: Date.now(),
      skills: [
        {
          name: "remote_skill",
          version: "1.0",
          totalCalls: 100,
          successRate: 0.95,
          avgLatencyMs: 30,
          p95LatencyMs: 50,
        },
      ],
    };

    transport.setBroadcastResults([{ instanceId: "remote-3", result: remoteSnapshot }]);

    await manager.syncAndRecommend();

    const recEvent = emittedEvents.find((e) => e.type === "federation:recommendation");
    expect(recEvent).toBeDefined();
    if (recEvent) {
      expect(recEvent.data.count).toBeGreaterThan(0);
    }
  });

  it("should accept adopt recommendations and trigger migration", async () => {
    registry.register(
      defineSkill({
        name: "skill1",
        description: "Skill 1",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    const remoteSnapshot: FederatedMetricsSnapshot = {
      instanceId: "remote-4",
      timestamp: Date.now(),
      skills: [
        {
          name: "new_skill",
          version: "1.0",
          totalCalls: 100,
          successRate: 0.95,
          avgLatencyMs: 30,
          p95LatencyMs: 50,
        },
      ],
    };

    transport.setBroadcastResults([{ instanceId: "remote-4", result: remoteSnapshot }]);

    await manager.syncAndRecommend();

    const newSkillRec = manager.getRecommendations().find((r) => r.skillName === "new_skill");
    expect(newSkillRec).toBeDefined();

    if (newSkillRec) {
      const result = await manager.acceptRecommendation("new_skill");

      expect(result.success).toBe(true);
      expect(result.reason).toBeDefined();
    }
  });

  it("should accept upgrade recommendations and trigger migration", async () => {
    registry.register(
      defineSkill({
        name: "upgrade_skill",
        description: "Skill to upgrade",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record weak metrics
    for (let i = 0; i < 20; i++) {
      if (i < 10) {
        metrics.record("upgrade_skill", 100, false, "error");
      } else {
        metrics.record("upgrade_skill", 100, true);
      }
    }

    const remoteSnapshot: FederatedMetricsSnapshot = {
      instanceId: "remote-5",
      timestamp: Date.now(),
      skills: [
        {
          name: "upgrade_skill",
          version: "2.0",
          totalCalls: 50,
          successRate: 0.95,
          avgLatencyMs: 30,
          p95LatencyMs: 45,
        },
      ],
    };

    transport.setBroadcastResults([{ instanceId: "remote-5", result: remoteSnapshot }]);

    await manager.syncAndRecommend();

    const upgradeRec = manager.getRecommendations().find((r) => r.action === "upgrade");
    expect(upgradeRec).toBeDefined();

    if (upgradeRec) {
      const result = await manager.acceptRecommendation(upgradeRec.skillName);

      expect(result.success).toBe(true);
    }
  });

  it("should fail gracefully when accepting non-existent recommendation", async () => {
    const result = await manager.acceptRecommendation("non_existent_skill");

    expect(result.success).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("should handle optimize action in acceptRecommendation", async () => {
    registry.register(
      defineSkill({
        name: "optimize_skill",
        description: "Skill to optimize",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record poor metrics to trigger optimize
    for (let i = 0; i < 25; i++) {
      if (i < 15) {
        metrics.record("optimize_skill", 100, false, "error");
      } else {
        metrics.record("optimize_skill", 100, true);
      }
    }

    await manager.syncAndRecommend();

    const optimizeRec = manager.getRecommendations().find((r) => r.action === "optimize");
    expect(optimizeRec).toBeDefined();

    if (optimizeRec) {
      const result = await manager.acceptRecommendation(optimizeRec.skillName);

      expect(result.success).toBe(true);
      expect(result.reason).toContain("evolution engine");
    }
  });

  it("should maintain remote snapshots from sync", async () => {
    const snapshot1: FederatedMetricsSnapshot = {
      instanceId: "remote-6",
      timestamp: Date.now(),
      skills: [
        {
          name: "skill1",
          version: "1.0",
          totalCalls: 50,
          successRate: 0.9,
          avgLatencyMs: 50,
          p95LatencyMs: 100,
        },
      ],
    };

    const snapshot2: FederatedMetricsSnapshot = {
      instanceId: "remote-7",
      timestamp: Date.now(),
      skills: [
        {
          name: "skill2",
          version: "1.0",
          totalCalls: 75,
          successRate: 0.92,
          avgLatencyMs: 45,
          p95LatencyMs: 95,
        },
      ],
    };

    transport.setBroadcastResults([
      { instanceId: "remote-6", result: snapshot1 },
      { instanceId: "remote-7", result: snapshot2 },
    ]);

    await manager.syncAndRecommend();

    const remoteSnapshots = manager.getRemoteSnapshots();

    expect(remoteSnapshots.size).toBeGreaterThanOrEqual(2);
    expect(remoteSnapshots.has("remote-6")).toBe(true);
    expect(remoteSnapshots.has("remote-7")).toBe(true);
  });

  it("should support custom recommendation strategy", async () => {
    // Create a custom strategy that only recommends adopt
    class CustomStrategy extends DefaultRecommendationStrategy {
      override recommend(): SkillRecommendation[] {
        return [
          {
            action: "adopt",
            skillName: "custom_skill",
            sourceInstance: "custom-source",
            reason: "Custom strategy recommendation",
            confidence: 0.95,
          },
        ];
      }
    }

    const customManager = new FederationManager({
      registry,
      metrics,
      transport,
      migration,
      instanceId: "local-instance",
      strategy: new CustomStrategy(),
    });

    const recommendations = await customManager.syncAndRecommend();

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].skillName).toBe("custom_skill");

    customManager.stop();
  });

  it("should replace strategy dynamically", async () => {
    class AlternativeStrategy extends DefaultRecommendationStrategy {
      override recommend(): SkillRecommendation[] {
        return [
          {
            action: "optimize",
            skillName: "alt_skill",
            sourceInstance: "self",
            reason: "Alternative strategy",
            confidence: 0.8,
          },
        ];
      }
    }

    manager.setStrategy(new AlternativeStrategy());

    const recommendations = await manager.syncAndRecommend();

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].action).toBe("optimize");
  });

  it("should return local metrics snapshot correctly", () => {
    registry.register(
      defineSkill({
        name: "metric_skill",
        description: "Skill for metrics",
        version: "1.0.0",
        handler: async () => ({ success: true }),
      }),
    );

    // Record some metrics
    for (let i = 0; i < 10; i++) {
      metrics.record("metric_skill", 50, true);
    }

    const snapshot = manager.getLocalMetricsSnapshot();

    expect(snapshot).toBeDefined();
    expect(snapshot.instanceId).toBe("local-instance");
    expect(snapshot).toHaveProperty("timestamp");
    expect(Array.isArray(snapshot.skills)).toBe(true);

    const skillMetric = snapshot.skills.find((s) => s.name === "metric_skill");
    expect(skillMetric).toBeDefined();
    if (skillMetric) {
      expect(skillMetric.totalCalls).toBeGreaterThan(0);
      expect(skillMetric.successRate).toBeGreaterThan(0);
    }
  });

  it("should handle start/stop lifecycle", async () => {
    manager.start({ heartbeatIntervalMs: 100, syncIntervalMs: 200 });

    // Wait for at least one cycle
    await new Promise((resolve) => setTimeout(resolve, 150));

    const heartbeatEvents = emittedEvents.filter((e) => e.type === "federation:heartbeat");
    expect(heartbeatEvents.length).toBeGreaterThan(0);

    manager.stop();

    // After stop, no more events should be emitted from intervals
    emittedEvents = [];
    await new Promise((resolve) => setTimeout(resolve, 250));

    const newHeartbeats = emittedEvents.filter((e) => e.type === "federation:heartbeat");
    expect(newHeartbeats.length).toBe(0);
  });

  it("should handle transport errors gracefully", async () => {
    // Create a transport that fails
    const failingTransport = new MockTransport();
    let broadcastCalled = false;

    const failingManager = new FederationManager({
      registry,
      metrics,
      transport: failingTransport,
      migration,
      instanceId: "local-instance",
    });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _originalBroadcast = failingTransport.broadcast.bind(failingTransport);
    failingTransport.broadcast = async () => {
      broadcastCalled = true;
      throw new Error("Transport error");
    };

    // Should not throw
    await expect(failingManager.sendHeartbeat()).resolves.not.toThrow();
    expect(broadcastCalled).toBe(true);

    failingManager.stop();
  });
});
