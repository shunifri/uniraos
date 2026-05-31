import { Router } from 'express';
import { requireAuth } from '../permissions/middleware/auth-middleware.js';
import {
  createWorkflowFormBinding,
  getWorkflowFormBinding,
  listWorkflowFormBindings,
  updateWorkflowFormBinding,
  deleteWorkflowFormBinding
} from '../services/workflow-form-service.js';
import { loadTaskForm, saveTaskForm } from '../services/workflow-task-form-service.js';
import { getWorkflowEngine } from '../workflow/engine.js';
import { getWorkflowRepository } from '../workflow/repository.js';

const router = Router();

router.post('/workflow/form-bindings', requireAuth, async (req, res) => {
  try {
    const { definitionKey, nodeId, formId, formVersion, isRequired, mappingJson } = req.body;
    if (!definitionKey || !nodeId || !formId) {
      return res.status(400).json({ success: false, error: 'definitionKey, nodeId, and formId are required' });
    }
    const binding = await createWorkflowFormBinding({ definitionKey, nodeId, formId, formVersion, isRequired, mappingJson });
    res.json({ success: true, data: binding });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/workflow/form-bindings', requireAuth, async (req, res) => {
  try {
    const bindings = await listWorkflowFormBindings(req.query.definitionKey as string);
    res.json({ success: true, data: bindings });
  } catch (error: unknown) {
    console.error("[workflow-form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get('/workflow/form-bindings/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const binding = await getWorkflowFormBinding(id);
    if (!binding) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: binding });
  } catch (error: unknown) {
    console.error("[workflow-form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put('/workflow/form-bindings/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const allowed = ['formId', 'formVersion', 'isRequired', 'mappingJson'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const binding = await updateWorkflowFormBinding(id, updates);
    res.json({ success: true, data: binding });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.delete('/workflow/form-bindings/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteWorkflowFormBinding(id);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error("[workflow-form-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get('/workflow/tasks/:taskId/form', requireAuth, async (req, res) => {
  try {
    const rawTaskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
    const taskId = parseInt(rawTaskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }
    // 权限检查：用户必须是 assignee 或 candidate
    const userId = req.user!.id;
    const repo = getWorkflowRepository();
    const task = await repo.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const engine = getWorkflowEngine();
    const hasPermission = await engine.checkTaskPermission(task, userId);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权查看此任务表单' });
    }
    const payload = await loadTaskForm(taskId);
    res.json({ success: true, data: payload });
  } catch (error: unknown) {
    res.status(404).json({ success: false, error: 'Resource not found' });
  }
});

router.post('/workflow/tasks/:taskId/form', requireAuth, async (req, res) => {
  try {
    const rawTaskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
    const taskId = parseInt(rawTaskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }
    const userId = req.user!.id;
    // Permission check: user must be assignee or candidate
    const repo = getWorkflowRepository();
    const task = await repo.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const engine = getWorkflowEngine();
    const hasPermission = await engine.checkTaskPermission(task, userId);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权操作此任务' });
    }
    const allowed = ['formData', 'comment', 'action'];
    const input: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) input[key] = req.body[key];
    }
    const payload = await saveTaskForm(taskId, input as any);
    res.json({ success: true, data: payload });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

export default router;
