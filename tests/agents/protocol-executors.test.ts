import { describe, it, expect, vi } from "vitest";
import { A2AExecutor } from "../../src/agents/protocols/a2a.js";
import { ContractNetExecutor } from "../../src/agents/protocols/contract-net.js";
import { MarketBasedExecutor } from "../../src/agents/protocols/market-based.js";
import { BlackboardExecutor } from "../../src/agents/protocols/blackboard.js";
import type { Agent, AgentOutput, AgentProfile, AgentStreamEvent } from "../../src/agents/types.js";
import type { LLMProvider, Message } from "../../src/llm/types.js";

function createMockAgent(result: string): Agent {
  return {
    name: "mock-agent",
    level: "simple",
    profile: { role: "mock", personality: "mock", expertise: [], allowedSkills: [] },
    run: vi.fn().mockResolvedValue({
      response: result,
      level: "simple",
      steps: [],
      iterations: 1,
      metadata: {},
    } as AgentOutput),
    runStream: async function* () {
      yield { event: "agent_done", data: { response: result } } as AgentStreamEvent;
    },
  };
}

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn(),
  } as unknown as LLMProvider;
}

describe("Protocol Executors", () => {
  describe("A2A", () => {
    it("should run two agents communicating without crashing", async () => {
      const provider = createMockProvider();
      vi.mocked(provider.chat).mockResolvedValue({ content: "0", toolCalls: [], finishReason: "stop" });

      const executor = new A2AExecutor(provider);
      const config = {
        members: [
          { role: "agent1", personality: "p1", expertise: ["e1"], allowedSkills: [] },
          { role: "agent2", personality: "p2", expertise: ["e2"], allowedSkills: [] },
        ],
        maxRounds: 3,
      };

      const factory = vi.fn().mockImplementation((profile: AgentProfile) => {
        return createMockAgent(`${profile.role} result`);
      });

      const result = await executor.execute({ message: "test" }, config, factory);

      expect(result.protocol).toBe("A2A");
      expect(result.response).toBe("agent1 result");
      expect(factory).toHaveBeenCalled();
    });
  });

  describe("CONTRACT_NET", () => {
    it("should announce task and accept a bid", async () => {
      const provider = createMockProvider();
      vi.mocked(provider.chat).mockImplementation(async (messages: Message[]) => {
        const content = messages[messages.length - 1]?.content ?? "";
        if (content.includes("招标")) {
          return {
            content: '{"confidence": 0.9, "approach": "I can do this", "estimatedSteps": 3}',
            toolCalls: [],
            finishReason: "stop",
          };
        }
        return { content: "Contract result", toolCalls: [], finishReason: "stop" };
      });

      const executor = new ContractNetExecutor(provider);
      const config = {
        members: [
          { role: "bidder1", personality: "p1", expertise: ["e1"], allowedSkills: [] },
          { role: "bidder2", personality: "p2", expertise: ["e2"], allowedSkills: [] },
        ],
      };

      const factory = vi.fn().mockImplementation((profile: AgentProfile) => {
        return createMockAgent(`${profile.role} executed`);
      });

      const result = await executor.execute({ message: "test task" }, config, factory);

      expect(result.protocol).toBe("CONTRACT_NET");
      expect(result.response).toBe("bidder1 executed");
      expect(result.metadata.totalBids).toBe(2);
    });
  });

  describe("MARKET_BASED", () => {
    it("should decompose task and assign to lowest cost agent", async () => {
      const provider = createMockProvider();
      vi.mocked(provider.chat).mockImplementation(async (messages: Message[]) => {
        const content = messages[messages.length - 1]?.content ?? "";
        if (content.includes("分解")) {
          return {
            content: '[{"id":1,"description":"subtask 1","complexity":"low"}]',
            toolCalls: [],
            finishReason: "stop",
          };
        }
        return { content: "Market merged result", toolCalls: [], finishReason: "stop" };
      });

      const executor = new MarketBasedExecutor(provider);
      const config = {
        members: [
          { role: "cheap", personality: "p1", expertise: ["e1"], allowedSkills: [], costPerToken: 0.1 },
          { role: "expensive", personality: "p2", expertise: ["e2"], allowedSkills: [], costPerToken: 1.0 },
        ],
      };

      const factory = vi.fn().mockImplementation((profile: AgentProfile) => {
        return createMockAgent(`${profile.role} done`);
      });

      const result = await executor.execute({ message: "test task" }, config, factory);

      expect(result.protocol).toBe("MARKET_BASED");
      expect(result.response).toBe("cheap done");
      expect(result.metadata.fragments).toBe(1);
    });
  });

  describe("BLACKBOARD", () => {
    it("should allow agents to write to shared board", async () => {
      const provider = createMockProvider();
      vi.mocked(provider.chat).mockImplementation(async (messages: Message[]) => {
        const content = messages[messages.length - 1]?.content ?? "";
        if (content.includes("哪些专家")) {
          return { content: '["expert1"]', toolCalls: [], finishReason: "stop" };
        }
        return { content: "Blackboard synthesis", toolCalls: [], finishReason: "stop" };
      });

      const executor = new BlackboardExecutor(provider);
      const config = {
        members: [
          { role: "expert1", personality: "p1", expertise: ["e1"], allowedSkills: [] },
        ],
        maxRounds: 3,
      };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
      const factory = vi.fn().mockImplementation((__profile: AgentProfile) => {
        return createMockAgent("[BB:conclusion] Final answer from blackboard");
      });

      const result = await executor.execute({ message: "test task" }, config, factory);

      expect(result.protocol).toBe("BLACKBOARD");
      expect(result.response).toBe("Final answer from blackboard");
      expect(result.metadata.boardEntries).toBeGreaterThan(0);
    });
  });
});
