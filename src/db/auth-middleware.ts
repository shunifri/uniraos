/**
 * Express 认证中间件
 * 支持 SQLite 和 MySQL
 *
 * @deprecated Use src/permissions/middleware/auth-middleware.ts instead
 * This module will be removed in a future version.
 */
import type { Request, Response, NextFunction } from "express";
import { validateSession } from "./auth.js";
import { userHasPermission, getUserRoles } from "./user-repository.js";
import type { User } from "./user-repository.js";

/** 扩展 Request，挂载当前用户 */
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * 认证中间件：从 Authorization header 提取 token 并验证
 * 未认证时 req.user 为 undefined（不阻断请求）
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;

  // 1. 优先从 Authorization header 取 token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  // 2. 回退：从 Cookie 读取 token（更安全，token 不会暴露在 URL/日志中）
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  // 3. 最后回退：从 URL 查询参数 ?token=xxx 取（用于 <img src> 等无法设置 header/Cookie 的场景）
  if (!token && typeof req.query.token === "string") {
    token = req.query.token;
  }

  if (token) {
    const user = await validateSession(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}

/**
 * 要求已登录（未登录返回 401）
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  next();
}

/**
 * 要求指定权限（未授权返回 403）
 * 用法: app.post("/api/xxx", requireAuth, requirePermission("config.read"), handler)
 */
export function requirePermission(permissionName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const hasPerm = await userHasPermission(req.user.id, permissionName);
    if (!hasPerm) {
      res.status(403).json({ success: false, error: `Permission denied: ${permissionName}` });
      return;
    }
    next();
  };
}

/**
 * 要求用户拥有指定角色
 * 用法: app.post("/api/xxx", requireAuth, requireRole("admin"), handler)
 */
export function requireRole(roleName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const roles = await getUserRoles(req.user.id);
    if (!roles.some((r) => r.name === roleName)) {
      res.status(403).json({ success: false, error: `Role required: ${roleName}` });
      return;
    }
    next();
  };
}

/**
 * 要求 admin 角色（快捷方式）
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const roles = await getUserRoles(req.user.id);
  if (!roles.some((r) => r.name === "admin")) {
    res.status(403).json({ success: false, error: "Admin access required" });
    return;
  }
  next();
}
