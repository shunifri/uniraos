/**
 * P2-CRITICAL-FIX #6 (manual entry): Calibration admin API
 *
 * 手动触发 calibration 的 3 个 endpoint:
 *   POST /api/admin/calibration/run        — 触发一次 (admin only)
 *   GET  /api/admin/calibration/status     — 当前状态
 *   GET  /api/admin/calibration/history    — 最近 N 次 run
 *   GET  /api/admin/calibration/runs/:id   — 单次 run 详情
 *
 * 用法:
 *   curl -X POST -H "Cookie: session=xxx" http://localhost:3000/api/admin/calibration/run
 *   curl http://localhost:3000/api/admin/calibration/status
 *
 * 为什么不在 cron:
 *   - 触发由 ops 决定 (acceptance 跌了 / 数据更新了 / LLM 升完级)
 *   - 需可视化 run history + 错误信息
 *   - 没 CI infra 也能用
 *   - 简单替代 #6 (CI/CD auto-calibration)
 */
import { Router } from "express";
import { requireAuth, requireAdmin } from "../permissions/middleware/auth-middleware.js";
import {
  startCalibration,
  getCurrentRun,
  getRecentRuns,
  getRunById,
  type CalibrationRun,
} from "../services/calibration-control.js";

export function createCalibrationAdminRoutes(): Router {
  const router = Router();

  /** POST /api/admin/calibration/run — 触发一次 calibration */
  router.post("/admin/calibration/run", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const current = getCurrentRun();
      if (current && current.status === "running") {
        return res.status(409).json({
          error: "Calibration already running",
          currentRun: current,
        });
      }
      const run = await startCalibration();
      res.status(202).json({
        message: "Calibration started",
        run,
      });
    } catch (err: any) {
      console.error("[calibration-admin] start failed:", err);
      res.status(500).json({ error: err?.message || "Failed to start calibration" });
    }
  });

  /** GET /api/admin/calibration/status — 当前状态 */
  router.get("/admin/calibration/status", requireAuth, requireAdmin, async (_req, res) => {
    const current = getCurrentRun();
    res.json({
      currentRun: current,
      isRunning: current?.status === "running",
    });
  });

  /** GET /api/admin/calibration/history?limit=10 — 历史 run */
  router.get("/admin/calibration/history", requireAuth, requireAdmin, async (req, res) => {
    const limitRaw: unknown = req.query.limit;
    const limitStr = Array.isArray(limitRaw) ? String(limitRaw[0] ?? "10") : String(limitRaw ?? "10");
    const limit = Math.min(parseInt(limitStr, 10) || 10, 50);
    const runs = getRecentRuns(limit);
    res.json({ runs, count: runs.length });
  });

  /** GET /api/admin/calibration/runs/:id — 单次详情 (含 stdout tail) */
  router.get("/admin/calibration/runs/:id", requireAuth, requireAdmin, async (req, res) => {
    const run = getRunById(String(req.params.id)) as CalibrationRun | undefined;
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    res.json(run);
  });

  return router;
}
