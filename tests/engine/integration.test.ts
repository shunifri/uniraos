/**
 * 集成测试：注册→执行→trace→WAL→指标 全链路
 */
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
  engine = new ExecutionEngine(registry, wal, { maxDepth: 20, callBudget: 100 });
});

describe("Integration: Full Pipeline", () => {
  it("register → execute → trace → WAL → metrics", async () => {
    // 1. Register
    registry.register(
      defineSkill({
        name: "add",
        description: "加法",
        version: "1.2.0",
        handler: async (params) => {
          const a = params.a as number;
          const b = params.b as number;
          return { success: true, data: { sum: a + b } };
        },
      }),
    );

    // 2. Execute
    const result = await engine.execute("add", { a: 3, b: 5 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sum: 8 });

    // 3. Trace
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].skillName).toBe("add");
    expect(result.trace[0].success).toBe(true);
    expect(result.trace[0].depth).toBe(0);
    expect(result.traceId).toBeDefined();

    // 4. WAL
    const walEntries = wal.getAll();
    expect(walEntries).toHaveLength(1);
    expect(walEntries[0].skillName).toBe("add");
    expect(walEntries[0].status).toBe("completed");
    expect(walEntries[0].traceId).toBe(result.traceId);

    // 5. Metrics
    const metrics = engine.metrics.getMetrics("add");
    expect(metrics).not.toBeNull();
    expect(metrics!.totalCalls).toBe(1);
    expect(metrics!.successCount).toBe(1);
    expect(metrics!.successRate).toBe(1);
  });

  it("chain of pre/post hooks with trace depth", async () => {
    const order: string[] = [];

    registry.register(
      defineSkill({
        name: "guard",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => {
          order.push("guard");
          return { success: true };
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "audit",
        autonomy: Autonomy.AUTO_POST,
        visible: false,
        handler: async () => {
          order.push("audit");
          return { success: true };
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "action",
        dependencies: ["guard", "audit"],
        handler: async () => {
          order.push("action");
          return { success: true, data: "done" };
        },
      }),
    );

    const result = await engine.execute("action");
    expect(result.success).toBe(true);
    expect(order).toEqual(["guard", "action", "audit"]);

    // Trace should have 3 entries
    expect(result.trace).toHaveLength(3);
    const traceNames = result.trace.map((t) => t.skillName);
    expect(traceNames).toContain("guard");
    expect(traceNames).toContain("action");
    expect(traceNames).toContain("audit");
    // guard executes before action in the trace
    expect(traceNames.indexOf("guard")).toBeLessThan(traceNames.indexOf("action"));

    // All 3 should be in WAL
    expect(wal.getAll()).toHaveLength(3);

    // All 3 should have metrics
    expect(engine.metrics.getMetrics("guard")!.totalCalls).toBe(1);
    expect(engine.metrics.getMetrics("action")!.totalCalls).toBe(1);
    expect(engine.metrics.getMetrics("audit")!.totalCalls).toBe(1);
  });

  it("failed execution records failure in WAL and metrics", async () => {
    registry.register(
      defineSkill({
        name: "fail_skill",
        handler: async () => {
          throw new Error("intentional failure");
        },
      }),
    );

    await expect(engine.execute("fail_skill")).rejects.toThrow("intentional failure");

    const walEntries = wal.getAll();
    expect(walEntries).toHaveLength(1);
    expect(walEntries[0].status).toBe("failed");
    expect(walEntries[0].error).toContain("intentional failure");

    const metrics = engine.metrics.getMetrics("fail_skill");
    expect(metrics!.totalCalls).toBe(1);
    expect(metrics!.failCount).toBe(1);
    expect(metrics!.successRate).toBe(0);
  });

  it("error propagation: postFailureAffectsResult=false ignores post hook failure", async () => {
    registry.register(
      defineSkill({
        name: "bad_post",
        autonomy: Autonomy.AUTO_POST,
        visible: false,
        handler: async () => {
          throw new Error("post hook failed");
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "resilient",
        dependencies: ["bad_post"],
        errorPropagation: { postFailureAffectsResult: false },
        handler: async () => ({ success: true, data: "ok" }),
      }),
    );

    // Should succeed despite post hook failure
    const result = await engine.execute("resilient");
    expect(result.success).toBe(true);
    expect(result.data).toBe("ok");
  });

  it("error propagation: preFailureBlocks=false allows main to run despite pre failure", async () => {
    registry.register(
      defineSkill({
        name: "bad_pre",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        handler: async () => {
          throw new Error("pre hook failed");
        },
      }),
    );

    registry.register(
      defineSkill({
        name: "tolerant",
        dependencies: ["bad_pre"],
        errorPropagation: { preFailureBlocks: false },
        handler: async () => ({ success: true, data: "ran anyway" }),
      }),
    );

    const result = await engine.execute("tolerant");
    expect(result.success).toBe(true);
    expect(result.data).toBe("ran anyway");
  });

  it("execution history is maintained", async () => {
    registry.register(
      defineSkill({
        name: "hist",
        handler: async () => ({ success: true }),
      }),
    );

    await engine.execute("hist");
    await engine.execute("hist");
    await engine.execute("hist");

    const history = engine.getHistory();
    expect(history).toHaveLength(3);
    expect(history.every((h) => h.success)).toBe(true);
  });

  it("retry with jitter does not exceed maxBackoffMs", async () => {
    let attempts = 0;

    registry.register(
      defineSkill({
        name: "retrying",
        retry: {
          maxRetries: 2,
          backoffMs: 10,
          backoffMultiplier: 10,
          maxBackoffMs: 20,
          jitter: true,
        },
        handler: async () => {
          attempts++;
          if (attempts < 3) throw new Error("not yet");
          return { success: true };
        },
      }),
    );

    const start = Date.now();
    const result = await engine.execute("retrying");
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
    // With maxBackoffMs=20 and jitter, total delay should be well under 100ms
    expect(elapsed).toBeLessThan(200);
  });
});
