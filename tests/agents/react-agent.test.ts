import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ReactAgent } from "../../src/agents/react-agent.js";
import type { AgentDeps, AgentProfile, AgentStreamEvent } from "../../src/agents/types.js";
import type { LLMProvider, LLMStreamChunk, Message, ToolDefinition } from "../../src/llm/types.js";
import type { SkillDefinition } from "../../src/types/index.js";

const testDb = new Database(":memory:");
vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

vi.mock("../../src/user/request-context.js", () => ({
  getCurrentUserId: vi.fn().mockReturnValue("default"),
}));

import { getCurrentUserId } from "../../src/user/request-context.js";

const mockProfile: AgentProfile = {
  role: "test-agent",
  personality: "You are a helpful test agent.",
  expertise: ["testing"],
  allowedSkills: [],
};

function createMockDeps(): AgentDeps {
  return {
    provider: {
      name: "mock",
      model: "mock-model",
      chat: vi.fn(),
      chatStream: vi.fn(),
    } as unknown as LLMProvider,
    engine: {
      execute: vi.fn(),
    } as unknown as AgentDeps["engine"],
    registry: {
      listVisible: vi.fn().mockReturnValue([]),
      lookup: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      onChange: vi.fn().mockReturnValue(() => {}),
    } as unknown as AgentDeps["registry"],
  };
}

describe("ReactAgent", () => {
  let deps: AgentDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.mocked(getCurrentUserId).mockReturnValue("default");
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should return basic response when provider returns text", async () => {
      const agent = new ReactAgent(mockProfile, deps);
      vi.mocked(deps.provider.chat).mockResolvedValue({
        content: "Hello, I can help you!",
        toolCalls: [],
        finishReason: "stop",
      });

      const result = await agent.run({ message: "Hi there" });

      expect(result.response).toBe("Hello, I can help you!");
      expect(result.level).toBe("react");
      expect(result.iterations).toBe(1);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].type).toBe("response");
    });

    it("should execute tool call loop and return result", async () => {
      const agent = new ReactAgent(mockProfile, deps);
      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "I'll use a tool",
          toolCalls: [{ id: "tc1", name: "test_skill", arguments: { query: "test" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Tool result: success",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockResolvedValue({
        success: true,
        data: { result: "found it" },
        trace: [],
        traceId: "t1",
      });

      const result = await agent.run({ message: "Do something" });

      expect(result.response).toBe("Tool result: success");
      expect(result.iterations).toBe(2);
      expect(deps.engine.execute).toHaveBeenCalledTimes(1);
      expect(deps.engine.execute).toHaveBeenCalledWith("test_skill", { query: "test" });
    });

    it("should handle multiple iterations (2+ tool calls)", async () => {
      const agent = new ReactAgent(mockProfile, deps);
      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "First tool",
          toolCalls: [{ id: "tc1", name: "skill_a", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Second tool",
          toolCalls: [{ id: "tc2", name: "skill_b", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "All done",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockResolvedValue({
        success: true,
        data: "ok",
        trace: [],
        traceId: "t1",
      });

      const result = await agent.run({ message: "Multi-step task" });

      expect(result.iterations).toBe(3);
      expect(deps.engine.execute).toHaveBeenCalledTimes(2);
      expect(result.response).toBe("All done");
    });

    it("should return max iterations error when limit reached", async () => {
      const agent = new ReactAgent(mockProfile, deps, { maxIterations: 2 });
      vi.mocked(deps.provider.chat).mockResolvedValue({
        content: "",
        toolCalls: [{ id: "tc1", name: "skill_a", arguments: {} }],
        finishReason: "tool_calls",
      });

      vi.mocked(deps.engine.execute).mockResolvedValue({
        success: true,
        data: "ok",
        trace: [],
        traceId: "t1",
      });

      const result = await agent.run({ message: "Infinite loop" });

      expect(result.iterations).toBe(2);
      expect(result.metadata.hitMaxIterations).toBe(true);
      expect(result.response).toBe("[ReAct Agent reached max iterations]");
    });

    it("should handle user confirmation as error in non-streaming mode", async () => {
      const agent = new ReactAgent(mockProfile, deps);
      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "Need confirmation",
          toolCalls: [
            { id: "tc1", name: "user_confirm", arguments: { type: "approval", title: "Confirm?" } },
          ],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Confirmed",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockResolvedValue({
        success: true,
        data: {
          __userConfirm: true,
          confirmId: "abc123",
          type: "approval",
          title: "Confirm?",
        },
        trace: [],
        traceId: "t1",
      });

      const result = await agent.run({ message: "Action needing confirmation" });

      // In non-streaming mode, __userConfirm is converted to an error
      const toolResultStep = result.steps.find((s) => s.type === "tool_result");
      expect(toolResultStep).toBeDefined();
      expect(toolResultStep!.data).toMatchObject({
        success: false,
        error: "user_confirm requires streaming mode (SSE)",
      });
    });

    it("should handle skill execution errors gracefully", async () => {
      const agent = new ReactAgent(mockProfile, deps);
      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "Trying tool",
          toolCalls: [{ id: "tc1", name: "bad_skill", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "I encountered an error but I'm okay",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockRejectedValue(new Error("Skill crashed"));

      const result = await agent.run({ message: "Trigger error" });

      expect(result.response).toBe("I encountered an error but I'm okay");
      const toolResultStep = result.steps.find((s) => s.type === "tool_result");
      expect(toolResultStep).toBeDefined();
      expect(toolResultStep!.data).toMatchObject({
        success: false,
        error: "Skill crashed",
      });
    });

    it("should inject memory context into system prompt", async () => {
      const agent = new ReactAgent(mockProfile, deps);
      vi.mocked(deps.provider.chat).mockResolvedValue({
        content: "Got it",
        toolCalls: [],
        finishReason: "stop",
      });

      await agent.run({
        message: "Remember this?",
        context: { memoryContext: "\n\n## 记忆\n- User likes coffee" },
      });

      const messages = vi.mocked(deps.provider.chat).mock.calls[0][0] as Message[];
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("User likes coffee");
    });

    it("should filter tools by allowed skills", async () => {
      vi.mocked(getCurrentUserId).mockReturnValue("user123");

      const profileWithAllowed: AgentProfile = {
        ...mockProfile,
        allowedSkills: ["allowed_skill"],
      };

      const allowedSkill: SkillDefinition = {
        name: "allowed_skill",
        version: "1.0.0",
        visible: true,
        autonomy: "MANUAL" as any,
        dependencies: [],
        timeout: 30000,
        retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
        handler: async () => ({ success: true }),
        description: "Allowed skill",
      };

      const mockSkillAccessService = {
        getAccessibleSkills: vi.fn().mockResolvedValue({
          skills: [allowedSkill],
          sourceMap: new Map(),
          permissions: [],
          isAdmin: false,
        }),
      };

      const agent = new ReactAgent(profileWithAllowed, deps, {
        skillAccessService: mockSkillAccessService as any,
      });

      vi.mocked(deps.provider.chat).mockResolvedValue({
        content: "Done",
        toolCalls: [],
        finishReason: "stop",
      });

      await agent.run({ message: "Test" });

      expect(mockSkillAccessService.getAccessibleSkills).toHaveBeenCalledWith(
        "user123",
        expect.objectContaining({
          visibleOnly: true,
          allowedSkills: ["allowed_skill"],
        }),
      );

      const tools = vi.mocked(deps.provider.chat).mock.calls[0][1] as ToolDefinition[];
      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toBe("allowed_skill");
    });
  });

  describe("runStream", () => {
    it("should emit stream events in correct order for text response", async () => {
      const agent = new ReactAgent(mockProfile, deps);

      async function* mockStream(): AsyncGenerator<LLMStreamChunk> {
        yield { type: "text_delta", text: "Hello" };
        yield { type: "text_delta", text: " world" };
        yield { type: "done" };
      }

      vi.mocked(deps.provider.chatStream).mockReturnValue(mockStream());

      const events: AgentStreamEvent[] = [];
      for await (const event of agent.runStream({ message: "Hi" })) {
        events.push(event);
      }

      expect(events[0].event).toBe("agent_start");
      expect(events[1].event).toBe("agent_thinking");
      expect(events[2].event).toBe("text_delta");
      expect(events[3].event).toBe("text_delta");
      expect(events[events.length - 1].event).toBe("agent_done");
    });

    it("should emit tool call events in correct order", async () => {
      const agent = new ReactAgent(mockProfile, deps);

      vi.mocked(deps.provider.chatStream)
        .mockReturnValueOnce(
          (async function* () {
            yield {
              type: "tool_call_complete",
              toolCallId: "tc1",
              toolCallName: "test_skill",
              toolCallArgs: "{}",
            };
          })(),
        )
        .mockReturnValueOnce(
          (async function* () {
            yield { type: "text_delta", text: "Result" };
            yield { type: "done" };
          })(),
        );

      vi.mocked(deps.engine.execute).mockResolvedValue({
        success: true,
        data: "tool result",
        trace: [],
        traceId: "t1",
      });

      const events: AgentStreamEvent[] = [];
      for await (const event of agent.runStream({ message: "Use tool" })) {
        events.push(event);
      }

      expect(events[0].event).toBe("agent_start");
      expect(events[1].event).toBe("agent_thinking");
      expect(events.some((e) => e.event === "tool_call")).toBe(true);
      expect(events.some((e) => e.event === "tool_start")).toBe(true);
      expect(events.some((e) => e.event === "tool_result")).toBe(true);
      expect(events[events.length - 1].event).toBe("agent_done");
    });
  });

describe("reflection", () => {
    it("should trigger reflection on tool error and retry with correction", async () => {
      // ROADMAP-Q3 item #1: 4-29 doc 9.1#2 "Reflection 模式" → ReactAgent 最小化 Reflection 实现
      const agent = new ReactAgent(mockProfile, deps, { reflectionEnabled: true });

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "I'll try tool",
          toolCalls: [{ id: "tc1", name: "test_skill", arguments: { query: "test" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Trying fixed query",
          toolCalls: [{ id: "tc2", name: "test_skill", arguments: { query: "fixed" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Success!",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute)
        .mockRejectedValueOnce(new Error("Invalid query"))
        .mockResolvedValueOnce({
          success: true,
          data: { result: "found it" },
          trace: [],
          traceId: "t1",
        });

      const result = await agent.run({ message: "Do something" });

      expect(result.response).toBe("Success!");
      // ROADMAP-Q3 item #1 最小化: 反思后立即重试, 不额外调一次反思 LLM.
      expect(deps.provider.chat).toHaveBeenCalledTimes(3);
      expect(deps.engine.execute).toHaveBeenCalledTimes(2);
      expect(result.metadata.reflectionCount).toBe(1);

      // Verify reflection message is in the conversation history for the retry
      const secondCallMessages = vi.mocked(deps.provider.chat).mock.calls[1][0] as Message[];
      expect(secondCallMessages.some((m) => m.role === "system" && m.content?.includes("Reflection"))).toBe(true);
    });

    // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
    it.skip("should detect loop and trigger reflection after same tool called 3 times", async () => {
      // TODO: reflection feature not yet implemented in ReactAgent
      const agent = new ReactAgent(mockProfile, deps, { reflectionEnabled: true });

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "Try 1",
          toolCalls: [{ id: "tc1", name: "test_skill", arguments: { query: "same" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Try 2",
          toolCalls: [{ id: "tc2", name: "test_skill", arguments: { query: "same" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Try 3",
          toolCalls: [{ id: "tc3", name: "test_skill", arguments: { query: "same" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "You are stuck in a loop. Try a different approach.",
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          content: "All done",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockResolvedValue({
        success: true,
        data: { result: "ok" },
        trace: [],
        traceId: "t1",
      });

      const result = await agent.run({ message: "Task" });

      expect(result.response).toBe("All done");
      expect(deps.engine.execute).toHaveBeenCalledTimes(3);
      expect(deps.provider.chat).toHaveBeenCalledTimes(5);
    });

    // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
    it.skip("should stop reflecting after max reflections limit", async () => {
      // TODO: reflection feature not yet implemented in ReactAgent
      const agent = new ReactAgent(mockProfile, deps, {
        reflectionEnabled: true,
        maxReflections: 2,
        maxIterations: 7,
      });

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "Try 1",
          toolCalls: [{ id: "tc1", name: "test_skill", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Reflect 1",
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          content: "Try 2",
          toolCalls: [{ id: "tc2", name: "test_skill", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Reflect 2",
          toolCalls: [],
          finishReason: "stop",
        })
        .mockResolvedValueOnce({
          content: "Try 3",
          toolCalls: [{ id: "tc3", name: "test_skill", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Try 4",
          toolCalls: [{ id: "tc4", name: "test_skill", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "I give up",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockRejectedValue(new Error("Always fails"));

      const result = await agent.run({ message: "Task" });

      expect(result.metadata.reflectionCount).toBe(2);
      expect(deps.provider.chat).toHaveBeenCalledTimes(7);
    });

    it("should not trigger reflection when disabled", async () => {
      const agent = new ReactAgent(mockProfile, deps, { reflectionEnabled: false });

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "Trying tool",
          toolCalls: [{ id: "tc1", name: "test_skill", arguments: {} }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Error occurred",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute).mockRejectedValue(new Error("Skill crashed"));

      const result = await agent.run({ message: "Trigger error" });

      expect(result.response).toBe("Error occurred");
      expect(deps.provider.chat).toHaveBeenCalledTimes(2);
    });

    it("should produce corrected result after reflection", async () => {
      // ROADMAP-Q3 item #1: 4-29 doc 9.1#2 "Reflection 模式" 最小化版本 — reflectionCount 正确反映反思次数.
      const agent = new ReactAgent(mockProfile, deps, { reflectionEnabled: true });

      vi.mocked(deps.provider.chat)
        .mockResolvedValueOnce({
          content: "I'll search for it",
          toolCalls: [{ id: "tc1", name: "search_skill", arguments: { q: "wrong" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Searching with correct parameter",
          toolCalls: [{ id: "tc2", name: "search_skill", arguments: { query: "correct" } }],
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "Here is the answer you were looking for.",
          toolCalls: [],
          finishReason: "stop",
        });

      vi.mocked(deps.engine.execute)
        .mockRejectedValueOnce(new Error("Unknown parameter 'q'"))
        .mockResolvedValueOnce({
          success: true,
          data: "The answer is 42",
          trace: [],
          traceId: "t1",
        });

      const result = await agent.run({ message: "Find the answer" });

      expect(result.response).toBe("Here is the answer you were looking for.");
      expect(result.metadata.reflectionCount).toBe(1);
    });

    // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
    it.skip("should yield reflection stream events in runStream", async () => {
      // TODO: reflection feature not yet implemented in ReactAgent
      const agent = new ReactAgent(mockProfile, deps, { reflectionEnabled: true });

      vi.mocked(deps.provider.chatStream)
        .mockReturnValueOnce(
          (async function* () {
            yield {
              type: "tool_call_complete",
              toolCallId: "tc1",
              toolCallName: "test_skill",
              toolCallArgs: "{}",
            };
          })(),
        )
        .mockReturnValueOnce(
          (async function* () {
            yield {
              type: "tool_call_complete",
              toolCallId: "tc2",
              toolCallName: "test_skill",
              toolCallArgs: "{}",
            };
          })(),
        )
        .mockReturnValueOnce(
          (async function* () {
            yield { type: "text_delta", text: "Success!" };
            yield { type: "done" };
          })(),
        );

      vi.mocked(deps.provider.chat).mockResolvedValueOnce({
        content: "Try checking the connection first.",
        toolCalls: [],
        finishReason: "stop",
      });

      vi.mocked(deps.engine.execute)
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce({
          success: true,
          data: "ok",
          trace: [],
          traceId: "t1",
        });

      const events: AgentStreamEvent[] = [];
      for await (const event of agent.runStream({ message: "Use tool" })) {
        events.push(event);
      }

      expect(events.some((e) => e.event === "reflection_start")).toBe(true);
      expect(events.some((e) => e.event === "reflection_thinking")).toBe(true);
      expect(events.some((e) => e.event === "reflection_done")).toBe(true);

      const reflectionEvents = events.filter((e) =>
        e.event === "reflection_start" || e.event === "reflection_thinking" || e.event === "reflection_done",
      );
      expect(reflectionEvents.map((e) => e.event)).toEqual([
        "reflection_start",
        "reflection_thinking",
        "reflection_done",
      ]);
    });
  });
});
