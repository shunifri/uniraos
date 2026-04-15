import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../user/request-context.js';

export function userIdContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const userId = req.user?.id ?? 'default';
  requestContext.run({ userId }, () => next());
}
