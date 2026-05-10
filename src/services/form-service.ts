import { getDb, isMySQL } from '../db/database.js';

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('../db/mysql-adapter.js');
  return getAdapter();
}

export interface FormDefinitionInput {
  key: string;
  name: string;
  description?: string;
  categoryId?: string;
  schemaJson: unknown;
  createdBy: string;
}

export async function createFormDefinition(input: FormDefinitionInput) {
  const id = crypto.randomUUID();
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO form_definitions (id, \`key\`, name, description, category_id, schema_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.key, input.name, input.description || null, input.categoryId || null, JSON.stringify(input.schemaJson), input.createdBy]
    );
  } else {
    const db = getDb();
    db.prepare(`
      INSERT INTO form_definitions (id, key, name, description, category_id, schema_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.key, input.name, input.description || null, input.categoryId || null, JSON.stringify(input.schemaJson), input.createdBy);
  }
  return getFormDefinition(id);
}

export async function getFormDefinition(id: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM form_definitions WHERE id = ?', [id]);
    const row = rows[0] as any;
    if (row) {
      row.schema_json = typeof row.schema_json === 'string' ? JSON.parse(row.schema_json) : row.schema_json;
    }
    return row;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM form_definitions WHERE id = ?').get(id) as any;
  if (row) row.schema_json = JSON.parse(row.schema_json);
  return row;
}

export async function getFormDefinitionByKey(key: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM form_definitions WHERE `key` = ?', [key]);
    const row = rows[0] as any;
    if (row) {
      row.schema_json = typeof row.schema_json === 'string' ? JSON.parse(row.schema_json) : row.schema_json;
    }
    return row;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM form_definitions WHERE key = ?').get(key) as any;
  if (row) row.schema_json = JSON.parse(row.schema_json);
  return row;
}

export async function listFormDefinitions(options: { categoryId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const { categoryId, status, page = 1, pageSize = 20 } = options;
  let sql = 'SELECT * FROM form_definitions WHERE 1=1';
  const params: unknown[] = [];
  if (categoryId) { sql += ' AND category_id = ?'; params.push(categoryId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(sql, params);
    return (rows as any[]).map(row => ({
      ...row,
      schema_json: typeof row.schema_json === 'string' ? JSON.parse(row.schema_json) : row.schema_json,
    }));
  }
  const db = getDb();
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(row => ({ ...row, schema_json: JSON.parse(row.schema_json) }));
}

export async function updateFormDefinition(id: string, updates: Partial<FormDefinitionInput>) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.categoryId !== undefined) { fields.push('category_id = ?'); params.push(updates.categoryId); }
  if (updates.schemaJson !== undefined) { fields.push('schema_json = ?'); params.push(JSON.stringify(updates.schemaJson)); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  const sql = `UPDATE form_definitions SET ${fields.join(', ')} WHERE id = ?`;

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(sql, params);
  } else {
    const db = getDb();
    db.prepare(sql).run(...params);
  }
  return getFormDefinition(id);
}

export async function deleteFormDefinition(id: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute('DELETE FROM form_definitions WHERE id = ?', [id]);
  } else {
    const db = getDb();
    db.prepare('DELETE FROM form_definitions WHERE id = ?').run(id);
  }
  return { success: true };
}

// Form Instance CRUD
export interface FormInstanceInput {
  definitionId: string;
  definitionVersion?: number;
  dataJson: unknown;
  status?: string;
  submittedBy?: string;
}

export async function createFormInstance(input: FormInstanceInput) {
  const id = crypto.randomUUID();
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.definitionId, input.definitionVersion || 1, JSON.stringify(input.dataJson), input.status || 'draft', input.submittedBy || null]
    );
  } else {
    const db = getDb();
    db.prepare(`
      INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.definitionId, input.definitionVersion || 1, JSON.stringify(input.dataJson), input.status || 'draft', input.submittedBy || null);
  }
  return getFormInstance(id);
}

export async function getFormInstance(id: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM form_instances WHERE id = ?', [id]);
    const row = rows[0] as any;
    if (row) {
      row.data_json = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json;
    }
    return row;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM form_instances WHERE id = ?').get(id) as any;
  if (row) row.data_json = JSON.parse(row.data_json);
  return row;
}

export async function updateFormInstance(id: string, updates: Partial<FormInstanceInput>) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.dataJson !== undefined) { fields.push('data_json = ?'); params.push(JSON.stringify(updates.dataJson)); }
  if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.submittedBy !== undefined) { fields.push('submitted_by = ?'); params.push(updates.submittedBy); }
  if (updates.definitionVersion !== undefined) { fields.push('definition_version = ?'); params.push(updates.definitionVersion); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  const sql = `UPDATE form_instances SET ${fields.join(', ')} WHERE id = ?`;

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(sql, params);
  } else {
    const db = getDb();
    db.prepare(sql).run(...params);
  }
  return getFormInstance(id);
}
