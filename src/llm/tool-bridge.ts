/**
 * Tool Bridge: 将 visible Skills 转换为 LLM tool 定义
 *
 * 当 Skill 有 paramSchema 时，生成精确的参数定义；
 * 否则回退到通用 {params: object} 包装。
 */
import type { SkillDefinition } from "../types/index.js";
import type { ParamSchema } from "../types/param-schema.js";
import type { ToolDefinition } from "./types.js";

export function skillsToTools(skills: SkillDefinition[]): ToolDefinition[] {
  return skills
    .filter((s) => s.visible)
    .map((s) => skillToTool(s));
}

export function skillToTool(skill: SkillDefinition): ToolDefinition {
  if (skill.paramSchema) {
    return buildTypedTool(skill, skill.paramSchema);
  }
  return buildGenericTool(skill);
}

function buildTypedTool(skill: SkillDefinition, schema: ParamSchema): ToolDefinition {
  const properties: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const toolProp: Record<string, unknown> = { type: prop.type };
    if (prop.description) toolProp.description = prop.description;
    if (prop.enum) toolProp.enum = prop.enum;
    if (prop.items) toolProp.items = { type: prop.items.type };
    if (prop.properties) {
      toolProp.properties = {};
      for (const [k, v] of Object.entries(prop.properties)) {
        (toolProp.properties as Record<string, unknown>)[k] = {
          type: v.type,
          ...(v.description ? { description: v.description } : {}),
        };
      }
    }
    properties[key] = toolProp;
  }

  return {
    type: "function",
    function: {
      name: skill.name,
      description: skill.description || `Execute skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties,
        required: schema.required,
      },
    },
  };
}

function buildGenericTool(skill: SkillDefinition): ToolDefinition {
  return {
    type: "function",
    function: {
      name: skill.name,
      description: skill.description || `Execute skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties: {
          params: {
            type: "object" as unknown,
            description: "Parameters to pass to the skill",
          },
        },
      },
    },
  };
}
