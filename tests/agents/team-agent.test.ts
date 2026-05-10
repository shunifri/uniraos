import { describe, it, expect, beforeEach, vi } from "vitest";
import { TeamAgent } from "../../src/agents/team-agent.js";
import type { AgentDeps, Protocol, TeamConfig } from "../../src/agents/types.js";
import type { LLMProvider, Message } from "../../src/llm/types.js";

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn(),
  } as unknown as LLMProvider;
}

function createMockDeps(): AgentDeps {
  return {
    provider: createMockProvider(),
    engine: {
      execute: vi.fn().mockResolvedValue({ success: true, data: "ok", trace: [], traceId: "t1" }),
    } as unknown as AgentDeps["engine"],
    registry: {
      listVisible: vi.fn().mockReturnValue([]),
      lookup: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as AgentDeps["registry"],
  };
}

function createSequentialConfig(): TeamConfig {
  return {
    members: [
      { role: "analyst", personality: "You are an analyst.", expertise: ["analysis"], allowedSkills: [] },
      { role: "writer", personality: "You are a writer.", expertise: ["writing"], allowedSkills: [] },
    ],
    pipelineSteps: ["analyze", "write"],
  };
}

function createHierarchicalConfig(): TeamConfig {
  return {
    members: [
      { role: "analyst", personality: "You are an analyst.", expertise: ["analysis"], allowedSkills: [] },
      { role: "writer", personality: "You are a writer.", expertise: ["writing"], allowedSkills: [] },
    ],
    manager: { role: "manager", personality: "You are a manager.", expertise: ["management"], allowedSkills: [] },
    maxRounds: 5,
  };
}

function createSwarmConfig(): TeamConfig {
  return {
    members: [
      { role: "agent_a", personality: "You are agent A.", expertise: ["topic_a"], allowedSkills: [] },
      { role: "agent_b", personality: "You are agent B.", expertise: ["topic_b"], allowedSkills: [] },
    ],
    maxRounds: 5,
  };
}

describe("TeamAgent", () => {
  let deps: AgentDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  describe("SEQUENTIAL protocol", () => {
    it("should execute 2 members in order and pass result through", async () => {
      const config = createSequentialConfig();
      const agent = new TeamAgent("SEQUENTIAL", config, deps);

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({ content: "analysis complete", toolCalls: [], finishReason: "stop" })
        .mockResolvedValueOnce({ content: "final report", toolCalls: [], finishReason: "stop" });

      const result = await agent.run({ message: "Analyze and report" });

      expect(result.protocol).toBe("SEQUENTIAL");
      expect(result.response).toBe("final report");
      expect(result.agents).toContain("analyst");
      expect(result.agents).toContain("writer");

      // Verify the second agent received the first agent's output
      const calls = vi.mocked(deps.provider.chat).mock.calls;
      const secondCallMessages = calls[1][0] as Message[];
      const lastMessage = secondCallMessages[secondCallMessages.length - 1];
      expect(lastMessage.content).toBe("analysis complete");
    });
  });

  describe("HIERARCHICAL protocol", () => {
    it("should delegate from manager to worker and aggregate result", async () => {
      const config = createHierarchicalConfig();
      const agent = new TeamAgent("HIERARCHICAL", config, deps);

      let callCount = 0;
      vi.mocked(deps.provider.chat).mockImplementation(async (messages: Message[]) => {
        callCount++;
        const content = messages[messages.length - 1]?.content ?? "";

        if (content.includes("做出决策") || content.includes("决策")) {
          if (callCount <= 1) {
            return {
              content:
                '```json\n{"decision":"assign","assignments":[{"agent":"analyst","task":"do analysis"}]}\n```',
              toolCalls: [],
              finishReason: "stop",
            };
          }
          return {
            content: '```json\n{"decision":"complete","summary":"Final aggregated answer"}\n```',
            toolCalls: [],
            finishReason: "stop",
          };
        }

        if (content.includes("合并") || content.includes("综合")) {
          return { content: "Merged result", toolCalls: [], finishReason: "stop" };
        }

        return { content: "Worker result", toolCalls: [], finishReason: "stop" };
      });

      const result = await agent.run({ message: "Complex task" });

      expect(result.protocol).toBe("HIERARCHICAL");
      expect(result.response).toBe("Final aggregated answer");
    });
  });

  describe("SWARM protocol", () => {
    it("should handoff between agents and return final answer", async () => {
      const config = createSwarmConfig();
      const agent = new TeamAgent("SWARM", config, deps);

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content:
            'I think agent B should handle this.\n```json\n{"handoff": true, "target": "agent_b", "reason": "better fit"}\n```',
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          content: "Agent B final answer",
          toolCalls: [],
          finishReason: "stop",
        });

      const result = await agent.run({ message: "Swarm task" });

      expect(result.protocol).toBe("SWARM");
      expect(result.response).toBe("Agent B final answer");
      expect(result.agents).toContain("agent_a");
      expect(result.agents).toContain("agent_b");
    });
  });

  describe("Invalid protocol", () => {
    it("should throw error for unknown protocol", () => {
      expect(() => {
        new TeamAgent("INVALID" as Protocol, createSequentialConfig(), deps);
      }).toThrow("Unknown protocol: INVALID");
    });
  });

  describe("runStream", () => {
    it("should yield strategy_selected event for SEQUENTIAL", async () => {
      const config = createSequentialConfig();
      const agent = new TeamAgent("SEQUENTIAL", config, deps);

      vi.mocked(deps.provider.chat).mockResolvedValue({
        content: "step result",
        toolCalls: [],
        finishReason: "stop",
      });

      const events = [];
      for await (const event of agent.runStream({ message: "Test" })) {
        events.push(event);
      }

      expect(events[0].event).toBe("strategy_selected");
      expect(events[0].data.protocol).toBe("SEQUENTIAL");
    });
  });
});
