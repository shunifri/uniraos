/**
 * 共享规则 API 路由
 */
import { Router } from "express";
import { join } from "path";
import { permissions } from "../permissions/index.js";
import { getUserRoles, getUserById } from "../db/user-repository.js";
import { getDepartmentById } from "../db/department-repository.js";
import { getDb } from "../db/database.js";
import type { ShareRepository } from "../db/share-repository.js";
import type { RouteDependencies } from "./types.js";

export function createShareRoutes(deps: RouteDependencies & { shareRepository: ShareRepository }): Router {
  const router = Router();
  const repo = deps.shareRepository;
  const registry = deps.registry;

  // 创建权限中间件实例 - 延迟到函数内部创建
  const pm = permissions.createMiddleware(permissions.service);

  /** 获取用户的部门路径 */
  async function getUserDeptPath(userId: string): Promise<string> {
    const user = await getUserById(userId);
    if (!user?.departmentId) return "/";
    const dept = await getDepartmentById(user.departmentId);
    return dept?.path ?? "/";
  }

  // POST /api/share — 创建共享规则
  router.post("/share", pm.requireAuth, async (req, res) => {
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

      // ===== 权限检查 =====

      // 1. Skill 分享需要 owner 验证
      if (resourceType === "skill") {
        const skill = registry.lookup(resourceId);
        if (!skill) {
          res.status(404).json({ success: false, error: "Skill not found" });
          return;
        }

        // 获取用户信息
        const userPermissions = await getUserRoles(req.user!.id);
        const isAdmin = userPermissions.some(r => r.name === "admin");
        const isOwner = !skill.owner || skill.owner === req.user!.id;

        // 系统 Skill：仅管理员可以分享
        if (skill.isSystem) {
          if (!isAdmin) {
            res.status(403).json({ success: false, error: "System skills can only be shared by administrators" });
            return;
          }
          // 管理员可以分享系统 Skill，跳过 ownership 检查
        } else {
          // 非系统 Skill：必须是 owner
          if (!isOwner) {
            res.status(403).json({ success: false, error: "Only skill owner can share this skill" });
            return;
          }
        }
      }

      // 2. kb_document 分享需要 owner 验证
      if (resourceType === "kb_document") {
        let isOwner = false;
        
          const db = getDb();
          const row = db.prepare("SELECT owner_id FROM kb_documents WHERE doc_id = ?").get(resourceId) as { owner_id: string } | undefined;
          isOwner = row?.owner_id === req.user!.id;
        
        if (!isOwner) {
          res.status(403).json({ success: false, error: "Only document owner can share this document" });
          return;
        }
      }

      // 3. file 分享需要 owner 验证（文件必须在当前用户的 uploads 目录下）
      if (resourceType === "file") {
        const wsBase = join(process.cwd(), ".raos", "workspace");
        const absPath = join(wsBase, resourceId);
        const userUploadBase = join(wsBase, "uploads", req.user!.id);
        if (!absPath.startsWith(userUploadBase)) {
          res.status(403).json({ success: false, error: "Only file owner can share this file" });
          return;
        }
      }

      const rule = await repo.create({
        resourceType,
        resourceId,
        ownerId: req.user!.id,
        scope,
        targetId: targetId ?? undefined,
        permission: perm,
      });
      res.json({ success: true, data: rule });
    } catch (err) {
      console.error("[share-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // DELETE /api/share/:id — 撤销共享
  router.delete("/share/:id", pm.requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const rule = await repo.getById(id);
      if (!rule) {
        res.status(404).json({ success: false, error: "Share rule not found" });
        return;
      }
      // 只有创建者可以删除
      if (rule.ownerId !== req.user!.id) {
        res.status(403).json({ success: false, error: "Only the owner can delete a share rule" });
        return;
      }
      await repo.delete(id);
      res.json({ success: true });
    } catch (err) {
      console.error("[share-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // GET /api/share/my — 我创建的共享
  router.get("/share/my", pm.requireAuth, async (req, res) => {
    try {
      const rules = await repo.getByOwner(req.user!.id);
      res.json({ success: true, data: rules });
    } catch (err) {
      console.error("[share-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // GET /api/share/to-me — 共享给我的资源
  router.get("/share/to-me", pm.requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const roles = await getUserRoles(userId);
      const roleIds = roles.map(r => r.id);
      const deptPath = await getUserDeptPath(userId);
      const rules = await repo.getSharedToUser(userId, roleIds, deptPath);
      res.json({ success: true, data: rules });
    } catch (err) {
      console.error("[share-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // PUT /api/share/:id — 修改共享规则
  router.put("/share/:id", pm.requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const rule = await repo.getById(id);
      if (!rule) {
        res.status(404).json({ success: false, error: "Share rule not found" });
        return;
      }
      if (rule.ownerId !== req.user!.id) {
        res.status(403).json({ success: false, error: "Only the owner can update a share rule" });
        return;
      }
      const { scope, targetId, permission } = req.body;
      if (scope !== undefined) {
        const validScopes = ["all", "role", "department", "user"];
        if (!validScopes.includes(scope)) {
          res.status(400).json({ success: false, error: `scope must be one of: ${validScopes.join(", ")}` });
          return;
        }
        if (scope !== "all" && !targetId) {
          res.status(400).json({ success: false, error: "targetId is required when scope is not 'all'" });
          return;
        }
      }
      if (permission !== undefined) {
        const validPermissions = ["read", "execute", "write"];
        if (!validPermissions.includes(permission)) {
          res.status(400).json({ success: false, error: `permission must be one of: ${validPermissions.join(", ")}` });
          return;
        }
      }
      if (targetId !== undefined && typeof targetId === "string" && targetId.length > 256) {
        res.status(400).json({ success: false, error: "targetId too long (max 256 characters)" });
        return;
      }
      const updated = await repo.update(id, { scope, targetId, permission });
      if (!updated) {
        res.status(400).json({ success: false, error: "No valid fields to update" });
        return;
      }
      const updatedRule = await repo.getById(id);
      res.json({ success: true, data: updatedRule });
    } catch (err) {
      console.error("[share-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  return router;
}
