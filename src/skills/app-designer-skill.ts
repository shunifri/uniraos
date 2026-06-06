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
import { createFormDefinition, getFormDefinitionByKey } from "../services/form-service.js";
import { getWorkflowRepository } from "../workflow/repository.js";
import { validateWorkflowSpec } from "../routes/workflow-definition-routes.js";

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
  // P1-25: 之前只 8 个 enum (string/number/boolean/select/date/textarea/email/phone),
  // form-engine 实际支持 18 个 widget, 缺 radio/checkbox/password/dateRange/dateTimeRange/
  //   timePicker/userPicker/deptPicker/fileUploader/array/group/table.
  // 用户在应用设计器里想用这些组件但找不到选项, "应用创建时这些组件没生成".
  // 完整化枚举, widgetMap 同步扩.
  type:
    | "string" | "number" | "boolean" | "select" | "date" | "textarea" | "email" | "phone"
    | "radio" | "checkbox" | "password"
    | "dateRange" | "dateTimeRange" | "timePicker"
    | "userPicker" | "deptPicker" | "fileUploader"
    | "array" | "group" | "table";
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
  placeholder?: string;
  // group/array/table 等复杂组件可能需要子字段或列定义
  items?: any;
  fields?: DesignFormField[];
  columns?: any[];
  // fileUploader 可能需要限制类型
  accept?: string;
  maxSize?: number;
}

interface DesignForm {
  key: string;
  name: string;
  description?: string;
  fields: DesignFormField[];
}

interface DesignWorkflowNode {
  id: string;
  type: "start" | "end" | "userTask" | "serviceTask" | "exclusiveGateway" | "parallelGateway";
  name: string;
  assignee?: string;
  formKey?: string;
  condition?: string;
  conditions?: string[];
  next?: string[];
  mode?: "split" | "join";
  branches?: string[];
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
  collectionId?: string; // 部署后由系统自动填充
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
  systemPrompt?: string;
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
  status: "created" | "exists" | "updated" | "failed" | "skipped";
  id?: string;
  message?: string;
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

  // ── 更新自定义系统提示词 ──
  async updateSystemPrompt(designId: string, systemPrompt: string, ownerId: string): Promise<AppDesignRecord> {
    const record = await this.getRecord(designId);
    if (!record) throw new Error(`设计方案不存在: ${designId}`);
    if (record.ownerId !== ownerId) throw new Error("无权修改此设计方案");
    record.designJson.systemPrompt = systemPrompt;
    record.updatedAt = Date.now();
    await this.saveRecord(record);
    return record;
  }

  // ── 更新组件关联关系 ──
  async updateRelationships(
    designId: string,
    relationships: DesignRelationship[],
    ownerId: string
  ): Promise<AppDesignRecord> {
    const record = await this.getRecord(designId);
    if (!record) throw new Error(`设计方案不存在: ${designId}`);
    if (record.ownerId !== ownerId) throw new Error("无权修改此设计方案");
    record.designJson.relationships = relationships;
    record.updatedAt = Date.now();
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

  // ── 级联删除设计方案（及关联组件） ──
  async deleteDesign(designId: string, ownerId: string): Promise<{ deleted: string[]; errors: string[] }> {
    const record = await this.getRecord(designId);
    if (!record || record.ownerId !== ownerId) {
      throw new Error("设计方案不存在或无权限");
    }

    const deleted: string[] = [];
    const errors: string[] = [];

    // 解析 components 获取已部署的组件
    const components = record.components ?? [];

    // 1. 先清理 workflow_form_bindings（解除表单和工作流的关联），否则表单删除会失败
    for (const comp of components.filter((c) => c.type === "workflow" && c.status === "created")) {
      try {
        const { deleteWorkflowFormBindingsByDefinitionKey } = await import("../services/workflow-form-service.js");
        await deleteWorkflowFormBindingsByDefinitionKey(comp.key);
      } catch (e: any) {
        console.warn(`[deleteDesign] 清理 workflow_form_bindings 警告: ${e.message || String(e)}`);
      }
    }

    // 2. 删除工作流定义（必须先于表单删除，因为 workflow_form_bindings 已清理）
    for (const comp of components.filter((c) => c.type === "workflow" && c.status === "created")) {
      try {
        const { getWorkflowRepository } = await import("../workflow/repository.js");
        const repo = getWorkflowRepository();
        const def = await repo.getDefinitionByKey(comp.key);
        if (def) {
          await repo.deleteDefinition(def.id);
          deleted.push(`workflow:${comp.key}`);
        }
      } catch (e: any) {
        errors.push(`workflow:${comp.key} — ${e.message || String(e)}`);
      }
    }

    // 3. 删除表单定义（workflow_form_bindings 已清理，不会再被引用）
    for (const comp of components.filter((c) => c.type === "form" && c.status === "created")) {
      try {
        const { deleteFormDefinition, getFormDefinitionByKey } = await import("../services/form-service.js");
        const formDef = await getFormDefinitionByKey(comp.key);
        if (formDef) {
          await deleteFormDefinition(formDef.id, ownerId);
          deleted.push(`form:${comp.key}`);
        }
      } catch (e: any) {
        errors.push(`form:${comp.key} — ${e.message || String(e)}`);
      }
    }

    // 3. 删除自定义 Skill
    for (const comp of components.filter((c) => c.type === "skill" && c.status === "created")) {
      try {
        const { getCustomSkillRepository } = await import("../db/custom-skill-repository.js");
        const repo = getCustomSkillRepository();
        await repo.deleteByName(comp.key, ownerId);
        deleted.push(`skill:${comp.key}`);
      } catch (e: any) {
        errors.push(`skill:${comp.key} — ${e.message || String(e)}`);
      }
    }

    // 4. 删除知识库集合（先删集合内文档，再删集合）
    for (const comp of components.filter((c) => c.type === "knowledgeBase" && c.status === "created")) {
      try {
        const kb = record.designJson.components.knowledgeBases.find((k: any) => k.name === comp.key);
        const collectionId = kb?.collectionId;
        if (collectionId) {
          // 4.1 查询集合内所有文档并逐个删除（含向量、文件）
          const { getKnowledgeBase } = await import("./knowledge-skills.js");
          const kbInstance = getKnowledgeBase(ownerId);
          let docRows: Array<{ doc_id: string }> = [];
          if (isMySQL()) {
            const adapter = await getMySQLAdapter();
            docRows = await adapter.query<{ doc_id: string }>(
              "SELECT doc_id FROM kb_documents WHERE collection_id = ? AND owner_id = ?",
              [collectionId, ownerId]
            );
          } else {
            const db = getDb();
            docRows = db.prepare("SELECT doc_id FROM kb_documents WHERE collection_id = ? AND owner_id = ?").all(collectionId, ownerId) as Array<{ doc_id: string }>;
          }
          for (const row of docRows) {
            try {
              await kbInstance.deleteDocument(row.doc_id);
            } catch (docErr: any) {
              console.warn(`[deleteDesign] Failed to delete KB doc ${row.doc_id}: ${docErr.message}`);
            }
          }

          // 4.2 删除集合本身
          const { deleteKBCollection } = await import("../services/kb-collection-service.js");
          await deleteKBCollection(collectionId, ownerId);
          deleted.push(`knowledgeBase:${comp.key}`);
        }
      } catch (e: any) {
        errors.push(`knowledgeBase:${comp.key} — ${e.message || String(e)}`);
      }
    }

    // 5. 删除应用记录
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute("DELETE FROM app_designs WHERE id = ?", [designId]);
    } else {
      const db = getDb();
      db.prepare("DELETE FROM app_designs WHERE id = ?").run(designId);
    }
    deleted.push(`app:${designId}`);

    return { deleted, errors };
  }

  // ── 关联知识库集合 ──
  async linkKbCollection(
    designId: string,
    kbName: string,
    collectionId: string,
    ownerId: string,
  ): Promise<AppDesignRecord> {
    const record = await this.getRecord(designId);
    if (!record) {
      throw new Error(`设计方案不存在: ${designId}`);
    }
    if (record.ownerId !== ownerId) {
      throw new Error("无权操作此设计方案");
    }
    const kb = record.designJson.components.knowledgeBases.find((k) => k.name === kbName);
    if (!kb) {
      throw new Error(`知识库 "${kbName}" 不存在于设计方案中`);
    }
    kb.collectionId = collectionId;
    record.updatedAt = Date.now();
    await this.saveRecord(record);
    return record;
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
    const createdFormKeys = new Set<string>();
    const formKeyToId = new Map<string, string>();

    // 1. 创建表单定义
    for (const form of record.designJson.components.forms) {
      try {
        const schema = this.buildFormSchema(form);
        const created = await createFormDefinition({
          key: form.key,
          name: form.name,
          description: form.description,
          schemaJson: schema,
          createdBy: ownerId,
        });
        createdFormKeys.add(form.key);
        if (created?.id) formKeyToId.set(form.key, created.id);
        results.push({ type: "form", key: form.key, name: form.name, status: "created" });
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("UNIQUE constraint") || msg.includes("Duplicate entry") || msg.includes("already exists")) {
          // 检查现有表单的 schema 是否与设计一致，防止引用错误的表单
          const existing = await getFormDefinitionByKey(form.key);
          const designedSchema = this.buildFormSchema(form);
          const existingSchema = existing?.schema_json;
          const schemasMatch = this.deepEqual(existingSchema, designedSchema);
          if (schemasMatch) {
            createdFormKeys.add(form.key);
            if (existing?.id) formKeyToId.set(form.key, existing.id);
            results.push({ type: "form", key: form.key, name: form.name, status: "exists" });
          } else {
            // P1-26 修复: 之前 schema 不匹配直接 fail, 让用户得手动删旧表单.
            // 用户实际工作流: 改设计 → apply → 期望立即生效. 改为自动 updateFormDefinition.
            // 已有的 form_instances 数据由 form-service 的 syncFormInstanceIndexes 自动适配.
            try {
              const { updateFormDefinition } = await import("../services/form-service.js");
              await updateFormDefinition(existing.id, {
                name: form.name,
                description: form.description,
                schemaJson: designedSchema,
              } as any, ownerId);
              createdFormKeys.add(form.key);
              if (existing?.id) formKeyToId.set(form.key, existing.id);
              results.push({
                type: "form",
                key: form.key,
                name: form.name,
                status: "updated",  // 新加的状态: 已更新 schema
                message: `表单 schema 已更新以匹配新设计`,
              });
            } catch (updateErr: any) {
              const uMsg = updateErr instanceof Error ? updateErr.message : String(updateErr);
              results.push({
                type: "form",
                key: form.key,
                name: form.name,
                status: "failed",
                error: `表单 "${form.key}" 已存在但 schema 不匹配, 自动 update 失败: ${uMsg}. 请先删除旧表单或手动修改设计`,
              });
            }
          }
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
        const spec = this.buildWorkflowSpec(workflow, createdFormKeys);
        await repo.createDefinition({
          name: workflow.name,
          key: workflow.key,
          version: 1,
          definition: spec,
          createdBy: ownerId,
        });
        // 为工作流中引用了已创建表单的 user_task 节点创建 form_bindings
        try {
          const { createWorkflowFormBinding } = await import("../services/workflow-form-service.js");
          for (const node of workflow.nodes) {
            if (node.type === "userTask" && node.formKey && createdFormKeys.has(node.formKey)) {
              const formDefId = formKeyToId.get(node.formKey);
              if (formDefId) {
                await createWorkflowFormBinding({
                  definitionKey: workflow.key,
                  nodeId: node.id,
                  formId: formDefId,
                  isRequired: true,
                }).catch(() => {}); // 忽略已存在的绑定
              }
            }
          }
        } catch (bindingErr) {
          console.warn(`[applyDesign] workflow_form_bindings creation warning:`, bindingErr);
        }
        results.push({ type: "workflow", key: workflow.key, name: workflow.name, status: "created" });
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ type: "workflow", key: workflow.key, name: workflow.name, status: "failed", error: msg });
      }
    }

    // 3. 创建 Skill（通过 skill_from_description 自动生成可执行代码，autoRegister 模式跳过审批直接注册）
    for (const skill of record.designJson.components.skills) {
      try {
        // 构建包含应用上下文的描述，让 LLM 生成更具体的代码
        const appContext = this.buildSkillContext(skill, record);
        const result = await engine.execute("skill_from_description", {
          name: skill.name,
          description: `${skill.description}\n\n业务逻辑：${skill.logic || "无详细逻辑"}\n\n应用上下文：${appContext}`,
          // 生产环境：走 evolution 审批流程，不自动注册
          autoRegister: false,
        } as any);
        console.log(`[applyDesign] skill_from_description result for ${skill.name}: success=${result.success}, error=${result.error instanceof Error ? result.error.message : result.error}`);
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

    // 4. 自动创建知识库集合
    for (const kb of record.designJson.components.knowledgeBases) {
      try {
        const result = await engine.execute("kb_collection_create", {
          name: kb.name,
          description: kb.description || `${kb.name}（应用「${record.name}」自动创建）`,
          owner: ownerId,
        });
        if (result.success) {
          const collectionId = ((result.data as any)?.collection as any)?.id as string | undefined;
          if (collectionId) {
            kb.collectionId = collectionId;
          }
          results.push({ type: "knowledgeBase", key: kb.name, name: kb.name, status: "created", id: collectionId, message: `知识库集合「${kb.name}」已创建，请前往知识库页面上传文档` });
        } else {
          const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
          if (errMsg.includes("已存在") || errMsg.includes("already exists") || errMsg.includes("Duplicate entry") || errMsg.includes("UNIQUE constraint")) {
            results.push({ type: "knowledgeBase", key: kb.name, name: kb.name, status: "exists", message: "知识库集合已存在" });
          } else {
            results.push({ type: "knowledgeBase", key: kb.name, name: kb.name, status: "failed", error: errMsg });
          }
        }
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ type: "knowledgeBase", key: kb.name, name: kb.name, status: "failed", error: msg });
      }
    }

    // 5. 更新记录
    const updatedComponents: GeneratedComponent[] = results.map((r) => ({
      type: r.type,
      key: r.key,
      name: r.name,
      status: r.status === "created" ? "created" : r.status === "exists" ? "created" : "failed",
      id: r.id,
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
3. 工作流：节点类型可选 start/end/userTask/serviceTask/exclusiveGateway/parallelGateway
   - start: 必须有 next（单个目标）
   - end: 无 next
   - userTask/serviceTask: 可有 next（单个目标）
   - exclusiveGateway: 必须有 condition（条件表达式）和 next（多个分支目标数组）
   - parallelGateway: 有 mode 字段（"split" 或 "join"）
     - split 模式: 必须有 branches（分支节点ID数组），不需要 next
     - join 模式: 必须有 next（单个目标），不需要 branches
   - 【重要】condition 中的变量必须使用 \${variable} 语法，如 "\${amount} >= 5000"、"\${status} == 'approved'"
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
          { "id": "start", "type": "start", "name": "开始", "next": ["gateway1"] },
          { "id": "gateway1", "type": "exclusiveGateway", "name": "金额判断", "condition": "\${amount} >= 5000", "next": ["high_task", "low_task"] },
          { "id": "high_task", "type": "userTask", "name": "高额审批", "assignee": "role_manager", "next": ["end"] },
          { "id": "low_task", "type": "userTask", "name": "普通审批", "assignee": "role_employee", "next": ["end"] },
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
      const parsed = JSON.parse(jsonText) as DesignSchema;
      // 填充默认值，防止 LLM 遗漏字段导致后续崩溃
      parsed.components = parsed.components || { skills: [], forms: [], workflows: [], knowledgeBases: [] };
      parsed.components.skills = parsed.components.skills || [];
      parsed.components.forms = parsed.components.forms || [];
      parsed.components.workflows = parsed.components.workflows || [];
      parsed.components.knowledgeBases = parsed.components.knowledgeBases || [];
      parsed.relationships = parsed.relationships || [];
      return parsed;
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
      // 填充默认值
      result.updatedSchema.components = result.updatedSchema.components || { skills: [], forms: [], workflows: [], knowledgeBases: [] };
      result.updatedSchema.components.skills = result.updatedSchema.components.skills || [];
      result.updatedSchema.components.forms = result.updatedSchema.components.forms || [];
      result.updatedSchema.components.workflows = result.updatedSchema.components.workflows || [];
      result.updatedSchema.components.knowledgeBases = result.updatedSchema.components.knowledgeBases || [];
      result.updatedSchema.relationships = result.updatedSchema.relationships || [];
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

  /** 深度比较两个值是否相等（忽略对象键顺序） */
  /** 为 design skill 构建应用上下文，帮助 LLM 生成更具体的代码
   * 基于 skill 的 description 和当前应用的所有组件（表单/知识库/工作流）自动推断上下文
   */
  private buildSkillContext(skill: DesignSkill, record: AppDesignRecord): string {
    const parts: string[] = [];
    const forms = record.designJson.components.forms ?? [];
    const kbs = record.designJson.components.knowledgeBases ?? [];
    const workflows = record.designJson.components.workflows ?? [];
    const desc = (skill.description || "").toLowerCase();
    const name = skill.name.toLowerCase();

    // ── 通用上下文：所有 skill 都能看到的应用组件信息 ──
    if (forms.length > 0) {
      const formKeys = forms.map((f) => f.key).join(", ");
      parts.push(`本应用关联的表单：${formKeys}`);
      const fields = forms.map((f) => `${f.key}(${f.fields.map((fld) => `${fld.name}:${fld.type}`).join(", ")})`).join("；");
      parts.push(`各表单字段：${fields}`);
    }
    if (kbs.length > 0) {
      const kbNames = kbs.map((k) => k.name).join(", ");
      parts.push(`本应用关联的知识库：${kbNames}`);
    }
    if (workflows.length > 0) {
      const wfNames = workflows.map((w) => w.name).join(", ");
      parts.push(`本应用关联的工作流：${wfNames}`);
    }

    // ── 基于 description 关键词推断 skill 类型，提供对应实现指引 ──
    const isQuerySkill = desc.includes("查询") || desc.includes("统计") || desc.includes("分析") || desc.includes("数据") || name.includes("query") || name.includes("data");
    const isKbSkill = desc.includes("知识") || desc.includes("文档") || desc.includes("资料") || desc.includes("问答") || name.includes("kb") || name.includes("knowledge");
    const isFormSkill = desc.includes("表单") || desc.includes("填写") || desc.includes("登记") || desc.includes("报名") || desc.includes("申请") || name.includes("form") || name.includes("registration");
    const isWorkflowSkill = desc.includes("审批") || desc.includes("流程") || desc.includes("审核") || desc.includes("发起") || name.includes("approval") || name.includes("workflow");

    if (isQuerySkill && forms.length > 0) {
      parts.push("【实现方式】如需查询表单数据，调用 form_data_query(skillName='form_data_query', params={formKey, queryType, filters, groupBy, metrics, startDate, endDate})。");
      parts.push("form_data_query 参数：formKey(表单key), queryType('list'|'count'|'group'|'stats'|'schema'), filters(字段过滤), groupBy(分组字段数组), metrics(统计指标), startDate/endDate(时间范围)");
      parts.push("【重要】form_data_query 是系统级通用 Skill，自动适配 MySQL/SQLite。禁止直接调用 db_query 或 mysql_query 操作 form_instances 表。");
    }

    if (isKbSkill && kbs.length > 0) {
      const kbIds = kbs.map((k) => k.collectionId).filter(Boolean);
      if (kbIds.length > 0) {
        parts.push(`本应用知识库 collectionId：${kbIds.join(", ")}`);
        parts.push("【实现方式】如需查询知识库，调用 kb_search(skillName='kb_search', params={collectionId, query, limit})");
      }
    }

    if (isFormSkill && forms.length > 0) {
      const firstForm = forms[0];
      parts.push(`【实现方式】如需引导用户填写表单，调用 user_confirm(skillName='user_confirm', params={type: 'form', formKey: '${firstForm.key}', title: '${firstForm.name}'})`);
      parts.push("如需提交表单数据，调用 form_submit(skillName='form_submit', params={formKey, data})");
    }

    if (isWorkflowSkill && workflows.length > 0) {
      const firstWf = workflows[0];
      parts.push(`【实现方式】如需发起审批，调用 approval_submit(skillName='approval_submit', params={workflowKey: '${firstWf.key}', formData: {...}})`);
    }

    return parts.join("。");
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
      const aa = a as unknown[];
      const bb = b as unknown[];
      if (aa.length !== bb.length) return false;
      for (let i = 0; i < aa.length; i++) {
        if (!this.deepEqual(aa[i], bb[i])) return false;
      }
      return true;
    }

    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!bKeys.includes(key)) return false;
      if (!this.deepEqual(ao[key], bo[key])) return false;
    }
    return true;
  }

  private buildFormSchema(form: DesignForm): Record<string, unknown> {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // P1-25: widgetMap 扩到 18 个, 覆盖 form-engine 全部已注册组件
    // (componentRegistry.ts: input/textarea/number/password/select/radio/checkbox/switch/
    //   datePicker/dateRange/dateTimeRange/timePicker/userPicker/deptPicker/
    //   fileUploader/array/group/table)
    const widgetMap: Record<string, string> = {
      string: "input",
      number: "number",
      boolean: "switch",
      select: "select",
      date: "datePicker",
      textarea: "textarea",
      email: "input",
      phone: "input",
      radio: "radio",
      checkbox: "checkbox",
      password: "password",
      dateRange: "dateRange",
      dateTimeRange: "dateTimeRange",
      timePicker: "timePicker",
      userPicker: "userPicker",
      deptPicker: "deptPicker",
      fileUploader: "fileUploader",
      array: "array",
      group: "group",
      table: "table",
    };

    // JSON Schema type 映射: 部分 widget 不是 string/number/boolean (比如 array/object)
    const jsonTypeMap: Record<string, string> = {
      array: "array",
      group: "object",
      table: "array",
      fileUploader: "string",  // 文件上传存 URL 字符串
    };

    for (const field of form.fields) {
      // 字段名校验：只允许字母、数字、下划线
      if (!/^[a-zA-Z0-9_]+$/.test(field.name)) {
        throw new Error(`表单 "${form.key}" 的字段名 "${field.name}" 非法，只允许字母、数字、下划线`);
      }
      // JSON Schema type 推断
      const jsonType = jsonTypeMap[field.type] ?? (
        field.type === "number" ? "number" :
        field.type === "boolean" ? "boolean" :
        "string"
      );
      const prop: any = {
        type: jsonType,
        title: field.title,
      };

      // UI 组件映射（与主站 form-engine 对齐）
      const widget = widgetMap[field.type];
      if (widget) prop["ui:widget"] = widget;

      // 特殊类型 format 标记（用于前端验证和输入类型区分）
      if (field.type === "email") prop.format = "email";
      if (field.type === "phone") prop.format = "mobile";

      // placeholder 使用 ui:placeholder（form-engine 标准）
      if (field.placeholder) prop["ui:placeholder"] = field.placeholder;

      // 选项使用 x-dataSource（form-engine 标准），同时保留 enum 作为后备
      // radio/checkbox/select 都用 options.
      // P1-27 修复: 之前 field.options.map((opt: string) => ({ label: opt, value: opt }))
      //   假设 opt 是 string. 但 app_designer prompt 生成的 designJson 里 options 是
      //   {label, value} 对象数组. 这样写会导致嵌套:
      //     x-dataSource.options[0] = {label: {label:"X",value:"Y"}, value: {label:"X",value:"Y"}}
      //   渲染时 opt.label 是对象, React 抛 "Objects are not valid as a React child".
      // 修法: 判断 opt 是 string 还是 {label, value} 对象, 分别处理.
      if (field.options && field.options.length > 0) {
        const normalizedOptions = field.options.map((opt: any) => {
          if (typeof opt === "string") {
            return { label: opt, value: opt };
          }
          // 已经是 {label, value} 对象
          if (opt && typeof opt === "object" && "label" in opt && "value" in opt) {
            return { label: String(opt.label), value: opt.value };
          }
          // 兜底: 强制转字符串
          return { label: String(opt), value: String(opt) };
        });
        prop.enum = normalizedOptions.map((o) => o.value);  // enum 用 value 数组 (string[])
        prop["x-dataSource"] = {
          type: "static",
          options: normalizedOptions,
        };
      }

      // fileUploader 限制
      if (field.type === "fileUploader") {
        if (field.accept) prop["ui:accept"] = field.accept;
        if (field.maxSize !== undefined) prop["ui:maxSize"] = field.maxSize;
      }

      // array/group/table 复杂组件: items/fields/columns
      if (field.type === "array" && field.items) {
        prop.items = field.items;
      }
      if (field.type === "group" && field.fields) {
        prop.properties = {};
        // 递归子字段
        for (const sub of field.fields) {
          prop.properties[sub.name] = { type: "string", title: sub.title };
          if (sub.options) {
            // P1-27: 同样修复嵌套 opt 对象问题
            const normalizedSubOptions = sub.options.map((opt: any) =>
              typeof opt === "string"
                ? { label: opt, value: opt }
                : { label: String(opt.label), value: opt.value }
            );
            prop.properties[sub.name].enum = normalizedSubOptions.map((o) => o.value);
            prop.properties[sub.name]["x-dataSource"] = {
              type: "static",
              options: normalizedSubOptions,
            };
          }
        }
      }
      if (field.type === "table" && field.columns) {
        prop.items = { type: "object", properties: {} };
        for (const col of field.columns) {
          prop.items.properties[col.name || col.dataIndex] = { type: col.type || "string", title: col.title };
        }
      }

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
      actions: [
        { type: "submit", label: "提交", primary: true },
        { type: "cancel", label: "取消" },
      ],
    };
  }

  private buildWorkflowSpec(workflow: DesignWorkflow, createdFormKeys?: Set<string>): any {
    const typeMap: Record<string, string> = {
      start: "start_event",
      end: "end_event",
      userTask: "user_task",
      serviceTask: "service_task",
      exclusiveGateway: "exclusive_gateway",
      parallelGateway: "parallel_gateway",
    };

    // 预校验：收集所有节点 ID
    const nodeIds = new Set(workflow.nodes.map((n) => n.id));
    const startNodes = workflow.nodes.filter((n) => n.type === "start");
    const endNodes = workflow.nodes.filter((n) => n.type === "end");
    if (startNodes.length !== 1) {
      throw new Error(`工作流 "${workflow.key}" 必须有且仅有一个 start 节点`);
    }
    if (endNodes.length === 0) {
      throw new Error(`工作流 "${workflow.key}" 至少需要一个 end 节点`);
    }

    const nodes = workflow.nodes.map((n) => {
      const backendType = typeMap[n.type] || n.type;
      const node: any = {
        id: n.id,
        type: backendType,
        name: n.name,
      };

      // assignee → 后端保留（格式校验）
      if (n.assignee) {
        if (!/^(role_|user_|dept_)/.test(n.assignee)) {
          throw new Error(`工作流 "${workflow.key}" 节点 "${n.id}" 的 assignee "${n.assignee}" 格式非法，必须以 role_ / user_ / dept_ 开头`);
        }
        node.assignee = n.assignee;
      }

      // formKey → formDefinitionId（仅当表单已成功创建时才引用）
      if (n.formKey && (!createdFormKeys || createdFormKeys.has(n.formKey))) {
        node.formDefinitionId = n.formKey;
      }

      // parallelGateway 特殊处理
      if (n.type === "parallelGateway") {
        node.mode = n.mode || "split";
        if (n.branches && n.branches.length > 0) {
          // 校验 branches 中的节点 ID 必须存在于工作流中
          for (const branchId of n.branches) {
            if (!nodeIds.has(branchId)) {
              throw new Error(`工作流 "${workflow.key}" 并行网关 "${n.id}" 的分支 "${branchId}" 不存在于节点列表中`);
            }
          }
          node.branches = n.branches;
        }
      }

      // next 处理 + 目标节点存在性校验
      if (n.next && Array.isArray(n.next) && n.next.length > 0) {
        for (const targetId of n.next) {
          if (!nodeIds.has(targetId)) {
            throw new Error(`工作流 "${workflow.key}" 节点 "${n.id}" 的 next 目标 "${targetId}" 不存在于节点列表中`);
          }
        }
        if (n.type === "exclusiveGateway") {
          // exclusiveGateway: next 数组 → conditions
          // 支持单个 condition（第一个分支）或 conditions 数组
          const conditions = n.conditions as string[] | undefined;
          // 校验：conditions 数量应等于 next 数量（不足时用 "default" 补充）
          if (conditions && conditions.length > 0 && conditions.length !== n.next.length) {
            throw new Error(`工作流 "${workflow.key}" 排他网关 "${n.id}" 的条件数量 (${conditions.length}) 与分支数量 (${n.next.length}) 不一致`);
          }
          node.conditions = n.next.map((targetId, idx) => ({
            expression: conditions?.[idx] ?? (n.condition && idx === 0 ? n.condition : "default"),
            next: targetId,
          }));
        } else if (n.type === "parallelGateway") {
          // parallelGateway: join 模式需要 next，split 模式不需要
          if (n.mode === "join") {
            node.next = n.next[0];
          }
        } else {
          // 其他节点: next 数组第一个元素 → next 字符串
          node.next = n.next[0];
        }
      }

      return node;
    });

    const spec = {
      key: workflow.key,
      name: workflow.name,
      nodes,
    };

    // 预验证，确保转换后的格式正确
    const validation = validateWorkflowSpec(spec);
    if (!validation.valid) {
      throw new Error(`Workflow validation failed: ${validation.errors.join("; ")}`);
    }

    return spec;
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

    if (d.relationships && d.relationships.length > 0) {
      text += `\n🔗 组件关联:\n`;
      for (const r of d.relationships) text += `  ${r.from} → ${r.to} (${r.type})\n`;
    }

    const req = record.requirement || "";
    text += `\n📋 原始需求:\n${req.slice(0, 500)}${req.length > 500 ? "..." : ""}`;
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
      timeout: 300000,
      description: `【应用级元 Skill】根据用户自然语言描述，设计完整的 RAOS 应用方案（Skill + 表单 + 工作流 + 知识库配置）。
支持持续迭代升级：创建 → 预览 → 修正 → 再预览 → 一键部署。

参数:
  action(string): create(创建方案) | update(修正方案) | preview(预览方案) | list(列出方案) | archive(归档方案) | delete(删除方案) | apply(一键部署) | link_kb_collection(关联知识库集合)
  requirement(string): 需求描述（create/update 时需要）
  designId(string): 设计方案 ID（update/preview/archive/delete/apply/link_kb_collection 时需要）
  name(string): 应用名称（create 时可选）
  kbName(string): 知识库名称（link_kb_collection 时需要）
  collectionId(string): 知识库集合 ID（link_kb_collection 时需要）

使用示例:
  1. create: {"action":"create","requirement":"帮我做一个高校招生咨询机器人"}
  2. preview: {"action":"preview","designId":"design_xxx"}
  3. update: {"action":"update","designId":"design_xxx","requirement":"再加一个按城市分配招生老师的功能"}
  4. apply: {"action":"apply","designId":"design_xxx"}
  5. list: {"action":"list"}
  6. link_kb_collection: {"action":"link_kb_collection","designId":"design_xxx","kbName":"课程资料","collectionId":"kbc_xxx"}

注意：
  - create/update 需要 LLM 配置
  - apply 会根据设计方案自动创建表单、工作流、知识库集合，并提交 Skill 生成审批
  - 知识库文档需要手动上传
  - 设计方案会自动版本化存储`,
      paramSchema: {
        properties: {
          action: {
            type: "string",
            enum: ["create", "update", "preview", "list", "archive", "delete", "apply", "link_kb_collection", "update_system_prompt"],
            description: "操作类型",
          },
          requirement: { type: "string", description: "需求描述" },
          designId: { type: "string", description: "设计方案ID" },
          name: { type: "string", description: "应用名称" },
          kbName: { type: "string", description: "知识库名称（link_kb_collection 时使用）" },
          collectionId: { type: "string", description: "知识库集合 ID（link_kb_collection 时使用）" },
          systemPrompt: { type: "string", description: "自定义系统提示词（update_system_prompt 时使用）" },
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
              // P1-26 修复: 之前 update 后不调 apply, 用户改完设计看 form 列表无变化
              // (因为 design_json 更新了, 但 form_definitions 表没动).
              // 现在 update 完成后自动 apply, 真实同步 form/workflow/skill 到对应表.
              const applyResult = await service.applyDesign(designId, userId, engine);
              const display = service.formatForDisplay(record);
              const formResult = applyResult.results.filter((r) => r.type === "form");
              const updatedForms = formResult.filter((r) => r.status === "updated").length;
              const createdForms = formResult.filter((r) => r.status === "created").length;
              const failedForms = formResult.filter((r) => r.status === "failed").length;
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  version: record.version,
                  status: applyResult.record.status,
                  preview: display.text,
                  structured: display.structured,
                  applySummary: applyResult.results,
                  message: `✅ 应用方案已更新至 v${record.version} 并自动部署。\n设计 ID: ${record.id}\n表单变更: 新增 ${createdForms} | 更新 ${updatedForms} | 失败 ${failedForms}\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="update" />`,
                },
              };
            }

            case "update_system_prompt": {
              const designId = params.designId as string;
              const systemPrompt = params.systemPrompt as string;
              if (!designId) {
                return { success: false, error: new Error("update_system_prompt 操作需要提供 designId 参数") };
              }
              const record = await service.updateSystemPrompt(designId, systemPrompt || "", userId);
              const display = service.formatForDisplay(record);
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  version: record.version,
                  preview: display.text,
                  structured: display.structured,
                  message: `✅ 应用角色设定已更新。\n设计 ID: ${record.id}\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="update" />`,
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

            case "link_kb_collection": {
              const designId = params.designId as string;
              const kbName = params.kbName as string;
              const collectionId = params.collectionId as string;
              if (!designId || !kbName || !collectionId) {
                return { success: false, error: new Error("link_kb_collection 操作需要提供 designId、kbName 和 collectionId 参数") };
              }
              const record = await service.linkKbCollection(designId, kbName, collectionId, userId);
              return {
                success: true,
                data: { designId, kbName, collectionId, message: `知识库「${kbName}」已关联到集合 ${collectionId}` },
              };
            }

            case "update_relationships": {
              const designId = params.designId as string;
              const relationships = params.relationships as DesignRelationship[];
              if (!designId || !Array.isArray(relationships)) {
                return { success: false, error: new Error("update_relationships 操作需要提供 designId 和 relationships 参数") };
              }
              const record = await service.updateRelationships(designId, relationships, userId);
              const display = service.formatForDisplay(record);
              return {
                success: true,
                data: {
                  designId: record.id,
                  name: record.name,
                  version: record.version,
                  preview: display.text,
                  structured: display.structured,
                  message: `✅ 组件关联关系已更新。\n设计 ID: ${record.id}\n\n<app-design-card data-design-id="${record.id}" data-name="${record.name}" data-version="${record.version}" data-action="update" />`,
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

            case "delete": {
              const designId = params.designId as string;
              if (!designId) {
                return { success: false, error: new Error("delete 操作需要提供 designId 参数") };
              }
              const { deleted, errors } = await service.deleteDesign(designId, userId);
              return {
                success: true,
                data: {
                  designId,
                  deleted,
                  errors,
                  message: `应用「${designId}」已删除。级联清理 ${deleted.length} 个组件${errors.length > 0 ? `，${errors.length} 个组件清理失败` : ""}。`,
                },
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
