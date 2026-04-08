import { describe, it, expect } from "vitest";
import { defineSkill } from "../../src/types/index.js";
import type { ParamSchema } from "../../src/types/param-schema.js";

describe("ParamSchema", () => {
  it("should allow defining a skill with paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        name: { type: "string", description: "The skill name" },
        count: { type: "number", description: "How many items" },
      },
      required: ["name"],
    };

    const skill = defineSkill({
      name: "test_skill",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    expect(skill.paramSchema).toBeDefined();
    expect(skill.paramSchema!.properties.name.type).toBe("string");
    expect(skill.paramSchema!.required).toContain("name");
  });

  it("should default paramSchema to undefined", () => {
    const skill = defineSkill({
      name: "no_schema",
      handler: async () => ({ success: true }),
    });

    expect(skill.paramSchema).toBeUndefined();
  });
});
