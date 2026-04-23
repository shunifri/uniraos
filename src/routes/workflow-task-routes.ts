import { Router } from 'express';
import { requireAuth } from '../db/auth-middleware.js';
import { getWorkflowRepository } from '../workflow/repository.js';
import { getWorkflowEngine } from '../workflow/engine.js';
import { saveTaskForm } from '../services/workflow-task-form-service.js';
import { getUserRoles } from '../db/user-repository.js';
import type { WorkflowTask } from '../workflow/types.js';

const router = Router();

interface TaskQuery {
  status?: string | string[];
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * GET /workflow/tasks
 * Return pending tasks for current user (filter by assignee or candidateUsers/candidateGroups)
 * Query params: page, pageSize, sortBy, sortOrder
 */
router.get('/workflow/tasks', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const repo = getWorkflowRepository();

    // Parse pagination and sorting
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

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
      if (task.assignee === userId) return true;
      if (task.candidateUsers?.includes(userId)) return true;
      if (task.candidateGroups && task.candidateGroups.length > 0) {
        if (task.candidateGroups.some((g) => userRoleIds.has(g) || userRoleNames.has(g))) {
          return true;
        }
      }
      if (!task.assignee && !task.candidateUsers?.length && !task.candidateGroups?.length) {
        return true;
      }
      return false;
    });

    // Sort
    const sortedTasks = myTasks.sort((a: any, b: any) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      return sortOrder === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

    // Paginate
    const total = sortedTasks.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedTasks = sortedTasks.slice(start, end);

    res.json({
      success: true,
      data: paginatedTasks,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
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
