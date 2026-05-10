# 表单 LLM 生成器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建表单引擎的 LLM 生成能力，支持自然语言描述生成 RaosFormSchema，与流程 LLM 生成器形成对称能力

**Architecture:** 参考 workflow-llm-generator 的实现模式，创建 form-llm-generator.ts，包含完整的 System Prompt、JSON 提取、结构验证和保存到数据库的能力

**Tech Stack:** TypeScript, Vitest, LLMProvider interface

---

### Task 1: 表单类型定义与类型导入对齐

**Files:**
- Check existing types: `src/types/form.ts`
- Check existing types: `web/src/components/form-engine/types.ts`

- [ ] **Step 1: 检查后端表单类型定义**

查看 `src/types/form.ts`，确认 RaosFormSchema 的结构是否与前端一致。如果不存在，创建最小类型定义。

- [ ] **Step 2: 如果后端缺少类型，创建类型文件**

如果 `src/types/form.ts` 不存在或不完整，创建/补充：

```typescript
// src/types/form.ts
export interface FormFieldValidation {
  type: "required" | "min" | "max" | "pattern" | "email";
  value?: unknown;
  message?: string;
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "radio" | "checkbox" | "textarea" | "date" | "file" | "user" | "department";
  required?: boolean;
  options?: Array<{ id: string; label: string }>;
  placeholder?: string;
  defaultValue?: unknown;
  validation?: FormFieldValidation[];
}

export interface FormSchema {
  fields: FormField[];
}

// RaosFormSchema - 与前端 form-engine 一致的完整结构
export interface CrossFieldValidationRule {
  expr: string;
  message: string;
  targetFields?: string[];
}

export interface RaosFormSchema {
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, RaosFieldSchema>;
  required?: string[];
}

export interface RaosFieldSchema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  title: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: "email" | "url" | "date" | "datetime" | "time" | "mobile" | "idCard";
  "ui:widget"?: string;
  "ui:props"?: Record<string, any>;
  "ui:placeholder"?: string;
}
```

- [ ] **Step 3: 运行现有表单测试确保无破坏**

```bash
npm test -- tests/routes/form-routes.test.ts 2>&1 | tail -20
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/types/form.ts
git commit -m "types: add RaosFormSchema type definitions for LLM generator"
```

---

### Task 2: 创建 Form LLM Generator 基础结构

**Files:**
- Create: `src/services/form-llm-generator.ts`
- Test: `tests/services/form-llm-generator.test.ts`

- [ ] **Step 1: 创建基础结构文件**

```typescript
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
```

- [ ] **Step 2: 创建测试文件基础结构**

```typescript
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
```

- [ ] **Step 3: 运行测试验证基础结构**

```bash
npm test -- tests/services/form-llm-generator.test.ts 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/services/form-llm-generator.ts tests/services/form-llm-generator.test.ts
git commit -m "feat: add base structure for form LLM generator"
```

---

### Task 3: 构建 System Prompt 和 JSON 验证器

**Files:**
- Modify: `src/services/form-llm-generator.ts`

- [ ] **Step 1: 添加 buildSystemPrompt 函数**

在 `src/services/form-llm-generator.ts` 末尾追加：

```typescript
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
      "pattern": "^\\\\d{11}$",
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
2. 合理设置 required 数组，包含必填字段名
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
```

- [ ] **Step 2: 添加 validateFormSchema 函数**

在文件末尾追加：

```typescript
/** 基本结构验证 */
function validateFormSchema(json: unknown): { valid: boolean; error?: string } {
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
```

- [ ] **Step 3: 在测试文件中添加验证测试**

```typescript
// 在 tests/services/form-llm-generator.test.ts 中追加

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
```

- [ ] **Step 4: 别忘了导入 validateFormSchema 到测试文件**

```typescript
// 在 tests/services/form-llm-generator.test.ts 顶部更新导入
import { __test__, validateFormSchema } from "../../src/services/form-llm-generator.js";
```

同时在导出中添加 validateFormSchema：

```typescript
// 在 src/services/form-llm-generator.ts 末尾更新 __test__ 导出
export const __test__ = {
  extractJson,
  buildSystemPrompt,
  validateFormSchema,
};
```

- [ ] **Step 5: 运行测试**

```bash
npm test -- tests/services/form-llm-generator.test.ts 2>&1 | tail -40
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/services/form-llm-generator.ts tests/services/form-llm-generator.test.ts
git commit -m "feat: add system prompt and validator for form LLM generator"
```

---

### Task 4: 实现核心 generateForm 函数

**Files:**
- Modify: `src/services/form-llm-generator.ts`
- Check: `src/services/form-service.ts`

- [ ] **Step 1: 导入必要的依赖**

在文件顶部添加：

```typescript
import { getFormDefinition, createFormDefinition, updateFormDefinition } from "./form-service.js";
```

- [ ] **Step 2: 添加 buildUserPrompt 函数**

在 `validateFormSchema` 函数后追加：

```typescript
/** 构建 user prompt */
function buildUserPrompt(input: GenerateFormInput, existing?: any): string {
  let prompt = `请根据以下描述设计一个表单：\n\n`;
  prompt += `【表单名称】${input.name}\n`;
  prompt += `【表单标识】${input.key}\n`;
  if (input.category) {
    prompt += `【分类】${input.category}\n`;
  }
  prompt += `\n【需求描述】\n${input.description}\n\n`;

  if (existing) {
    prompt += `【现有表单定义】\n请基于以下现有表单进行修改：\n`;
    prompt += JSON.stringify(existing.schema_json || existing.definition, null, 2);
    prompt += `\n\n请根据上面的需求描述修改这个表单。\n`;
  }

  prompt += `请直接输出 JSON，不要包含任何解释文字。`;
  return prompt;
}
```

- [ ] **Step 3: 添加 generateForm 核心函数**

在文件末尾追加：

```typescript
/**
 * 使用 LLM 生成表单定义
 */
export async function generateForm(
  input: GenerateFormInput,
  getProvider: () => LLMProvider | null
): Promise<GenerateFormResult> {
  const provider = getProvider();
  if (!provider) {
    return { success: false, error: "LLM 未配置，请先配置模型" };
  }

  // 如果提供了 existingId，获取现有表单
  let existing: any;
  if (input.existingId) {
    existing = await getFormDefinition(input.existingId);
    if (!existing) {
      return { success: false, error: `未找到现有表单: ${input.existingId}` };
    }
  }

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(input, existing) },
  ];

  try {
    const response = await provider.chat(messages);

    if (response.finishReason === "error" || !response.content) {
      return { success: false, error: "LLM 生成失败: " + (response.content || "未知错误") };
    }

    let contentStr = typeof response.content === "string" ? response.content : "";
    if (typeof response.content !== "string" && response.content !== null && response.content !== undefined) {
      try {
        contentStr = JSON.stringify(response.content);
      } catch {
        contentStr = String(response.content);
      }
    }

    const rawJson = extractJson(contentStr);
    if (!rawJson) {
      return { success: false, error: "无法从 LLM 响应中提取 JSON", rawJson: contentStr };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (e) {
      return { success: false, error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`, rawJson };
    }

    const validation = validateFormSchema(parsed);
    if (!validation.valid) {
      return { success: false, error: `验证失败: ${validation.error}`, rawJson };
    }

    const schema = parsed as RaosFormSchema;

    // 保存到数据库
    try {
      if (existing) {
        // 更新现有表单
        await updateFormDefinition(existing.id, {
          key: existing.key,
          name: schema.title || input.name,
          description: schema.description,
          schemaJson: schema,
        });
        const updated = await getFormDefinition(existing.id);
        return { success: true, definition: updated, rawJson };
      } else {
        // 创建新表单
        const newDef = await createFormDefinition({
          key: input.key,
          name: schema.title || input.name,
          description: schema.description,
          schemaJson: schema,
          createdBy: "llm_generator",
        });
        return { success: true, definition: newDef, rawJson };
      }
    } catch (e) {
      return { success: false, error: `保存失败: ${e instanceof Error ? e.message : String(e)}`, rawJson };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `生成过程出错: ${errMsg}` };
  }
}
```

- [ ] **Step 4: 运行所有表单相关测试确保没有破坏**

```bash
npm test -- tests/routes/form-routes.test.ts 2>&1 | tail -20
```
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/services/form-llm-generator.ts
git commit -m "feat: implement core generateForm function"
```

---

### Task 5: 添加表单 LLM 生成 API 路由

**Files:**
- Modify: `src/routes/form-routes.ts`

- [ ] **Step 1: 在 form-routes.ts 顶部添加导入**

```typescript
import { generateForm } from "../services/form-llm-generator.js";
import { getLLMProvider } from "../llm/index.js";
```

注意：如果 `getLLMProvider` 不存在，需要检查 `src/llm/index.ts` 并获取正确的导出名。

- [ ] **Step 2: 在表单路由文件末尾添加 POST 路由**

```typescript
// Generate form from natural language
router.post("/form/generate", async (req, res) => {
  try {
    const { key, name, description, category, existingId } = req.body;
    if (!key || !name) {
      return res.status(400).json({ success: false, error: "key and name are required" });
    }

    const result = await generateForm(
      { key, name, description, category, existingId },
      () => getLLMProvider() || null
    );

    if (result.success) {
      res.json({ success: true, data: result.definition });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("[FORM_GENERATE_ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 3: 运行现有表单路由测试**

```bash
npm test -- tests/routes/form-routes.test.ts 2>&1 | tail -20
```
Expected: All existing tests pass

- [ ] **Step 4: 为新路由添加测试**

在 `tests/routes/form-routes.test.ts` 末尾追加：

```typescript
describe("POST /api/form/generate", () => {
  it("should return error when key is missing", async () => {
    // 使用单元测试方式，因为需要 mock LLM
    // 这里只测试输入验证
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/form-routes.ts
git commit -m "feat: add form LLM generation API endpoint"
```

---

### Plan 1 Complete

**完成后的能力：**
- ✅ 表单 LLM 生成器核心功能
- ✅ 自然语言描述 → RaosFormSchema JSON
- ✅ 基于现有表单的修改
- ✅ 结构验证
- ✅ API 端点

**下一计划：** Plan 2 - 流程节点引用表单定义

---

### Plan 2: 流程节点引用表单定义

# 流程节点引用表单定义 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一流程引擎的表单引用机制，使流程节点能够复用表单中心的完整表单定义，解决流程表单与表单中心的割裂问题

**Architecture:** 在 UserTaskNode 中增加 formDefinitionId 字段支持直接引用表单中心的定义。保留原有的内嵌 form 字段作为向后兼容，增加表单字段权限控制能力

**Tech Stack:** TypeScript, SQLite, MySQL, Vitest

---

### Task 1: 更新流程类型定义

**Files:**
- Modify: `src/workflow/types.ts`

- [ ] **Step 1: 修改 UserTaskNode 类型定义**

找到 `UserTaskNode` 的接口定义，添加 `formDefinitionId` 和 `formFieldPermissions`：

```typescript
/** 用户任务（需要人工处理） */
export interface UserTaskNode extends BaseNode {
  type: "user_task";
  form?: FormSchema;  // 保留做向后兼容
  formDefinitionId?: string;  // ✅ 新增：引用表单中心的定义 ID
  formFieldPermissions?: Record<string, "read" | "write" | "hidden">;  // ✅ 新增：节点级字段权限
  assigneePolicy?: string;
  assignee?: string;
  approvers?: ApproverConfig[];
  candidateUsers?: string[];
  candidateGroups?: string[];
  actions?: TaskAction[];
  dueDuration?: string;
  reminder?: ReminderConfig;
}
```

- [ ] **Step 2: 运行现有流程测试确保无破坏**

```bash
npm test -- tests/workflow/engine.test.ts 2>&1 | tail -20
```
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/workflow/types.ts
git commit -m "types: add formDefinitionId and field permissions to UserTaskNode"
```

---

### Task 2: 更新流程 LLM 生成器，支持自动创建表单

**Files:**
- Modify: `src/workflow/workflow-llm-generator.ts`

- [ ] **Step 1: 导入表单生成器**

在文件顶部添加：

```typescript
import { generateForm } from "../services/form-llm-generator.js";
import { getFormDefinition, createFormDefinition } from "../services/form-service.js";
```

- [ ] **Step 2: 修改 System Prompt，指导 LLM 使用表单引用**

在 `buildSystemPrompt()` 函数中，更新 user_task 部分的说明：

```typescript
// 找到 user_task 说明部分，更新为：
### 3. user_task — 用户任务（需要人工处理）
\`\`\`json
{
  "id": "节点id",
  "type": "user_task",
  "name": "节点显示名称",
  "formDefinitionId": "form-uuid-or-key",  // 优先使用，引用表单中心的定义
  "form": { /* 内嵌表单定义（不推荐，优先使用 formDefinitionId） */ },
  "approvers": [
    { "type": "role", "value": "role_manager" },
  ],
  "actions": ["approve", "reject", "transfer"],
  "next": "下一个节点id"
}
\`\`\`

- **推荐使用 formDefinitionId** 引用表单中心已有的表单定义，复用表单引擎的完整能力（联动、数据源、权限等）
- form 字段保留用于简单场景或快速原型
```

- [ ] **Step 3: 添加自动创建表单的辅助函数**

在 `generateWorkflow` 函数前添加：

```typescript
/**
 * 为流程中的每个用户任务节点自动生成并关联表单
 */
async function autoCreateFormsForWorkflow(
  workflowSpec: WorkflowSpec,
  workflowKey: string,
  workflowName: string,
  getProvider: () => LLMProvider | null
): Promise<WorkflowSpec> {
  const updatedNodes = [...workflowSpec.nodes];

  for (let i = 0; i < updatedNodes.length; i++) {
    const node = updatedNodes[i];
    if (node.type === "user_task") {
      const userTask = node as UserTaskNode;

      // 如果节点有 form 但没有 formDefinitionId，
      // 自动将 form 保存为独立的表单定义并关联
      if (userTask.form && !userTask.formDefinitionId) {
        const formKey = `${workflowKey}_${node.id}_form`;
        const formName = `${workflowName} - ${userTask.name || node.id}`;

        try {
          // 将 FormSchema 转换为 RaosFormSchema 格式
          const raosSchema: any = {
            type: "object",
            title: formName,
            properties: {},
            required: [],
          };

          for (const field of userTask.form.fields) {
            raosSchema.properties[field.key] = {
              type: field.type === "number" ? "number" : "string",
              title: field.label,
              default: field.defaultValue,
            };
            if (field.required) {
              raosSchema.required.push(field.key);
            }
            if (field.options) {
              raosSchema.properties[field.key].enum = field.options.map((o: any) => o.id);
              raosSchema.properties[field.key].enumNames = field.options.map((o: any) => o.label);
            }
          }

          const formDef = await createFormDefinition({
            key: formKey,
            name: formName,
            schemaJson: raosSchema,
            createdBy: "workflow_llm_generator",
          });

          // 替换为 formDefinitionId 引用
          (updatedNodes[i] as UserTaskNode).formDefinitionId = formDef.id;
          delete (updatedNodes[i] as UserTaskNode).form;  // 移除内嵌表单
        } catch (e) {
          console.warn(`[WorkflowLLM] Failed to auto-create form for node ${node.id}:`, e);
          // 失败时保留原 form，不阻塞流程创建
        }
      }
    }
  }

  return { ...workflowSpec, nodes: updatedNodes };
}
```

- [ ] **Step 4: 在 generateWorkflow 中调用自动表单创建**

找到 `build WorkflowSpec` 后保存前的位置，添加：

```typescript
// 构建 WorkflowSpec 后...

// ✅ 自动为用户任务节点创建并关联表单
const specWithForms = await autoCreateFormsForWorkflow(spec, finalKey, generated.name, getProvider);

// 然后保存...
// 把原来的 spec 替换为 specWithForms
```

- [ ] **Step 5: 运行流程 LLM 生成器测试**

```bash
npm test -- tests/workflow/llm-generator.test.ts 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/workflow/workflow-llm-generator.ts
git commit -m "feat: auto-create forms for user task nodes in workflow LLM generator"
```

---

### Task 3: 流程运行时加载表单定义

**Files:**
- Modify: `src/workflow/engine.ts`
- Create type export if needed

- [ ] **Step 1: 导入表单服务**

在 engine.ts 顶部添加：

```typescript
import { getFormDefinition } from "../services/form-service.js";
```

- [ ] **Step 2: 添加获取任务表单的辅助函数**

```typescript
/**
 * 获取任务的表单定义
 * 优先使用 formDefinitionId 引用表单中心的定义，fallback 到内嵌 form
 */
export async function getTaskFormSchema(task: WorkflowTask, workflowSpec: WorkflowSpec): Promise<any | null> {
  const node = workflowSpec.nodes.find((n) => n.id === task.nodeId);
  if (!node || node.type !== "user_task") {
    return null;
  }

  const userTaskNode = node as UserTaskNode;

  // 优先使用 formDefinitionId 引用
  if (userTaskNode.formDefinitionId) {
    const formDef = await getFormDefinition(userTaskNode.formDefinitionId);
    if (formDef) {
      return {
        schema: formDef.schema_json,
        fieldPermissions: userTaskNode.formFieldPermissions,
        source: "form_center",
        formId: formDef.id,
      };
    }
  }

  // Fallback 到内嵌 form
  if (userTaskNode.form) {
    return {
      schema: userTaskNode.form,
      fieldPermissions: userTaskNode.formFieldPermissions,
      source: "inline",
    };
  }

  return null;
}
```

- [ ] **Step 3: 导出该函数供前端 API 使用**

确保 engine.ts 导出了该函数：

```typescript
// 在文件末尾的导出中添加
export { getTaskFormSchema };
```

- [ ] **Step 4: 运行引擎测试**

```bash
npm test -- tests/workflow/engine.test.ts 2>&1 | tail -20
```
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/workflow/engine.ts
git commit -m "feat: add getTaskFormSchema to resolve form definitions for tasks"
```

---

### Task 4: 更新流程任务表单 API 返回表单定义

**Files:**
- Modify: `src/services/workflow-task-form-service.ts`

- [ ] **Step 1: 导入 getTaskFormSchema**

```typescript
import { getTaskFormSchema } from "../workflow/engine.js";
```

- [ ] **Step 2: 修改 loadTaskForm，使用新的表单解析**

找到加载 schema 的代码，更新为：

```typescript
// 获取表单定义（优先按 ID 查询，fallback 按 key）
let formSchema: any = null;

// 从流程定义中获取节点信息并解析表单
const instanceDef = instance.definition;
if (instanceDef) {
  const formResult = await getTaskFormSchema(task, instanceDef);
  if (formResult) {
    formSchema = formResult.schema;
    // 字段权限可返回给前端
    // formResult.fieldPermissions
  }
}

// 如果没有从节点获取到 schema，保持原有逻辑
if (!formSchema) {
  // 原有逻辑...
}
```

- [ ] **Step 3: 运行 workflow-task-form 测试**

```bash
npm test -- tests/routes/workflow-task-form.test.ts 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/services/workflow-task-form-service.ts
git commit -m "feat: resolve form definition from form center in workflow task form service"
```

---

### Plan 2 Complete

**完成后的能力：**
- ✅ UserTaskNode 支持 formDefinitionId 引用表单中心
- ✅ 支持节点级字段权限控制
- ✅ 流程 LLM 生成时自动创建并关联表单
- ✅ 流程运行时自动解析表单定义
- ✅ 向后兼容：保留内嵌 form 字段支持

---

**剩余计划：**
- Plan 3: 丰富服务任务生态（邮件、IM、Webhook 等）
- Plan 4: 流程可视化编排器（拖拽式画布）

---

**Plan 1 & 2 已完成并保存。**

**执行选项：**

1. **Subagent-Driven (推荐)** - 为每个任务分派独立子代理，任务间审查，快速迭代
2. **Inline Execution** - 在本次会话中批量执行，包含审查检查点

你希望采用哪种方式开始执行？
