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
});
