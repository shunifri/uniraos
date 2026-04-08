/**
 * Shared middleware and helpers for route modules.
 */

import type { Request, Response, NextFunction } from "express";

/** Async route wrapper — catches rejected promises and forwards to Express error handler. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
