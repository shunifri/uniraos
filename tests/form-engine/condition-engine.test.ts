import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  applyConditionalSchema,
  hasConditionalSchema,
  getConditionDependencies,
} from "../../web/src/components/form-engine/core/ConditionEngine";
import type { RaosFieldSchema, ConditionalSchemaRule } from "../../web/src/components/form-engine/types";

describe("ConditionEngine", () => {
  describe("evaluateCondition", () => {
    it("should return true when condition is met", () => {
      expect(evaluateCondition("{{country}} === '中国'", { country: "中国" })).toBe(true);
    });

    it("should return false when condition is not met", () => {
      expect(evaluateCondition("{{country}} === '中国'", { country: "美国" })).toBe(false);
    });

    it("should support number comparison", () => {
      expect(evaluateCondition("{{age}} >= 18", { age: 20 })).toBe(true);
      expect(evaluateCondition("{{age}} >= 18", { age: 16 })).toBe(false);
    });

    it("should handle null values gracefully", () => {
      expect(evaluateCondition("{{x}} === null", { x: null })).toBe(true);
    });

    it("should support expr: prefix", () => {
      expect(evaluateCondition("expr:{{a}} + {{b}} === 5", { a: 2, b: 3 })).toBe(true);
    });

    it("should handle syntax errors gracefully", () => {
      expect(evaluateCondition("invalid syntax !!!", {})).toBe(false);
    });
  });

  describe("applyConditionalSchema", () => {
    const baseSchema: RaosFieldSchema = {
      type: "string",
      title: "地址",
      "ui:widget": "input",
      "ui:props": { placeholder: "请输入地址" },
    };

    it("should apply 'then' when condition is met", () => {
      const rules: ConditionalSchemaRule[] = [
        {
          when: "{{country}} === '中国'",
          then: { title: "省份", "ui:props": { placeholder: "请输入省份" } },
        },
      ];
      const result = applyConditionalSchema(baseSchema, rules, { country: "中国" });
      expect(result.title).toBe("省份");
      expect(result["ui:props"]).toEqual({ placeholder: "请输入省份" });
    });

    it("should apply 'else' when condition is not met", () => {
      const rules: ConditionalSchemaRule[] = [
        {
          when: "{{country}} === '中国'",
          then: { title: "省份" },
          else: { title: "州" },
        },
      ];
      const result = applyConditionalSchema(baseSchema, rules, { country: "美国" });
      expect(result.title).toBe("州");
    });

    it("should merge ui:props instead of replacing", () => {
      const rules: ConditionalSchemaRule[] = [
        {
          when: "true",
          then: { "ui:props": { maxLength: 10 } },
        },
      ];
      const result = applyConditionalSchema(baseSchema, rules, {});
      expect(result["ui:props"]).toEqual({ placeholder: "请输入地址", maxLength: 10 });
    });

    it("should apply multiple rules in order", () => {
      const rules: ConditionalSchemaRule[] = [
        { when: "true", then: { title: "第一步" } },
        { when: "true", then: { title: "第二步" } },
      ];
      const result = applyConditionalSchema(baseSchema, rules, {});
      expect(result.title).toBe("第二步");
    });

    it("should not modify base schema", () => {
      const rules: ConditionalSchemaRule[] = [
        { when: "true", then: { title: "新标题" } },
      ];
      applyConditionalSchema(baseSchema, rules, {});
      expect(baseSchema.title).toBe("地址");
    });
  });

  describe("hasConditionalSchema", () => {
    it("should return true when x-condition exists", () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "test",
        "x-condition": [{ when: "true", then: {} }],
      };
      expect(hasConditionalSchema(schema)).toBe(true);
    });

    it("should return false when x-condition is empty", () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "test",
        "x-condition": [],
      };
      expect(hasConditionalSchema(schema)).toBe(false);
    });

    it("should return false when x-condition is missing", () => {
      const schema: RaosFieldSchema = { type: "string", title: "test" };
      expect(hasConditionalSchema(schema)).toBe(false);
    });
  });

  describe("getConditionDependencies", () => {
    it("should extract all {{fieldName}} dependencies", () => {
      const rules: ConditionalSchemaRule[] = [
        { when: "{{country}} === '中国'", then: {} },
        { when: "{{province}} !== ''", then: {} },
      ];
      const deps = getConditionDependencies(rules);
      expect(deps).toEqual(["country", "province"]);
    });

    it("should handle nested field paths", () => {
      const rules: ConditionalSchemaRule[] = [
        { when: "{{user.name}} === 'admin'", then: {} },
      ];
      const deps = getConditionDependencies(rules);
      expect(deps).toEqual(["user.name"]);
    });

    it("should return empty array when no dependencies", () => {
      const rules: ConditionalSchemaRule[] = [
        { when: "true", then: {} },
      ];
      const deps = getConditionDependencies(rules);
      expect(deps).toEqual([]);
    });
  });
});
