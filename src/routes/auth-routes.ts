import { Router } from "express";
import { randomUUID } from "crypto";
import { permissions } from "../permissions/index.js";
import { createSession, destroySession } from "../db/auth.js";
import * as userRepo from "../db/user-repository.js";
import * as deptRepo from "../db/department-repository.js";
import * as resRepo from "../db/resource-repository.js";
import { loginSchema, registerSchema, validate } from "./validation.js";
import type { RouteDependencies } from "./types.js";
import { log } from "../utils/logger.js";

export function createAuthRoutes(deps: RouteDependencies): Router {
  const { sessionManager, syncSkillsToResources } = deps;
  const router = Router();

  // 创建权限中间件实例 - 延迟到函数内部创建
  const pm = permissions.createMiddleware(permissions.service);

  // ===== Auth Routes =====

  router.post("/auth/login", validate(loginSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const user = await userRepo.authenticate(username, password);
    if (!user) {
      res.status(401).json({ success: false, error: "Invalid credentials" });
      return;
    }

    const session = await createSession(user.id);
    const details = await userRepo.getUserWithDetails(user.id);

    // Set HttpOnly cookie for better security (token not exposed to JS/history/logs)
    const msToExpiry = session.expiresAt - Date.now();
    res.cookie('token', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: msToExpiry > 0 ? msToExpiry : 7 * 24 * 60 * 60 * 1000, // 1 week default
      path: '/',
    });

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
        const session = await createSession(user.id);
        const details = await userRepo.getUserWithDetails(user.id);

        const msToExpiry = session.expiresAt - Date.now();
        res.cookie('token', session.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: msToExpiry > 0 ? msToExpiry : 7 * 24 * 60 * 60 * 1000,
          path: '/',
        });

        log("info", "[AUDIT] auth.anonymous_login", { userId: user.id, phone: phone.slice(-4), ip: req.ip });
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

      const msToExpiry = session.expiresAt - Date.now();
      res.cookie('token', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: msToExpiry > 0 ? msToExpiry : 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      log("info", "[AUDIT] auth.anonymous_login", { userId: user.id, phone: phone.slice(-4), ip: req.ip });
      res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: details,
      });
    } catch (err) {
      console.error("[auth-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // POST /api/auth/visitor — 访客模式（无需手机号，生成临时身份）
  router.post("/auth/visitor", async (req, res) => {
    try {
      const visitorId = `v_${randomUUID().slice(0, 12)}`;
      const username = `visitor_${visitorId}`;

      const user = await userRepo.createUser({
        username,
        password: randomUUID(),
        displayName: `访客`,
        phone: ``,
        roleIds: ["role_viewer"],
      });

      const session = await createSession(user.id);
      const details = await userRepo.getUserWithDetails(user.id);

      const msToExpiry = session.expiresAt - Date.now();
      res.cookie('token', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: msToExpiry > 0 ? msToExpiry : 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: details,
      });
    } catch (err) {
      console.error("[auth-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/auth/logout", pm.requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      await destroySession(authHeader.slice(7));
    }
    // 同时清除 cookie 中的 token
    const cookieToken = (req as any).cookies?.token;
    if (cookieToken) {
      await destroySession(cookieToken);
    }
    res.clearCookie("token", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    log("info", "auth.logout", { userId });
    res.json({ success: true });
  });

  router.get("/auth/me", pm.requireAuth, async (req, res) => {
    const details = await userRepo.getUserWithDetails(req.user!.id);
    if (!details) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    res.json({ success: true, user: details });
  });

  // ===== User management API (admin) =====

  router.get("/users", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
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

  router.post("/users", pm.requireAuth, pm.requireAdmin(), validate(registerSchema), async (req, res) => {
    const { username, password, displayName, departmentId, phone, email, roleIds } = req.body;
    try {
      const user = await userRepo.createUser({ username, password, displayName, departmentId, phone, email, roleIds });
      log("info", "auth.user_created", { userId: user.id, username, by: req.user!.id });
      const details = await userRepo.getUserWithDetails(user.id);
      res.json({ success: true, user: details });
    } catch (err) {
      console.error("[auth-routes] unexpected error:", err);
      res.status(400).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  router.put("/users/:id", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const { displayName, avatar, status, departmentId, phone, email, roleIds } = req.body;
    const id = req.params.id as string;
    const user = await userRepo.updateUser(id, { displayName, avatar, status, departmentId, phone, email, roleIds });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }
    log("info", "auth.user_updated", { userId: id, by: req.user!.id });
    const details = await userRepo.getUserWithDetails(id);
    res.json({ success: true, user: details });
  });

  router.delete("/users/:id", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    if (id === req.user!.id) {
      res.status(400).json({ success: false, error: "Cannot delete yourself" });
      return;
    }
    log("info", "auth.user_deleted", { userId: id, by: req.user!.id });
    const deleted = await userRepo.deleteUser(id);
    res.json({ success: true, deleted });
  });

  router.post("/users/:id/roles", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
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

  // 管理员修改任意用户密码（无需验证原密码）
  router.post("/users/:id/password", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const { password } = req.body as { password: string };
    if (!password) {
      res.status(400).json({ success: false, error: "password is required" });
      return;
    }
    const changed = await userRepo.changePassword(id, password);
    res.json({ success: true, changed });
  });

  // 个人修改自己的密码（需验证原密码）
  router.post("/user/password", pm.requireAuth, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body as { oldPassword: string; newPassword: string };
      if (!oldPassword || !newPassword) {
        res.status(400).json({ success: false, error: "oldPassword and newPassword are required" });
        return;
      }
      if (newPassword.length < 6 || newPassword.length > 100) {
        res.status(400).json({ success: false, error: "newPassword must be 6-100 characters" });
        return;
      }
      // 验证原密码
      const user = await userRepo.authenticate(req.user!.username, oldPassword);
      if (!user) {
        res.status(401).json({ success: false, error: "原密码不正确" });
        return;
      }
      const changed = await userRepo.changePassword(req.user!.id, newPassword);
      res.json({ success: true, changed });
    } catch (err) {
      console.error("[auth-routes] change own password error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // ===== Department management API (admin) =====

  router.get("/departments", pm.requireAuth, pm.requireAdmin(), async (_req, res) => {
    const departments = await deptRepo.getDepartmentTree();
    res.json({ success: true, departments });
  });

  router.post("/departments", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const { name, parentId, description } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }
    try {
      const dept = await deptRepo.createDepartment({ name, parentId, description });
      res.json({ success: true, department: dept });
    } catch (err) {
      console.error("[auth-routes] unexpected error:", err);
      res.status(400).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  router.put("/departments/:id", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const { name, description } = req.body;
    const dept = await deptRepo.updateDepartment(id, { name, description });
    if (!dept) {
      res.status(404).json({ success: false, error: "Department not found" });
      return;
    }
    res.json({ success: true, department: dept });
  });

  router.delete("/departments/:id", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    try {
      await deptRepo.deleteDepartment(id);
      res.json({ success: true });
    } catch (err) {
      console.error("[auth-routes] unexpected error:", err);
      res.status(400).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  router.post("/departments/:id/resources", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const { resourceIds } = req.body as { resourceIds: string[] };
    if (!resourceIds || !Array.isArray(resourceIds)) {
      res.status(400).json({ success: false, error: "resourceIds array is required" });
      return;
    }
    if (resourceIds.length > 100) {
      res.status(400).json({ success: false, error: "resourceIds array too large (max 100)" });
      return;
    }
    await deptRepo.assignResources(id, resourceIds);
    const resources = await deptRepo.getDepartmentResources(id);
    res.json({ success: true, resources });
  });

  router.delete("/departments/:id/resources", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const { resourceIds } = req.body as { resourceIds: string[] };
    if (!resourceIds || !Array.isArray(resourceIds)) {
      res.status(400).json({ success: false, error: "resourceIds array is required" });
      return;
    }
    if (resourceIds.length > 100) {
      res.status(400).json({ success: false, error: "resourceIds array too large (max 100)" });
      return;
    }
    await deptRepo.removeResources(id, resourceIds);
    const resources = await deptRepo.getDepartmentResources(id);
    res.json({ success: true, resources });
  });

  router.get("/departments/:id/resources", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const effective = req.query.effective === "true";
    const resources = effective
      ? await deptRepo.getDepartmentEffectiveResources(id)
      : await deptRepo.getDepartmentResources(id);
    res.json({ success: true, resources });
  });

  // ===== Resource management API (admin) =====

  router.get("/resources", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const type = req.query.type as string | undefined;
    const resources = await resRepo.listResources(type);
    res.json({ success: true, resources });
  });

  router.post("/resources/sync", pm.requireAuth, pm.requireAdmin(), async (_req, res) => {
    await syncSkillsToResources();
    const resources = await resRepo.listResources("skill");
    res.json({ success: true, resources });
  });

  // ===== Role permission management API (admin) =====

  router.get("/roles", pm.requireAuth, pm.requireAdmin(), async (_req, res) => {
    const roles = await userRepo.listRoles();
    res.json({ success: true, roles });
  });

  router.get("/roles/:id/permissions", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const permissions = await resRepo.getPermissionsByRole(id);
    res.json({ success: true, permissions });
  });

  router.post("/roles/:id/permissions", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    const body = req.body as any;

    // 支持三种格式：
    // 1. permissions: 完全替换角色权限
    // 2. permissionIds + action: 追加/移除权限
    // 3. 兼容旧格式

    // 检查是否是新格式（permissions）
    if (body.permissions && Array.isArray(body.permissions)) {
      if (body.permissions.length > 200) {
        res.status(400).json({ success: false, error: "permissions array too large (max 200)" });
        return;
      }
      console.log(`替换角色 ${id} 的权限，新权限数: ${body.permissions.length}`);
      await resRepo.replacePermissionsForRole(id, body.permissions);
    }
    // 检查是否是旧格式（permissionIds + action）
    else if (body.permissionIds && Array.isArray(body.permissionIds) && body.action) {
      if (body.permissionIds.length > 200) {
        res.status(400).json({ success: false, error: "permissionIds array too large (max 200)" });
        return;
      }
      if (body.action === "assign") {
        console.log(`为角色 ${id} 分配权限，权限数: ${body.permissionIds.length}`);
        await resRepo.assignPermissionsToRole(id, body.permissionIds);
      } else if (body.action === "remove") {
        console.log(`从角色 ${id} 移除权限，权限数: ${body.permissionIds.length}`);
        await resRepo.removePermissionsFromRole(id, body.permissionIds);
      } else {
        res.status(400).json({ success: false, error: "action must be 'assign' or 'remove'" });
        return;
      }
    }
    // 无效格式
    else {
      res.status(400).json({ success: false, error: "permissions (or permissionIds + action) are required" });
      return;
    }

    const result = await resRepo.getPermissionsByRole(id);
    res.json({ success: true, permissions: result });
  });

  router.get("/roles/:id/agent-config", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const { id } = req.params;
    try {
      const config = await userRepo.getRoleAgentConfig(id as string);
      res.json({ success: true, config });
    } catch (err) {
      console.error("[auth-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/roles/:id/agent-config", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const { id } = req.params;
    const config = req.body as import("../permissions/types/role.js").RoleAgentConfig | null;
    console.log(`[POST /roles/${id}/agent-config] received (size=${JSON.stringify(config).length} bytes)`);
    try {
      await userRepo.updateRoleAgentConfig(id as string, config);
      console.log(`[POST /roles/${id}/agent-config] saved ok`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[POST /roles/${id}/agent-config] error:`, err);
      console.error("[auth-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.get("/permissions", pm.requireAuth, pm.requireAdmin(), async (_req, res) => {
    const permissions = await resRepo.listPermissions();
    res.json({ success: true, permissions });
  });

  router.post("/roles", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const { name, description } = req.body as { name: string; description?: string };
    if (!name) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }
    try {
      const role = await userRepo.createRole({ name, description });
      res.json({ success: true, role });
    } catch (err) {
      console.error("[auth-routes] unexpected error:", err);
      res.status(400).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  router.delete("/roles/:id", pm.requireAuth, pm.requireAdmin(), async (req, res) => {
    const id = req.params.id as string;
    try {
      const ok = await userRepo.deleteRole(id);
      if (!ok) {
        res.status(404).json({ success: false, error: "Role not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[auth-routes] unexpected error:", err);
      res.status(400).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  // ===== User Session APIs =====

  router.get("/user/sessions", pm.requireAuth, (_req, res) => {
    res.json({ sessions: sessionManager.listSessions() });
  });

  return router;
}
