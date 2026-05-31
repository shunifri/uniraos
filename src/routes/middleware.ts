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
  const internalMessage = err.message || "Internal server error";

  // P1 修复：使用结构化 logger，注入 requestId 和 userId
  // 用 try/catch 保护，防止 logger 自身崩溃导致默认错误处理器返回 text/plain
  try {
    log("error", "http.request_failed", {
      requestId: (req as any).requestId,
      userId: (req as any).user?.id,
      method: req.method,
      path: req.path,
      statusCode,
      error: internalMessage,
      stack: err.stack,
    });
  } catch (logErr) {
    console.error("[globalErrorHandler] Logger failed:", logErr);
  }

  // 安全：500 错误不返回原始错误消息，防止泄露数据库结构/文件路径等内部信息
  const clientMessage = statusCode >= 500 ? "Internal server error" : internalMessage;

  res.status(statusCode).json({
    success: false,
    error: clientMessage,
  });
}
