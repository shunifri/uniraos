/**
 * Form Definition Repository — 底层数据访问
 *
 * 此模块仅包含 form_definitions / form_instances 的数据库 CRUD，
 * 不依赖 Workflow 或其他上层 Service，供 Form Service 和 Workflow Engine 共同使用。
 */

import { getDb } from "../db/database.js";

export interface FormDefinitionInput {
  key: string;
  name: string;
  description?: string;
  categoryId?: string;
  schemaJson: unknown;
  createdBy: string;
}

export function createFormDefinition(input: FormDefinitionInput) {
  const db = getDb();
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO form_definitions (id, key, name, description, category_id, schema_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, input.key, input.name, input.description || null, input.categoryId || null, JSON.stringify(input.schemaJson), input.createdBy);
  return getFormDefinition(id);
}

export function getFormDefinition(id: string) {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM form_definitions WHERE id = ?");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = stmt.get(id) as any;
  if (row) {
    try {
      row.schema_json = JSON.parse(row.schema_json);
    } catch {
      row.schema_json = null;
    }
  }
  return row;
}

export function getFormDefinitionByKey(key: string) {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM form_definitions WHERE key = ?");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = stmt.get(key) as any;
  if (row) {
    try {
      row.schema_json = JSON.parse(row.schema_json);
    } catch {
      row.schema_json = null;
    }
  }
  return row;
}

export function listFormDefinitions(options: { categoryId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const db = getDb();
  const { categoryId, status, page = 1, pageSize = 20 } = options;
  let sql = "SELECT * FROM form_definitions WHERE 1=1";
  const params: unknown[] = [];
  if (categoryId) { sql += " AND category_id = ?"; params.push(categoryId); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, (page - 1) * pageSize);
  const stmt = db.prepare(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = stmt.all(...params) as any[];
  return rows.map(row => {
    try {
      return { ...row, schema_json: JSON.parse(row.schema_json) };
    } catch {
      return { ...row, schema_json: null };
    }
  });
}

export function updateFormDefinition(id: string, updates: Partial<FormDefinitionInput>) {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) { fields.push("name = ?"); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push("description = ?"); params.push(updates.description); }
  if (updates.categoryId !== undefined) { fields.push("category_id = ?"); params.push(updates.categoryId); }
  if (updates.schemaJson !== undefined) { fields.push("schema_json = ?"); params.push(JSON.stringify(updates.schemaJson)); }
  fields.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);
  const sql = `UPDATE form_definitions SET ${fields.join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...params);
  return getFormDefinition(id);
}

export function deleteFormDefinition(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM form_definitions WHERE id = ?").run(id);
  return { success: true };
}
