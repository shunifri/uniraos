/**
 * P2-CRITICAL-FIX #6 (auto-promote): Score candidate admin API
 *
 * 候选池 API — 管理员手动管理 + 系统自动比较:
 *   GET    /api/admin/calibration/candidates           — 池里所有 candidates
 *   GET    /api/admin/calibration/candidates/current   — 当前 active
 *   GET    /api/admin/calibration/candidates/settings  — auto-promote + threshold
 *   POST   /api/admin/calibration/candidates/settings  — 改 auto-promote / threshold
 *   POST   /api/admin/calibration/candidates/:id/promote  — 手动 promote
 *   POST   /api/admin/calibration/candidates/:id/reject   — 手动 reject
 *   DELETE /api/admin/calibration/candidates/:id           — 手动 delete
 *   POST   /api/admin/calibration/candidates/revert    — revert 到上一版 active
 *
 * 模型: 每次 successful calibration 跑完 → addCandidate (score-candidates.ts)
 *       addCandidate 内部做 auto-promote 比较
 *       管理员可以 override (promote / reject / delete / revert)
 */
import { Router } from "express";
import { requireAuth, requireAdmin } from "../permissions/middleware/auth-middleware.js";
import {
  getStore,
  getCandidates,
  getActiveCandidate,
  setAutoPromote,
  setImprovementThreshold,
  promoteCandidate,
  rejectCandidate,
  deleteCandidate,
  revertActive,
  getCurrentK,
} from "../services/score-candidates.js";

export function createCandidateAdminRoutes(): Router {
  const router = Router();

  /** GET /api/admin/calibration/candidates — 池里所有 */
  router.get("/admin/calibration/candidates", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [candidates, active, currentK] = await Promise.all([
        getCandidates(),
        getActiveCandidate(),
        Promise.resolve(getCurrentK()),
      ]);
      res.json({
        candidates,
        active,
        currentK,
        count: candidates.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to list candidates" });
    }
  });

  /** GET /api/admin/calibration/candidates/current — 当前 active */
  router.get("/admin/calibration/candidates/current", requireAuth, requireAdmin, async (_req, res) => {
    const [active, currentK] = await Promise.all([getActiveCandidate(), Promise.resolve(getCurrentK())]);
    res.json({ active, currentK });
  });

  /** GET /api/admin/calibration/candidates/settings */
  router.get("/admin/calibration/candidates/settings", requireAuth, requireAdmin, async (_req, res) => {
    const s = await getStore();
    res.json({
      autoPromote: s.autoPromote,
      improvementThresholdPct: s.improvementThresholdPct,
    });
  });

  /** POST /api/admin/calibration/candidates/settings */
  router.post("/admin/calibration/candidates/settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { autoPromote, improvementThresholdPct } = req.body || {};
      if (typeof autoPromote === "boolean") await setAutoPromote(autoPromote);
      if (typeof improvementThresholdPct === "number") await setImprovementThreshold(improvementThresholdPct);
      const s = await getStore();
      res.json({
        ok: true,
        autoPromote: s.autoPromote,
        improvementThresholdPct: s.improvementThresholdPct,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to update settings" });
    }
  });

  /** POST /api/admin/calibration/candidates/:id/promote */
  router.post("/admin/calibration/candidates/:id/promote", requireAuth, requireAdmin, async (req, res) => {
    const result = await promoteCandidate(String(req.params.id));
    res.status(result.ok ? 200 : 400).json(result);
  });

  /** POST /api/admin/calibration/candidates/:id/reject */
  router.post("/admin/calibration/candidates/:id/reject", requireAuth, requireAdmin, async (req, res) => {
    const notesRaw: unknown = req.body?.notes;
    const notes = typeof notesRaw === "string" ? notesRaw : undefined;
    const result = await rejectCandidate(String(req.params.id), notes);
    res.status(result.ok ? 200 : 400).json(result);
  });

  /** DELETE /api/admin/calibration/candidates/:id */
  router.delete("/admin/calibration/candidates/:id", requireAuth, requireAdmin, async (req, res) => {
    const result = await deleteCandidate(String(req.params.id));
    res.status(result.ok ? 200 : 400).json(result);
  });

  /** POST /api/admin/calibration/candidates/revert */
  router.post("/admin/calibration/candidates/revert", requireAuth, requireAdmin, async (_req, res) => {
    const result = await revertActive();
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}
