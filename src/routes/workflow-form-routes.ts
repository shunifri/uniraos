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

const router = Router();

router.post('/workflow/form-bindings', requireAuth, async (req, res) => {
  try {
    const binding = await createWorkflowFormBinding(req.body);
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
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/workflow/form-bindings/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const binding = await getWorkflowFormBinding(id);
    if (!binding) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: binding });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.put('/workflow/form-bindings/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const binding = await updateWorkflowFormBinding(id, req.body);
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
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/workflow/tasks/:taskId/form', requireAuth, async (req, res) => {
  try {
    const rawTaskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
    const taskId = parseInt(rawTaskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }
    const payload = await loadTaskForm(taskId);
    res.json({ success: true, data: payload });
  } catch (error: unknown) {
    res.status(404).json({ success: false, error: (error as Error).message });
  }
});

router.post('/workflow/tasks/:taskId/form', requireAuth, async (req, res) => {
  try {
    const rawTaskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
    const taskId = parseInt(rawTaskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }
    const payload = await saveTaskForm(taskId, req.body);
    res.json({ success: true, data: payload });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

export default router;
