import { Router } from 'express';
import { requireAuth } from '../permissions/middleware/auth-middleware.js';
import { getWorkflowRepository } from '../workflow/repository.js';
import { getWorkflowEngine } from '../workflow/engine.js';
import { saveTaskForm } from '../services/workflow-task-form-service.js';
import { getUserRoles } from '../db/user-repository.js';
import { getMySQLAdapter } from '../db/mysql-adapter.js';
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

    // Support status filter from query param; default to pending/claimed for backward compat
    const statusParam = req.query.status as string | undefined;
    let statusFilter: string[] | undefined;
    if (statusParam) {
      statusFilter = statusParam.split(',').filter(Boolean);
    } else {
      statusFilter = ['pending', 'claimed'];
    }

    // Fetch tasks with status filter
    const { items: allTasks } = await repo.listTasks({
      status: statusFilter as any,
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

    // 批量获取流程实例信息（用于返回 definitionKey / definitionName / instanceStatus）
    const instanceIds = [...new Set(paginatedTasks.map((t) => t.instanceId).filter(Boolean))];
    const instanceDefMap = new Map<number, { definitionKey: string; definitionName: string; instanceStatus: string }>();
    if (instanceIds.length > 0) {
      const mysqlAdapter = await getMySQLAdapter();
      const placeholders = instanceIds.map(() => "?").join(",");
      const instances = await mysqlAdapter.query<{ id: number; definition_id: number; status: string }>(
        `SELECT id, definition_id, status FROM workflow_instances WHERE id IN (${placeholders})`,
        instanceIds,
      );
      const defIds = [...new Set(instances.map((i) => i.definition_id).filter(Boolean))];
      if (defIds.length > 0) {
        const defPlaceholders = defIds.map(() => "?").join(",");
        const defs = await mysqlAdapter.query<{ id: number; key: string; name: string }>(
          `SELECT id, \`key\`, name FROM workflow_definitions WHERE id IN (${defPlaceholders})`,
          defIds,
        );
        const defMap = new Map<number, { key: string; name: string }>();
        for (const d of defs) {
          defMap.set(d.id, { key: d.key, name: d.name });
        }
        for (const inst of instances) {
          const def = defMap.get(inst.definition_id);
          if (def) {
            instanceDefMap.set(inst.id, {
              definitionKey: def.key,
              definitionName: def.name,
              instanceStatus: inst.status,
            });
          }
        }
      }
    }

    // 安全：从响应中过滤掉敏感字段（formData 可能包含其他用户的提交数据）
    const safeTasks = paginatedTasks.map((task: any) => {
      const { formData, nodeName, ...rest } = task;
      const defInfo = task.instanceId ? instanceDefMap.get(task.instanceId) : undefined;
      return {
        ...rest,
        name: nodeName || task.nodeId,
        definitionKey: defInfo?.definitionKey || "",
        definitionName: defInfo?.definitionName || "",
        instanceStatus: defInfo?.instanceStatus || "unknown",
      };
    });

    console.log(`[workflow-task-routes] GET /workflow/tasks status=${statusParam || 'default'} user=${userId} roles=${[...userRoleNames].join(',')} returned=${safeTasks.length} total=${total}`);
    res.json({
      success: true,
      data: safeTasks,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error: any) {
    console.error("[workflow-task-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /workflow/tasks/:taskId/complete
 * Save form data then complete the task
 */
router.post('/workflow/tasks/:taskId/complete', requireAuth, async (req, res) => {
  try {
    const rawTaskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
    const taskId = parseInt(rawTaskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }

    const userId = req.user!.id;
    const { action, comment, formData } = req.body;

    // 1. Complete the task first (includes permission check)
    const engine = getWorkflowEngine();
    const result = await engine.completeTask(taskId, { action, formData, comment }, userId);

    if (!result.success) {
      if (result.error?.message?.includes('无权')) {
        return res.status(403).json({ success: false, error: result.error.message });
      }
      return res.status(400).json({ success: false, error: result.error?.message || 'Complete task failed' });
    }

    // 2. Save form data with variable mapping (safe: user already passed permission check)
    if (formData && typeof formData === 'object') {
      try {
        await saveTaskForm(taskId, { formData, comment, action });
      } catch (err) {
        console.warn('[completeTask] saveTaskForm failed after complete:', (err as Error).message);
        // Task is already completed; mapping failure is non-critical
      }
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: 'Resource not found' });
    }
    res.status(400).json({ success: false, error: 'Invalid request' });
  }
});

export default router;
