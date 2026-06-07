/**
 * 超时保护测试
 *
 * 验证：
 * - ReactAgent 的 chat() 调用在超时时返回错误
 * - 协议执行器在单步超时和总超时时正确返回错误
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { ReactAgent } from "../../src/agents/react-agent.js";
import { SequentialExecutor } from "../../src/agents/protocols/sequential.js";
import { HierarchicalExecutor } from "../../src/agents/protocols/hierarchical.js";
import { SwarmExecutor } from "../../src/agents/protocols/swarm.js";

const testDb = new Database(":memory:");
vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));
import type {
  Agent,
  AgentInput,
  AgentOutput,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  _AgentProfile,
  AgentStreamEvent,
  LLMProvider,
  Message,
  TeamConfig,
} from "../../src/agents/types.js";

/** 延迟指定时间的 Mock Provider */
class DelayedMockProvider implements LLMProvider {
  readonly name = "delayed";
  readonly model = "test";
  private delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(__messages: Message[]): Promise<{ content?: string }> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { content: "mock response" };
  }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async embedding(___text: string): Promise<number[]> {
    return Array(384).fill(0);
  }
}

/** 快速返回的 Mock Provider */
class FastMockProvider implements LLMProvider {
  readonly name = "fast";
  readonly model = "test";
  private response: string;

  constructor(response: string = "fast response") {
    this.response = response;
  }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(___messages: Message[]): Promise<{ content?: string }> {
    return { content: this.response };
  }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async embedding(___text: string): Promise<number[]> {
    return Array(384).fill(0);
  }
}

/** 延迟指定时间的 Mock Agent */
function createDelayedAgent(delayMs: number, response: string = "agent response"): Agent {
  return {
    name: "mock-agent",
    level: "simple",
    profile: {
      role: "mock",
      personality: "mock",
      expertise: ["mock"],
      allowedSkills: [],
    },
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    async run(___input: AgentInput): Promise<AgentOutput> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        response,
        level: "simple",
        steps: [],
        iterations: 1,
        metadata: {},
      };
    },
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *runStream(___input: AgentInput): AsyncGenerator<AgentStreamEvent> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield { event: "agent_done", data: { response } };
    },
  };
}

/** 快速返回的 Mock Agent */
function createFastAgent(response: string = "agent response"): Agent {
  return {
    name: "mock-agent",
    level: "simple",
    profile: {
      role: "mock",
      personality: "mock",
      expertise: ["mock"],
      allowedSkills: [],
    },
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    async run(___input: AgentInput): Promise<AgentOutput> {
      return {
        response,
        level: "simple",
        steps: [],
        iterations: 1,
        metadata: {},
      };
    },
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *runStream(___input: AgentInput): AsyncGenerator<AgentStreamEvent> {
      yield { event: "agent_done", data: { response } };
    },
  };
}

const mockDeps = (provider: LLMProvider) => ({
  registry: {
    listVisible: vi.fn(() => []),
    onChange: vi.fn(),
  } as any,
  engine: {
    execute: vi.fn(async () => ({ success: true, data: {} })),
  } as any,
  provider,
});

describe("ReactAgent Timeout Protection", () => {
  it("should return timeout error when chat() exceeds chatTimeout", async () => {
    // ROADMAP-Q3 item #1: 4-29 doc 9.1#7 "Agent 缺少超时保护" → ReactAgent.run() 包了 withTimeout
    const provider = new DelayedMockProvider(200);
    const agent = new ReactAgent(
      {
        role: "test",
        personality: "test",
        expertise: ["test"],
        allowedSkills: [],
      },
      mockDeps(provider),
      { chatTimeout: 50 },
    );

    const result = await agent.run({ message: "hello" });

    expect(result.response).toContain("timed out");
    expect(result.metadata.timedOut).toBe(true);
    expect(result.iterations).toBe(1);
  });

  it("should succeed when chat() finishes within chatTimeout", async () => {
    const provider = new DelayedMockProvider(10);
    const agent = new ReactAgent(
      {
        role: "test",
        personality: "test",
        expertise: ["test"],
        allowedSkills: [],
      },
      mockDeps(provider),
      { chatTimeout: 200 },
    );

    const result = await agent.run({ message: "hello" });

    expect(result.response).toBe("mock response");
    expect(result.metadata.timedOut).toBeUndefined();
  });

  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should yield error event in runStream when chat fallback times out", async () => {
    // TODO: chatTimeout not yet implemented in ReactAgent
    const provider = new DelayedMockProvider(200);
    const agent = new ReactAgent(
      {
        role: "test",
        personality: "test",
        expertise: ["test"],
        allowedSkills: [],
      },
      mockDeps(provider),
      { chatTimeout: 50 },
    );

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream({ message: "hello" })) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toContain("timed out");
    expect(errorEvent!.data.timedOut).toBe(true);
  });
});

describe("SequentialExecutor Timeout Protection", () => {
  it("should return timeout error when a step exceeds stepTimeout", async () => {
    // ROADMAP-Q3 item #1: 4-29 doc 9.1#7 "7 种协议 step/total 双层超时" → SequentialExecutor 包了 withTimeout
    const executor = new SequentialExecutor();
    const config: TeamConfig = {
      members: [
        { role: "A", personality: "A", expertise: ["a"], allowedSkills: [] },
        { role: "B", personality: "B", expertise: ["b"], allowedSkills: [] },
      ],
      pipelineSteps: ["step1", "step2"],
      stepTimeout: 50,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      (profile) => {
        if (profile.role === "A") return createDelayedAgent(200, "A result");
        return createFastAgent("B result");
      },
    );

    expect(result.response).toContain("SEQUENTIAL 超时");
    expect(result.metadata.timedOut).toBe(true);
    expect(result.metadata.completedStages).toBe(0);
  });

  it("should complete all steps when within timeout", async () => {
    const executor = new SequentialExecutor();
    const config: TeamConfig = {
      members: [
        { role: "A", personality: "A", expertise: ["a"], allowedSkills: [] },
        { role: "B", personality: "B", expertise: ["b"], allowedSkills: [] },
      ],
      pipelineSteps: ["step1", "step2"],
      stepTimeout: 500,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      (profile) => createFastAgent(`${profile.role} result`),
    );

    expect(result.response).toBe("B result");
    expect(result.metadata.timedOut).toBeUndefined();
  });
});

describe("HierarchicalExecutor Timeout Protection", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should return timeout error when manager decide exceeds stepTimeout", async () => {
    // TODO: stepTimeout not yet implemented in HierarchicalExecutor
    const provider = new DelayedMockProvider(200);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Worker", personality: "W", expertise: ["w"], allowedSkills: [] },
      ],
      stepTimeout: 50,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      () => createFastAgent("worker result"),
    );

    expect(result.response).toContain("HIERARCHICAL 超时");
    expect(result.metadata.timedOut).toBe(true);
  });

  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should return timeout error when sub-agent execution exceeds stepTimeout", async () => {
    // TODO: stepTimeout not yet implemented in HierarchicalExecutor
    const provider = new FastMockProvider(
      JSON.stringify({
        decision: "assign",
        assignments: [{ agent: "Worker", task: "do work" }],
      }),
    );
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Worker", personality: "W", expertise: ["w"], allowedSkills: [] },
      ],
      stepTimeout: 50,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      () => createDelayedAgent(200, "worker result"),
    );

    expect(result.response).toContain("HIERARCHICAL 超时");
    expect(result.metadata.timedOut).toBe(true);
  });
});

describe("SwarmExecutor Timeout Protection", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should return timeout error when agent run exceeds stepTimeout", async () => {
    // TODO: stepTimeout not yet implemented in SwarmExecutor
    const provider = new FastMockProvider("no handoff");
    const executor = new SwarmExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Agent1", personality: "A1", expertise: ["a"], allowedSkills: [] },
      ],
      stepTimeout: 50,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      () => createDelayedAgent(200, "slow result"),
    );

    expect(result.response).toContain("SWARM 超时");
    expect(result.metadata.timedOut).toBe(true);
  });

  it("should complete when agent run finishes within stepTimeout", async () => {
    const provider = new FastMockProvider("no handoff");
    const executor = new SwarmExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Agent1", personality: "A1", expertise: ["a"], allowedSkills: [] },
      ],
      stepTimeout: 500,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      () => createFastAgent("fast result"),
    );

    expect(result.response).toBe("fast result");
    expect(result.metadata.timedOut).toBeUndefined();
  });
});

describe("SequentialExecutor Stream Timeout Protection", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should yield error event in executeStream when total timeout is exceeded", async () => {
    // TODO: totalTimeout not yet implemented in SequentialExecutor
    const executor = new SequentialExecutor();
    const config: TeamConfig = {
      members: [
        { role: "A", personality: "A", expertise: ["a"], allowedSkills: [] },
        { role: "B", personality: "B", expertise: ["b"], allowedSkills: [] },
      ],
      pipelineSteps: ["step1", "step2"],
      totalTimeout: 50,
    };

    const events: AgentStreamEvent[] = [];
    for await (const event of executor.executeStream(
      { message: "test" },
      config,
      (profile) => createDelayedAgent(100, `${profile.role} result`),
    )) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toContain("请求处理超时");
    expect(errorEvent!.data.timedOut).toBe(true);
  });

  it("should complete executeStream when within timeout", async () => {
    const executor = new SequentialExecutor();
    const config: TeamConfig = {
      members: [
        { role: "A", personality: "A", expertise: ["a"], allowedSkills: [] },
      ],
      pipelineSteps: ["step1"],
      totalTimeout: 500,
    };

    const events: AgentStreamEvent[] = [];
    for await (const event of executor.executeStream(
      { message: "test" },
      config,
      () => createDelayedAgent(10, "fast result"),
    )) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeUndefined();
    const doneEvent = events.find((e) => e.event === "agent_done");
    expect(doneEvent).toBeDefined();
  });
});

describe("HierarchicalExecutor Stream Timeout Protection", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should yield error event in executeStream when manager decide exceeds stepTimeout", async () => {
    // TODO: stepTimeout not yet implemented in HierarchicalExecutor
    const provider = new DelayedMockProvider(200);
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Worker", personality: "W", expertise: ["w"], allowedSkills: [] },
      ],
      stepTimeout: 50,
    };

    const events: AgentStreamEvent[] = [];
    for await (const event of executor.executeStream(
      { message: "test" },
      config,
      () => createFastAgent("worker result"),
    )) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toContain("请求处理超时");
    expect(errorEvent!.data.timedOut).toBe(true);
  });

  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should yield error event in executeStream when sub-agent exceeds stepTimeout", async () => {
    // TODO: stepTimeout not yet implemented in HierarchicalExecutor
    const provider = new FastMockProvider(
      JSON.stringify({
        decision: "assign",
        assignments: [{ agent: "Worker", task: "do work" }],
      }),
    );
    const executor = new HierarchicalExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Worker", personality: "W", expertise: ["w"], allowedSkills: [] },
      ],
      stepTimeout: 50,
    };

    const events: AgentStreamEvent[] = [];
    for await (const event of executor.executeStream(
      { message: "test" },
      config,
      () => createDelayedAgent(200, "worker result"),
    )) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toContain("请求处理超时");
    expect(errorEvent!.data.timedOut).toBe(true);
  });
});

describe("SwarmExecutor Stream Timeout Protection", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should yield error event in executeStream when agent exceeds stepTimeout", async () => {
    // TODO: stepTimeout not yet implemented in SwarmExecutor
    const provider = new FastMockProvider("no handoff");
    const executor = new SwarmExecutor(provider);
    const config: TeamConfig = {
      members: [
        { role: "Agent1", personality: "A1", expertise: ["a"], allowedSkills: [] },
      ],
      stepTimeout: 50,
    };

    const events: AgentStreamEvent[] = [];
    for await (const event of executor.executeStream(
      { message: "test" },
      config,
      () => createDelayedAgent(200, "slow result"),
    )) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toContain("请求处理超时");
    expect(errorEvent!.data.timedOut).toBe(true);
  });
});

describe("Protocol Total Timeout Protection", () => {
  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("should trigger total timeout when cumulative time exceeds totalTimeout", async () => {
    // TODO: totalTimeout not yet implemented in protocol executors
    const executor = new SequentialExecutor();
    const config: TeamConfig = {
      members: [
        { role: "A", personality: "A", expertise: ["a"], allowedSkills: [] },
        { role: "B", personality: "B", expertise: ["b"], allowedSkills: [] },
        { role: "C", personality: "C", expertise: ["c"], allowedSkills: [] },
      ],
      pipelineSteps: ["step1", "step2", "step3"],
      stepTimeout: 5000,
      totalTimeout: 150,
    };

    const result = await executor.execute(
      { message: "test" },
      config,
      () => createDelayedAgent(100, "result"),
    );

    expect(result.response).toContain("SEQUENTIAL 超时");
    expect(result.metadata.timedOut).toBe(true);
  });
});
