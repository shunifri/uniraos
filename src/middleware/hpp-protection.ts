/**
 * P2 修复：HTTP 参数污染（HPP）防护中间件
 * 防止重复查询参数导致类型混淆（Express 会将重复参数转为数组）
 */

import type { Request, Response, NextFunction } from "express";

/**
 * 检测查询字符串和 URL-encoded 请求体中的数组污染。
 * JSON 请求体中的数组是合法数据类型，不检查。
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

    // 仅对 URL-encoded / multipart 请求体检查重复键（JSON 中的数组是合法的）
    const contentType = req.headers?.["content-type"] || "";
    const isJsonBody = contentType.includes("application/json");
    if (!isJsonBody && req.body && typeof req.body === "object") {
      const pollutedBodyParams = Object.entries(req.body).filter(
        ([key, value]) => Array.isArray(value) && !allowedArrayFields.includes(key),
      );
      if (pollutedBodyParams.length > 0) {
        const fields = pollutedBodyParams.map(([k]) => k).join(", ");
        res.status(400).json({
          success: false,
          error: `Parameter pollution detected for body fields: ${fields}`,
        });
        return;
      }
    }

    next();
  };
}
