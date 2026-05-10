/**
 * Shared middleware and helpers for route modules.
 */

import type { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger.js";

/** Async route wrapper — catches rejected promises and forwards to Express error handler. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Global error handler middleware — must be mounted after all routes. */
export function globalErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const statusCode = (err as any).statusCode ?? (err as any).status ?? 500;
  const message = err.message || "Internal server error";

  // P1 修复：使用结构化 logger，注入 requestId 和 userId
  log("error", "http.request_failed", {
    requestId: (req as any).requestId,
    userId: (req as any).user?.id,
    method: req.method,
    path: req.path,
    statusCode,
    error: message,
    stack: err.stack,
  });

  res.status(statusCode).json({
    success: false,
    error: message,
  });
}
