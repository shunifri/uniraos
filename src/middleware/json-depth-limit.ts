/**
 * P2 修复：JSON 嵌套深度限制中间件
 * 防止深层嵌套 JSON 导致 JSON.parse/JSON.stringify CPU 耗尽（prototype pollution / nested bomb）
 */

import type { Request, Response, NextFunction } from "express";

const DEFAULT_MAX_DEPTH = 20;

function getDepth(value: unknown, currentDepth: number = 0): number {
  if (currentDepth > DEFAULT_MAX_DEPTH) return currentDepth;
  if (value === null || typeof value !== "object") return currentDepth;

  let maxDepth = currentDepth;
  for (const v of Object.values(value)) {
    const d = getDepth(v, currentDepth + 1);
    if (d > maxDepth) maxDepth = d;
    if (maxDepth > DEFAULT_MAX_DEPTH) break;
  }
  return maxDepth;
}

export function jsonDepthLimitMiddleware(
  maxDepth: number = DEFAULT_MAX_DEPTH,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.body || typeof req.body !== "object") {
      next();
      return;
    }

    const depth = getDepth(req.body);
    if (depth > maxDepth) {
      res.status(400).json({
        success: false,
        error: `JSON nesting depth exceeded: ${depth} > ${maxDepth}`,
      });
      return;
    }

    next();
  };
}
