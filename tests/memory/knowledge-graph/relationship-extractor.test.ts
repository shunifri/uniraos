import { describe, it, expect, vi } from "vitest";
import { extractRelationships, extractTagRelationships } from "../../../src/memory/knowledge-graph/relationship-extractor.js";

describe.sequential("RelationshipExtractor", () => {
  describe("extractRelationships (LLM)", () => {
    it("should extract relations from LLM response", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          content: '[{"sourceLabel": "Alice", "targetLabel": "Project X", "relation": "works_on", "confidence": 0.9}]',
        }),
      };
      const result = await extractRelationships("Alice is working on Project X", mockLlm as any);
      expect(result).toHaveLength(1);
      expect(result[0].sourceLabel).toBe("Alice");
      expect(result[0].relation).toBe("works_on");
    });

    it("should handle markdown-wrapped JSON", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          content: '```json\n[{"sourceLabel": "A", "targetLabel": "B", "relation": "uses", "confidence": 0.8}]\n```',
        }),
      };
      const result = await extractRelationships("A uses B", mockLlm as any);
      expect(result).toHaveLength(1);
    });

    it("should return empty on LLM error", async () => {
      const mockLlm = { chat: vi.fn().mockRejectedValue(new Error("API error")) };
      const result = await extractRelationships("some text", mockLlm as any);
      expect(result).toHaveLength(0);
    });

    it("should return empty without LLM provider", async () => {
      const result = await extractRelationships("some text", null);
      expect(result).toHaveLength(0);
    });

    it("should filter low confidence results", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          content: '[{"sourceLabel": "A", "targetLabel": "B", "relation": "maybe", "confidence": 0.1}]',
        }),
      };
      const result = await extractRelationships("text", mockLlm as any);
      expect(result).toHaveLength(0); // confidence 0.1 < threshold 0.3
    });
  });

  describe("extractTagRelationships", () => {
    it("should find entries with overlapping tags", () => {
      const existing = [
        { id: "1", label: "fact1", tags: ["user", "preference"] },
        { id: "2", label: "fact2", tags: ["system", "config"] },
        { id: "3", label: "fact3", tags: ["user", "settings"] },
      ];
      const result = extractTagRelationships(["user", "theme"], existing);
      expect(result).toHaveLength(2); // matches fact1 and fact3
      expect(result[0].sharedTags).toContain("user");
    });

    it("should respect minOverlap", () => {
      const existing = [
        { id: "1", label: "fact1", tags: ["a", "b", "c"] },
        { id: "2", label: "fact2", tags: ["a"] },
      ];
      const result = extractTagRelationships(["a", "b"], existing, 2);
      expect(result).toHaveLength(1); // only fact1 has 2+ overlap
    });

    it("should return empty when no overlap", () => {
      const result = extractTagRelationships(["x"], [{ id: "1", label: "f", tags: ["y"] }]);
      expect(result).toHaveLength(0);
    });
  });
});
