import { describe, it, expect, vi } from "vitest";
import {
  SearchEnhancer,
  type EnhancedLTMEntry,
  type FilterExpression,
  type MetadataFilter,
} from "../../../src/memory/enhanced/search-enhancer.js";
import type { LLMProvider, LLMResponse } from "../../../src/llm/types.js";

// ---- Helpers ----

function makeEntry(overrides: Partial<EnhancedLTMEntry> = {}): EnhancedLTMEntry {
  return {
    id: overrides.id ?? "id-1",
    key: overrides.key ?? "key-1",
    value: overrides.value ?? "some value",
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: overrides.updatedAt ?? 2000,
    accessCount: overrides.accessCount ?? 1,
    lastAccessedAt: overrides.lastAccessedAt ?? 3000,
    score: overrides.score,
    source: overrides.source,
    summary: overrides.summary,
    metadata: overrides.metadata,
  };
}

function makeLLMProvider(response: Partial<LLMResponse> = {}): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn().mockResolvedValue({
      content: response.content ?? "",
      toolCalls: response.toolCalls ?? [],
      finishReason: response.finishReason ?? "stop",
    }),
  };
}

// ---- Tests ----

describe("SearchEnhancer", () => {
  const enhancer = new SearchEnhancer();

  // ==================== rerank ====================

  describe("rerank", () => {
    it("should return empty array for empty results", async () => {
      const llm = makeLLMProvider();
      const result = await enhancer.rerank("test query", [], llm);
      expect(result).toEqual([]);
      expect(llm.chat).not.toHaveBeenCalled();
    });

    it("should rerank results based on LLM scores", async () => {
      const entries = [
        makeEntry({ id: "a", summary: "About cats", score: 0.9 }),
        makeEntry({ id: "b", summary: "About dogs", score: 0.8 }),
        makeEntry({ id: "c", summary: "About fish", score: 0.7 }),
      ];

      const llm = makeLLMProvider({
        content: JSON.stringify([
          { index: 0, score: 0.3 },
          { index: 1, score: 0.95 },
          { index: 2, score: 0.5 },
        ]),
      });

      const result = await enhancer.rerank("best pet", entries, llm);

      expect(result).toHaveLength(3);
      expect(result[0].entry.id).toBe("b");
      expect(result[0].relevanceScore).toBe(0.95);
      expect(result[1].entry.id).toBe("c");
      expect(result[2].entry.id).toBe("a");
    });

    it("should handle LLM response wrapped in markdown fences", async () => {
      const entries = [
        makeEntry({ id: "a", score: 0.5 }),
        makeEntry({ id: "b", score: 0.5 }),
      ];

      const llm = makeLLMProvider({
        content: '```json\n[{"index":0,"score":0.2},{"index":1,"score":0.8}]\n```',
      });

      const result = await enhancer.rerank("query", entries, llm);
      expect(result[0].entry.id).toBe("b");
      expect(result[1].entry.id).toBe("a");
    });

    it("should clamp scores to 0-1", async () => {
      const entries = [makeEntry({ id: "a" })];
      const llm = makeLLMProvider({
        content: '[{"index":0,"score":5.0}]',
      });
      const result = await enhancer.rerank("query", entries, llm);
      expect(result[0].relevanceScore).toBe(1);
    });

    it("should fall back to original order on LLM error", async () => {
      const entries = [
        makeEntry({ id: "a", score: 0.9 }),
        makeEntry({ id: "b", score: 0.8 }),
      ];
      const llm = makeLLMProvider();
      (llm.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM down"));

      const result = await enhancer.rerank("query", entries, llm);
      expect(result).toHaveLength(2);
      expect(result[0].entry.id).toBe("a");
      expect(result[0].relevanceScore).toBe(0.9);
    });

    it("should fall back on invalid JSON", async () => {
      const entries = [makeEntry({ id: "a", score: 0.5 })];
      const llm = makeLLMProvider({ content: "I cannot do that." });
      const result = await enhancer.rerank("query", entries, llm);
      expect(result[0].relevanceScore).toBe(0.5);
    });

    it("should only send top 20 to LLM and append the rest", async () => {
      const entries = Array.from({ length: 25 }, (_, i) =>
        makeEntry({ id: `id-${i}`, score: 1 - i * 0.01, summary: `item ${i}` }),
      );

      // LLM returns all 20 with uniform score so order is stable
      const scores = Array.from({ length: 20 }, (_, i) => ({ index: i, score: 0.5 }));
      const llm = makeLLMProvider({ content: JSON.stringify(scores) });

      const result = await enhancer.rerank("query", entries, llm);
      expect(result).toHaveLength(25);
      // Last 5 should be the un-reranked tail
      expect(result[20].entry.id).toBe("id-20");
      expect(result[24].entry.id).toBe("id-24");
    });

    it("should use entry.value when summary is not present", async () => {
      const entries = [makeEntry({ id: "a", value: "my important value" })];
      const llm = makeLLMProvider({
        content: '[{"index":0,"score":0.7}]',
      });

      await enhancer.rerank("query", entries, llm);
      const callArgs = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs[1].content).toContain("my important value");
    });

    it("should use fallback score 0 when entry has no score", async () => {
      const entries = [makeEntry({ id: "a" })]; // no score
      const llm = makeLLMProvider({ content: "no json here at all" });
      const result = await enhancer.rerank("query", entries, llm);
      expect(result[0].relevanceScore).toBe(0);
    });
  });

  // ==================== applyMetadataFilters ====================

  describe("applyMetadataFilters", () => {
    // ---- metadata (equality) ----

    it("should filter by exact metadata equality", () => {
      const entries = [
        makeEntry({ id: "a", source: "web" }),
        makeEntry({ id: "b", source: "file" }),
      ];
      const filter: MetadataFilter = {
        key: "source",
        value: "web",
        filterType: "metadata",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should handle negate flag", () => {
      const entries = [
        makeEntry({ id: "a", source: "web" }),
        makeEntry({ id: "b", source: "file" }),
      ];
      const filter: MetadataFilter = {
        key: "source",
        value: "web",
        filterType: "metadata",
        negate: true,
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("b");
    });

    // ---- numeric ----

    it("should filter by numeric > operator", () => {
      const entries = [
        makeEntry({ id: "a", accessCount: 5 }),
        makeEntry({ id: "b", accessCount: 15 }),
      ];
      const filter: MetadataFilter = {
        key: "accessCount",
        value: 10,
        filterType: "numeric",
        numericOperator: ">",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("b");
    });

    it("should filter by numeric <= operator", () => {
      const entries = [
        makeEntry({ id: "a", accessCount: 10 }),
        makeEntry({ id: "b", accessCount: 15 }),
      ];
      const filter: MetadataFilter = {
        key: "accessCount",
        value: 10,
        filterType: "numeric",
        numericOperator: "<=",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should filter by numeric = (default operator)", () => {
      const entries = [
        makeEntry({ id: "a", accessCount: 10 }),
        makeEntry({ id: "b", accessCount: 5 }),
      ];
      const filter: MetadataFilter = {
        key: "accessCount",
        value: 10,
        filterType: "numeric",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should return false for NaN numeric comparison", () => {
      const entries = [makeEntry({ id: "a", metadata: { rank: "not-a-number" } })];
      const filter: MetadataFilter = {
        key: "rank",
        value: 5,
        filterType: "numeric",
        numericOperator: ">",
      };
      expect(enhancer.applyMetadataFilters(entries, filter)).toHaveLength(0);
    });

    // ---- array_contains ----

    it("should filter by array_contains", () => {
      const entries = [
        makeEntry({ id: "a", tags: ["food", "recipe"] }),
        makeEntry({ id: "b", tags: ["travel"] }),
      ];
      const filter: MetadataFilter = {
        key: "tags",
        value: "food",
        filterType: "array_contains",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should return empty for array_contains on non-array field", () => {
      const entries = [makeEntry({ id: "a", source: "web" })];
      const filter: MetadataFilter = {
        key: "source",
        value: "web",
        filterType: "array_contains",
      };
      expect(enhancer.applyMetadataFilters(entries, filter)).toHaveLength(0);
    });

    // ---- string_contains ----

    it("should filter by string_contains", () => {
      const entries = [
        makeEntry({ id: "a", summary: "A recipe for pasta" }),
        makeEntry({ id: "b", summary: "Travel guide" }),
      ];
      const filter: MetadataFilter = {
        key: "summary",
        value: "recipe",
        filterType: "string_contains",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    // ---- nested AND/OR ----

    it("should handle AND filter", () => {
      const entries = [
        makeEntry({ id: "a", source: "web", tags: ["important"] }),
        makeEntry({ id: "b", source: "web", tags: [] }),
        makeEntry({ id: "c", source: "file", tags: ["important"] }),
      ];
      const filter: FilterExpression = {
        AND: [
          { key: "source", value: "web", filterType: "metadata" },
          { key: "tags", value: "important", filterType: "array_contains" },
        ],
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should handle OR filter", () => {
      const entries = [
        makeEntry({ id: "a", source: "web" }),
        makeEntry({ id: "b", source: "file" }),
        makeEntry({ id: "c", source: "api" }),
      ];
      const filter: FilterExpression = {
        OR: [
          { key: "source", value: "web", filterType: "metadata" },
          { key: "source", value: "api", filterType: "metadata" },
        ],
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toEqual(["a", "c"]);
    });

    it("should handle deeply nested AND/OR", () => {
      const entries = [
        makeEntry({ id: "a", source: "web", accessCount: 20, tags: ["urgent"] }),
        makeEntry({ id: "b", source: "file", accessCount: 5, tags: ["urgent"] }),
        makeEntry({ id: "c", source: "web", accessCount: 2, tags: [] }),
      ];
      const filter: FilterExpression = {
        AND: [
          {
            OR: [
              { key: "source", value: "web", filterType: "metadata" },
              { key: "source", value: "file", filterType: "metadata" },
            ],
          },
          { key: "accessCount", value: 10, filterType: "numeric", numericOperator: ">" },
        ],
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should match all entries for empty AND/OR arrays", () => {
      const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
      expect(enhancer.applyMetadataFilters(entries, { AND: [] })).toHaveLength(2);
      expect(enhancer.applyMetadataFilters(entries, { OR: [] })).toHaveLength(2);
    });

    // ---- metadata field resolution ----

    it("should resolve keys from entry.metadata", () => {
      const entries = [
        makeEntry({ id: "a", metadata: { priority: "high" } }),
        makeEntry({ id: "b", metadata: { priority: "low" } }),
      ];
      const filter: MetadataFilter = {
        key: "priority",
        value: "high",
        filterType: "metadata",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("should resolve dotted key paths in metadata", () => {
      const entries = [
        makeEntry({ id: "a", metadata: { nested: { level: 3 } } }),
        makeEntry({ id: "b", metadata: { nested: { level: 1 } } }),
      ];
      const filter: MetadataFilter = {
        key: "nested.level",
        value: 2,
        filterType: "numeric",
        numericOperator: ">",
      };
      const result = enhancer.applyMetadataFilters(entries, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });
  });

  // ==================== rewriteQuery ====================

  describe("rewriteQuery", () => {
    it("should return LLM-rewritten query", async () => {
      const llm = makeLLMProvider({
        content: "best practices for TypeScript error handling patterns",
      });
      const result = await enhancer.rewriteQuery("ts error handling", llm);
      expect(result).toBe("best practices for TypeScript error handling patterns");
    });

    it("should return original query on LLM error", async () => {
      const llm = makeLLMProvider();
      (llm.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
      const result = await enhancer.rewriteQuery("original query", llm);
      expect(result).toBe("original query");
    });

    it("should return original query when LLM returns empty string", async () => {
      const llm = makeLLMProvider({ content: "  " });
      const result = await enhancer.rewriteQuery("original query", llm);
      expect(result).toBe("original query");
    });

    it("should return original query when LLM returns null content", async () => {
      const llm = makeLLMProvider({ content: null as unknown as string });
      const result = await enhancer.rewriteQuery("original query", llm);
      expect(result).toBe("original query");
    });
  });
});
