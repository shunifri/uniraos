/**
 * Production security middleware stack
 * — helmet, cors, rate-limit, request audit
 */

import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createFileSink } from "../utils/file-log-sink.js";
import { httpRequestDuration, httpRequestsTotal } from "../metrics/http-metrics.js";
import path from "path";

/** ─── Helmet: security headers ─── */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // 允许内嵌资源（SPA 需要）
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  // P2: Permissions-Policy 限制浏览器功能暴露
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
});

/** ─── CORS: whitelist-based ─── */
function parseAllowedOrigins(): string[] | boolean {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    // 生产环境未设置白名单时拒绝所有跨域
    if (process.env.NODE_ENV === "production") {
      console.warn("[SECURITY] ALLOWED_ORIGINS 未设置，生产环境禁止跨域访问");
      return false;
    }
    // 开发环境允许所有
    return true;
  }
  return raw.split(",").map((o) => o.trim());
}

export const corsMiddleware = cors({
  origin: parseAllowedOrigins(),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
});

/** ─── Rate Limiting ─── */
const createLimiter = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    keyGenerator: (req: Request) => {
      // 优先使用已认证用户 ID，否则使用 IP
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user?.id;
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
  });

/** 通用 API 限流: 100 次 / 分钟 */
export const generalRateLimit = createLimiter(60_000, 100, "请求过于频繁，请稍后再试");

/** 认证路由限流: 60 次 / 分钟 */
export const authRateLimit = createLimiter(60_000, 60, "登录请求过于频繁，请稍后再试");

/** LLM / Agent 调用限流: 10 次 / 分钟 */
export const llmRateLimit = createLimiter(60_000, 10, "AI 调用过于频繁，请稍后再试");

/** 文件上传限流: 5 次 / 分钟 */
export const uploadRateLimit = createLimiter(60_000, 5, "文件上传过于频繁，请稍后再试");

/** ─── Request Audit Logger ─── */
const auditSink = createFileSink({
  dir: path.resolve(".raos/audit"),
  filename: "audit.log",
  rotateDaily: true,
  maxFiles: 30,
});

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (req as any).user?.id || "anonymous";
  const requestId = req.headers["x-request-id"] ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 将 requestId 注入到响应头，方便链路追踪
  res.setHeader("X-Request-Id", String(requestId));

  res.on("finish", () => {
    const duration = Date.now() - start;
    const durationSec = duration / 1000;
    const route = req.route?.path || req.path || "unknown";
    const statusCode = String(res.statusCode);

    // P1 修复：记录 Prometheus HTTP 指标
    httpRequestDuration.observe({ method: req.method, route, status_code: statusCode }, durationSec);
    httpRequestsTotal.inc({ method: req.method, route, status_code: statusCode });

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "info" as const,
      event: "audit",
      requestId,
      userId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip ?? req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
    auditSink(logEntry);
  });

  next();
}

/** ─── Request Timeout ─── */
/** 默认请求超时: 30 秒（SSE / LLM 流路由可在各自 handler 中覆盖） */
export const REQUEST_TIMEOUT_MS = 30_000;

export function requestTimeoutMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    console.warn(`[TIMEOUT] Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${req.method} ${req.path}`);
    if (!res.headersSent) {
      res.status(408).json({ success: false, error: "Request timeout" });
    }
    req.destroy();
  });
  next();
}
