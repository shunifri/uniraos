/**
 * Tool Bridge: 将 visible Skills 转换为 LLM tool 定义
 */
import type { SkillDefinition } from "../types/index.js";
import type { ToolDefinition } from "./types.js";

/**
 * 将 SkillDefinition 转换为 LLM ToolDefinition
 * 只转换 visible=true 的 Skill
 */
export function skillsToTools(skills: SkillDefinition[]): ToolDefinition[] {
  return skills
    .filter((s) => s.visible)
    .map((s) => skillToTool(s));
}

/**
 * 单个 Skill → Tool 定义
 */
export function skillToTool(skill: SkillDefinition): ToolDefinition {
  return {
    type: "function",
    function: {
      name: skill.name,
      description: skill.description || `Execute skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties: {
          // 默认接受任意 JSON 参数
          // 后续可扩展为从 Skill 声明中提取 schema
          params: {
            type: "object" as unknown,
            description: "Parameters to pass to the skill",
          },
        },
      },
    },
  };
}

/**
 * 增强版：支持 Skill 自定义参数 schema
 */
export interface SkillParamSchema {
  properties: Record<
    string,
    { type: string; description?: string; enum?: string[] }
  >;
  required?: string[];
}

/**
 * 将带有参数 schema 的 Skill 转换为更精确的 Tool 定义
 */
export function skillToToolWithSchema(
  skill: SkillDefinition,
  schema: SkillParamSchema,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: skill.name,
      description: skill.description || `Execute skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties: schema.properties,
        required: schema.required,
      },
    },
  };
}
