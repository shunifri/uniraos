/**
 * Workflow Engine Lite — 数据访问层
 *
 * 封装 workflow_definitions / workflow_instances / workflow_tasks / workflow_variables / connections 的 CRUD
 * 兼容 SQLite (better-sqlite3) 和 MySQL (mysql2/promise)
 */

import { isMySQL } from "../db/database.js";
import { getMySQLAdapter } from "../db/mysql-adapter.js";
import type { Database } from "better-sqlite3";
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowTask,
  WorkflowVariable,
  Connection,
  ApprovalQueryParams,
  TaskQueryParams,
  IWorkflowRepository,
} from "./types.js";

/** 安全解析 JSON，失败时返回 null 并记录日志 */
function safeJsonParse<T>(str: string | unknown, ctx: string): T | null {
  if (str === null || str === undefined || str === "") return null;
  const strVal = typeof str === "string" ? str : String(str);
  try {
    return JSON.parse(strVal) as T;
  } catch (e) {
    console.error(`[WorkflowRepository] JSON parse failed (${ctx}): ${e instanceof Error ? e.message : String(e)}. Raw: ${strVal.slice(0, 200)}`);
    return null;
  }
}

// ===== SQLite Repository =====

export class SQLiteWorkflowRepository implements IWorkflowRepository {
  constructor(private db: Database) {}

  // --- Workflow Definitions ---

  async createDefinition(def: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">): Promise<WorkflowDefinition> {
    const now = Date.now();
    console.log(`[WorkflowRepository] SQLite createDefinition: key=${def.key}, name=${def.name}`);
    const stmt = this.db.prepare(`
      INSERT INTO workflow_definitions (name, key, version, category, definition, form_schema, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      def.name, def.key, def.version, def.category ?? null,
      JSON.stringify(def.definition), def.formSchema ? JSON.stringify(def.formSchema) : null,
      def.createdBy ?? null, now, now,
    );
    console.log(`[WorkflowRepository] SQLite createDefinition success: key=${def.key}, id=${result.lastInsertRowid}`);
    return { ...def, id: Number(result.lastInsertRowid), createdAt: now, updatedAt: now };
  }

  async getDefinitionById(id: number): Promise<WorkflowDefinition | undefined> {
    const row = this.db.prepare("SELECT * FROM workflow_definitions WHERE id = ?").get(id) as RawDef | undefined;
    return row ? this.mapDefinition(row) : undefined;
  }

  async getDefinitionByKey(key: string): Promise<WorkflowDefinition | undefined> {
    console.log(`[WorkflowRepository] SQLite getDefinitionByKey: key=${key}`);
    const row = this.db.prepare("SELECT * FROM workflow_definitions WHERE key = ? ORDER BY version DESC LIMIT 1").get(key) as RawDef | undefined;
    if (!row) {
      console.log(`[WorkflowRepository] SQLite getDefinitionByKey: key=${key} not found`);
      return undefined;
    }
    const def = this.mapDefinition(row);
    console.log(`[WorkflowRepository] SQLite getDefinitionByKey: key=${key}, found=${!!def}, id=${row.id}`);
    return def;
  }

  async listDefinitions(category?: string): Promise<WorkflowDefinition[]> {
    const sql = category
      ? "SELECT * FROM workflow_definitions WHERE category = ? ORDER BY updated_at DESC"
      : "SELECT * FROM workflow_definitions ORDER BY updated_at DESC";
    const stmt = this.db.prepare(sql);
    const rows = category ? stmt.all(category) : stmt.all();
    return (rows as RawDef[]).map((r) => this.mapDefinition(r)).filter((d): d is WorkflowDefinition => d !== undefined);
  }

  async updateDefinition(id: number, updates: Partial<WorkflowDefinition>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
    if (updates.category !== undefined) { sets.push("category = ?"); vals.push(updates.category); }
    if (updates.definition !== undefined) { sets.push("definition = ?"); vals.push(JSON.stringify(updates.definition)); }
    if (updates.formSchema !== undefined) { sets.push("form_schema = ?"); vals.push(updates.formSchema ? JSON.stringify(updates.formSchema) : null); }
    if (sets.length === 0) return;
    sets.push("updated_at = ?"); vals.push(Date.now());
    vals.push(id);
    this.db.prepare(`UPDATE workflow_definitions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  async deleteDefinition(id: number): Promise<void> {
    this.db.prepare("DELETE FROM workflow_definitions WHERE id = ?").run(id);
  }

  private mapDefinition(row: RawDef): WorkflowDefinition | undefined {
    // MySQL 的 JSON 类型字段会被驱动自动解析为对象，无需再 JSON.parse
    const definition = typeof row.definition === "object" && row.definition !== null
      ? row.definition as WorkflowDefinition["definition"]
      : safeJsonParse<WorkflowDefinition["definition"]>(row.definition, "definition");
    if (!definition) return undefined;
    const formSchema = typeof row.form_schema === "object" && row.form_schema !== null
      ? row.form_schema as WorkflowDefinition["formSchema"]
      : row.form_schema ? safeJsonParse<WorkflowDefinition["formSchema"]>(row.form_schema, "form_schema") ?? undefined : undefined;
    return {
      id: row.id,
      name: row.name,
      key: row.key,
      version: row.version,
      category: row.category ?? undefined,
      definition,
      formSchema,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Workflow Instances ---

  async createInstance(inst: Omit<WorkflowInstance, "id" | "startedAt">): Promise<WorkflowInstance> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO workflow_instances (definition_id, definition_version, business_key, starter, status, current_node_id, variables, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      inst.definitionId, inst.definitionVersion, inst.businessKey ?? null,
      inst.starter ?? null, inst.status, inst.currentNodeId ?? null,
      JSON.stringify(inst.variables), now,
    );
    return { ...inst, id: Number(result.lastInsertRowid), startedAt: now };
  }

  async getInstanceById(id: number): Promise<WorkflowInstance | undefined> {
    const row = this.db.prepare("SELECT * FROM workflow_instances WHERE id = ?").get(id) as RawInst | undefined;
    return row ? this.mapInstance(row) : undefined;
  }

  async updateInstance(id: number, updates: Partial<WorkflowInstance>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.status !== undefined) { sets.push("status = ?"); vals.push(updates.status); }
    if (updates.currentNodeId !== undefined) { sets.push("current_node_id = ?"); vals.push(updates.currentNodeId); }
    if (updates.variables !== undefined) { sets.push("variables = ?"); vals.push(JSON.stringify(updates.variables)); }
    if (updates.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(updates.completedAt); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE workflow_instances SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  async listInstances(params: ApprovalQueryParams = {}): Promise<{ items: WorkflowInstance[]; total: number }> {
    const conditions: string[] = [];
    const vals: unknown[] = [];

    if (params.workflowKey) {
      conditions.push("definition_id = (SELECT id FROM workflow_definitions WHERE key = ? ORDER BY version DESC LIMIT 1)");
      vals.push(params.workflowKey);
    }
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      vals.push(...statuses);
    }
    if (params.starter) {
      conditions.push("starter = ?");
      vals.push(params.starter);
    }
    if (params.startDate) {
      conditions.push("started_at >= ?");
      vals.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push("started_at <= ?");
      vals.push(params.endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM workflow_instances ${where}`).get(...vals) as { count: number };
    const rows = this.db.prepare(`SELECT * FROM workflow_instances ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as RawInst[];

    return { items: rows.map((r) => this.mapInstance(r)), total: totalRow.count };
  }

  private mapInstance(row: RawInst): WorkflowInstance {
    // MySQL JSON 类型字段会被驱动自动解析为对象
    const variables = typeof row.variables === "object" && row.variables !== null
      ? row.variables as Record<string, unknown>
      : safeJsonParse<Record<string, unknown>>(row.variables, "instance_variables") ?? {};
    return {
      id: row.id,
      definitionId: row.definition_id,
      definitionVersion: row.definition_version,
      businessKey: row.business_key ?? undefined,
      starter: row.starter ?? undefined,
      status: row.status as WorkflowInstance["status"],
      currentNodeId: row.current_node_id ?? undefined,
      variables,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // --- Workflow Tasks ---

  async createTask(task: Omit<WorkflowTask, "id" | "createdAt">): Promise<WorkflowTask> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO workflow_tasks (instance_id, node_id, node_name, task_type, assignee, candidate_users, candidate_groups, status, form_data, comment, action, due_date, sign_group, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      task.instanceId, task.nodeId, task.nodeName ?? null, task.taskType,
      task.assignee ?? null, task.candidateUsers ? JSON.stringify(task.candidateUsers) : null,
      task.candidateGroups ? JSON.stringify(task.candidateGroups) : null,
      task.status, task.formData ? JSON.stringify(task.formData) : null,
      task.comment ?? null, task.action ?? null, task.dueDate ?? null, task.signGroup ?? null, now,
    );
    return { ...task, id: Number(result.lastInsertRowid), createdAt: now };
  }

  async getTaskById(id: number): Promise<WorkflowTask | undefined> {
    const row = this.db.prepare("SELECT * FROM workflow_tasks WHERE id = ?").get(id) as RawTask | undefined;
    return row ? this.mapTask(row) : undefined;
  }

  async getActiveTaskByInstanceAndNode(instanceId: number, nodeId: string): Promise<WorkflowTask | undefined> {
    const row = this.db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND node_id = ? AND status IN ('pending', 'claimed') ORDER BY created_at DESC LIMIT 1")
      .get(instanceId, nodeId) as RawTask | undefined;
    return row ? this.mapTask(row) : undefined;
  }

  async updateTask(id: number, updates: Partial<WorkflowTask>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.status !== undefined) { sets.push("status = ?"); vals.push(updates.status); }
    if (updates.assignee !== undefined) { sets.push("assignee = ?"); vals.push(updates.assignee); }
    if (updates.formData !== undefined) { sets.push("form_data = ?"); vals.push(updates.formData ? JSON.stringify(updates.formData) : null); }
    if (updates.comment !== undefined) { sets.push("comment = ?"); vals.push(updates.comment); }
    if (updates.action !== undefined) { sets.push("action = ?"); vals.push(updates.action); }
    if (updates.claimedAt !== undefined) { sets.push("claimed_at = ?"); vals.push(updates.claimedAt); }
    if (updates.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(updates.completedAt); }
    if (updates.signGroup !== undefined) { sets.push("sign_group = ?"); vals.push(updates.signGroup); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE workflow_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  async listTasks(params: TaskQueryParams = {}): Promise<{ items: WorkflowTask[]; total: number }> {
    const conditions: string[] = [];
    const vals: unknown[] = [];

    if (params.instanceId !== undefined) {
      conditions.push("instance_id = ?");
      vals.push(params.instanceId);
    }
    if (params.assignee) {
      conditions.push("assignee = ?");
      vals.push(params.assignee);
    }
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      vals.push(...statuses);
    }
    if (params.dueBefore) {
      conditions.push("(due_date IS NULL OR due_date <= ?)");
      vals.push(params.dueBefore);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM workflow_tasks ${where}`).get(...vals) as { count: number };
    const rows = this.db.prepare(`SELECT * FROM workflow_tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as RawTask[];

    return { items: rows.map((r) => this.mapTask(r)), total: totalRow.count };
  }

  private mapTask(row: RawTask): WorkflowTask {
    // MySQL JSON 类型字段会被驱动自动解析为对象/数组
    const candidateUsers = Array.isArray(row.candidate_users)
      ? row.candidate_users as string[]
      : safeJsonParse<string[]>(row.candidate_users, "task_candidate_users") ?? undefined;
    const candidateGroups = Array.isArray(row.candidate_groups)
      ? row.candidate_groups as string[]
      : safeJsonParse<string[]>(row.candidate_groups, "task_candidate_groups") ?? undefined;
    const formData = typeof row.form_data === "object" && row.form_data !== null
      ? row.form_data as Record<string, unknown>
      : safeJsonParse<Record<string, unknown>>(row.form_data, "task_form_data") ?? undefined;
    return {
      id: row.id,
      instanceId: row.instance_id,
      nodeId: row.node_id,
      nodeName: row.node_name ?? undefined,
      taskType: row.task_type as WorkflowTask["taskType"],
      assignee: row.assignee ?? undefined,
      candidateUsers,
      candidateGroups,
      status: row.status as WorkflowTask["status"],
      formData,
      comment: row.comment ?? undefined,
      action: row.action as WorkflowTask["action"] ?? undefined,
      dueDate: row.due_date ?? undefined,
      signGroup: row.sign_group ?? undefined,
      createdAt: row.created_at,
      claimedAt: row.claimed_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // --- Workflow Variables ---

  async setVariable(instanceId: number, name: string, value: unknown, type?: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_variables (instance_id, name, value, type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(instance_id, name) DO UPDATE SET value = excluded.value, type = excluded.type
    `);
    stmt.run(instanceId, name, JSON.stringify(value), type ?? "json");
  }

  async getVariable(instanceId: number, name: string): Promise<unknown> {
    const row = this.db.prepare("SELECT value, type FROM workflow_variables WHERE instance_id = ? AND name = ?").get(instanceId, name) as { value: string; type: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  async getVariables(instanceId: number): Promise<Record<string, unknown>> {
    const rows = this.db.prepare("SELECT name, value, type FROM workflow_variables WHERE instance_id = ?").all(instanceId) as Array<{ name: string; value: string; type: string }>;
    const vars: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        vars[row.name] = JSON.parse(row.value);
      } catch {
        vars[row.name] = row.value;
      }
    }
    return vars;
  }

  // --- Connections ---

  async createConnection(conn: Omit<Connection, "id" | "createdAt" | "updatedAt">): Promise<Connection> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO connections (name, type, config, credentials, is_active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      conn.name, conn.type, JSON.stringify(conn.config), conn.credentials ?? null,
      conn.isActive ? 1 : 0, conn.createdBy ?? null, now, now,
    );
    return { ...conn, id: Number(result.lastInsertRowid), createdAt: now, updatedAt: now };
  }

  async getConnectionById(id: number): Promise<Connection | undefined> {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as RawConn | undefined;
    return row ? this.mapConnection(row) : undefined;
  }

  async getConnectionByName(name: string): Promise<Connection | undefined> {
    const row = this.db.prepare("SELECT * FROM connections WHERE name = ? AND is_active = 1").get(name) as RawConn | undefined;
    return row ? this.mapConnection(row) : undefined;
  }

  async listConnections(type?: string): Promise<Connection[]> {
    const sql = type
      ? "SELECT * FROM connections WHERE type = ? ORDER BY updated_at DESC"
      : "SELECT * FROM connections ORDER BY updated_at DESC";
    const stmt = this.db.prepare(sql);
    const rows = type ? stmt.all(type) : stmt.all();
    return (rows as RawConn[]).map((r) => this.mapConnection(r));
  }

  async updateConnection(id: number, updates: Partial<Connection>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
    if (updates.config !== undefined) { sets.push("config = ?"); vals.push(JSON.stringify(updates.config)); }
    if (updates.credentials !== undefined) { sets.push("credentials = ?"); vals.push(updates.credentials); }
    if (updates.isActive !== undefined) { sets.push("is_active = ?"); vals.push(updates.isActive ? 1 : 0); }
    if (sets.length === 0) return;
    sets.push("updated_at = ?"); vals.push(Date.now());
    vals.push(id);
    this.db.prepare(`UPDATE connections SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  async deleteConnection(id: number): Promise<void> {
    this.db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  }

  private mapConnection(row: RawConn): Connection {
    // MySQL JSON 类型字段会被驱动自动解析为对象
    const config = typeof row.config === "object" && row.config !== null
      ? row.config as Connection["config"]
      : JSON.parse(row.config);
    return {
      id: row.id,
      name: row.name,
      type: row.type as Connection["type"],
      config,
      credentials: row.credentials ?? undefined,
      isActive: row.is_active === 1,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ===== MySQL Repository =====

class MySQLWorkflowRepository implements IWorkflowRepository {
  private adapter = getMySQLAdapter();

  // --- Workflow Definitions ---

  async createDefinition(def: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">): Promise<WorkflowDefinition> {
    const now = Date.now();
    const result = await this.adapter.execute(
      `INSERT INTO workflow_definitions (name, \`key\`, version, category, definition, form_schema, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [def.name, def.key, def.version, def.category ?? null, JSON.stringify(def.definition), def.formSchema ? JSON.stringify(def.formSchema) : null, def.createdBy ?? null, now, now]
    );
    return { ...def, id: Number(result.insertId), createdAt: now, updatedAt: now };
  }

  async getDefinitionById(id: number): Promise<WorkflowDefinition | undefined> {
    const rows = await this.adapter.query<RawDef>(`SELECT * FROM workflow_definitions WHERE id = ?`, [id]);
    return rows[0] ? this.mapDefinition(rows[0]) : undefined;
  }

  async getDefinitionByKey(key: string): Promise<WorkflowDefinition | undefined> {
    console.log(`[WorkflowRepository] MySQL getDefinitionByKey: key=${key}`);
    const rows = await this.adapter.query<RawDef>(`SELECT * FROM workflow_definitions WHERE \`key\` = ? ORDER BY version DESC LIMIT 1`, [key]);
    if (!rows[0]) {
      console.log(`[WorkflowRepository] MySQL getDefinitionByKey: key=${key} not found`);
      return undefined;
    }
    const def = this.mapDefinition(rows[0]);
    console.log(`[WorkflowRepository] MySQL getDefinitionByKey: key=${key}, found=${!!def}, id=${rows[0].id}`);
    return def;
  }

  async listDefinitions(category?: string): Promise<WorkflowDefinition[]> {
    const sql = category
      ? `SELECT * FROM workflow_definitions WHERE category = ? ORDER BY updated_at DESC`
      : `SELECT * FROM workflow_definitions ORDER BY updated_at DESC`;
    const rows = category
      ? await this.adapter.query<RawDef>(sql, [category])
      : await this.adapter.query<RawDef>(sql);
    return rows.map((r) => this.mapDefinition(r)).filter((d): d is WorkflowDefinition => d !== undefined);
  }

  async updateDefinition(id: number, updates: Partial<WorkflowDefinition>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
    if (updates.category !== undefined) { sets.push("category = ?"); vals.push(updates.category); }
    if (updates.definition !== undefined) { sets.push("definition = ?"); vals.push(JSON.stringify(updates.definition)); }
    if (updates.formSchema !== undefined) { sets.push("form_schema = ?"); vals.push(updates.formSchema ? JSON.stringify(updates.formSchema) : null); }
    if (sets.length === 0) return;
    sets.push("updated_at = ?"); vals.push(Date.now());
    vals.push(id);
    await this.adapter.execute(`UPDATE workflow_definitions SET ${sets.join(", ")} WHERE id = ?`, vals);
  }

  async deleteDefinition(id: number): Promise<void> {
    await this.adapter.execute(`DELETE FROM workflow_definitions WHERE id = ?`, [id]);
  }

  private mapDefinition(row: RawDef): WorkflowDefinition | undefined {
    // MySQL 的 JSON 类型字段会被驱动自动解析为对象，无需再 JSON.parse
    const definition = typeof row.definition === "object" && row.definition !== null
      ? row.definition as WorkflowDefinition["definition"]
      : safeJsonParse<WorkflowDefinition["definition"]>(row.definition, "definition");
    if (!definition) return undefined;
    const formSchema = typeof row.form_schema === "object" && row.form_schema !== null
      ? row.form_schema as WorkflowDefinition["formSchema"]
      : row.form_schema ? safeJsonParse<WorkflowDefinition["formSchema"]>(row.form_schema, "form_schema") ?? undefined : undefined;
    return {
      id: row.id,
      name: row.name,
      key: row.key,
      version: row.version,
      category: row.category ?? undefined,
      definition,
      formSchema,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Workflow Instances ---

  async createInstance(inst: Omit<WorkflowInstance, "id" | "startedAt">): Promise<WorkflowInstance> {
    const now = Date.now();
    const result = await this.adapter.execute(
      `INSERT INTO workflow_instances (definition_id, definition_version, business_key, starter, status, current_node_id, variables, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inst.definitionId, inst.definitionVersion, inst.businessKey ?? null, inst.starter ?? null, inst.status, inst.currentNodeId ?? null, JSON.stringify(inst.variables), now]
    );
    return { ...inst, id: Number(result.insertId), startedAt: now };
  }

  async getInstanceById(id: number): Promise<WorkflowInstance | undefined> {
    const rows = await this.adapter.query<RawInst>(`SELECT * FROM workflow_instances WHERE id = ?`, [id]);
    return rows[0] ? this.mapInstance(rows[0]) : undefined;
  }

  async updateInstance(id: number, updates: Partial<WorkflowInstance>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.status !== undefined) { sets.push("status = ?"); vals.push(updates.status); }
    if (updates.currentNodeId !== undefined) { sets.push("current_node_id = ?"); vals.push(updates.currentNodeId); }
    if (updates.variables !== undefined) { sets.push("variables = ?"); vals.push(JSON.stringify(updates.variables)); }
    if (updates.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(updates.completedAt); }
    if (sets.length === 0) return;
    vals.push(id);
    await this.adapter.execute(`UPDATE workflow_instances SET ${sets.join(", ")} WHERE id = ?`, vals);
  }

  async listInstances(params: ApprovalQueryParams = {}): Promise<{ items: WorkflowInstance[]; total: number }> {
    const conditions: string[] = [];
    const vals: unknown[] = [];

    if (params.workflowKey) {
      conditions.push("definition_id = (SELECT id FROM workflow_definitions WHERE `key` = ? ORDER BY version DESC LIMIT 1)");
      vals.push(params.workflowKey);
    }
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      vals.push(...statuses);
    }
    if (params.starter) {
      conditions.push("starter = ?");
      vals.push(params.starter);
    }
    if (params.startDate) {
      conditions.push("started_at >= ?");
      vals.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push("started_at <= ?");
      vals.push(params.endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const totalRows = await this.adapter.query<{ count: number }>(`SELECT COUNT(*) as count FROM workflow_instances ${where}`, vals);
    const total = totalRows[0]?.count ?? 0;
    const rows = await this.adapter.query<RawInst>(`SELECT * FROM workflow_instances ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`, [...vals, limit, offset]);

    return { items: rows.map((r) => this.mapInstance(r)), total };
  }

  private mapInstance(row: RawInst): WorkflowInstance {
    // MySQL JSON 类型字段会被驱动自动解析为对象
    const variables = typeof row.variables === "object" && row.variables !== null
      ? row.variables as Record<string, unknown>
      : safeJsonParse<Record<string, unknown>>(row.variables, "instance_variables") ?? {};
    return {
      id: row.id,
      definitionId: row.definition_id,
      definitionVersion: row.definition_version,
      businessKey: row.business_key ?? undefined,
      starter: row.starter ?? undefined,
      status: row.status as WorkflowInstance["status"],
      currentNodeId: row.current_node_id ?? undefined,
      variables,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // --- Workflow Tasks ---

  async createTask(task: Omit<WorkflowTask, "id" | "createdAt">): Promise<WorkflowTask> {
    const now = Date.now();
    const result = await this.adapter.execute(
      `INSERT INTO workflow_tasks (instance_id, node_id, node_name, task_type, assignee, candidate_users, candidate_groups, status, form_data, comment, action, due_date, sign_group, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [task.instanceId, task.nodeId, task.nodeName ?? null, task.taskType, task.assignee ?? null, task.candidateUsers ? JSON.stringify(task.candidateUsers) : null, task.candidateGroups ? JSON.stringify(task.candidateGroups) : null, task.status, task.formData ? JSON.stringify(task.formData) : null, task.comment ?? null, task.action ?? null, task.dueDate ?? null, task.signGroup ?? null, now]
    );
    return { ...task, id: Number(result.insertId), createdAt: now };
  }

  async getTaskById(id: number): Promise<WorkflowTask | undefined> {
    const rows = await this.adapter.query<RawTask>(`SELECT * FROM workflow_tasks WHERE id = ?`, [id]);
    return rows[0] ? this.mapTask(rows[0]) : undefined;
  }

  async getActiveTaskByInstanceAndNode(instanceId: number, nodeId: string): Promise<WorkflowTask | undefined> {
    const rows = await this.adapter.query<RawTask>(
      `SELECT * FROM workflow_tasks WHERE instance_id = ? AND node_id = ? AND status IN ('pending', 'claimed') ORDER BY created_at DESC LIMIT 1`,
      [instanceId, nodeId]
    );
    return rows[0] ? this.mapTask(rows[0]) : undefined;
  }

  async updateTask(id: number, updates: Partial<WorkflowTask>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.status !== undefined) { sets.push("status = ?"); vals.push(updates.status); }
    if (updates.assignee !== undefined) { sets.push("assignee = ?"); vals.push(updates.assignee); }
    if (updates.formData !== undefined) { sets.push("form_data = ?"); vals.push(updates.formData ? JSON.stringify(updates.formData) : null); }
    if (updates.comment !== undefined) { sets.push("comment = ?"); vals.push(updates.comment); }
    if (updates.action !== undefined) { sets.push("action = ?"); vals.push(updates.action); }
    if (updates.claimedAt !== undefined) { sets.push("claimed_at = ?"); vals.push(updates.claimedAt); }
    if (updates.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(updates.completedAt); }
    if (updates.signGroup !== undefined) { sets.push("sign_group = ?"); vals.push(updates.signGroup); }
    if (sets.length === 0) return;
    vals.push(id);
    await this.adapter.execute(`UPDATE workflow_tasks SET ${sets.join(", ")} WHERE id = ?`, vals);
  }

  async listTasks(params: TaskQueryParams = {}): Promise<{ items: WorkflowTask[]; total: number }> {
    const conditions: string[] = [];
    const vals: unknown[] = [];

    if (params.instanceId !== undefined) {
      conditions.push("instance_id = ?");
      vals.push(params.instanceId);
    }
    if (params.assignee) {
      conditions.push("assignee = ?");
      vals.push(params.assignee);
    }
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      vals.push(...statuses);
    }
    if (params.dueBefore) {
      conditions.push("(due_date IS NULL OR due_date <= ?)");
      vals.push(params.dueBefore);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const totalRows = await this.adapter.query<{ count: number }>(`SELECT COUNT(*) as count FROM workflow_tasks ${where}`, vals);
    const total = totalRows[0]?.count ?? 0;
    const rows = await this.adapter.query<RawTask>(`SELECT * FROM workflow_tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...vals, limit, offset]);

    return { items: rows.map((r) => this.mapTask(r)), total };
  }

  private mapTask(row: RawTask): WorkflowTask {
    // MySQL JSON 类型字段会被驱动自动解析为对象/数组
    const candidateUsers = Array.isArray(row.candidate_users)
      ? row.candidate_users as string[]
      : safeJsonParse<string[]>(row.candidate_users, "task_candidate_users") ?? undefined;
    const candidateGroups = Array.isArray(row.candidate_groups)
      ? row.candidate_groups as string[]
      : safeJsonParse<string[]>(row.candidate_groups, "task_candidate_groups") ?? undefined;
    const formData = typeof row.form_data === "object" && row.form_data !== null
      ? row.form_data as Record<string, unknown>
      : safeJsonParse<Record<string, unknown>>(row.form_data, "task_form_data") ?? undefined;
    return {
      id: row.id,
      instanceId: row.instance_id,
      nodeId: row.node_id,
      nodeName: row.node_name ?? undefined,
      taskType: row.task_type as WorkflowTask["taskType"],
      assignee: row.assignee ?? undefined,
      candidateUsers,
      candidateGroups,
      status: row.status as WorkflowTask["status"],
      formData,
      comment: row.comment ?? undefined,
      action: row.action as WorkflowTask["action"] ?? undefined,
      dueDate: row.due_date ?? undefined,
      signGroup: row.sign_group ?? undefined,
      createdAt: row.created_at,
      claimedAt: row.claimed_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // --- Workflow Variables ---

  async setVariable(instanceId: number, name: string, value: unknown, type?: string): Promise<void> {
    await this.adapter.execute(
      `INSERT INTO workflow_variables (instance_id, name, value, type) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type)`,
      [instanceId, name, JSON.stringify(value), type ?? "json"]
    );
  }

  async getVariable(instanceId: number, name: string): Promise<unknown> {
    const rows = await this.adapter.query<{ value: string | object; type: string }>(
      `SELECT value, type FROM workflow_variables WHERE instance_id = ? AND name = ?`,
      [instanceId, name]
    );
    if (!rows[0]) return undefined;
    const val = rows[0].value;
    if (typeof val === "object" && val !== null) return val;
    try {
      return JSON.parse(val as string);
    } catch {
      return val;
    }
  }

  async getVariables(instanceId: number): Promise<Record<string, unknown>> {
    const rows = await this.adapter.query<{ name: string; value: string | object; type: string }>(
      `SELECT name, value, type FROM workflow_variables WHERE instance_id = ?`,
      [instanceId]
    );
    const vars: Record<string, unknown> = {};
    for (const row of rows) {
      const val = row.value;
      if (typeof val === "object" && val !== null) {
        vars[row.name] = val;
      } else {
        try {
          vars[row.name] = JSON.parse(val as string);
        } catch {
          vars[row.name] = val;
        }
      }
    }
    return vars;
  }

  // --- Connections ---

  async createConnection(conn: Omit<Connection, "id" | "createdAt" | "updatedAt">): Promise<Connection> {
    const now = Date.now();
    const result = await this.adapter.execute(
      `INSERT INTO connections (name, type, config, credentials, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [conn.name, conn.type, JSON.stringify(conn.config), conn.credentials ?? null, conn.isActive ? 1 : 0, conn.createdBy ?? null, now, now]
    );
    return { ...conn, id: Number(result.insertId), createdAt: now, updatedAt: now };
  }

  async getConnectionById(id: number): Promise<Connection | undefined> {
    const rows = await this.adapter.query<RawConn>(`SELECT * FROM connections WHERE id = ?`, [id]);
    return rows[0] ? this.mapConnection(rows[0]) : undefined;
  }

  async getConnectionByName(name: string): Promise<Connection | undefined> {
    const rows = await this.adapter.query<RawConn>(`SELECT * FROM connections WHERE name = ? AND is_active = 1`, [name]);
    return rows[0] ? this.mapConnection(rows[0]) : undefined;
  }

  async listConnections(type?: string): Promise<Connection[]> {
    const sql = type
      ? `SELECT * FROM connections WHERE type = ? ORDER BY updated_at DESC`
      : `SELECT * FROM connections ORDER BY updated_at DESC`;
    const rows = type
      ? await this.adapter.query<RawConn>(sql, [type])
      : await this.adapter.query<RawConn>(sql);
    return rows.map((r) => this.mapConnection(r));
  }

  async updateConnection(id: number, updates: Partial<Connection>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
    if (updates.config !== undefined) { sets.push("config = ?"); vals.push(JSON.stringify(updates.config)); }
    if (updates.credentials !== undefined) { sets.push("credentials = ?"); vals.push(updates.credentials); }
    if (updates.isActive !== undefined) { sets.push("is_active = ?"); vals.push(updates.isActive ? 1 : 0); }
    if (sets.length === 0) return;
    sets.push("updated_at = ?"); vals.push(Date.now());
    vals.push(id);
    await this.adapter.execute(`UPDATE connections SET ${sets.join(", ")} WHERE id = ?`, vals);
  }

  async deleteConnection(id: number): Promise<void> {
    await this.adapter.execute(`DELETE FROM connections WHERE id = ?`, [id]);
  }

  private mapConnection(row: RawConn): Connection {
    return {
      id: row.id,
      name: row.name,
      type: row.type as Connection["type"],
      config: JSON.parse(row.config),
      credentials: row.credentials ?? undefined,
      isActive: row.is_active === 1,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ===== Factory =====

let repoInstance: IWorkflowRepository | null = null;

export function setWorkflowRepository(repo: IWorkflowRepository): void {
  repoInstance = repo;
}

export function getWorkflowRepository(): IWorkflowRepository {
  if (repoInstance) return repoInstance;
  if (isMySQL()) {
    repoInstance = new MySQLWorkflowRepository();
    return repoInstance;
  }
  const { getDb } = require("../db/database.js");
  repoInstance = new SQLiteWorkflowRepository(getDb());
  return repoInstance;
}

export function resetWorkflowRepository(): void {
  repoInstance = null;
}

// ===== Raw Row Types =====

interface RawDef {
  id: number;
  name: string;
  key: string;
  version: number;
  category: string | null;
  definition: string;
  form_schema: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface RawInst {
  id: number;
  definition_id: number;
  definition_version: number;
  business_key: string | null;
  starter: string | null;
  status: string;
  current_node_id: string | null;
  variables: string | null;
  started_at: number;
  completed_at: number | null;
}

interface RawTask {
  id: number;
  instance_id: number;
  node_id: string;
  node_name: string | null;
  task_type: string;
  assignee: string | null;
  candidate_users: string | null;
  candidate_groups: string | null;
  status: string;
  form_data: string | null;
  comment: string | null;
  action: string | null;
  due_date: number | null;
  sign_group: string | null;
  created_at: number;
  claimed_at: number | null;
  completed_at: number | null;
}

interface RawConn {
  id: number;
  name: string;
  type: string;
  config: string;
  credentials: string | null;
  is_active: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}
