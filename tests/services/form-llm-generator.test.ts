// tests/services/form-llm-generator.test.ts
import { describe, it, expect } from "vitest";
import { __test__, validateFormSchema } from "../../src/services/form-llm-generator.js";

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

describe("validateFormSchema", () => {
  it("should validate correct schema", () => {
    const schema = {
      type: "object",
      title: "Test Form",
      properties: {
        name: { type: "string", title: "姓名" },
      },
      required: ["name"],
    };
    expect(validateFormSchema(schema)).toEqual({ valid: true });
  });

  it("should reject schema without object type", () => {
    const schema = {
      type: "array",
      properties: {},
    };
    expect(validateFormSchema(schema).valid).toBe(false);
    expect(validateFormSchema(schema).error).toContain("object");
  });

  it("should reject schema without properties", () => {
    const schema = { type: "object" };
    expect(validateFormSchema(schema).valid).toBe(false);
  });

  it("should reject empty properties", () => {
    const schema = { type: "object", properties: {} };
    expect(validateFormSchema(schema).valid).toBe(false);
  });

  it("should reject field without type", () => {
    const schema = {
      type: "object",
      properties: {
        name: { title: "姓名" },
      },
    };
    expect(validateFormSchema(schema).valid).toBe(false);
  });

  it("should reject field without title", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };
    expect(validateFormSchema(schema).valid).toBe(false);
  });

  it("should reject required field not defined in properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", title: "姓名" },
      },
      required: ["nonexistent"],
    };
    expect(validateFormSchema(schema).valid).toBe(false);
  });
});
