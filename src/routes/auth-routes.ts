import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, requireAdmin } from "../db/auth-middleware.js";
import { createSession, destroySession } from "../db/auth.js";
import * as userRepo from "../db/user-repository.js";
import * as deptRepo from "../db/department-repository.js";
import * as resRepo from "../db/resource-repository.js";
import type { RouteDependencies } from "./index.js";

export function createAuthRoutes(deps: RouteDependencies): Router {
  const { sessionManager, syncSkillsToResources } = deps;
  const router = Router();

  // ===== Auth Routes =====

  router.post("/auth/login", async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    if (!username || !password) {
      res.status(400).json({ success: false, error: "username and password are required" });
      return;
    }

    const user = await userRepo.authenticate(username, password);
    if (!user) {
      res.status(401).json({ success: false, error: "Invalid credentials" });
      return;
    }

    const session = await createSession(user.id);
    const details = await userRepo.getUserWithDetails(user.id);

    res.json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: details,
    });
  });

  // POST /api/auth/anonymous — 匿名登录（通过手机号标识）
  router.post("/auth/anonymous", async (req, res) => {
    try {
      const { phone } = req.body as { phone?: string };

      // 手机号必填且格式验证（中国大陆11位手机号）
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        res.status(400).json({ success: false, error: "请输入有效的手机号码" });
        return;
      }

      // 检查手机号是否已注册过匿名用户
      let user = await userRepo.getUserByPhone(phone);

      if (user) {
        // 已有用户，直接创建新 session
        const session = await createSession(user.id);
        const details = await userRepo.getUserWithDetails(user.id);
        res.json({
          success: true,
          token: session.token,
          expiresAt: session.expiresAt,
          user: details,
        });
        return;
      }

      // 创建新匿名用户
      const anonUsername = `guest_${phone.slice(-4)}_${randomUUID().slice(0, 4)}`;
      user = await userRepo.createUser({
        username: anonUsername,
        password: randomUUID(), // 随机密码，匿名用户不需要密码登录
        displayName: `游客${phone.slice(-4)}`,
        phone,
        roleIds: ["role_viewer"],
      });

      const session = await createSession(user.id);
      const details = await userRepo.getUserWithDetails(user.id);

      res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: details,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/auth/logout", requireAuth, async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      await destroySession(authHeader.slice(7));
    }
    res.json({ success: true });
  });

  router.get("/auth/me", requireAuth, async (req, res) => {
    const details = await userRepo.getUserWithDetails(req.user!.id);
    if (!details) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    res.json({ success: true, user: details });
  });

  // ===== User management API (admin) =====

  router.get("/users", requireAuth, requireAdmin, async (req, res) => {
    const userId = req.query.id as string | undefined;
    if (userId) {
      const details = await userRepo.getUserWithDetails(userId);
      if (!details) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }
      res.json({ success: true, user: details });
      return;
    }
    const users = await userRepo.listUsers();
    // Enrich each user with roles for the list view
    const enriched = await Promise.all(users.map(async (u) => {
      const roles = await userRepo.getUserRoles(u.id);
      return { ...u, roles };
    }));
    res.json({ success: true, users: enriched });
  });

  router.post("/users", requireAuth, requireAdmin, async (req, res) => {
    const { username, password, displayName, departmentId, phone, email, roleIds } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, error: "username and password are required" });
      return;
    }
    try {
      const user = await userRepo.createUser({ username, password, displayName, departmentId, phone, email, roleIds });
      const details = await userRepo.getUserWithDetails(user.id);
      res.json({ success: true, user: details });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const { displayName, avatar, status, departmentId, phone, email, roleIds } = req.body;
    const id = req.params.id as string;
    const user = await userRepo.updateUser(id, { displayName, avatar, status, departmentId, phone, email, roleIds });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    const details = await userRepo.getUserWithDetails(id);
    res.json({ success: true, user: details });
  });

  router.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    if (id === req.user!.id) {
      res.status(400).json({ success: false, error: "Cannot delete yourself" });
      return;
    }
    const deleted = await userRepo.deleteUser(id);
    res.json({ success: true, deleted });
  });

  router.post("/users/:id/roles", requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const { roleId, action } = req.body as { roleId: string; action: "assign" | "remove" };
    if (!roleId || !action) {
      res.status(400).json({ success: false, error: "roleId and action (assign/remove) are required" });
      return;
    }
    if (action === "assign") {
      await userRepo.assignRole(id, roleId);
    } else {
      await userRepo.removeRole(id, roleId);
    }
    const roles = await userRepo.getUserRoles(id);
    res.json({ success: true, roles });
  });

  router.post("/users/:id/password", requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const { password } = req.body as { password: string };
    if (!password) {
      res.status(400).json({ success: false, error: "password is required" });
      return;
    }
    const changed = await userRepo.changePassword(id, password);
    res.json({ success: true, changed });
  });

  // ===== Department management API (admin) =====

  router.get("/departments", requireAuth, requireAdmin, (_req, res) => {
    const departments = deptRepo.getDepartmentTree();
    res.json({ success: true, departments });
  });

  router.post("/departments", requireAuth, requireAdmin, (req, res) => {
    const { name, parentId, description } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }
    try {
      const dept = deptRepo.createDepartment({ name, parentId, description });
      res.json({ success: true, department: dept });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/departments/:id", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const { name, description } = req.body;
    const dept = deptRepo.updateDepartment(id, { name, description });
    if (!dept) {
      res.status(404).json({ success: false, error: "Department not found" });
      return;
    }
    res.json({ success: true, department: dept });
  });

  router.delete("/departments/:id", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    try {
      deptRepo.deleteDepartment(id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/departments/:id/resources", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const { resourceIds } = req.body as { resourceIds: string[] };
    if (!resourceIds || !Array.isArray(resourceIds)) {
      res.status(400).json({ success: false, error: "resourceIds array is required" });
      return;
    }
    deptRepo.assignResources(id, resourceIds);
    const resources = deptRepo.getDepartmentResources(id);
    res.json({ success: true, resources });
  });

  router.delete("/departments/:id/resources", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const { resourceIds } = req.body as { resourceIds: string[] };
    if (!resourceIds || !Array.isArray(resourceIds)) {
      res.status(400).json({ success: false, error: "resourceIds array is required" });
      return;
    }
    deptRepo.removeResources(id, resourceIds);
    const resources = deptRepo.getDepartmentResources(id);
    res.json({ success: true, resources });
  });

  router.get("/departments/:id/resources", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const effective = req.query.effective === "true";
    const resources = effective
      ? deptRepo.getDepartmentEffectiveResources(id)
      : deptRepo.getDepartmentResources(id);
    res.json({ success: true, resources });
  });

  // ===== Resource management API (admin) =====

  router.get("/resources", requireAuth, requireAdmin, (req, res) => {
    const type = req.query.type as string | undefined;
    const resources = resRepo.listResources(type);
    res.json({ success: true, resources });
  });

  router.post("/resources/sync", requireAuth, requireAdmin, (_req, res) => {
    syncSkillsToResources();
    const resources = resRepo.listResources("skill");
    res.json({ success: true, resources });
  });

  // ===== Role permission management API (admin) =====

  router.get("/roles", requireAuth, requireAdmin, async (_req, res) => {
    const roles = await userRepo.listRoles();
    res.json({ success: true, roles });
  });

  router.get("/roles/:id/permissions", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const permissions = resRepo.getPermissionsByRole(id);
    res.json({ success: true, permissions });
  });

  router.post("/roles/:id/permissions", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const { permissionIds, action } = req.body as { permissionIds: string[]; action: "assign" | "remove" };
    if (!permissionIds || !action) {
      res.status(400).json({ success: false, error: "permissionIds and action (assign/remove) are required" });
      return;
    }
    if (action === "assign") {
      resRepo.assignPermissionsToRole(id, permissionIds);
    } else {
      resRepo.removePermissionsFromRole(id, permissionIds);
    }
    const permissions = resRepo.getPermissionsByRole(id);
    res.json({ success: true, permissions });
  });

  router.get("/permissions", requireAuth, requireAdmin, (_req, res) => {
    const permissions = resRepo.listPermissions();
    res.json({ success: true, permissions });
  });

  router.post("/roles", requireAuth, requireAdmin, async (req, res) => {
    const { name, description } = req.body as { name: string; description?: string };
    if (!name) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }
    try {
      const role = await userRepo.createRole({ name, description });
      res.json({ success: true, role });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/roles/:id", requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    try {
      const ok = await userRepo.deleteRole(id);
      if (!ok) {
        res.status(404).json({ success: false, error: "Role not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ===== User Session APIs =====

  router.get("/user/sessions", requireAuth, (_req, res) => {
    res.json({ sessions: sessionManager.listSessions() });
  });

  return router;
}
