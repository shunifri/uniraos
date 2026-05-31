import { getDb, isMySQL } from '../db/database.js';
import { countWorkflowFormBindingsByFormId, findWorkflowFormBindingsByFormIdOrKey } from './workflow-form-service.js';

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

/**
 * 根据表单 Schema 自动同步 form_instances 的 JSON 函数索引
 * MySQL 8.0.13+ 支持函数索引，可为 data_json 中的常用字段建立索引
 */
async function syncFormInstanceIndexes(definitionId: string, schemaJson: unknown): Promise<void> {
  if (!isMySQL()) return; // SQLite 暂不支持函数索引

  const schema = schemaJson as Record<string, unknown>;
  const properties = schema?.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== 'object') return;

  const adapter = await getMySQLAdapter();
  const fieldNames = Object.keys(properties).filter(k => /^[a-zA-Z0-9_]+$/.test(k) && k.length <= 64);
  if (fieldNames.length === 0) return;

  // 获取当前已有的索引
  const existingIndexes = await adapter.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_instances' AND INDEX_NAME LIKE ?",
    ['idx_fi_data_%']
  );
  const existingSet = new Set((existingIndexes as any[]).map(r => r.INDEX_NAME));

  for (const fieldName of fieldNames) {
    const indexName = `idx_fi_data_${fieldName}`;
    if (existingSet.has(indexName)) continue;

    // MySQL 函数索引：为 data_json->>'$.fieldName' 创建索引
    try {
      await adapter.execute(
        `ALTER TABLE form_instances ADD INDEX ${indexName} ((CAST(data_json->>'$.${fieldName}' AS CHAR(255) CHARSET utf8mb4)))`,
        []
      );
    } catch (err: any) {
      // 忽略重复索引或语法不支持的错误
      if (!err.message?.includes('Duplicate') && !err.message?.includes('already exists')) {
        console.warn(`[syncFormInstanceIndexes] Failed to create index ${indexName}:`, err.message);
      }
    }
  }
}

export async function updateFormDefinition(id: string, updates: Partial<FormDefinitionInput>, userId?: string) {
  if (userId) {
    const existing = await getFormDefinition(id);
    if (!existing || existing.created_by !== userId) throw new Error('表单定义不存在或无权限');
  }
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

  // 若 schema 发生变更，后台异步同步数据库索引（不阻塞 API 响应）
  if (updates.schemaJson !== undefined) {
    void syncFormInstanceIndexes(id, updates.schemaJson).catch((syncErr) => {
      console.warn('[updateFormDefinition] Schema sync warning:', syncErr);
    });
  }

  return getFormDefinition(id);
}

export async function deleteFormDefinition(id: string, userId?: string) {
  if (userId) {
    const existing = await getFormDefinition(id);
    if (!existing || existing.created_by !== userId) throw new Error('表单定义不存在或无权限');
  }
  // 自动清理 workflow_form_bindings 引用（如果有），避免用户手动解除引用
  const existing = await getFormDefinition(id);
  if (existing) {
    const { deleteWorkflowFormBindingsByFormId: deleteBindingsByFormId } = await import('./workflow-form-service.js');
    await deleteBindingsByFormId(id);
    if (existing.key) {
      await deleteBindingsByFormId(existing.key);
    }
  }
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
  // 服务端校验：检查表单定义是否存在
  const definition = await getFormDefinition(input.definitionId);
  if (!definition) {
    throw new Error(`Form definition not found: ${input.definitionId}`);
  }
  // 基础数据校验
  if (input.dataJson === null || input.dataJson === undefined) {
    throw new Error('Form data is required');
  }
  // 安全：强制状态只能是 draft，防止绕过提交校验流程
  const status = 'draft';

  const id = crypto.randomUUID();
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.definitionId, input.definitionVersion || 1, JSON.stringify(input.dataJson), status, input.submittedBy || null]
    );
  } else {
    const db = getDb();
    db.prepare(`
      INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.definitionId, input.definitionVersion || 1, JSON.stringify(input.dataJson), status, input.submittedBy || null);
  }
  return getFormInstance(id);
}

export async function getFormInstance(id: string, userId?: string) {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    let sql = 'SELECT * FROM form_instances WHERE id = ?';
    const params: unknown[] = [id];
    if (userId) { sql += ' AND submitted_by = ?'; params.push(userId); }
    const rows = await adapter.query(sql, params);
    const row = rows[0] as any;
    if (row) {
      row.data_json = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json;
    }
    return row;
  }
  const db = getDb();
  const sql = userId
    ? 'SELECT * FROM form_instances WHERE id = ? AND submitted_by = ?'
    : 'SELECT * FROM form_instances WHERE id = ?';
  const params = userId ? [id, userId] : [id];
  const row = db.prepare(sql).get(...params) as any;
  if (row) row.data_json = JSON.parse(row.data_json);
  return row;
}

export async function updateFormInstance(id: string, updates: Partial<FormInstanceInput>, userId?: string) {
  if (userId) {
    const existing = await getFormInstance(id, userId);
    if (!existing) throw new Error('表单实例不存在或无权限');
  }
  // 安全：禁止通过 updateFormInstance 直接修改 status，状态变更必须走 submitFormInstance
  if (updates.status !== undefined) {
    throw new Error('不能直接修改表单状态，请使用 submitFormInstance 提交');
  }
  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.dataJson !== undefined) { fields.push('data_json = ?'); params.push(JSON.stringify(updates.dataJson)); }
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

export async function submitFormInstance(id: string, userId?: string) {
  const instance = await getFormInstance(id, userId);
  if (!instance) throw new Error('表单实例不存在或无权限');
  if (instance.status === 'submitted') throw new Error('Form instance already submitted');

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      'UPDATE form_instances SET status = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['submitted', id]
    );
  } else {
    const db = getDb();
    const submittedAt = new Date().toISOString();
    db.prepare('UPDATE form_instances SET status = ?, submitted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('submitted', submittedAt, id);
  }

  // 表单提交后，自动触发关联的工作流
  try {
    const formDef = await getFormDefinition(instance.definition_id);
    const formKey = formDef?.key || '';
    const bindings = await findWorkflowFormBindingsByFormIdOrKey(instance.definition_id, formKey);
    if (bindings.length > 0) {
      const { getWorkflowEngine } = await import('../workflow/engine.js');
      const engine = getWorkflowEngine();
      for (const binding of bindings) {
        const formData = typeof instance.data_json === 'string' ? JSON.parse(instance.data_json) : instance.data_json;
        await engine.startInstance(binding.definition_key, userId || 'anonymous', formData, `form-${id}`);
      }
    }
  } catch (wfErr) {
    // 工作流启动失败不应影响表单提交成功，记录日志即可
    console.warn('[submitFormInstance] 自动触发工作流失败:', wfErr);
  }

  return getFormInstance(id);
}

export async function listFormInstances(options: { definitionId?: string; status?: string; page?: number; pageSize?: number; submittedBy?: string } = {}) {
  const { definitionId, status, page = 1, pageSize = 20, submittedBy } = options;
  let sql = 'SELECT * FROM form_instances WHERE 1=1';
  const params: unknown[] = [];
  if (definitionId) { sql += ' AND definition_id = ?'; params.push(definitionId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (submittedBy) { sql += ' AND submitted_by = ?'; params.push(submittedBy); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(sql, params);
    return (rows as any[]).map(row => ({
      ...row,
      data_json: typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json,
    }));
  }
  const db = getDb();
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(row => ({ ...row, data_json: JSON.parse(row.data_json) }));
}

export async function deleteFormInstance(id: string, userId?: string) {
  if (userId) {
    const existing = await getFormInstance(id, userId);
    if (!existing) throw new Error('表单实例不存在或无权限');
  }
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute('DELETE FROM form_instances WHERE id = ?', [id]);
  } else {
    const db = getDb();
    db.prepare('DELETE FROM form_instances WHERE id = ?').run(id);
  }
  return { success: true };
}
