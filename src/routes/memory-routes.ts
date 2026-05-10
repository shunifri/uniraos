import { Router } from "express";
import { permissions } from "../permissions/index.js";
import type { RouteDependencies } from "./types.js";

export function createMemoryRoutes(deps: RouteDependencies): Router {
  const { engine, sessionManager } = deps;
  const router = Router();

  // 创建权限中间件实例 - 延迟到函数内部创建
  const pm = permissions.createMiddleware(permissions.service);

  router.get("/memory/stm", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), (req, res) => {
    const { stm } = sessionManager.getOrCreate(req.user!.id);
    res.json({ entries: stm.list(), size: stm.size });
  });

  router.get("/memory/ltm", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { ltm } = sessionManager.getOrCreate(req.user!.id);
    const stats = await ltm.stats();
    // 返回全部条目（画像图谱等需要完整数据）
    res.json({ entries: await ltm.list({ limit: 10000 }), ...stats });
  });

  router.get("/memory/archives", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { ltm } = sessionManager.getOrCreate(req.user!.id);
    res.json({ archives: await ltm.getArchiveManifests() });
  });

  router.get("/memory/stats", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    try {
      const result = await engine.execute("memory_stats", {});

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.status(500).json({ success: false, error: result.error?.message || "Failed to get stats" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Scheduled archive management
  router.get("/memory/schedule", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { ltm } = sessionManager.getOrCreate(req.user!.id);
    const stats = await ltm.stats();
    res.json({
      running: stats.scheduledArchive.running,
      lastRunAt: stats.scheduledArchive.lastRunAt || null,
    });
  });

  router.post("/memory/schedule", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const { ltm } = sessionManager.getOrCreate(req.user!.id);
    const { action, intervalMinutes } = req.body as {
      action: "start" | "stop";
      intervalMinutes?: number;
    };

    if (action === "start") {
      const minutes = intervalMinutes ?? 60;
      if (minutes < 1) {
        res.status(400).json({ success: false, error: "intervalMinutes must be >= 1" });
        return;
      }
      ltm.startScheduledArchive(minutes * 60 * 1000);
      res.json({ success: true, action: "started", intervalMinutes: minutes });
    } else if (action === "stop") {
      ltm.stopScheduledArchive();
      res.json({ success: true, action: "stopped" });
    } else {
      res.status(400).json({ success: false, error: "action must be 'start' or 'stop'" });
    }
  });

  // Manual archive trigger
  router.post("/memory/archive", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const { ltm } = sessionManager.getOrCreate(req.user!.id);
    const reason = (req.body?.reason as string) || "manual_ui";
    const result = await ltm.archive(reason);
    res.json({
      success: true,
      archived: result.archived,
      manifest: result.manifest,
      activeRemaining: ltm.size,
    });
  });

  // Restore from archive
  router.post("/memory/restore", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const { ltm } = sessionManager.getOrCreate(req.user!.id);
    const { archiveId, keys } = req.body as { archiveId: string; keys?: string[] };
    if (!archiveId) {
      res.status(400).json({ success: false, error: "archiveId is required" });
      return;
    }
    const restored = await ltm.restoreFromArchive(archiveId, keys);
    res.json({ success: true, restored, activeTotal: ltm.size });
  });

  // ===== Enhanced LTM APIs =====

  // User memory profile
  // Express 5: optional params use two routes instead of :param?
  const profileHandler = async (req: any, res: any) => {
    const targetUserId = req.params.userId || req.user!.id;

    try {
      const result = await engine.execute("ltm_profile", { userId: targetUserId });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.json({ success: false, error: result.error?.message || "Enhanced memory backend not enabled" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  };
  router.get("/memory/profile/:userId", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), profileHandler);
  router.get("/memory/profile", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), profileHandler);

  // Version history
  router.get("/memory/versions/:key", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { key } = req.params;
    const { includeForgotten } = req.query as { includeForgotten?: string };

    try {
      const result = await engine.execute("ltm_version_history", {
        key,
        includeForgotten: includeForgotten === "true",
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.json({ success: false, error: result.error?.message || "Enhanced memory backend not enabled" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Forgotten log
  router.get("/memory/forgotten", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { since, limit, reason } = req.query as { since?: string; limit?: string; reason?: string };

    try {
      const result = await engine.execute("ltm_forgotten_log", {
        since: since ? parseInt(since, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : 50,
        reason,
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.json({ success: false, error: result.error?.message || "Enhanced memory backend not enabled" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Check conflicts
  router.post("/memory/check-conflicts", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { key, value, topN } = req.body as { key: string; value: unknown; topN?: number };

    if (!key) {
      res.status(400).json({ success: false, error: "key is required" });
      return;
    }
    if (value === undefined) {
      res.status(400).json({ success: false, error: "value is required" });
      return;
    }

    try {
      const result = await engine.execute("ltm_check_conflicts", {
        key,
        value,
        topN,
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.json({ success: false, error: result.error?.message || "Enhanced memory backend not enabled" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Extract facts
  router.post("/memory/extract-facts", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const { text, entityContext, tags } = req.body as { text: string; entityContext?: string; tags?: string[] };

    if (!text) {
      res.status(400).json({ success: false, error: "text is required" });
      return;
    }

    try {
      const result = await engine.execute("ltm_extract_facts", {
        text,
        entityContext,
        tags,
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.status(400).json({ success: false, error: result.error?.message || "Fact extraction requires LLM provider" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Store memory
  router.post("/memory/store", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const { key, value, tags, summary, relation, expiresInSec } = req.body as {
      key: string;
      value: unknown;
      tags?: string[];
      summary?: string;
      relation?: string;
      expiresInSec?: number;
    };

    if (!key) {
      res.status(400).json({ success: false, error: "key is required" });
      return;
    }

    try {
      const result = await engine.execute("ltm_store", {
        key,
        value,
        tags,
        summary,
        relation,
        expiresInSec,
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.status(400).json({ success: false, error: result.error?.message || "Store operation failed" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Search memory
  router.get("/memory/search", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const { query, limit, tags, rerank, filters, includeForgotten } = req.query as {
      query?: string;
      limit?: string;
      tags?: string;
      rerank?: string;
      filters?: string;
      includeForgotten?: string;
    };

    if (!query) {
      res.status(400).json({ success: false, error: "query is required" });
      return;
    }

    try {
      const parsedTags = tags ? tags.split(",") : undefined;
      let parsedFilters: any;
      if (filters) {
        try {
          parsedFilters = JSON.parse(filters);
        } catch {
          res.status(400).json({ success: false, error: "Invalid filters JSON" });
          return;
        }
      }

      const result = await engine.execute("ltm_search", {
        query,
        limit: limit ? parseInt(limit, 10) : undefined,
        tags: parsedTags,
        rerank: rerank === "true",
        filters: parsedFilters,
        includeForgotten: includeForgotten === "true",
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.status(400).json({ success: false, error: result.error?.message || "Search operation failed" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // Delete memory
  router.delete("/memory/:id", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const { id } = req.params;
    const { reason, hard } = req.body as { reason?: string; hard?: boolean };

    if (!id) {
      res.status(400).json({ success: false, error: "id is required" });
      return;
    }

    try {
      const result = await engine.execute("ltm_delete", {
        id,
        reason,
        hard,
      });

      if (result.success) {
        res.json({ success: true, ...result.data as object });
      } else {
        res.status(400).json({ success: false, error: result.error?.message || "Delete operation failed" });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return router;
}
