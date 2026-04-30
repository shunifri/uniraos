// tests/services/form-llm-generator.test.ts
import { describe, it, expect } from "vitest";
import { __test__ } from "../../src/services/form-llm-generator.js";

const { extractJson } = __test__;

describe("FormLLMGenerator", () => {
  describe("extractJson", () => {
    it("should extract JSON from markdown code block", () => {
      const input = "```json\n{\"key\": \"value\"}\n```";
      expect(extractJson(input)).toBe('{"key": "value"}');
    });

    it("should extract JSON from code block without json tag", () => {
      const input = "```\n{\"key\": \"value\"}\n```";
      expect(extractJson(input)).toBe('{"key": "value"}');
    });

    it("should extract JSON directly from text", () => {
      const input = '{"key": "value"}';
      expect(extractJson(input)).toBe('{"key": "value"}');
    });

    it("should return null when no JSON found", () => {
      const input = "Plain text without JSON";
      expect(extractJson(input)).toBeNull();
    });
  });
});
