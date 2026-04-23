import { getDb } from '../db/database.js';

export interface FormDefinitionInput {
  key: string;
  name: string;
  description?: string;
  categoryId?: string;
  schemaJson: any;
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
  const stmt = db.prepare('SELECT * FROM form_definitions WHERE id = ?');
  const row = stmt.get(id) as any;
  if (row) row.schema_json = JSON.parse(row.schema_json);
  return row;
}

export function getFormDefinitionByKey(key: string) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM form_definitions WHERE key = ?');
  const row = stmt.get(key) as any;
  if (row) row.schema_json = JSON.parse(row.schema_json);
  return row;
}

export function listFormDefinitions(options: { categoryId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const db = getDb();
  const { categoryId, status, page = 1, pageSize = 20 } = options;
  let sql = 'SELECT * FROM form_definitions WHERE 1=1';
  const params: any[] = [];
  if (categoryId) { sql += ' AND category_id = ?'; params.push(categoryId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];
  return rows.map(row => ({ ...row, schema_json: JSON.parse(row.schema_json) }));
}

export function updateFormDefinition(id: string, updates: Partial<FormDefinitionInput>) {
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.categoryId !== undefined) { fields.push('category_id = ?'); params.push(updates.categoryId); }
  if (updates.schemaJson !== undefined) { fields.push('schema_json = ?'); params.push(JSON.stringify(updates.schemaJson)); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  const sql = `UPDATE form_definitions SET ${fields.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);
  return getFormDefinition(id);
}

export function deleteFormDefinition(id: string) {
  const db = getDb();
  db.prepare('DELETE FROM form_definitions WHERE id = ?').run(id);
  return { success: true };
}

// Form Instance CRUD
export interface FormInstanceInput {
  definitionId: string;
  definitionVersion?: number;
  dataJson: any;
  status?: string;
  submittedBy?: string;
}

export function createFormInstance(input: FormInstanceInput) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.definitionId, input.definitionVersion || 1, JSON.stringify(input.dataJson), input.status || 'draft', input.submittedBy || null);
  return getFormInstance(id);
}

export function getFormInstance(id: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM form_instances WHERE id = ?').get(id) as any;
  if (row) row.data_json = JSON.parse(row.data_json);
  return row;
}

export function updateFormInstance(id: string, updates: Partial<FormInstanceInput>) {
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (updates.dataJson !== undefined) { fields.push('data_json = ?'); params.push(JSON.stringify(updates.dataJson)); }
  if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.submittedBy !== undefined) { fields.push('submitted_by = ?'); params.push(updates.submittedBy); }
  if (updates.definitionVersion !== undefined) { fields.push('definition_version = ?'); params.push(updates.definitionVersion); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  const sql = `UPDATE form_instances SET ${fields.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);
  return getFormInstance(id);
}
