import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../user/request-context.js';

/**
 * 数据隔离中间件：将用户信息注入 AsyncLocalStorage context，
 * 供 Repository/Service 层在查询时添加 userId/departmentId 过滤。
 *
 * 已完成的隔离加固：
 *   - form-service: instance CRUD 增加 userId 过滤；definition update/delete 增加 createdBy 检查
 *   - form-routes: 所有 instance/definition 操作强制传入 req.user!.id
 *   - custom-skill-repository: findByName/delete 增加 ownerId 过滤
 *   - conversation-repository: clearHistory 禁止无 userId 的全量删除
 *   - app-designs: 已有 owner_id 过滤（listDesigns/previewDesign/archiveDesign/applyDesign）
 *   - share-rules: 已有 owner_id 过滤 + scope/target 校验
 *
 * 剩余 TODO:
 *   - workflow repository: definitions/instances/tasks 需增加 created_by/assignee 过滤
 *   - user-repository: listUsers/countUsers 需增加 department_id 过滤（非管理员场景）
 *   - memory/STM/LTM: 需增加 user_id/owner 过滤
 *   - knowledge-base: 需确认 kb_documents 的 owner_id 过滤完整性
 *
 * 长期方案：
 *   方案A（推荐）: 在 Repository 层统一封装查询方法，自动注入 department_id 过滤
 *   方案B: 使用 Prisma/TypeORM 等 ORM 的行级安全（RLS）功能
 *   方案C: 在数据库层创建视图（VIEW），每个部门只能看到自己的数据
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
