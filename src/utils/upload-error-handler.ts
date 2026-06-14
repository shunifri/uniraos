import type { Request, Response, NextFunction, RequestHandler } from "express";
import multer from "multer";

/**
 * Wrap a multer middleware to translate MulterError into clear HTTP responses.
 *
 * Without this wrapper, multer errors (e.g. "File too large") come back as 500
 * Internal Server Error with a generic stack trace. The user has no idea what
 * went wrong. This wrapper:
 *   - LIMIT_FILE_SIZE  → 413 + "文件超过大小限制 (最大 XMB), 请压缩或拆分后重试"
 *   - LIMIT_FILE_COUNT → 413 + "一次最多上传 N 个文件"
 *   - LIMIT_UNEXPECTED_FILE → 400 + 提示字段名
 *   - 其他 MulterError   → 400 + 通用 multer 错误
 *   - fileFilter 错误    → 400 + 原始 message (如 "文件类型不允许: xxx")
 *
 * @param middleware multer 中间件 (upload.single / upload.fields / upload.array 之一)
 * @returns 包装后的 express RequestHandler
 */
export function handleUploadErrors(middleware: RequestHandler, maxSizeBytes: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            success: false,
            error: `文件超过大小限制 (最大 ${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB), 请压缩或拆分后重试`,
            code: "FILE_TOO_LARGE",
            maxSizeMB: Math.round(maxSizeBytes / 1024 / 1024),
          });
          return;
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          res.status(413).json({
            success: false,
            error: `一次最多上传 ${(err as any).limit ?? 10} 个文件`,
            code: "TOO_MANY_FILES",
          });
          return;
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          res.status(400).json({
            success: false,
            error: `不支持的字段名 "${err.field}", 请用 "file" 或 "files"`,
            code: err.code,
          });
          return;
        }
        res.status(400).json({
          success: false,
          error: `上传失败: ${err.message}`,
          code: err.code,
        });
        return;
      }
      // fileFilter 等其他错误 (例如 "文件类型不允许: xxx")
      res.status(400).json({
        success: false,
        error: err.message || "上传失败",
      });
    });
  };
}
