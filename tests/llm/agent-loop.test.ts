import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLoop } from "../../src/llm/agent-loop.js";
import { SkillRegistry } from "../../src/registry/index.js";
import { defineSkill } from "../../src/types/index.js";
import type { LLMProvider, LLMResponse, LLMStreamChunk } from "../../src/llm/types.js";

vi.mock("../../src/user/request-context.js", () => ({
  requestContext: {
    run: vi.fn((store, callback) => callback()),
    getStore: vi.fn(() => ({ userId: "default" })),
  },
  getCurrentUserId: vi.fn(() => "default"),
}));

describe("AgentLoop", () => {
  let registry: SkillRegistry;
  let engine: any;
  let provider: LLMProvider;
  let agent: AgentLoop;

  beforeEach(() => {
    registry = new SkillRegistry();
    engine = {
      execute: vi.fn(),
    };
    provider = {
      name: "mock",
      model: "mock-model",
      chat: vi.fn(),
    } as unknown as LLMProvider;
    agent = new AgentLoop(registry, engine, provider, { maxIterations: 5, autoMemory: false });
  });

  it("should return final response without tool calls", async () => {
    (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "Hello, user!",
      toolCalls: [],
      finishReason: "stop",
    } as LLMResponse);

    const result = await agent.run("Hi there");
    expect(result.finalResponse).toBe("Hello, user!");
    expect(result.iterations).toBe(1);
    expect(result.hitMaxIterations).toBe(false);
    expect(result.steps[0].type).toBe("llm_response");
  });

  it("should execute tool calls and continue conversation", async () => {
    (provider.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "tc1", name: "echo", arguments: { text: "hello" } }],
        finishReason: "tool_calls",
      } as LLMResponse)
      .mockResolvedValueOnce({
        content: "Done with echo",
        toolCalls: [],
        finishReason: "stop",
      } as LLMResponse);

    engine.execute.mockResolvedValue({ success: true, data: "echoed: hello", trace: [], traceId: "t1" });

    registry.register(defineSkill({
      name: "echo",
      handler: async () => ({ success: true, data: "echoed" }),
    }));

    const result = await agent.run("Call echo");
    expect(result.finalResponse).toBe("Done with echo");
    expect(result.steps.some((s) => s.type === "tool_call")).toBe(true);
    expect(result.steps.some((s) => s.type === "tool_result")).toBe(true);
    expect(engine.execute).toHaveBeenCalledWith("echo", { text: "hello" });
  });

  it("should handle provider errors gracefully", async () => {
    (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Provider down"));

    await expect(agent.run("Hi")).rejects.toThrow("Provider down");
  });

  it("should handle tool execution errors", async () => {
    (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "",
      toolCalls: [{ id: "tc1", name: "fail_skill", arguments: {} }],
      finishReason: "tool_calls",
    } as LLMResponse);

    engine.execute.mockRejectedValue(new Error("Skill failed"));

    registry.register(defineSkill({
      name: "fail_skill",
      handler: async () => ({ success: false, error: new Error("Skill failed") }),
    }));

    const result = await agent.run("Trigger failure");
    expect(result.steps.some((s) => s.type === "tool_result" && !s.toolResult?.result.success)).toBe(true);
  });

  it("should respect maxIterations", async () => {
    (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "",
      toolCalls: [{ id: "tc1", name: "loop_skill", arguments: {} }],
      finishReason: "tool_calls",
    } as LLMResponse);

    engine.execute.mockResolvedValue({ success: true, data: {}, trace: [], traceId: "t1" });

    registry.register(defineSkill({
      name: "loop_skill",
      handler: async () => ({ success: true, data: {} }),
    }));

    const result = await agent.run("Loop");
    expect(result.hitMaxIterations).toBe(true);
  });

  it("should clear history", () => {
    agent.clearHistory("test-conv");
    // Should not throw
  });

  describe("runStream", () => {
    it("should yield text deltas", async () => {
      provider.chatStream = vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta", text: "Hello" } as LLMStreamChunk;
        yield { type: "text_delta", text: " world" } as LLMStreamChunk;
      });

      const events: any[] = [];
      for await (const event of agent.runStream("Hi", { conversationId: "stream-test" })) {
        events.push(event);
      }

      expect(events.some((e) => e.event === "text_delta" && e.data.text === "Hello")).toBe(true);
      expect(events.some((e) => e.event === "text_delta" && e.data.text === " world")).toBe(true);
      expect(events.some((e) => e.event === "done")).toBe(true);
    });

    it("should yield tool call events in stream", async () => {
      provider.chatStream = vi.fn().mockImplementation(async function* () {
        yield { type: "tool_call_complete", toolCallId: "tc1", toolCallName: "echo", toolCallArgs: "{}" } as LLMStreamChunk;
      });

      engine.execute.mockResolvedValue({ success: true, data: "ok", trace: [], traceId: "t1" });

      registry.register(defineSkill({
        name: "echo",
        handler: async () => ({ success: true, data: "ok" }),
      }));

      const events: any[] = [];
      for await (const event of agent.runStream("Hi")) {
        events.push(event);
      }

      expect(events.some((e) => e.event === "tool_call")).toBe(true);
      expect(events.some((e) => e.event === "tool_start")).toBe(true);
      expect(events.some((e) => e.event === "tool_result")).toBe(true);
    });

    it("should handle empty stream response", async () => {
      provider.chatStream = vi.fn().mockImplementation(async function* () {
        // Empty response - no content
      });

      const events: any[] = [];
      for await (const event of agent.runStream("Hi")) {
        events.push(event);
      }

      expect(events.some((e) => e.event === "done")).toBe(true);
    });
  });
});
