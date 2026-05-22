/**
 * App Designer Skill — 应用级元 Skill
 *
 * 根据用户自然语言描述，设计完整的 RAOS 应用方案（Skill + 表单 + 工作流 + 知识库）。
 * 支持持续迭代升级：创建 → 预览 → 修正 → 再预览 → 确认。
 *
 * 符合自迭代原则：
 *   - 自身是 Skill，注册在 Registry 中
 *   - 走 Evolution 审批（通过 skill_from_description 生成业务 Skill 时）
 *   - 内部调用已有 Skill（db_query、skill_from_description 等）
 *   - 设计方案版本化存储，可追溯、可回滚
 */

import { randomUUID } from "crypto";
import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { LLMProvider } from "../llm/types.js";
import type { ExecutionEngine } from "../engine/index.js";
import { getDb, isMySQL } from "../db/database.js";
import { getCurrentUserId } from "../user/request-context.js";
import { createFormDefinition } from "../services/form-service.js";
import { getWorkflowRepository } from "../workflow/repository.js";

// ───────────────────────────────────────────────────────────────
// 类型定义
// ───────────────────────────────────────────────────────────────

interface DesignSkill {
  name: string;
  description: string;
  logic: string;
  autonomy?: "MANUAL" | "AUTO_PRE" | "AUTO_POST";
}

interface DesignFormField {
  name: string;
  title: string;
  type: "string" | "number" | "boolean" | "select" | "date" | "textarea" | "email" | "phone";
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
  placeholder?: string;
}

interface DesignForm {
  key: string;
  name: string;
  description?: string;
  fields: DesignFormField[];
}

interface DesignWorkflowNode {
  id: string;
  type: "start" | "end" | "userTask" | "serviceTask" | "exclusiveGateway";
  name: string;
  assignee?: string;
  formKey?: string;
  condition?: string;
  next?: string[];
}

interface DesignWorkflow {
  key: string;
  name: string;
  description?: string;
  nodes: DesignWorkflowNode[];
}

interface DesignKnowledgeBase {
  name: string;
  description?: string;
  documentTypes: string[];
}

interface DesignRelationship {
  from: string;
  to: string;
  type: "triggers" | "submits_to" | "calls" | "binds";
  description?: string;
}

interface DesignSchema {
  name: string;
  description: string;
  components: {
    skills: DesignSkill[];
    forms: DesignForm[];
    workflows: DesignWorkflow[];
    knowledgeBases: DesignKnowledgeBase[];
  };
  relationships: DesignRelationship[];
}

interface GeneratedComponent {
  type: "skill" | "form" | "workflow" | "knowledgeBase";
  key: string;
  name: string;
  status: "pending" | "created" | "failed";
  id?: string;
  error?: string;
}

interface AppDesignRecord {
  id: string;
  name: string;
  description: string;
  version: number;
  requirement: string;
  designJson: DesignSchema;
  components: GeneratedComponent[];
  status: "draft" | "applied" | "archived";
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

interface ApplyResult {
  type: "skill" | "form" | "workflow" | "knowledgeBase";
  key: string;
  name: string;
  status: "created" | "exists" | "failed" | "skipped";
  error?: string;
}

// ───────────────────────────────────────────────────────────────
// MySQL 适配器延迟加载
// ───────────────────────────────────────────────────────────────

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import("../db/mysql-adapter.js");
  return getAdapter();
}

// ───────────────────────────────────────────────────────────────
// App Designer Service
// ───────────────────────────────────────────────────────────────

export class AppDesignerService {
  constructor(private llmProvider?: () => LLMProvider | null) {}

  // ── 创建设计方案 ──
  async createDesign(params: {
    name?: string;
    requirement: string;
    ownerId: string;
  }): Promise<AppDesignRecord> {
    const designSchema = await this.analyzeRequirement(params.requirement, params.name);

    const record: AppDesignRecord = {
      id: `design_${randomUUID().slice(0, 12)}`,
      name: designSchema.name,
      description: designSchema.description,
      version: 1,
      requirement: params.requirement,
      designJson: designSchema,
      components: this.extractComponents(designSchema),
      status: "draft",
      ownerId: params.ownerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveRecord(record);
    return record;
  }

  // ── 更新设计方案（增量修正）──
  async updateDesign(params: {
    designId: string;
    requirement: string;
    ownerId: string;
  }): Promise<AppDesignRecord> {
    const existing = await this.getRecord(params.designId);
    if (!existing) {
      throw new Error(`设计方案不存在: ${params.designId}`);
    }
    if (existing.ownerId !== params.ownerId) {
      throw new Error("无权修改此设计方案");
    }

    const { updatedSchema, changelog } = await this.computeDiff(
      existing.designJson,
      params.requirement
    );

    const updated: AppDesignRecord = {
      ...existing,
      name: updatedSchema.name,
      description: updatedSchema.description,
      version: existing.version + 1,
      requirement: `${existing.requirement}\n\n[修正 v${existing.version + 1}]\n${params.requirement}`,
      designJson: updatedSchema,
      components: this.extractComponents(updatedSchema),
      status: "draft",
      updatedAt: Date.now(),
    };

    await this.saveRecord(updated);
    return updated;
  }

  // ── 预览设计方案 ──
  async previewDesign(designId: string, ownerId: string): Promise<AppDesignRecord | null> {
    const record = await this.getRecord(designId);
    if (!record) return null;
    if (record.ownerId !== ownerId) return null;
    return record;
  }

  // ── 列出用户的设计方案 ──
  async listDesigns(ownerId: string): Promise<AppDesignRecord[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query(
        "SELECT * FROM app_designs WHERE owner_id = ? ORDER BY updated_at DESC",
        [ownerId]
      );
      return (rows as any[]).map((r) => this.mapRow(r));
    }
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM app_designs WHERE owner_id = ? ORDER BY updated_at DESC")
      .all(ownerId) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  // ── 归档设计方案 ──
  async archiveDesign(designId: string, ownerId: string): Promise<void> {
    const record = await this.getRecord(designId);
    if (!record || record.ownerId !== ownerId) {
      throw new Error("设计方案不存在或无权限");
    }
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        "UPDATE app_designs SET status = 'archived', updated_at = ? WHERE id = ?",
        [Date.now(), designId]
      );
    } else {
      const db = getDb();
      db.prepare("UPDATE app_designs SET status = 'archived', updated_at = ? WHERE id = ?").run(
        Date.now(),
        designId
      );
    }
  }

  // ── 一键部署设计方案 ──
  async applyDesign(
    designId: string,
    ownerId: string,
    engine: ExecutionEngine
  ): Promise<{ record: AppDesignRecord; results: ApplyResult[] }> {
    const record = await this.getRecord(designId);
    if (!record) {
      throw new Error(`设计方案不存在: ${designId}`);
    }
    if (record.ownerId !== ownerId) {
      throw new Error("无权部署此设计方案");
    }

    const results: ApplyResult[] = [];

    // 1. 创建表单定义
    for (const form of record.designJson.components.forms) {
      try {
        const schema = this.buildFormSchema(form);
        await createFormDefinition({
          key: form.key,
          name: form.name,
          description: form.description,
          schemaJson: schema,
          createdBy: ownerId,
        });
        results.push({ type: "form", key: form.key, name: form.name, status: "created" });
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("UNIQUE constraint") || msg.includes("Duplicate entry") || msg.includes("already exists")) {
          results.push({ type: "form", key: form.key, name: form.name, status: "exists" });
        } else {
          results.push({ type: "form", key: form.key, name: form.name, status: "failed", error: msg });
        }
      }
    }

    // 2. 创建工作流定义
    for (const workflow of record.designJson.components.workflows) {
      try {
        const repo = getWorkflowRepository();
        const existing = await repo.getDefinitionByKey(workflow.key);
        if (existing) {
          results.push({ type: "workflow", key: workflow.key, name: workflow.name, status: "exists" });
          continue;
        }
        const spec = this.buildWorkflowSpec(workflow);
        await repo.createDefinition({
          name: workflow.name,
          key: workflow.key,
          version: 1,
          definition: spec,
          createdBy: ownerId,
        });
        results.push({ type: "workflow", key: workflow.key, name: workflow.name, status: "created" });
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ type: "workflow", key: workflow.key, name: workflow.name, status: "failed", error: msg });
      }
    }

    // 3. 创建 Skill（通过 engine.execute 调用 skill_from_description）
    for (const skill of record.designJson.components.skills) {
      try {
        const result = await engine.execute("skill_from_description", {
          name: skill.name,
          description: `${skill.description}\n\n业务逻辑：${skill.logic || "无详细逻辑"}`,
        });
        if (result.success) {
          results.push({ type: "skill", key: skill.name, name: skill.name, status: "created" });
        } else {
          const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
          if (errMsg.includes("已存在") || errMsg.includes("already exists")) {
            results.push({ type: "skill", key: skill.name, name: skill.name, status: "exists" });
          } else {
            results.push({ type: "skill", key: skill.name, name: skill.name, status: "failed", error: errMsg });
          }
        }
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ type: "skill", key: skill.name, name: skill.name, status: "failed", error: msg });
      }
    }

    // 4. 知识库目前只能提示用户手动上传
    for (const kb of record.designJson.components.knowledgeBases) {
      results.push({ type: "knowledgeBase", key: kb.name, name: kb.name, status: "skipped", error: "请手动前往知识库页面上传文档" });
    }

    // 5. 更新记录
    const updatedComponents: GeneratedComponent[] = results.map((r) => ({
      type: r.type,
      key: r.key,
      name: r.name,
      status: r.status === "created" ? "created" : r.status === "exists" ? "created" : "failed",
      error: r.error,
    }));

    const allOk = results.every((r) => r.status === "created" || r.status === "exists" || r.status === "skipped");
    record.components = updatedComponents;
    record.status = allOk ? "applied" : "draft";
    record.updatedAt = Date.now();
    await this.saveRecord(record);

    return { record, results };
  }

  // ─────────────────────────────────────────────────────────────
  // 私有方法：LLM 交互
  // ─────────────────────────────────────────────────────────────

  private async analyzeRequirement(requirement: string, nameHint?: string): Promise<DesignSchema> {
    const provider = this.llmProvider ? this.llmProvider() : null;
    if (!provider) {
      throw new Error("LLM 未配置，无法分析需求");
    }

    const prompt = `你是一个企业级应用架构师。请根据以下需求，设计一个基于 RAOS 智能体平台的应用方案。

## 需求描述
${requirement}

## 设计约束
1. Skill：每个 Skill 应该是一个独立的业务功能单元，接收参数、返回结果
2. 表单：字段类型可选 string/number/boolean/select/date/textarea/email/phone
3. 工作流：节点类型可选 start/end/userTask/serviceTask/exclusiveGateway
4. 知识库：列出需要上传的文档类型

## 输出格式
请严格输出以下 JSON 格式（不要 markdown 标记，不要额外说明）：
{
  "name": "应用名称（简短）",
  "description": "应用一句话描述",
  "components": {
    "skills": [
      {
        "name": "skill_english_name",
        "description": "功能描述",
        "logic": "详细业务逻辑说明（用于后续生成代码）",
        "autonomy": "MANUAL"
      }
    ],
    "forms": [
      {
        "key": "form_key",
        "name": "表单名称",
        "description": "表单用途",
        "fields": [
          {
            "name": "field_name",
            "title": "字段显示名称",
            "type": "string",
            "required": true,
            "placeholder": "提示文本"
          }
        ]
      }
    ],
    "workflows": [
      {
        "key": "workflow_key",
        "name": "工作流名称",
        "description": "流程说明",
        "nodes": [
          { "id": "start", "type": "start", "name": "开始", "next": ["task1"] },
          { "id": "task1", "type": "userTask", "name": "审批任务", "assignee": "role_admin", "formKey": "form_key", "next": ["end"] },
          { "id": "end", "type": "end", "name": "结束" }
        ]
      }
    ],
    "knowledgeBases": [
      {
        "name": "知识库名称",
        "description": "知识库用途",
        "documentTypes": ["pdf", "docx"]
      }
    ]
  },
  "relationships": [
    { "from": "skill:skill_name", "to": "form:form_key", "type": "triggers", "description": "Skill 引导用户填写表单" },
    { "from": "form:form_key", "to": "workflow:workflow_key", "type": "submits_to", "description": "表单提交触发工作流" }
  ]
}

注意：
- nameHint（如果提供）是用户建议的名称：${nameHint || "未指定"}
- 如果需求不涉及某类组件（如不需要工作流），对应数组可为空
- 关系中的 from/to 格式为 "type:key"`;

    const response = await provider.chat([{ role: "user", content: prompt }]);
    const content = (response.content ?? "").trim();
    const jsonText = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");

    try {
      return JSON.parse(jsonText) as DesignSchema;
    } catch (err) {
      throw new Error(`LLM 返回的设计方案格式无效: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async computeDiff(
    existing: DesignSchema,
    newRequirement: string
  ): Promise<{ updatedSchema: DesignSchema; changelog: string }> {
    const provider = this.llmProvider ? this.llmProvider() : null;
    if (!provider) {
      throw new Error("LLM 未配置，无法计算差异");
    }

    const prompt = `你是一个应用架构师。用户对一个已有应用方案提出了修改需求。

## 现有方案
${JSON.stringify(existing, null, 2)}

## 修改需求
${newRequirement}

## 任务
1. 分析修改需求，确定需要新增、修改、删除哪些组件
2. 输出完整的更新后方案 JSON（保持未变更部分不变）
3. 同时输出变更日志（changelog）

## 输出格式
请严格输出以下 JSON（不要 markdown 标记）：
{
  "updatedSchema": { /* 完整的更新后方案，格式同现有方案 */ },
  "changelog": "变更说明：\n1. 新增 xxx\n2. 修改 xxx\n3. 删除 xxx"
}`;

    const response = await provider.chat([{ role: "user", content: prompt }]);
    const content = (response.content ?? "").trim();
    const jsonText = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");

    try {
      const result = JSON.parse(jsonText) as { updatedSchema: DesignSchema; changelog: string };
      return result;
    } catch (err) {
      throw new Error(`LLM 返回的更新方案格式无效: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 私有方法：数据持久化
  // ─────────────────────────────────────────────────────────────

  private async saveRecord(record: AppDesignRecord): Promise<void> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `INSERT INTO app_designs (id, name, description, version, requirement, design_json, components, status, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         name = VALUES(name), description = VALUES(description), version = VALUES(version),
         requirement = VALUES(requirement), design_json = VALUES(design_json),
         components = VALUES(components), status = VALUES(status), updated_at = VALUES(updated_at)`,
        [
          record.id,
          record.name,
          record.description,
          record.version,
          record.requirement,
          JSON.stringify(record.designJson),
          JSON.stringify(record.components),
          record.status,
          record.ownerId,
          record.createdAt,
          record.updatedAt,
        ]
      );
    } else {
      const db = getDb();
      db.prepare(
        `INSERT OR REPLACE INTO app_designs (id, name, description, version, requirement, design_json, components, status, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id,
        record.name,
        record.description,
        record.version,
        record.requirement,
        JSON.stringify(record.designJson),
        JSON.stringify(record.components),
        record.status,
        record.ownerId,
        record.createdAt,
        record.updatedAt
      );
    }
  }

  private async getRecord(designId: string): Promise<AppDesignRecord | null> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM app_designs WHERE id = ?", [designId]);
      if (rows.length === 0) return null;
      return this.mapRow(rows[0]);
    }
    const db = getDb();
    const row = db.prepare("SELECT * FROM app_designs WHERE id = ?").get(designId) as any;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: any): AppDesignRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description || "",
      version: row.version || 1,
      requirement: row.requirement,
      designJson: typeof row.design_json === "string" ? JSON.parse(row.design_json) : row.design_json,
      components: typeof row.components === "string" ? JSON.parse(row.components) : row.components ?? [],
      status: row.status || "draft",
      ownerId: row.owner_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 私有方法：工具函数
  // ─────────────────────────────────────────────────────────────

  private buildFormSchema(form: DesignForm): Record<string, unknown> {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const field of form.fields) {
      const prop: any = { type: field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string", title: field.title };
      if (field.placeholder) prop.placeholder = field.placeholder;
      if (field.options && field.options.length > 0) prop.enum = field.options;
      if (field.defaultValue !== undefined) prop.default = field.defaultValue;
      properties[field.name] = prop;
      if (field.required) required.push(field.name);
    }
    return {
      type: "object",
      title: form.name,
      description: form.description || "",
      properties,
      required,
    };
  }

  private buildWorkflowSpec(workflow: DesignWorkflow): any {
    return {
      key: workflow.key,
      name: workflow.name,
      nodes: workflow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        ...(n.assignee ? { assignee: n.assignee } : {}),
        ...(n.formKey ? { formKey: n.formKey } : {}),
        ...(n.condition ? { condition: n.condition } : {}),
        ...(n.next ? { next: n.next } : {}),
      })),
    };
  }

  private extractComponents(schema: DesignSchema): GeneratedComponent[] {
    const components: GeneratedComponent[] = [];
    for (const s of schema.components.skills) {
      components.push({ type: "skill", key: s.name, name: s.description || s.name, status: "pending" });
    }
    for (const f of schema.components.forms) {
      components.push({ type: "form", key: f.key, name: f.name, status: "pending" });
    }
    for (const w of schema.components.workflows) {
      components.push({ type: "workflow", key: w.key, name: w.name, status: "pending" });
    }
    for (const k of schema.components.knowledgeBases) {
      components.push({ type: "knowledgeBase", key: k.name, name: k.name, status: "pending" });
    }
    return components;
  }

  private formatPreview(record: AppDesignRecord): string {
    const d = record.designJson;
    let text = `📐 应用设计方案「${d.name}」\n`;
    text += `版本: v${record.version} | 状态: ${record.status}\n`;
    text += `描述: ${d.description}\n\n`;

    text += `🧩 组件清单:\n`;
    if (d.components.skills.length > 0) {
      text += `  Skills (${d.components.skills.length}):\n`;
      for (const s of d.components.skills) text += `    • ${s.name}: ${s.description}\n`;
    }
    if (d.components.forms.length > 0) {
      text += `  表单 (${d.components.forms.length}):\n`;
      for (const f of d.components.forms) text += `    • ${f.name} (${f.fields.length} 个字段)\n`;
    }
    if (d.components.workflows.length > 0) {
      text += `  工作流 (${d.components.workflows.length}):\n`;
      for (const w of d.components.workflows) text += `    • ${w.name}\n`;
    }
    if (d.components.knowledgeBases.length > 0) {
      text += `  知识库 (${d.components.knowledgeBases.length}):\n`;
      for (const k of d.components.knowledgeBases) text += `    • ${k.name}\n`;
    }

    if (d.relationships.length > 0) {
      text += `\n🔗 组件关联:\n`;
      for (const r of d.relationships) text += `  ${r.from} → ${r.to} (${r.type})\n`;
    }

    text += `\n📋 原始需求:\n${record.requirement.slice(0, 500)}${record.requirement.length > 500 ? "..." : ""}`;
    return text;
  }

  // 对外暴露格式化方法，供 Skill handler 使用
  formatForDisplay(record: AppDesignRecord): { text: string; structured: unknown } {
    return { text: this.formatPreview(record), structured: record };
  }
}

// ───────────────────────────────────────────────────────────────
// Skill 注册
// ───────────────────────────────────────────────────────────────

export function registerAppDesignerSkill(
  registry: SkillRegistry,
  engine: ExecutionEngine,
  llmProvider?: () => LLMProvider | null,
) {
  const service = new AppDesignerService(llmProvider);

  registry.register(
    defineSystemSkill({
      name: "app_designer",
      description: `【应用级元 Skill】根据用户自然语言描述，设计完整的 RAOS 应用方案（Skill + 表单 + 工作流 + 知识库配置）。
支持持续迭代升级：创建 → 预览 → 修正 → 再预览 → 一键部署。

参数:
  action(string): create(创建方案) | update(修正方案) | preview(预览方案) | list(列出方案) | archive(归档方案) | apply(一键部署)
  requirement(string): 需求描述（create/update 时需要）
  designId(string): 设计方案 ID（update/preview/archive/apply 时需要）
  name(string): 应用名称（create 时可选）

使用示例:
  1. create: {"action":"create","requirement":"帮我做一个高校招生咨询机器人"}
  2. preview: {"action":"preview","designId":"design_xxx"}
  3. update: {"action":"update","designId":"design_xxx","requirement":"再加一个按城市分配招生老师的功能"}
  4. apply: {"action":"apply","designId":"design_xxx"}
  5. list: {"action":"list"}

注意：
  - create/update 需要 LLM 配置
  - apply 会根据设计方案自动创建表单、工作流，并提交 Skill 生成审批
  - 知识库文档需要手动上传
  - 设计方案会自动版本化存储`,
      paramSchema: {
        properties: {
          action: {
            type: "string",
            enum: ["create", "update", "preview", "list", "archive", "apply"],
            description: "操作类型",
          },
          requirement: { type: "string", description: "需求描述" },
          designId: { type: "string", description: "设计方案ID" },
          name: { type: "string", description: "应用名称" },
        },
        required: ["action"],
      },
      handler: async (params, context) => {
        const action = params.action as string;
        const userId = context.user?.id || getCurrentUserId();

        try {
          switch (action) {
            case "create": {
              const requirement = params.requirement as string;
              if (!requirement) {
                return { success: false, error: new Error("create 操作需要提供 requirement 参数") };
              }
              const record = await service.createDesign({
                name: params.name as string | undefined,
                requirement,
                ownerId: userId,
              });
              const display = service.formatForDisplay(record);
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  version: record.version,
                  preview: display.text,
                  structured: display.structured,
                  message: `✅ 应用方案「${record.name}」已创建（v${record.version}）。\n设计 ID: ${record.id}\n请使用 preview 查看详情，或使用 update 提出修改意见。\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="create" />`,
                },
              };
            }

            case "update": {
              const designId = params.designId as string;
              const requirement = params.requirement as string;
              if (!designId || !requirement) {
                return { success: false, error: new Error("update 操作需要提供 designId 和 requirement 参数") };
              }
              const record = await service.updateDesign({ designId, requirement, ownerId: userId });
              const display = service.formatForDisplay(record);
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  version: record.version,
                  preview: display.text,
                  structured: display.structured,
                  message: `✅ 应用方案已更新至 v${record.version}。\n设计 ID: ${record.id}\n变更已保存，请使用 preview 查看更新后的详情。\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="update" />`,
                },
              };
            }

            case "preview": {
              const designId = params.designId as string;
              if (!designId) {
                return { success: false, error: new Error("preview 操作需要提供 designId 参数") };
              }
              const record = await service.previewDesign(designId, userId);
              if (!record) {
                return { success: false, error: new Error("设计方案不存在或无权限访问") };
              }
              const display = service.formatForDisplay(record);
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  version: record.version,
                  status: record.status,
                  preview: display.text,
                  structured: display.structured,
                  message: `📐 应用方案「${record.name}」v${record.version} 预览\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="preview" />`,
                },
              };
            }

            case "list": {
              const records = await service.listDesigns(userId);
              return {
                success: true,
                data: {
                  total: records.length,
                  designs: records.map((r) => ({
                    id: r.id,
                    name: r.name,
                    version: r.version,
                    status: r.status,
                    updatedAt: r.updatedAt,
                  })),
                },
              };
            }

            case "apply": {
              const designId = params.designId as string;
              if (!designId) {
                return { success: false, error: new Error("apply 操作需要提供 designId 参数") };
              }
              const { record, results } = await service.applyDesign(designId, userId, engine);
              const successCount = results.filter((r) => r.status === "created").length;
              const existCount = results.filter((r) => r.status === "exists").length;
              const failCount = results.filter((r) => r.status === "failed").length;
              const skipCount = results.filter((r) => r.status === "skipped").length;
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  status: record.status,
                  summary: `创建 ${successCount} 个 | 已存在 ${existCount} 个 | 失败 ${failCount} 个 | 跳过 ${skipCount} 个`,
                  results: results.map((r) => ({ type: r.type, key: r.key, name: r.name, status: r.status, error: r.error })),
                  message: `🚀 部署完成！${record.status === "applied" ? "所有组件已就绪。" : "部分组件部署失败，请查看详情。"}\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="apply" />`,
                },
              };
            }

            case "archive": {
              const designId = params.designId as string;
              if (!designId) {
                return { success: false, error: new Error("archive 操作需要提供 designId 参数") };
              }
              await service.archiveDesign(designId, userId);
              return {
                success: true,
                data: { designId, message: "设计方案已归档" },
              };
            }

            default:
              return { success: false, error: new Error(`不支持的操作: ${action}`) };
          }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      },
    })
  );

  console.log("   App Designer skill registered (app_designer)");
}
