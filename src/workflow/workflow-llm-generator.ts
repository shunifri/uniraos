/**
 * Workflow LLM Generator — 使用 LLM 从自然语言生成工作流定义
 *
 * 设计原则：
 * - 使用 few-shot prompting 让 LLM 理解 WorkflowSpec JSON DSL
 * - 验证生成的 JSON 结构有效性
 * - 支持从零生成和基于现有定义修改
 */

import type { LLMProvider, Message } from "../llm/types.js";
import type { WorkflowDefinition, WorkflowSpec, FormSchema, WorkflowNode, UserTaskNode } from "./types.js";
import { getWorkflowRepository } from "./repository.js";
import { createFormDefinition, getFormDefinition } from "../services/form-service.js";

export interface GenerateWorkflowInput {
  /** 自然语言描述 */
  description: string;
  /** 流程显示名称 */
  name: string;
  /** 流程标识（英文小写+下划线） */
  key: string;
  /** 分类 */
  category?: string;
  /** 如果提供，则基于现有流程修改 */
  existingKey?: string;
}

export interface GenerateWorkflowResult {
  success: boolean;
  definition?: WorkflowDefinition;
  error?: string;
  rawJson?: string;
}

/** 构建 system prompt */
function buildSystemPrompt(): string {
  return `你是一个工作流设计专家。根据用户的自然语言描述，生成符合以下 JSON Schema 的工作流定义。

## WorkflowSpec 结构

\`\`\`json
{
  "key": "流程标识（英文小写+下划线）",
  "name": "流程显示名称（中文）",
  "nodes": [节点数组],
  "starterConstraints": [
    { "type": "role", "value": "role_manager", "message": "仅经理角色可发起" }
  ]
}
\`\`\`
- starterConstraints 可选，用于限制谁能发起此流程。type 取值："role"(角色), "department"(部门)

## 节点类型说明

### 1. start_event — 开始事件（每个流程必须有且仅有一个）
\`\`\`json
{ "id": "start", "type": "start_event", "next": "下一个节点id" }
\`\`\`

### 2. end_event — 结束事件（每个流程必须有且仅有一个）
\`\`\`json
{ "id": "end", "type": "end_event", "name": "结束" }
\`\`\`

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
    { "type": "role_dept", "value": "role_employee", "deptId": "dept_001" },
    { "type": "starter_manager" }
  ],
  "signPolicy": { "mode": "parallel", "condition": "all" },
  "actions": ["approve", "reject", "transfer"],
  "dueDuration": "PT24H",
  "next": "下一个节点id"
}
\`\`\`
- **推荐使用 formDefinitionId** 引用表单中心已有的表单定义，复用表单引擎的完整能力（联动、数据源、权限等）
- form 字段保留用于简单场景或快速原型
- approvers 是新策略（优先于旧 assignee/assigneePolicy），支持多种审批人查找方式：
  - type="user" value="user_123" → 指定用户
  - type="role" value="role_manager" → 按角色查找所有用户
  - type="role_dept" value="role_employee" deptId="dept_001" → 角色和部门的交集
  - type="starter" → 发起人本人
  - type="starter_manager" → 发起人的经理
  - type="starter_director" → 发起人的总监
  - type="expression" value="\${managerId}" → 表达式解析
- signPolicy 可选，用于多人会签。mode: "parallel"(并行) 或 "sequential"(顺序)。condition: "all"(全部通过), "any"(任一通过), "majority"(多数通过)
- actions 取值："approve", "reject", "transfer", "delegate", "return"
- dueDuration 格式：ISO 8601，如 "PT24H"(24小时), "P3D"(3天), "PT2H"(2小时)

### 4. service_task — 服务任务（自动执行）
\`\`\`json
{
  "id": "节点id",
  "type": "service_task",
  "name": "节点显示名称",
  "service": "email_notification",
  "config": { "template": "xxx", "to": "\${starter.email}" },
  "next": "下一个节点id"
}
\`\`\`
- service 常用值："email_notification", "im_bot_send", "webhook_call"
- config 中的变量使用 \${变量名} 格式

### 5. exclusive_gateway — 排他网关（条件分支 if/else）
\`\`\`json
{
  "id": "节点id",
  "type": "exclusive_gateway",
  "name": "网关名称",
  "conditions": [
    { "name": "条件名称", "expression": "\${amount} >= 5000", "next": "分支1节点id" },
    { "name": "默认", "expression": "default", "next": "默认分支节点id" }
  ]
}
\`\`\`
- expression 使用 \${变量名} 引用流程变量，支持 >=, <=, >, <, ==, != 操作符
- 必须有一个 expression 为 "default" 的分支作为兜底
- 条件按顺序匹配，第一个匹配的分支会被执行

### 6. parallel_gateway — 并行网关（AND 分裂/汇聚）
\`\`\`json
{
  "id": "split",
  "type": "parallel_gateway",
  "mode": "split",
  "branches": ["分支1id", "分支2id"]
}
\`\`\`
\`\`\`json
{
  "id": "join",
  "type": "parallel_gateway",
  "mode": "join",
  "next": "汇聚后节点id"
}
\`\`\`

## FormSchema 结构（用于 user_task 的 form 字段）

\`\`\`json
{
  "fields": [
    {
      "key": "字段标识",
      "label": "显示名称",
      "type": "text|number|select|radio|checkbox|textarea|date|file|user|department",
      "required": true,
      "options": [{ "id": "值", "label": "显示文本" }],
      "placeholder": "提示文本",
      "defaultValue": "默认值",
      "validation": [
        { "type": "required", "message": "必填" },
        { "type": "min", "value": 0, "message": "最小值错误" },
        { "type": "max", "value": 100, "message": "最大值错误" },
        { "type": "pattern", "value": "^\\d+$", "message": "格式错误" },
        { "type": "email", "message": "邮箱格式错误" }
      ]
    }
  ]
}
\`\`\`
- type 取值：text(单行文本), number(数字), select(下拉选择), radio(单选), checkbox(多选), textarea(多行文本), date(日期), file(文件), user(用户选择), department(部门选择)
- options 仅在 type 为 select/radio/checkbox 时需要

## 设计规则

1. 每个流程必须有且仅有一个 start_event 和一个 end_event
2. 节点通过 next 字段链接，exclusive_gateway 通过 conditions 分支
3. 变量名使用小写+下划线（如 amount, leave_type）
4. 网关表达式使用 \${变量名} 格式引用表单字段
5. 第一个 user_task 通常包含 form（让用户填写表单）
6. 审批节点通常 actions 包含 "approve" 和 "reject"
7. 必须确保所有分支最终都能到达 end_event，没有死路
8. 节点 id 使用英文小写+下划线，要简洁明了
9. 流程名称使用中文，要直观易懂
10. 尽量保持流程简洁，不要过度设计

## 输出格式

请直接输出纯 JSON（不要包含 markdown 代码块标记 \`\`\`json 或其他解释文字）。输出必须是一个有效的 JSON 对象，包含以下字段：

\`\`\`json
{
  "key": "流程标识",
  "name": "流程显示名称",
  "category": "分类",
  "nodes": [...],
  "formSchema": { "fields": [...] }
}
\`\`\`

- formSchema 对应第一个 user_task（通常是 fill_form）的 form 字段
- 如果流程不需要表单（纯自动流程），formSchema 可以为 null 或省略`;
}

/** 构建 user prompt */
function buildUserPrompt(input: GenerateWorkflowInput, existing?: WorkflowDefinition): string {
  let prompt = `请根据以下描述设计一个工作流：\n\n`;
  prompt += `【流程名称】${input.name}\n`;
  prompt += `【流程标识】${input.key}\n`;
  if (input.category) {
    prompt += `【分类】${input.category}\n`;
  }
  prompt += `\n【需求描述】\n${input.description}\n\n`;

  if (existing) {
    prompt += `【现有流程定义】\n请基于以下现有流程进行修改：\n`;
    prompt += JSON.stringify(existing.definition, null, 2);
    if (existing.formSchema) {
      prompt += `\n\n【现有表单定义】\n`;
      prompt += JSON.stringify(existing.formSchema, null, 2);
    }
    prompt += `\n\n请根据上面的需求描述修改这个流程。保持 key 不变，可以调整 name、nodes 和 formSchema。\n`;
  }

  prompt += `请直接输出 JSON，不要包含任何解释文字。`;
  return prompt;
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

/** 基本结构验证 */
function validateWorkflowJson(json: unknown): { valid: boolean; error?: string } {
  if (typeof json !== "object" || json === null) {
    return { valid: false, error: "生成的内容不是有效的 JSON 对象" };
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.key !== "string" || !obj.key) {
    return { valid: false, error: "缺少或无效的 key 字段" };
  }
  if (typeof obj.name !== "string" || !obj.name) {
    return { valid: false, error: "缺少或无效的 name 字段" };
  }
  if (!Array.isArray(obj.nodes)) {
    return { valid: false, error: "缺少或无效的 nodes 数组" };
  }

  const nodes = obj.nodes as Array<Record<string, unknown>>;

  // 检查是否有 start_event 和 end_event
  const startEvents = nodes.filter((n) => n.type === "start_event");
  const endEvents = nodes.filter((n) => n.type === "end_event");

  if (startEvents.length !== 1) {
    return { valid: false, error: `必须有且仅有一个 start_event，当前有 ${startEvents.length} 个` };
  }
  if (endEvents.length !== 1) {
    return { valid: false, error: `必须有且仅有一个 end_event，当前有 ${endEvents.length} 个` };
  }

  // 检查节点 id 唯一性
  const ids = new Set<string>();
  for (const node of nodes) {
    if (typeof node.id !== "string" || !node.id) {
      return { valid: false, error: "存在缺少 id 的节点" };
    }
    if (ids.has(node.id)) {
      return { valid: false, error: `节点 id 重复: ${node.id}` };
    }
    ids.add(node.id);
  }

  // 检查 next 引用有效性 + user_task 结构
  const validNodeTypes = new Set(["start_event", "end_event", "user_task", "service_task", "exclusive_gateway", "parallel_gateway"]);
  const validApproverTypes = new Set(["user", "role", "role_dept", "starter", "starter_manager", "starter_director", "expression"]);
  const validSignConditions = new Set(["all", "any", "majority"]);

  for (const node of nodes) {
    if (!validNodeTypes.has(node.type as string)) {
      return { valid: false, error: `未知节点类型: ${node.type}` };
    }
    if (node.type === "start_event") {
      if (typeof node.next !== "string" || !node.next) {
        return { valid: false, error: `start_event 节点必须包含有效的 next 字段` };
      }
      if (!ids.has(node.next)) {
        return { valid: false, error: `节点 ${node.id} 的 next 引用不存在的节点: ${node.next}` };
      }
    }
    if (node.type === "user_task" || node.type === "service_task") {
      if (typeof node.next === "string" && node.next) {
        if (!ids.has(node.next)) {
          return { valid: false, error: `节点 ${node.id} 的 next 引用不存在的节点: ${node.next}` };
        }
      }
    }
    if (node.type === "exclusive_gateway" && Array.isArray(node.conditions)) {
      for (const cond of node.conditions) {
        if (typeof cond.next !== "string" || !cond.next) {
          return { valid: false, error: `网关 ${node.id} 的条件缺少有效的 next 字段` };
        }
        if (!ids.has(cond.next)) {
          return { valid: false, error: `网关 ${node.id} 的条件分支引用不存在的节点: ${cond.next}` };
        }
      }
    }
    // 验证 approvers 结构
    if (node.type === "user_task" && node.approvers && Array.isArray(node.approvers)) {
      for (const approver of node.approvers as Array<Record<string, unknown>>) {
        if (!validApproverTypes.has(approver.type as string)) {
          return { valid: false, error: `节点 ${node.id} 包含无效的 approver 类型: ${approver.type}` };
        }
      }
    }
    // 验证 signPolicy 结构
    if (node.type === "user_task" && node.signPolicy && typeof node.signPolicy === "object") {
      const sp = node.signPolicy as Record<string, unknown>;
      if (!validSignConditions.has(sp.condition as string)) {
        return { valid: false, error: `节点 ${node.id} 包含无效的 signPolicy condition: ${sp.condition}` };
      }
    }
  }

  // 验证 starterConstraints 结构
  if (obj.starterConstraints && Array.isArray(obj.starterConstraints)) {
    const validConstraintTypes = new Set(["role", "department"]);
    for (const sc of obj.starterConstraints as Array<Record<string, unknown>>) {
      if (!validConstraintTypes.has(sc.type as string)) {
        return { valid: false, error: `无效的 starterConstraint 类型: ${sc.type}` };
      }
      if (typeof sc.value !== "string" || !sc.value) {
        return { valid: false, error: `starterConstraint 缺少 value` };
      }
    }
  }

  // 检查表单字段有效性
  if (obj.formSchema && typeof obj.formSchema === "object") {
    const fs = obj.formSchema as Record<string, unknown>;
    if (fs.fields && Array.isArray(fs.fields)) {
      for (const field of fs.fields as Array<Record<string, unknown>>) {
        if (typeof field.key !== "string" || !field.key) {
          return { valid: false, error: "表单字段缺少 key" };
        }
        if (typeof field.label !== "string" || !field.label) {
          return { valid: false, error: `表单字段 ${field.key} 缺少 label` };
        }
        const validTypes = ["text", "number", "select", "radio", "checkbox", "textarea", "date", "file", "user", "department"];
        if (!validTypes.includes(field.type as string)) {
          return { valid: false, error: `表单字段 ${field.key} 无效的类型: ${field.type}` };
        }
      }
    }
  }

  return { valid: true };
}

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

/**
 * 使用 LLM 生成工作流定义
 */
export async function generateWorkflow(
  input: GenerateWorkflowInput,
  getProvider: () => LLMProvider | null
): Promise<GenerateWorkflowResult> {
  const provider = getProvider();
  if (!provider) {
    return { success: false, error: "LLM 未配置，请先配置模型" };
  }

  const repo = getWorkflowRepository();

  // 如果提供了 existingKey，获取现有定义
  let existing: WorkflowDefinition | undefined;
  if (input.existingKey) {
    existing = await repo.getDefinitionByKey(input.existingKey);
    if (!existing) {
      return { success: false, error: `未找到现有流程: ${input.existingKey}` };
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

    // 防御性处理：确保 content 是字符串
    let contentStr: string;
    const contentType = typeof response.content;
    console.log(`[WorkflowLLM] response.content type: ${contentType}`);
    if (typeof response.content === "string") {
      contentStr = response.content;
    } else if (response.content === null || response.content === undefined) {
      contentStr = "";
    } else {
      // 如果 parseResponse 没有正确处理，这里兜底
      try {
        contentStr = JSON.stringify(response.content);
        console.log(`[WorkflowLLM] content was object, JSON.stringify fallback: ${contentStr.slice(0, 200)}`);
      } catch {
        contentStr = String(response.content);
        console.log(`[WorkflowLLM] content was object, String() fallback: ${contentStr.slice(0, 200)}`);
      }
    }

    // 特殊检测：[object Object] 通常意味着某处对象被隐式转字符串
    if (contentStr === "[object Object]") {
      console.error(`[WorkflowLLM] CRITICAL: contentStr is "[object Object]". This usually means an object was implicitly converted to string somewhere. response.content type was: ${contentType}`);
      return { success: false, error: "LLM 返回内容异常：对象被错误转换为字符串，请检查服务端日志" };
    }

    // DEBUG: 记录原始响应前 500 字符
    console.log(`[WorkflowLLM] LLM raw response (${contentStr.length} chars): ${contentStr.slice(0, 500)}`);

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

    const validation = validateWorkflowJson(parsed);
    if (!validation.valid) {
      return { success: false, error: `验证失败: ${validation.error}`, rawJson };
    }

    const generated = parsed as {
      key: string;
      name: string;
      category?: string;
      nodes: WorkflowNode[];
      formSchema?: FormSchema | null;
    };

    // 强制使用用户指定的 key（防止 LLM 生成不同的 key）
    const finalKey = generated.key === input.key ? generated.key : input.key;
    if (generated.key !== input.key) {
      console.warn(`[WorkflowLLM] LLM generated key "${generated.key}" does not match input key "${input.key}", using input key`);
    }

    // 构建 WorkflowSpec
    const spec: WorkflowSpec = {
      key: finalKey,
      name: generated.name,
      nodes: generated.nodes,
    };

    // ✅ 自动为用户任务节点创建并关联表单
    const specWithForms = await autoCreateFormsForWorkflow(spec, finalKey, generated.name, getProvider);

    // 提取 formSchema（对应第一个 fill_form 的 form）
    let formSchema: FormSchema | undefined;
    if (generated.formSchema && typeof generated.formSchema === "object" && generated.formSchema !== null) {
      formSchema = generated.formSchema as FormSchema;
    }

    // 查找是否已存在同名流程（使用用户指定的 input.key，防御性处理）
    let existingDef: WorkflowDefinition | undefined;
    try {
      existingDef = await repo.getDefinitionByKey(finalKey);
    } catch (e) {
      console.error(`[WorkflowLLM] getDefinitionByKey failed for key=${finalKey}, treating as new: ${e instanceof Error ? e.message : String(e)}`);
      existingDef = undefined;
    }

    let definition: WorkflowDefinition;
    if (existingDef) {
      // 更新现有定义
      await repo.updateDefinition(existingDef.id, {
        name: generated.name,
        category: generated.category ?? existingDef.category,
        definition: specWithForms,
        formSchema,
      });
      // 防御性处理：如果 getDefinitionByKey 因脏数据失败，直接构造返回对象
      try {
        definition = (await repo.getDefinitionByKey(finalKey))!;
      } catch (e) {
        console.error(`[WorkflowLLM] getDefinitionByKey failed after update for key=${finalKey}: ${e instanceof Error ? e.message : String(e)}`);
        definition = { ...existingDef, name: generated.name, category: generated.category ?? existingDef.category, definition: specWithForms, formSchema };
      }
    } else {
      // 创建新定义
      definition = await repo.createDefinition({
        name: generated.name,
        key: finalKey,
        version: 1,
        category: generated.category ?? input.category ?? "general",
        definition: specWithForms,
        formSchema,
        createdBy: "llm_generator",
      });
    }

    return { success: true, definition, rawJson };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : "no stack";
    console.error(`[WorkflowLLM] CRITICAL ERROR in generateWorkflow: ${errMsg}`);
    console.error(`[WorkflowLLM] Stack: ${errStack}`);
    return { success: false, error: `生成过程出错: ${errMsg}` };
  }
}

/** 测试导出 */
export const __test__ = {
  extractJson,
  validateWorkflowJson,
};
