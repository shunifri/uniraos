import { describe, it, expect, vi, beforeEach } from "vitest";
import { OptimizeActionExecutor } from "../../../src/federation/executors/optimize-executor.js";
import type { LLMProvider } from "../../../src/llm/types.js";
import type { SkillRegistry } from "../../../src/registry/index.js";
import type { MetricsCollector } from "../../../src/engine/metrics.js";
import type { SkillLifecycleManager } from "../../../src/engine/skill-lifecycle.js";
import type { EvolutionAction } from "../../../src/federation/types.js";
import { Autonomy } from "../../../src/types/index.js";

function makeAction(overrides: Partial<EvolutionAction> = {}): EvolutionAction {
  return {
    type: "optimize",
    skillName: "my_skill",
    payload: { reason: "high latency", currentP95: 8000 },
    priority: 60,
    requiresApproval: false,
    ...overrides,
  };
}

const stubSkill = {
  name: "my_skill",
  version: "1.2.3",
  visible: true,
  autonomy: Autonomy.MANUAL,
  dependencies: [],
  timeout: 30000,
  retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
  handler: async () => ({ success: true }),
};

describe("OptimizeActionExecutor", () => {
  let llm: LLMProvider;
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let lifecycle: SkillLifecycleManager;
  let executor: OptimizeActionExecutor;

  beforeEach(() => {
    llm = {
      name: "mock-llm",
      model: "mock",
      chat: vi.fn().mockResolvedValue({ content: "return { success: true, data: {} };", toolCalls: [], finishReason: "stop" }),
    } as unknown as LLMProvider;

    registry = {
      get: vi.fn().mockReturnValue(stubSkill),
      lookup: vi.fn().mockReturnValue(stubSkill),
      register: vi.fn(),
      registerVersion: vi.fn(),
      list: vi.fn().mockReturnValue([stubSkill]),
    } as unknown as SkillRegistry;

    metrics = {
      getMetrics: vi.fn().mockReturnValue({
        skillName: "my_skill",
        totalCalls: 100,
        successRate: 0.85,
        p95DurationMs: 8000,
        avgDurationMs: 3000,
        successCount: 85,
        failCount: 15,
        p50DurationMs: 2000,
        p99DurationMs: 12000,
        maxDurationMs: 20000,
        lastCalledAt: Date.now(),
        errorDistribution: {},
      }),
    } as unknown as MetricsCollector;

    lifecycle = {
      startCanary: vi.fn(),
      promoteCanary: vi.fn(),
      rollbackCanary: vi.fn(),
      evaluateCanary: vi.fn(),
    } as unknown as SkillLifecycleManager;

    executor = new OptimizeActionExecutor(llm, lifecycle);
  });

  it("has correct actionType", () => {
    expect(executor.actionType).toBe("optimize");
  });

  it("returns failure when skill not found in registry", async () => {
    (registry.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("Skill not found");
    });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("my_skill");
  });

  it("calls LLM with a prompt containing skill name and reason", async () => {
    await executor.execute(makeAction(), { registry, metrics });

    expect(llm.chat).toHaveBeenCalledOnce();
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const promptContent: string = messages[0].content;
    expect(promptContent).toContain("my_skill");
    expect(promptContent).toContain("high latency");
  });

  it("calls LLM with metrics info in the prompt", async () => {
    await executor.execute(makeAction(), { registry, metrics });

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const promptContent: string = messages[0].content;
    expect(promptContent).toContain("successRate");
  });

  it("registers optimized version on success", async () => {
    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(true);
    expect(registry.registerVersion).toHaveBeenCalledOnce();
  });

  it("bumps the patch version on the registered skill", async () => {
    await executor.execute(makeAction(), { registry, metrics });

    const registeredSkill = (registry.registerVersion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(registeredSkill.version).toBe("1.2.4");
  });

  it("starts canary deployment after registering", async () => {
    await executor.execute(makeAction(), { registry, metrics });

    expect(lifecycle.startCanary).toHaveBeenCalledWith("my_skill", "1.2.3", "1.2.4");
  });

  it("returns failure when LLM returns no content", async () => {
    (llm.chat as ReturnType<typeof vi.fn>).mockResolvedValue({ content: null, toolCalls: [], finishReason: "stop" });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("no code");
  });

  it("returns failure when LLM call throws", async () => {
    (llm.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("LLM call failed");
  });

  it("returns failure when generated code contains forbidden patterns", async () => {
    (llm.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "process.exit(1);",
      toolCalls: [],
      finishReason: "stop",
    });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("validation failed");
  });

  it("returns failure when registry.registerVersion throws", async () => {
    (registry.registerVersion as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("version conflict");
    });

    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(false);
    expect(result.message).toContain("version conflict");
  });

  it("includes skill versions in the success message", async () => {
    const result = await executor.execute(makeAction(), { registry, metrics });

    expect(result.success).toBe(true);
    expect(result.message).toContain("1.2.3");
    expect(result.message).toContain("1.2.4");
  });
});
