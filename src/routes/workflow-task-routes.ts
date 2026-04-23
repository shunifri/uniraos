import { Router } from 'express';
import { requireAuth } from '../db/auth-middleware.js';
import { getWorkflowRepository } from '../workflow/repository.js';
import { getWorkflowEngine } from '../workflow/engine.js';
import { saveTaskForm } from '../services/workflow-task-form-service.js';
import { getUserRoles } from '../db/user-repository.js';
import type { WorkflowTask } from '../workflow/types.js';

const router = Router();

/**
 * GET /workflow/tasks
 * Return pending tasks for current user (filter by assignee or candidateUsers/candidateGroups)
 */
router.get('/workflow/tasks', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const repo = getWorkflowRepository();

    // Fetch all pending/claimed tasks
    const { items: allTasks } = await repo.listTasks({
      status: ['pending', 'claimed'],
      limit: 1000,
    });

    // Get user roles for candidateGroups check
    const userRoles = await getUserRoles(userId);
    const userRoleIds = new Set(userRoles.map((r) => r.id));
    const userRoleNames = new Set(userRoles.map((r) => r.name));

    // Filter tasks assignable to current user
    const myTasks = allTasks.filter((task: WorkflowTask) => {
      // Direct assignee
      if (task.assignee === userId) return true;

      // Candidate users
      if (task.candidateUsers?.includes(userId)) return true;

      // Candidate groups (roles)
      if (task.candidateGroups && task.candidateGroups.length > 0) {
        if (task.candidateGroups.some((g) => userRoleIds.has(g) || userRoleNames.has(g))) {
          return true;
        }
      }

      // No assignee and no candidates → anyone can claim
      if (!task.assignee && !task.candidateUsers?.length && !task.candidateGroups?.length) {
        return true;
      }

      return false;
    });

    res.json({ success: true, data: myTasks });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /workflow/tasks/:taskId/complete
 * Save form data then complete the task
 */
router.post('/workflow/tasks/:taskId/complete', requireAuth, async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }

    const userId = req.user!.id;
    const { action, comment, formData } = req.body;

    // 1. Save form data (handles variable mapping)
    if (formData && typeof formData === 'object') {
      await saveTaskForm(taskId, { formData, comment, action });
    }

    // 2. Complete the task and advance workflow
    const engine = getWorkflowEngine();
    const result = await engine.completeTask(taskId, { action, formData, comment }, userId);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error?.message || 'Complete task failed' });
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
