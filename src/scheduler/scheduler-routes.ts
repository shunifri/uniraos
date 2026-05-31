/**
 * Scheduler REST API Routes
 */

import { Router } from "express";
import { requireAuth } from "../permissions/middleware/auth-middleware.js";
import { getSchedulerService } from "./scheduler-service.js";

const router = Router();

/**
 * POST /api/schedule
 * 创建定时任务
 */
router.post("/schedule", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { type, triggerConfig, actionConfig, escalationConfig, source, sourceId } = req.body;

    if (!type || !triggerConfig || !actionConfig) {
      res.status(400).json({ success: false, error: "Missing required fields" });
      return;
    }

    const event = await getSchedulerService().createEvent({
      userId,
      type,
      triggerConfig,
      actionConfig,
      escalationConfig,
      source: source || "user",
      sourceId,
    });

    res.json({ success: true, data: event });
  } catch (error: unknown) {
    console.error("[scheduler-routes] error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /api/schedule
 * 列表查询
 */
router.get("/schedule", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const query = {
      userId,
      type: req.query.type as string,
      status: req.query.status as string,
      source: req.query.source as string,
      page: parseInt(req.query.page as string || "1", 10),
      pageSize: parseInt(req.query.pageSize as string || "20", 10),
    };

    const result = await getSchedulerService().listEvents(query);
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error("[scheduler-routes] error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /api/schedule/:id
 * 详情
 */
router.get("/schedule/:id", requireAuth, async (req, res) => {
  try {
    const event = await getSchedulerService().getEvent(req.params.id as string);
    if (!event) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    // 所有权校验：只能查看自己的定时任务
    if (event.userId !== req.user!.id) {
      res.status(403).json({ success: false, error: "无权访问此定时任务" });
      return;
    }
    res.json({ success: true, data: event });
  } catch (error: unknown) {
    console.error("[scheduler-routes] error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * DELETE /api/schedule/:id
 * 取消定时任务
 */
router.delete("/schedule/:id", requireAuth, async (req, res) => {
  try {
    const event = await getSchedulerService().getEvent(req.params.id as string);
    if (!event) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (event.userId !== req.user!.id) {
      res.status(403).json({ success: false, error: "无权取消此定时任务" });
      return;
    }
    const success = await getSchedulerService().cancelEvent(req.params.id as string);
    res.json({ success });
  } catch (error: unknown) {
    console.error("[scheduler-routes] error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /api/schedule/:id/cancel
 * 取消（兼容 DELETE）
 */
router.post("/schedule/:id/cancel", requireAuth, async (req, res) => {
  try {
    const event = await getSchedulerService().getEvent(req.params.id as string);
    if (!event) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (event.userId !== req.user!.id) {
      res.status(403).json({ success: false, error: "无权取消此定时任务" });
      return;
    }
    const success = await getSchedulerService().cancelEvent(req.params.id as string);
    res.json({ success });
  } catch (error: unknown) {
    console.error("[scheduler-routes] error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /api/schedule/:id/trigger
 * 手动触发（测试用）
 */
router.post("/schedule/:id/trigger", requireAuth, async (req, res) => {
  try {
    const event = await getSchedulerService().getEvent(req.params.id as string);
    if (!event) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (event.userId !== req.user!.id) {
      res.status(403).json({ success: false, error: "无权触发此定时任务" });
      return;
    }
    await getSchedulerService().triggerNow(req.params.id as string);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error("[scheduler-routes] error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
