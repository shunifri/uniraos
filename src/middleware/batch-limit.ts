/**
 * P2 修复：批量操作限流中间件
 * 防止超大数组导致内存/CPU 耗尽
 */

import type { Request, Response, NextFunction } from "express";

const DEFAULT_MAX_BATCH_SIZE = 1000;

/**
 * 检测请求体中的批量操作数组大小
 * 支持常见的批量字段名：items, records, data, files, ids, users 等
 */
export function batchLimitMiddleware(
  maxSize: number = DEFAULT_MAX_BATCH_SIZE,
  fields: string[] = ["items", "records", "data", "files", "ids", "users", "documents", "skills"],
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.body || typeof req.body !== "object") {
      next();
      return;
    }

    for (const field of fields) {
      const arr = req.body[field];
      if (Array.isArray(arr) && arr.length > maxSize) {
        res.status(413).json({
          success: false,
          error: `Batch size exceeded: ${field} has ${arr.length} items, maximum allowed is ${maxSize}`,
        });
        return;
      }
    }

    next();
  };
}
