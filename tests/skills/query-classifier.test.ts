import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyQuery } from "../../src/skills/knowledge-skills.js";
import type { LLMProvider } from "../../src/llm/types.js";

function createMockLLM(responseContent: string): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      toolCalls: [],
      finishReason: "stop" as const,
    }),
  };
}

function createFailingLLM(): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn().mockRejectedValue(new Error("LLM API error")),
  };
}

describe("classifyQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should classify factual queries via rule engine", async () => {
    const result = await classifyQuery("什么是知识图谱");
    expect(result.type).toBe("factual");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.keywords.length).toBeGreaterThan(0);
  });

  it("should classify relational queries via rule engine", async () => {
    const result = await classifyQuery("A和B的关系是什么");
    expect(result.type).toBe("relational");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should classify discovery queries via rule engine", async () => {
    const result = await classifyQuery("还有什么新发现");
    expect(result.type).toBe("discovery");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should use LLM fallback for hybrid queries", async () => {
    const llm = createMockLLM('{"type":"factual","confidence":0.85}');
    const result = await classifyQuery("some random unknown query", llm);
    expect(result.type).toBe("factual");
    expect(result.confidence).toBe(0.85);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("should parse LLM response with markdown fences", async () => {
    const llm = createMockLLM(
      '```json\n{"type":"relational","confidence":0.9}\n```'
    );
    const result = await classifyQuery("another unknown query", llm);
    expect(result.type).toBe("relational");
    expect(result.confidence).toBe(0.9);
  });

  it("should return hybrid when no LLM provider is given", async () => {
    const result = await classifyQuery("completely ambiguous query with no keywords");
    expect(result.type).toBe("hybrid");
    expect(result.confidence).toBe(0.5);
  });

  it("should return hybrid on LLM error", async () => {
    const llm = createFailingLLM();
    const result = await classifyQuery("query that fails llm", llm);
    expect(result.type).toBe("hybrid");
    expect(result.confidence).toBe(0.5);
  });

  it("should cache classification results", async () => {
    const llm = createMockLLM('{"type":"discovery","confidence":0.8}');
    const query = "unique cache test query xyz789abc";

    const result1 = await classifyQuery(query, llm);
    expect(result1.type).toBe("discovery");

    const result2 = await classifyQuery(query, llm);
    expect(result2.type).toBe("discovery");

    // LLM should only be called once due to caching
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("should handle empty string", async () => {
    const result = await classifyQuery("");
    expect(result.type).toBe("hybrid");
    expect(result.confidence).toBe(0.5);
    expect(result.keywords).toEqual([]);
  });

  it("should handle very long query", async () => {
    const longQuery = "a".repeat(5000);
    const llm = createMockLLM('{"type":"factual","confidence":0.6}');
    const result = await classifyQuery(longQuery, llm);
    expect(result.type).toBe("factual");
    expect(result.confidence).toBe(0.6);
    expect(llm.chat).toHaveBeenCalledTimes(1);
    const prompt = (llm.chat as any).mock.calls[0][0][0].content;
    expect(prompt).toContain(longQuery);
  });
});
