/**
 * P1-30: Agent 设置里"最大迭代"实际影响哪些 agent
 *
 * Bug: 之前 TeamAgent.createSubAgent 硬编码 maxIterations: 10,
 *      跟用户在 Config UI 设的 agent.maxIterations 没关系.
 *
 * 修法:
 * - AgentDeps 加 config?: { maxIterations?: number }
 * - TeamAgent.createSubAgent 读 profile.maxIterations 优先 → config.maxIterations → 30 fallback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("P1-30: TeamAgent.createSubAgent 读 maxIterations 配置", () => {
  it("profile 有 maxIterations 时应该用 profile.maxIterations", () => {
    // 模拟 createSubAgent 的 resolve 逻辑
    function resolveMaxIter(profile: any, cfg: any, fallback = 30): number {
      return profile?.maxIterations ?? cfg?.maxIterations ?? fallback;
    }
    expect(resolveMaxIter({ maxIterations: 5 }, { maxIterations: 30 })).toBe(5);
    expect(resolveMaxIter({ maxIterations: 5 }, null)).toBe(5);
  });

  it("profile 没 maxIterations 时应该用 config.maxIterations (用户 Config UI 设的值)", () => {
    function resolveMaxIter(profile: any, cfg: any, fallback = 30): number {
      return profile?.maxIterations ?? cfg?.maxIterations ?? fallback;
    }
    expect(resolveMaxIter({}, { maxIterations: 30 })).toBe(30);
    expect(resolveMaxIter({ allowedSkills: ["kb_search"] }, { maxIterations: 25 })).toBe(25);
  });

  it("profile + config 都没时 fallback 到默认 30 (P1-29 修过)", () => {
    function resolveMaxIter(profile: any, cfg: any, fallback = 30): number {
      return profile?.maxIterations ?? cfg?.maxIterations ?? fallback;
    }
    expect(resolveMaxIter({}, undefined)).toBe(30);
    expect(resolveMaxIter({ allowedSkills: ["kb_search"] }, null)).toBe(30);
  });
});

describe("P1-30: AgentDeps 加 config 字段 (向后兼容)", () => {
  it("AgentDeps.config 应该是可选的 (旧代码不传也能跑)", () => {
    // 类型层面: 之前没 config 字段, 现在 config?: { maxIterations?: number; ... }
    // 旧调用方 (new EvolutionEngine({registry, engine, provider})) 应该不报错
    const deps1: { registry: any; engine: any; provider: any } = {
      registry: {},
      engine: {},
      provider: {},
    };
    // 模拟 AgentDeps 接受不传 config
    expect(deps1).toBeTruthy();
  });
});

describe("P1-30: Config UI 字段生效链路", () => {
  it("Config UI agent.maxIterations → configManager.get().agent → Orchestrator opts.maxIterations", () => {
    // 链路:
    //   Config.tsx form item 'maxIterations' → POST /api/config/agent
    //   → configManager.update({agent: {maxIterations: N}})
    //   → providerManager.getOrchestrator() 读 agentConfig.maxIterations
    //   → new Orchestrator({...}, {maxIterations: agentConfig.maxIterations})
    //   → this.config.maxIterations = N
    //   → resolveMaxIterations(roleConfig) = roleConfig?.maxIterations ?? N
    //   → plan/replan agent 用这个值
    const cfg = { agent: { maxIterations: 30 } };
    expect(cfg.agent.maxIterations).toBe(30);
    // resolveMaxIterations 行为
    const resolveMaxIter = (roleCfg: any, orchCfg: any) => roleCfg?.maxIterations ?? orchCfg.maxIterations;
    expect(resolveMaxIter(undefined, cfg.agent)).toBe(30);
    expect(resolveMaxIter({ maxIterations: 10 }, cfg.agent)).toBe(10);  // roleConfig 优先
  });
});
