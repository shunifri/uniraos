/**
 * Health, readiness, liveness, and metrics endpoints
 */

import { Router } from "express";
import { asyncHandler } from "./middleware.js";
import { register, collectDefaultMetrics } from "prom-client";
import { healthCheck, readinessCheck } from "../health/health-check.js";
import { requireAuth, requireAdmin } from "../permissions/middleware/auth-middleware.js";
import { httpRequestDuration, httpRequestsTotal } from "../metrics/http-metrics.js";

// 启动默认 Prometheus 指标收集（内存、CPU、事件循环等）
collectDefaultMetrics({ register });

// P1 修复：注册自定义 HTTP 指标
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);

const router = Router();

/** Kubernetes-style liveness probe */
router.get("/live", (_req, res) => {
  res.status(200).json({ status: "alive", timestamp: Date.now() });
});

/** Kubernetes-style readiness probe */
router.get("/ready", asyncHandler(async (_req, res) => {
  const result = await readinessCheck();
  if (result.ready) {
    res.status(200).json({ status: "ready", timestamp: Date.now() });
  } else {
    res.status(503).json({ status: "not ready", reason: result.reason, timestamp: Date.now() });
  }
}));

/** Full health check with all dependency statuses */
router.get("/health", asyncHandler(async (_req, res) => {
  const status = await healthCheck();
  const httpStatus = status.status === "healthy" ? 200 : status.status === "degraded" ? 503 : 503;
  res.status(httpStatus).json(status);
}));

/** Prometheus metrics endpoint（独立路径避免与 skill-routes 的 /metrics 冲突） */
router.get("/prom/metrics", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
}));

export default router;
