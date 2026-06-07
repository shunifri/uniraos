/**
 * Hierarchical 超时保护单测
 *
 * ROADMAP-Q3 item #7 (2026-06-08): 摘 4-29 doc 9.1#2 "7 协议双层超时" 虚标.
 * 覆盖 Hierarchical 协议 3 类超时:
 *   1. stepTimeout 命中 managerDecide (LLM chat 阶段)
 *   2. stepTimeout 命中 sub-agent run (assign 后 expert 慢)
 *   3. stepTimeout 命中 revise 阶段
 *   4. totalTimeout 命中累计执行
 *   5. 提前完成不触发超时
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { HierarchicalExecutor } from "../../../src/agents/protocols/hierarchical.js";
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  LLMProvider,
  Message,
  TeamConfig,
} from "../../../src/agents/types.js";

const testDb = new Database(":memory:");
vi.mock("../../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

class DelayedMockProvider implements LLMProvider {
  readonly name = "delayed";
  readonly model = "test";
  constructor(private delayMs: number) {}
  async chat(_messages: Message[]): Promise<{ content?: string }> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { content: "no decision" };
  }
  async embedding(_text: string): Promise<number[]> {
    return Array(384).fill(0);
  }
}

class ScriptedMockProvider implements LLMProvider {
  readonly name = "scripted";
  readonly model = "test";
  constructor(private responses: string[]) {}
  async chat(_messages: Message[]): Promise<{ content?: string }> {
    const r = this.responses.shift() ?? "no decision";
    return { content: r };
  }
  async embedding(_text: string): Promise<number[]> {
    return Array(384).fill(0);
  }
}

function delayedAgent(delayMs: number, response: string = "agent response"): Agent {
  return {
    name: "mock-agent",
    level: "simple",
    profile: { role: "mock", personality: "mock", expertise: ["mock"], allowedSkills: [] },
    async run(_input: AgentInput): Promise<AgentOutput> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { response, level: "simple", steps: [], iterations: 1, metadata: {} };
    },
    async *runStream(_input: AgentInput): AsyncGenerator<AgentStreamEvent> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield { event: "agent_done", data: { response } };
    },
  };
}

function fastAgent(response: string = "agent response"): Agent {
  return {
    name: "mock-agent",
    level: "simple",
    profile: { role: "mock", personality: "mock", expertise: ["mock"], allowedSkills: [] },
    async run(_input: AgentInput): Promise<AgentOutput> {
      return { response, level: "simple", steps: [], iterations: 1, metadata: {} };
    },
    async *runStream(_input: AgentInput): AsyncGenerator<AgentStreamEvent> {
      yield { event: "agent_done", data: { response } };
    },
  };
}

describe("HierarchicalExecutor Step Timeout", () => {
  it("managerDecide 超时返回 [HIERARCHICAL 超时] phase managerDecide", async () => {
    // Provider 延迟 200ms 模拟 manager LLM chat 慢
    const provider = new DelayedMockProvider(200);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [{ role: "W", personality: "W", expertise: ["w"], allowedSkills: [] }],
      stepTimeout: 50,
    };

    const result = await executor.execute({ message: "test" }, config, () => fastAgent());

    expect(result.response).toMatch(/\[HIERARCHICAL 超时\] phase managerDecide/);
    expect(result.metadata.timedOut).toBe(true);
    expect(result.metadata.timedOutPhase).toBe("managerDecide");
    expect(result.metadata.timedOutMs).toBe(50);
  });

  it("sub-agent 超时返回 phase sub-agent:<role>", async () => {
    // Provider 快速返回 assign, 但 sub-agent 慢 (200ms > 50ms)
    const provider = new ScriptedMockProvider([
      JSON.stringify({ decision: "assign", assignments: [{ agent: "W", task: "do work" }] }),
    ]);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [{ role: "W", personality: "W", expertise: ["w"], allowedSkills: [] }],
      stepTimeout: 50,
    };

    const result = await executor.execute({ message: "test" }, config, () => delayedAgent(200));

    expect(result.response).toMatch(/\[HIERARCHICAL 超时\] phase sub-agent:W/);
    expect(result.metadata.timedOut).toBe(true);
    expect(result.metadata.timedOutPhase).toBe("sub-agent:W");
  });

  it("提前完成不触发超时", async () => {
    const provider = new ScriptedMockProvider([
      JSON.stringify({ decision: "complete", summary: "Done!" }),
    ]);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [{ role: "W", personality: "W", expertise: ["w"], allowedSkills: [] }],
      stepTimeout: 500,
    };

    const result = await executor.execute({ message: "test" }, config, () => fastAgent());

    expect(result.response).toBe("Done!");
    expect(result.metadata.timedOut).toBeUndefined();
  });

  it("revise 阶段超时返回 phase revise:<role>", async () => {
    // 第 1 轮 assign → 第 2 轮 revise
    const provider = new ScriptedMockProvider([
      JSON.stringify({ decision: "assign", assignments: [{ agent: "W", task: "do work" }] }),
      JSON.stringify({ decision: "revise", revision: "W: please fix" }),
    ]);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [{ role: "W", personality: "W", expertise: ["w"], allowedSkills: [] }],
      stepTimeout: 50,
    };

    // 第 1 个 agent 快速, 第 2 个 (revise) 慢
    let callCount = 0;
    const factory = (_profile: AgentProfile): Agent => {
      callCount++;
      return callCount === 1 ? fastAgent("first result") : delayedAgent(200, "revised");
    };

    const result = await executor.execute({ message: "test" }, config, factory);

    expect(result.response).toMatch(/\[HIERARCHICAL 超时\] phase revise:W/);
    expect(result.metadata.timedOut).toBe(true);
    expect(result.metadata.timedOutPhase).toBe("revise:W");
  });

  it("未配置 stepTimeout (默认 0) 时不触发超时", async () => {
    const provider = new DelayedMockProvider(100);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [{ role: "W", personality: "W", expertise: ["w"], allowedSkills: [] }],
      // stepTimeout 不设置 (默认 0 = 不超时)
    };

    // 第 1 轮 managerDecide 后 fallback 分配所有成员 (parse JSON 失败), 进入 sub-agent 阶段
    // 但 provider 延迟 100ms, sub-agent 快速 → 整体能跑完 (merge 在最后)
    // 此处只验证 managerDecide 不会超时, 即使延迟 100ms
    const result = await executor.execute({ message: "test" }, config, () => fastAgent());

    // 不应包含 "HIERARCHICAL 超时"
    expect(result.response).not.toContain("HIERARCHICAL 超时");
    expect(result.metadata.timedOut).toBeUndefined();
  });
});

describe("HierarchicalExecutor Total Timeout", () => {
  it("totalTimeout 命中累计时间", async () => {
    // stepTimeout 设很大不触发, 但 totalTimeout 触发
    const provider = new DelayedMockProvider(80); // 每次 managerDecide 80ms
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [{ role: "W", personality: "W", expertise: ["w"], allowedSkills: [] }],
      maxRounds: 10,
      stepTimeout: 5000,    // 单步超时很大
      totalTimeout: 50,     // 总超时 50ms, 第 1 轮 managerDecide 80ms 必超时
    };

    const result = await executor.execute({ message: "test" }, config, () => fastAgent());

    // stepTimeout (managerDecide 80ms) 比 totalTimeout (50ms) 先到, 但 80ms > 50ms 也会被 stepTimeout 命中
    expect(result.response).toContain("HIERARCHICAL 超时");
    expect(result.metadata.timedOut).toBe(true);
  });
});