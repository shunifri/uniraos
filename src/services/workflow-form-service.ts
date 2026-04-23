import { getDb } from '../db/database.js';

export interface WorkflowFormBindingInput {
  definitionKey: string;
  nodeId: string;
  formId: string;
  formVersion?: number;
  isRequired?: boolean;
  mappingJson?: any;
}

export function createWorkflowFormBinding(input: WorkflowFormBindingInput) {
  const db = getDb();
  const id = crypto.randomUUID();
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
  return getWorkflowFormBinding(id);
}

export function getWorkflowFormBinding(id: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow_form_bindings WHERE id = ?').get(id) as any;
  if (row) {
    row.mapping_json = row.mapping_json ? JSON.parse(row.mapping_json) : null;
  }
  return row;
}

export function getWorkflowFormBindingByNode(definitionKey: string, nodeId: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow_form_bindings WHERE definition_key = ? AND node_id = ?').get(definitionKey, nodeId) as any;
  if (row) {
    row.mapping_json = row.mapping_json ? JSON.parse(row.mapping_json) : null;
  }
  return row;
}

export function listWorkflowFormBindings(definitionKey: string) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM workflow_form_bindings WHERE definition_key = ?').all(definitionKey) as any[];
  return rows.map(row => ({
    ...row,
    mapping_json: row.mapping_json ? JSON.parse(row.mapping_json) : null
  }));
}

export function updateWorkflowFormBinding(id: string, updates: Partial<WorkflowFormBindingInput>) {
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (updates.formId !== undefined) { fields.push('form_id = ?'); params.push(updates.formId); }
  if (updates.formVersion !== undefined) { fields.push('form_version = ?'); params.push(updates.formVersion); }
  if (updates.isRequired !== undefined) { fields.push('is_required = ?'); params.push(updates.isRequired ? 1 : 0); }
  if (updates.mappingJson !== undefined) { fields.push('mapping_json = ?'); params.push(JSON.stringify(updates.mappingJson)); }
  params.push(id);
  const sql = `UPDATE workflow_form_bindings SET ${fields.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);
  return getWorkflowFormBinding(id);
}

export function deleteWorkflowFormBinding(id: string) {
  const db = getDb();
  db.prepare('DELETE FROM workflow_form_bindings WHERE id = ?').run(id);
  return { success: true };
}
