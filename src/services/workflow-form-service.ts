import { getDb, isMySQL } from '../db/database.js';

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('../db/mysql-adapter.js');
  return getAdapter();
}

export interface WorkflowFormBindingInput {
  definitionKey: string;
  nodeId: string;
  formId: string;
  formVersion?: number;
  isRequired?: boolean;
  mappingJson?: any;
}

export async function createWorkflowFormBinding(input: WorkflowFormBindingInput) {
  const id = crypto.randomUUID();
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO workflow_form_bindings (id, definition_key, node_id, form_id, form_version, is_required, mapping_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.definitionKey, input.nodeId, input.formId, input.formVersion ?? -1, input.isRequired ?? true ? 1 : 0, input.mappingJson ? JSON.stringify(input.mappingJson) : null]
    );
  } else {
    const db = getDb();
    db.prepare(`
      INSERT INTO workflow_form_bindings (id, definition_key, node_id, form_id, form_version, is_required, mapping_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.definitionKey,
      input.nodeId,
      input.formId,
      input.formVersion ?? -1,
      input.isRequired ?? true ? 1 : 0,
      input.mappingJson ? JSON.stringify(input.mappingJson) : null
    );
  }
  return getWorkflowFormBinding(id);
}

export async function getWorkflowFormBinding(id: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM workflow_form_bindings WHERE id = ?', [id]);
    const row = rows[0] as any;
    if (row) {
      row.mapping_json = row.mapping_json ? (typeof row.mapping_json === 'string' ? JSON.parse(row.mapping_json) : row.mapping_json) : null;
    }
    return row;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow_form_bindings WHERE id = ?').get(id) as any;
  if (row) {
    row.mapping_json = row.mapping_json ? JSON.parse(row.mapping_json) : null;
  }
  return row;
}

export async function getWorkflowFormBindingByNode(definitionKey: string, nodeId: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM workflow_form_bindings WHERE definition_key = ? AND node_id = ?', [definitionKey, nodeId]);
    const row = rows[0] as any;
    if (row) {
      row.mapping_json = row.mapping_json ? (typeof row.mapping_json === 'string' ? JSON.parse(row.mapping_json) : row.mapping_json) : null;
    }
    return row;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow_form_bindings WHERE definition_key = ? AND node_id = ?').get(definitionKey, nodeId) as any;
  if (row) {
    row.mapping_json = row.mapping_json ? JSON.parse(row.mapping_json) : null;
  }
  return row;
}

export async function listWorkflowFormBindings(definitionKey: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM workflow_form_bindings WHERE definition_key = ?', [definitionKey]);
    return (rows as any[]).map(row => ({
      ...row,
      mapping_json: row.mapping_json ? (typeof row.mapping_json === 'string' ? JSON.parse(row.mapping_json) : row.mapping_json) : null,
    }));
  }
  const db = getDb();
  const rows = db.prepare('SELECT * FROM workflow_form_bindings WHERE definition_key = ?').all(definitionKey) as any[];
  return rows.map(row => ({
    ...row,
    mapping_json: row.mapping_json ? JSON.parse(row.mapping_json) : null,
  }));
}

export async function updateWorkflowFormBinding(id: string, updates: Partial<WorkflowFormBindingInput>) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.definitionKey !== undefined) { fields.push('definition_key = ?'); params.push(updates.definitionKey); }
  if (updates.nodeId !== undefined) { fields.push('node_id = ?'); params.push(updates.nodeId); }
  if (updates.formId !== undefined) { fields.push('form_id = ?'); params.push(updates.formId); }
  if (updates.formVersion !== undefined) { fields.push('form_version = ?'); params.push(updates.formVersion); }
  if (updates.isRequired !== undefined) { fields.push('is_required = ?'); params.push(updates.isRequired ? 1 : 0); }
  if (updates.mappingJson !== undefined) { fields.push('mapping_json = ?'); params.push(updates.mappingJson ? JSON.stringify(updates.mappingJson) : null); }
  params.push(id);
  const sql = `UPDATE workflow_form_bindings SET ${fields.join(', ')} WHERE id = ?`;

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(sql, params);
  } else {
    const db = getDb();
    db.prepare(sql).run(...params);
  }
  return getWorkflowFormBinding(id);
}

export async function listWorkflowFormBindingsByFormId(formId: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT * FROM workflow_form_bindings WHERE form_id = ?', [formId]);
    return (rows as any[]).map(row => ({
      ...row,
      mapping_json: row.mapping_json ? (typeof row.mapping_json === 'string' ? JSON.parse(row.mapping_json) : row.mapping_json) : null,
    }));
  }
  const db = getDb();
  const rows = db.prepare('SELECT * FROM workflow_form_bindings WHERE form_id = ?').all(formId) as any[];
  return rows.map(row => ({
    ...row,
    mapping_json: row.mapping_json ? JSON.parse(row.mapping_json) : null,
  }));
}

/** 同时按 form definition UUID 或 form key 查询绑定（向后兼容） */
export async function findWorkflowFormBindingsByFormIdOrKey(formId: string, formKey: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      'SELECT * FROM workflow_form_bindings WHERE form_id = ? OR form_id = ?',
      [formId, formKey]
    );
    return (rows as any[]).map(row => ({
      ...row,
      mapping_json: row.mapping_json ? (typeof row.mapping_json === 'string' ? JSON.parse(row.mapping_json) : row.mapping_json) : null,
    }));
  }
  const db = getDb();
  const rows = db.prepare('SELECT * FROM workflow_form_bindings WHERE form_id = ? OR form_id = ?').all(formId, formKey) as any[];
  return rows.map(row => ({
    ...row,
    mapping_json: row.mapping_json ? JSON.parse(row.mapping_json) : null,
  }));
}

export async function countWorkflowFormBindingsByFormId(formId: string): Promise<number> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM workflow_form_bindings WHERE form_id = ?',
      [formId]
    );
    return rows[0]?.count ?? 0;
  }
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM workflow_form_bindings WHERE form_id = ?').get(formId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function deleteWorkflowFormBinding(id: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute('DELETE FROM workflow_form_bindings WHERE id = ?', [id]);
  } else {
    const db = getDb();
    db.prepare('DELETE FROM workflow_form_bindings WHERE id = ?').run(id);
  }
}

export async function deleteWorkflowFormBindingsByDefinitionKey(definitionKey: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute('DELETE FROM workflow_form_bindings WHERE definition_key = ?', [definitionKey]);
  } else {
    const db = getDb();
    db.prepare('DELETE FROM workflow_form_bindings WHERE definition_key = ?').run(definitionKey);
  }
}

export async function deleteWorkflowFormBindingsByFormId(formId: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute('DELETE FROM workflow_form_bindings WHERE form_id = ?', [formId]);
  } else {
    const db = getDb();
    db.prepare('DELETE FROM workflow_form_bindings WHERE form_id = ?').run(formId);
  }
}
