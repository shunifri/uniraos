import { describe, it, expect } from "vitest";
import { skillsToTools, skillToTool } from "../../src/llm/tool-bridge.js";
import { defineSkill } from "../../src/types/index.js";
import type { ParamSchema } from "../../src/types/param-schema.js";

describe("Tool Bridge", () => {
  it("should generate generic params wrapper when no paramSchema", () => {
    const skill = defineSkill({
      name: "no_schema_skill",
      description: "A skill without schema",
      handler: async () => ({ success: true }),
    });

    const tool = skillToTool(skill);
    expect(tool.function.parameters.properties).toHaveProperty("params");
  });

  it("should generate typed parameters from paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
      },
      required: ["query"],
    };

    const skill = defineSkill({
      name: "search_skill",
      description: "Search something",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    const tool = skillToTool(skill);
    expect(tool.function.parameters.properties).toHaveProperty("query");
    expect(tool.function.parameters.properties).toHaveProperty("limit");
    expect((tool.function.parameters.properties as any).query.type).toBe("string");
    expect((tool.function.parameters.properties as any).query.description).toBe("Search query");
    expect(tool.function.parameters.required).toContain("query");
    expect(tool.function.parameters.properties).not.toHaveProperty("params");
  });

  it("should only convert visible skills", () => {
    const skills = [
      defineSkill({ name: "visible_skill", visible: true, handler: async () => ({ success: true }) }),
      defineSkill({ name: "hidden_skill", visible: false, handler: async () => ({ success: true }) }),
    ];

    const tools = skillsToTools(skills);
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("visible_skill");
  });

  it("should handle nested object properties in paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        address: {
          type: "object",
          description: "User address",
          properties: {
            street: { type: "string", description: "Street name" },
            city: { type: "string", description: "City name" },
          },
          required: ["street"],
        },
      },
      required: ["address"],
    };

    const skill = defineSkill({
      name: "nested_skill",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    const tool = skillToTool(skill);
    const addressProp = (tool.function.parameters.properties as any).address;
    expect(addressProp.type).toBe("object");
    expect(addressProp.properties).toHaveProperty("street");
    expect(addressProp.properties).toHaveProperty("city");
    expect(addressProp.required).toContain("street");
  });

  it("should handle array items in paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        tags: {
          type: "array",
          description: "Tag list",
          items: { type: "string", description: "A tag" },
        },
      },
    };

    const skill = defineSkill({
      name: "array_skill",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    const tool = skillToTool(skill);
    const tagsProp = (tool.function.parameters.properties as any).tags;
    expect(tagsProp.type).toBe("array");
    expect(tagsProp.items.type).toBe("string");
  });

  it("should handle enum values in paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        color: { type: "string", description: "Color", enum: ["red", "green", "blue"] },
      },
    };

    const skill = defineSkill({
      name: "enum_skill",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    const tool = skillToTool(skill);
    expect((tool.function.parameters.properties as any).color.enum).toEqual(["red", "green", "blue"]);
  });

  it("should handle default values in paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        limit: { type: "number", description: "Limit", default: 10 },
      },
    };

    const skill = defineSkill({
      name: "default_skill",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    const tool = skillToTool(skill);
    expect((tool.function.parameters.properties as any).limit.default).toBe(10);
  });

  it("should use skill name as fallback description", () => {
    const skill = defineSkill({
      name: "no_desc_skill",
      handler: async () => ({ success: true }),
    });

    const tool = skillToTool(skill);
    expect(tool.function.description).toContain("no_desc_skill");
  });

  it("should handle empty skills array", () => {
    const tools = skillsToTools([]);
    expect(tools).toHaveLength(0);
  });
});
