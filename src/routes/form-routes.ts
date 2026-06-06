import { Router } from 'express';
import { requireAuth } from '../permissions/middleware/auth-middleware.js';
import {
  createFormDefinition, getFormDefinition, getFormDefinitionByKey, listFormDefinitions,
  updateFormDefinition, deleteFormDefinition,
  createFormInstance, getFormInstance, updateFormInstance,
  submitFormInstance, listFormInstances, deleteFormInstance
} from '../services/form-service.js';
import { resolveDataSource } from '../services/data-source-service.js';
import { testConnection, testConnectionConfig } from '../services/database-connector.js';
import { generateForm } from '../services/form-llm-generator.js';
import { isMySQL, getDb } from '../db/database.js';
import { getMySQLAdapter } from '../db/mysql-adapter.js';
import type { RouteDependencies } from './types.js';

export function createFormRoutes(deps: RouteDependencies): Router {
  const { getCurrentProvider } = deps;
  const router = Router();

// Form Definitions
router.post('/form/definitions', requireAuth, async (req, res) => {
  try {
    const { key, name, schemaJson, description, categoryId } = req.body;
    if (!key || !name || schemaJson === undefined) {
      return res.status(400).json({ success: false, error: 'key, name, and schemaJson are required' });
    }
    const def = await createFormDefinition({ key, name, schemaJson, description, categoryId, createdBy: req.user!.id });
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/form/definitions', requireAuth, async (req, res) => {
  try {
    const defs = await listFormDefinitions({
      categoryId: req.query.categoryId as string,
      status: req.query.status as string,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20
    });
    res.json({ success: true, data: defs });
  } catch (error: unknown) {
    console.error("[form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get('/form/definitions/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    let def = await getFormDefinition(id);
    if (!def) def = await getFormDefinitionByKey(id);
    if (!def) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    console.error("[form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put('/form/definitions/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    // P1-25: 之前 allowed = ['name','description','categoryId','schemaJson'] 漏了 'key'.
    // 前端 FormDesigner.tsx 总是发 `key` 字段, 改 key 时被 silently ignored.
    // 加上 'key' 和 'status' (publish/unpublish), 让前端能完整编辑表单元数据.
    const allowed = ['name', 'description', 'categoryId', 'schemaJson', 'key', 'status'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const def = await updateFormDefinition(id, updates, req.user!.id);
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.delete('/form/definitions/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteFormDefinition(id, req.user!.id);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error("[form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Form Instances
router.post('/form/instances', requireAuth, async (req, res) => {
  try {
    const { definitionId, dataJson, definitionVersion } = req.body;
    if (!definitionId || dataJson === undefined) {
      return res.status(400).json({ success: false, error: 'definitionId and dataJson are required' });
    }
    const instance = await createFormInstance({ definitionId, dataJson, definitionVersion, submittedBy: req.user!.id });
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/form/instances/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = await getFormInstance(id, req.user!.id);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    console.error("[form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put('/form/instances/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const allowed = ['dataJson', 'submittedBy', 'definitionVersion'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const instance = await updateFormInstance(id, updates, req.user!.id);
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.post('/form/instances/:id/submit', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = await submitFormInstance(id, req.user!.id);
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/form/instances', requireAuth, async (req, res) => {
  try {
    const instances = await listFormInstances({
      definitionId: req.query.definitionId as string,
      status: req.query.status as string,
      submittedBy: req.user!.id,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20
    });
    res.json({ success: true, data: instances });
  } catch (error: unknown) {
    console.error("[form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete('/form/instances/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteFormInstance(id, req.user!.id);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error("[form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Data Source Resolution
router.post('/form/resolve-data-source', requireAuth, async (req, res) => {
  try {
    const result = await resolveDataSource(req.body);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// LLM Form Generation
router.post('/form/generate', requireAuth, async (req, res) => {
  try {
    const { key, name, description } = req.body;
    if (!key || !name) {
      return res.status(400).json({ success: false, error: 'key and name are required' });
    }
    const result = await generateForm({ key, name, description }, getCurrentProvider);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Database Connection Testing
router.post('/connections/test/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await testConnection(id);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

router.post('/connections/test-config', requireAuth, async (req, res) => {
  try {
    const result = await testConnectionConfig(req.body);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

// Form Export — 导出表单数据为 CSV/Excel
router.get('/form/export/:formKey', requireAuth, async (req, res) => {
  try {
    const formKey = Array.isArray(req.params.formKey) ? req.params.formKey[0] : req.params.formKey;
    const format = ((req.query.format as string | undefined) ?? 'csv');
    const formDef = await getFormDefinitionByKey(formKey);
    if (!formDef) {
      res.status(404).json({ success: false, error: '表单不存在' });
      return;
    }

    const schema = typeof formDef.schema_json === 'string' ? JSON.parse(formDef.schema_json) : formDef.schema_json;
    const fields = Object.entries(schema?.properties || {})
      .map(([key, def]: [string, any]) => ({ key, title: def.title || key, type: def.type || 'string' }));

    // 查询所有表单实例（不分页）
    let instances: any[];
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query('SELECT * FROM form_instances WHERE definition_id = ? ORDER BY created_at DESC', [formDef.id]);
      instances = (rows as any[]).map(row => ({
        ...row,
        data_json: typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json,
      }));
    } else {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM form_instances WHERE definition_id = ? ORDER BY created_at DESC').all(formDef.id) as any[];
      instances = rows.map(row => ({ ...row, data_json: JSON.parse(row.data_json) }));
    }

    if (format === 'xlsx') {
      // 使用 xlsx 生成 Excel
      const XLSX = await import('xlsx');
      const data = instances.map((inst, idx) => {
        const row: Record<string, any> = { '序号': idx + 1 };
        fields.forEach(f => { row[f.title] = inst.data_json?.[f.key] ?? ''; });
        row['提交状态'] = inst.status || '';
        row['提交时间'] = inst.submitted_at ? new Date(inst.submitted_at).toLocaleString() : '';
        row['创建时间'] = inst.created_at ? new Date(inst.created_at).toLocaleString() : '';
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, formDef.name || 'Sheet1');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(formDef.name || formKey)}.xlsx"`);
      res.send(buf);
    } else {
      // CSV 格式
      const headers = ['序号', ...fields.map(f => f.title), '提交状态', '提交时间', '创建时间'];
      const rows = instances.map((inst, idx) => {
        const cols = [String(idx + 1)];
        fields.forEach(f => { cols.push(String(inst.data_json?.[f.key] ?? '')); });
        cols.push(inst.status || '');
        cols.push(inst.submitted_at ? new Date(inst.submitted_at).toLocaleString() : '');
        cols.push(inst.created_at ? new Date(inst.created_at).toLocaleString() : '');
        return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
      });
      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(formDef.name || formKey)}.csv"`);
      res.send(csvContent);
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

  return router;
}
