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

/** 构建 system prompt */
function buildSystemPrompt(): string {
  return `你是一个表单设计专家。根据用户的自然语言描述，生成符合以下 JSON Schema 的表单定义。

## RaosFormSchema 结构

\`\`\`json
{
  "type": "object",
  "title": "表单标题",
  "description": "表单描述",
  "properties": {
    "字段名": {
      "type": "string|number|integer|boolean|array|object",
      "title": "字段显示名称",
      "description": "字段描述",
      "default": "默认值",
      "required": true,
      "minLength": 1,
      "maxLength": 100,
      "minimum": 0,
      "maximum": 10000,
      "pattern": "^\\d{11}$",
      "format": "email|url|date|datetime|time|mobile|idCard",
      "ui:widget": "textarea|select|radio|checkbox|datepicker",
      "ui:placeholder": "请输入...",
      "enum": ["选项1", "选项2"],
      "enumNames": ["选项一名称", "选项二名称"]
    }
  },
  "required": ["必填字段1", "必填字段2"]
}
\`\`\`

## 字段类型说明

### type 取值
- **string**: 字符串文本
- **number**: 浮点数
- **integer**: 整数
- **boolean**: 布尔值
- **array**: 数组/多选
- **object**: 嵌套对象

### format 取值
- **email**: 邮箱地址
- **url**: URL 地址
- **date**: 日期
- **datetime**: 日期时间
- **time**: 时间
- **mobile**: 手机号
- **idCard**: 身份证号

### ui:widget 常用组件
- **textarea**: 多行文本
- **select**: 下拉选择
- **radio**: 单选按钮
- **checkbox**: 多选框
- **datepicker**: 日期选择器

## 设计规则

1. 字段名使用英文小写+下划线（如 leave_type, start_date）
2. 合理设置 required 数组，包含必填字段
3. 对于有选项的字段（请假类型、部门等），使用 enum 和 enumNames
4. 数字字段设置合理的 minimum/maximum
5. 字符串字段设置合理的 minLength/maxLength
6. 格式明确的字段（邮箱、手机、身份证、日期等）使用对应的 format
7. 使用 ui:widget 提升用户体验
8. 使用 ui:placeholder 提供友好的输入提示
9. 表单字段要有逻辑分组和顺序（基本信息在前，详细信息在后）

## 输出格式

请直接输出纯 JSON（不要包含 markdown 代码块标记 \`\`\`json 或其他解释文字）。

\`\`\`json
{
  "type": "object",
  "title": "请假申请表",
  "description": "员工请假申请单",
  "properties": {
    "leave_type": {
      "type": "string",
      "title": "请假类型",
      "enum": ["annual", "sick", "personal", "maternity"],
      "enumNames": ["年假", "病假", "事假", "产假"],
      "ui:widget": "select",
      "ui:placeholder": "请选择请假类型"
    }
  },
  "required": ["leave_type"]
}
\`\`\`
`;
}

/** 基本结构验证 */
export function validateFormSchema(json: unknown): { valid: boolean; error?: string } {
  if (typeof json !== "object" || json === null) {
    return { valid: false, error: "生成的内容不是有效的 JSON 对象" };
  }

  const obj = json as Record<string, unknown>;

  if (obj.type !== "object") {
    return { valid: false, error: "根节点 type 必须为 'object'" };
  }

  if (!obj.properties || typeof obj.properties !== "object") {
    return { valid: false, error: "缺少或无效的 properties 字段" };
  }

  const properties = obj.properties as Record<string, unknown>;

  if (Object.keys(properties).length === 0) {
    return { valid: false, error: "properties 不能为空" };
  }

  // 验证每个字段
  for (const [fieldKey, field] of Object.entries(properties)) {
    const fieldObj = field as Record<string, unknown>;
    if (!fieldObj.type) {
      return { valid: false, error: `字段 ${fieldKey} 缺少 type` };
    }
    if (!fieldObj.title) {
      return { valid: false, error: `字段 ${fieldKey} 缺少 title` };
    }
    const validTypes = ["string", "number", "integer", "boolean", "array", "object"];
    if (!validTypes.includes(fieldObj.type as string)) {
      return { valid: false, error: `字段 ${fieldKey} 无效的 type: ${fieldObj.type}` };
    }
    // enum 和 enumNames 必须同时存在
    if (fieldObj.enum && !fieldObj.enumNames) {
      return { valid: false, error: `字段 ${fieldKey} 有 enum 但缺少 enumNames` };
    }
  }

  // 验证 required 数组中的字段都在 properties 中
  if (obj.required && Array.isArray(obj.required)) {
    for (const requiredField of obj.required) {
      if (!properties[requiredField as string]) {
        return { valid: false, error: `required 中字段 '${requiredField}' 不在 properties 中定义` };
      }
    }
  }

  return { valid: true };
}

export const __test__ = {
  extractJson,
  buildSystemPrompt,
  validateFormSchema,
};
