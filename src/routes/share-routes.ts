/**
 * 共享规则 API 路由
 */
import { Router } from "express";
import { requireAuth } from "../db/auth-middleware.js";
import { getUserRoles } from "../db/user-repository.js";
import { getDb } from "../db/database.js";
import type { ShareRepository } from "../db/share-repository.js";
import type { RouteDependencies } from "./index.js";

export function createShareRoutes(deps: RouteDependencies & { shareRepository: ShareRepository }): Router {
  const router = Router();
  const repo = deps.shareRepository;

  /** 获取用户的部门路径 */
  function getUserDeptPath(userId: string): string {
    const row = getDb().prepare(`
      SELECT d.path FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ?
    `).get(userId) as { path: string | null } | undefined;
    return row?.path ?? "";
  }

  // POST /api/share — 创建共享规则
  router.post("/share", requireAuth, (req, res) => {
    try {
      const { resourceType, resourceId, scope, targetId, permission } = req.body;
      if (!resourceType || !resourceId || !scope) {
        res.status(400).json({ success: false, error: "resourceType, resourceId, scope are required" });
        return;
      }
      const validTypes = ["skill", "kb_document", "file"];
      if (!validTypes.includes(resourceType)) {
        res.status(400).json({ success: false, error: `resourceType must be one of: ${validTypes.join(", ")}` });
        return;
      }
      const validScopes = ["all", "role", "department", "user"];
      if (!validScopes.includes(scope)) {
        res.status(400).json({ success: false, error: `scope must be one of: ${validScopes.join(", ")}` });
        return;
      }
      if (scope !== "all" && !targetId) {
        res.status(400).json({ success: false, error: "targetId is required when scope is not 'all'" });
        return;
      }
      const validPermissions = ["read", "execute", "write"];
      const perm = permission || "read";
      if (!validPermissions.includes(perm)) {
        res.status(400).json({ success: false, error: `permission must be one of: ${validPermissions.join(", ")}` });
        return;
      }

      const rule = repo.create({
        resourceType,
        resourceId,
        ownerId: req.user!.id,
        scope,
        targetId: targetId ?? undefined,
        permission: perm,
      });
      res.json({ success: true, data: rule });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/share/:id — 撤销共享
  router.delete("/share/:id", requireAuth, (req, res) => {
    try {
      const id = req.params.id as string;
      const rule = repo.getById(id);
      if (!rule) {
        res.status(404).json({ success: false, error: "Share rule not found" });
        return;
      }
      // 只有创建者可以删除
      if (rule.ownerId !== req.user!.id) {
        res.status(403).json({ success: false, error: "Only the owner can delete a share rule" });
        return;
      }
      repo.delete(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/share/my — 我创建的共享
  router.get("/share/my", requireAuth, (req, res) => {
    try {
      const rules = repo.getByOwner(req.user!.id);
      res.json({ success: true, data: rules });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/share/to-me — 共享给我的资源
  router.get("/share/to-me", requireAuth, (req, res) => {
    try {
      const userId = req.user!.id;
      const roles = getUserRoles(userId);
      const roleIds = roles.map(r => r.id);
      const deptPath = getUserDeptPath(userId);
      const rules = repo.getSharedToUser(userId, roleIds, deptPath);
      res.json({ success: true, data: rules });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PUT /api/share/:id — 修改共享规则
  router.put("/share/:id", requireAuth, (req, res) => {
    try {
      const id = req.params.id as string;
      const rule = repo.getById(id);
      if (!rule) {
        res.status(404).json({ success: false, error: "Share rule not found" });
        return;
      }
      if (rule.ownerId !== req.user!.id) {
        res.status(403).json({ success: false, error: "Only the owner can update a share rule" });
        return;
      }
      const { scope, targetId, permission } = req.body;
      const updated = repo.update(id, { scope, targetId, permission });
      if (!updated) {
        res.status(400).json({ success: false, error: "No valid fields to update" });
        return;
      }
      const updatedRule = repo.getById(id);
      res.json({ success: true, data: updatedRule });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
