import { describe, it, expect } from "vitest";
import { extractJsonString } from "../../src/utils/extract-json.js";

describe("extract-json", () => {
  describe("extractJsonString", () => {
    it("should extract JSON from markdown code block with json label", () => {
      const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
      expect(extractJsonString(text)).toBe('{"key": "value"}');
    });

    it("should extract JSON from markdown code block without label", () => {
      const text = '```\n{"a": 1}\n```';
      expect(extractJsonString(text)).toBe('{"a": 1}');
    });

    it("should extract first JSON object from text", () => {
      const text = 'prefix {"key": "value"} suffix';
      expect(extractJsonString(text)).toBe('{"key": "value"}');
    });

    it("should return the trimmed text itself when it is JSON-like", () => {
      const text = '{"standalone": true}';
      expect(extractJsonString(text)).toBe('{"standalone": true}');
    });

    it("should return null for text without JSON", () => {
      expect(extractJsonString("just plain text")).toBeNull();
      expect(extractJsonString("")).toBeNull();
    });

    it("should handle nested JSON objects", () => {
      const text = 'Response: {"outer": {"inner": 42}}';
      expect(extractJsonString(text)).toBe('{"outer": {"inner": 42}}');
    });

    it("should handle JSON arrays inside objects", () => {
      const text = '```json\n{"items": [1, 2, 3]}\n```';
      expect(extractJsonString(text)).toBe('{"items": [1, 2, 3]}');
    });

    it("should prefer code block over inline JSON", () => {
      const text = 'inline {"a": 1}\n```json\n{"b": 2}\n```';
      expect(extractJsonString(text)).toBe('{"b": 2}');
    });

    it("should handle multiline JSON", () => {
      const text = `\`\`\`json
{
  "key": "value",
  "num": 123
}
\`\`\``;
      const result = extractJsonString(text);
      expect(result).toContain('"key": "value"');
      expect(result).toContain('"num": 123');
    });

    it("should handle empty code block", () => {
      const text = '```json\n\n```';
      expect(extractJsonString(text)).toBe('');
    });

    it("should return null for whitespace-only input", () => {
      expect(extractJsonString("   ")).toBeNull();
    });
  });
});
