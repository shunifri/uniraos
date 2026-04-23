import { Router } from 'express';
import { requireAuth } from '../db/auth-middleware.js';
import {
  createWorkflowFormBinding,
  getWorkflowFormBinding,
  listWorkflowFormBindings,
  updateWorkflowFormBinding,
  deleteWorkflowFormBinding
} from '../services/workflow-form-service.js';
import { loadTaskForm } from '../services/workflow-task-form-service.js';

const router = Router();

router.post('/workflow/form-bindings', requireAuth, (req, res) => {
  try {
    const binding = createWorkflowFormBinding(req.body);
    res.json({ success: true, data: binding });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/workflow/form-bindings', requireAuth, (req, res) => {
  try {
    const bindings = listWorkflowFormBindings(req.query.definitionKey as string);
    res.json({ success: true, data: bindings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/workflow/form-bindings/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const binding = getWorkflowFormBinding(id);
    if (!binding) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: binding });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/workflow/form-bindings/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const binding = updateWorkflowFormBinding(id, req.body);
    res.json({ success: true, data: binding });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/workflow/form-bindings/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    deleteWorkflowFormBinding(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/workflow/tasks/:taskId/form', requireAuth, async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }
    const payload = await loadTaskForm(taskId);
    res.json({ success: true, data: payload });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

export default router;
