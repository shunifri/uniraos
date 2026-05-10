/**
 * P2 修复：HTTP 参数污染（HPP）防护中间件
 * 防止重复查询参数导致类型混淆（Express 会将重复参数转为数组）
 */

import type { Request, Response, NextFunction } from "express";

/**
 * 检测请求体/查询字符串中的数组污染
 * 对于期望字符串的字段，如果发现数组则拒绝
 */
export function hppProtectionMiddleware(
  allowedArrayFields: string[] = [],
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 检查查询参数中的重复键
    const pollutedQueryParams = Object.entries(req.query).filter(
      ([key, value]) => Array.isArray(value) && !allowedArrayFields.includes(key),
    );

    if (pollutedQueryParams.length > 0) {
      const fields = pollutedQueryParams.map(([k]) => k).join(", ");
      res.status(400).json({
        success: false,
        error: `Parameter pollution detected for fields: ${fields}`,
      });
      return;
    }

    next();
  };
}
