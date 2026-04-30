// src/services/form-llm-generator.ts
import type { LLMProvider, Message } from "../llm/types.js";
import type { RaosFormSchema } from "../types/form.js";

export interface GenerateFormInput {
  /** 自然语言描述 */
  description: string;
  /** 表单显示名称 */
  name: string;
  /** 表单标识（英文小写+下划线） */
  key: string;
  /** 描述 */
  description?: string;
  /** 分类 */
  category?: string;
  /** 如果提供，则基于现有表单修改 */
  existingId?: string;
}

export interface GenerateFormResult {
  success: boolean;
  definition?: {
    key: string;
    name: string;
    description?: string;
    category?: string;
    schema: RaosFormSchema;
  };
  error?: string;
  rawJson?: string;
}

/** 从 LLM 响应中提取 JSON */
function extractJson(text: string): string | null {
  // 尝试提取 markdown 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // 尝试直接找 JSON 对象
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  // 如果文本本身就是 JSON
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  return null;
}

export const __test__ = {
  extractJson,
};
