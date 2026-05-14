import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../user/request-context.js';

/**
 * ⚠️ 当前实现仅为 "User Context Middleware"，非真正的数据隔离。
 *
 * 现状：将用户信息（userId, departmentId）放入 AsyncLocalStorage context，
 * 供下游代码手动读取。但 Repository 层不会自动添加 `WHERE department_id = ?` 过滤。
 *
 * 风险：任何忘记手动过滤 department_id 的查询都会导致跨部门数据泄露。
 *
 * TODO(P0-重构): 实现真正的数据隔离
 *   方案A（推荐）: 在 Repository 层统一封装查询方法，自动注入 department_id 过滤
 *   方案B: 使用 Prisma/TypeORM 等 ORM 的行级安全（RLS）功能
 *   方案C: 在数据库层创建视图（VIEW），每个部门只能看到自己的数据
 *
 * 影响范围：src/db/*-repository.ts 中的所有查询方法
 */
export function userIdContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const user = req.user;
  requestContext.run({
    userId: user?.id ?? 'default',
    userName: user?.username,
    userDisplayName: user?.displayName,
    departmentId: user?.departmentId ?? undefined,
  }, () => next());
}
