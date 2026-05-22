import type { Request, Response, NextFunction } from 'express';
import { validateSession } from '../../db/auth.js';
import { userHasPermission, getUserRoles } from '../../db/user-repository.js';
import type { User } from '../../db/user-repository.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token && req.query?.token) {
    token = req.query.token as string;
  }

  if (token) {
    const user = await validateSession(token);
    if (user) {
      req.user = user;
      next();
      return;
    }
    // Token 存在但验证失败 → 拒绝请求（防止无效 token 被当作匿名访问）
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
    return;
  }

  // 未提供 token → 匿名访问，继续执行（由具体路由决定是否需要 requireAuth）
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
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
