import { describe, it, expect, vi } from "vitest";
import {
  extractRelationships,
  extractTagRelationships,
  extractEntitiesAndRelationships,
} from "../../../src/memory/knowledge-graph/relationship-extractor.js";

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

  // ============================================================
  // P1-6: extractEntitiesAndRelationships 合并为单次 LLM 调用
  // 验证：
  //   1. 单次 chat 调用同时返回 entities + relations
  //   2. schema 校验（过滤掉不合规的 entity/relation）
  //   3. markdown-wrapped JSON 也能解析
  //   4. LLM 异常时静默返回空
  // ============================================================
  describe("extractEntitiesAndRelationships (P1-6 merged LLM call)", () => {
    it("单次调用同时返回 entities + relations", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            entities: [
              { label: "苹果公司", type: "organization", importance: 0.9 },
              { label: "蒂姆·库克", type: "person", importance: 0.85 },
            ],
            relations: [
              { sourceLabel: "苹果公司", targetLabel: "蒂姆·库克", relation: "created_by", confidence: 0.9 },
            ],
          }),
        }),
      };
      const r = await extractEntitiesAndRelationships("苹果公司 CEO 是蒂姆·库克", mockLlm as any);
      // 关键：chat 应当只被调用 1 次
      expect(mockLlm.chat).toHaveBeenCalledTimes(1);
      expect(r.entities).toHaveLength(2);
      expect(r.relations).toHaveLength(1);
      expect(r.relations[0].sourceLabel).toBe("苹果公司");
    });

    it("过滤不合规的 entity 和 relation", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            entities: [
              { label: "好实体", type: "concept", importance: 0.5 },       // 保留
              { label: "", type: "concept", importance: 0.5 },              // 空 label → 过滤
              { label: "low_imp", type: "concept", importance: 0.05 },      // importance < 0.1 → 过滤
            ],
            relations: [
              { sourceLabel: "好实体", targetLabel: "A", relation: "x", confidence: 0.8 }, // 保留
              { sourceLabel: "", targetLabel: "A", relation: "x", confidence: 0.8 },      // 空 source → 过滤
            ],
          }),
        }),
      };
      const r = await extractEntitiesAndRelationships("test", mockLlm as any);
      expect(r.entities).toHaveLength(1);
      expect(r.relations).toHaveLength(1);
    });

    it("markdown-wrapped JSON 也能解析", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          content: '```json\n{"entities":[{"label":"X","type":"concept","importance":0.5}],"relations":[]}\n```',
        }),
      };
      const r = await extractEntitiesAndRelationships("test", mockLlm as any);
      expect(r.entities).toHaveLength(1);
      expect(r.entities[0].label).toBe("X");
    });

    it("LLM 抛错时静默返回空（不向上抛）", async () => {
      const mockLlm = { chat: vi.fn().mockRejectedValue(new Error("API down")) };
      const r = await extractEntitiesAndRelationships("test", mockLlm as any);
      expect(r).toEqual({ entities: [], relations: [] });
    });

    it("无 LLM provider 时返回空", async () => {
      const r = await extractEntitiesAndRelationships("test", null);
      expect(r).toEqual({ entities: [], relations: [] });
    });

    // ============================================================
    // P2-10: 鲁棒性——LLM 不听话返回 array 而非 object 时，也能用
    //   当 entities 处理（relations 留空），不丢覆盖率
    // ============================================================
    it("P2-10: LLM 返回 array 时降级为 entities-only（容错）", async () => {
      const mockLlm = {
        chat: vi.fn().mockResolvedValue({
          // LLM 偷懒只返回 entity array，忽略 relations 字段
          content: JSON.stringify([
            { label: "苹果公司", type: "organization", importance: 0.9 },
            { label: "蒂姆·库克", type: "person", importance: 0.85 },
          ]),
        }),
      };
      const r = await extractEntitiesAndRelationships("test", mockLlm as any);
      // entities 应被解析，relations 留空（不让 LLM 的偷懒扩散成整次失败）
      expect(r.entities.length).toBe(2);
      expect(r.entities.map((e) => e.label)).toContain("苹果公司");
      expect(r.relations).toEqual([]);
    });
  });
});
