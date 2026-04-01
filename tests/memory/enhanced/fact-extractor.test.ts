import { describe, it, expect, vi } from "vitest";
import { FactExtractor } from "../../../src/memory/enhanced/fact-extractor.js";
import type { LLMProvider } from "../../../src/llm/types.js";

const mockLLM = (content: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue({ content }),
  // 其他方法
} as any);

describe("FactExtractor", () => {
  it("should extract facts from valid LLM response", async () => {
    const extractor = new FactExtractor();
    const response = JSON.stringify([
      {
        key: "user_name",
        fact: "User's name is John",
        confidence: 0.95,
        tags: ["personal", "identity"],
      },
      {
        key: "birth_year",
        fact: "Born in 1990",
        confidence: 0.8,
        tags: ["personal"],
      },
    ]);

    const facts = await extractor.extract("Test text", mockLLM(response));
    expect(facts).toHaveLength(2);
    expect(facts[0].key).toBe("user_name");
    expect(facts[0].confidence).toBe(0.95);
  });

  it("should filter out low confidence facts", async () => {
    const extractor = new FactExtractor();
    const response = JSON.stringify([
      {
        key: "fact1",
        fact: "High confidence",
        confidence: 0.7,
        tags: [],
      },
      {
        key: "fact2",
        fact: "Low confidence",
        confidence: 0.3,
        tags: [],
      },
    ]);

    const facts = await extractor.extract("Test", mockLLM(response));
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe("fact1");
  });

  it("should handle markdown code fences", async () => {
    const extractor = new FactExtractor();
    const response = `Here are the facts:
\`\`\`json
[{"key": "test", "fact": "Test fact", "confidence": 0.9, "tags": []}]
\`\`\``;

    const facts = await extractor.extract("Text", mockLLM(response));
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe("test");
  });

  it("should return empty array on LLM error", async () => {
    const extractor = new FactExtractor();
    const failingLLM: LLMProvider = {
      chat: vi.fn().mockRejectedValue(new Error("API error")),
    } as any;

    const facts = await extractor.extract("Text", failingLLM);
    expect(facts).toEqual([]);
  });

  it("should return empty array when no LLM provided", async () => {
    const extractor = new FactExtractor();
    const facts = await extractor.extract("Text", undefined);
    expect(facts).toEqual([]);
  });

  it("should truncate entityContext to 1500 chars", async () => {
    const extractor = new FactExtractor();
    const llm = mockLLM("[]");
    const longContext = "a".repeat(2000);

    await extractor.extract("Text", llm, longContext);

    const call = (llm.chat as any).mock.calls[0];
    expect(call[0][0].content).toContain("a".repeat(1500));
    expect(call[0][0].content).not.toContain("a".repeat(2000));
  });
});
