/**
 * P2 修复：URL 长度限制中间件
 * 防止超长 URL 导致日志/代理层拒绝服务
 */

import type { Request, Response, NextFunction } from "express";

const DEFAULT_MAX_URL_LENGTH = 4096; // 4KB，覆盖大多数浏览器/代理限制

export function urlLengthLimitMiddleware(
  maxLength: number = DEFAULT_MAX_URL_LENGTH,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const urlLength = req.originalUrl.length;
    if (urlLength > maxLength) {
      res.status(414).json({
        success: false,
        error: `URL too long: ${urlLength} characters, maximum allowed is ${maxLength}`,
      });
      return;
    }
    next();
  };
}
