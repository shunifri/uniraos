import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../user/request-context.js';

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
