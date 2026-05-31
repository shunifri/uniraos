/**
 * Inbox REST API Routes
 */

import { Router } from "express";
import { requireAuth } from "../permissions/middleware/auth-middleware.js";
import { getInboxService } from "./inbox-service.js";
import { inboxEventBus } from "./inbox-events.js";

const router = Router();

/**
 * GET /api/inbox
 * 列表查询（支持过滤、分页）
 */
router.get("/inbox", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const query = {
      userId,
      type: req.query.type as string,
      category: req.query.category as string,
      status: req.query.status as string,
      priority: req.query.priority as string,
      source: req.query.source as string,
      page: parseInt(req.query.page as string || "1", 10),
      pageSize: parseInt(req.query.pageSize as string || "20", 10),
      sortBy: (req.query.sortBy as string) || "created_at",
      sortOrder: (req.query.sortOrder as string) === "asc" ? "asc" : "desc",
    };

    const result = await getInboxService().listItems(query);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/inbox/stats
 * 统计信息
 */
router.get("/inbox/stats", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const stats = await getInboxService().getStats(userId);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/inbox/unread-count
 * 未读数
 */
router.get("/inbox/unread-count", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const count = await getInboxService().getUnreadCount(userId);
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/inbox/stream
 * SSE 实时推送 inbox 事件
 * ⚠️ 必须放在 /inbox/:id 之前，否则 "stream" 会被当成动态参数 id 匹配
 */
router.get("/inbox/stream", requireAuth, (req, res) => {
  const userId = req.user!.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  let closed = false;
  res.on("close", () => { closed = true; });

  const handler = (event: any) => {
    if (closed) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // 监听该用户的事件
  inboxEventBus.on(`inbox_event:${userId}`, handler);

  // 心跳保活（20s 间隔，与前端超时检测对齐，避免被中间代理断开）
  const heartbeat = setInterval(() => {
    if (closed) {
      clearInterval(heartbeat);
      return;
    }
    res.write(`event: heartbeat\ndata: {}\n\n`);
  }, 20000);

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    inboxEventBus.off(`inbox_event:${userId}`, handler);
  });
});

/**
 * GET /api/inbox/:id
 * 详情
 */
router.get("/inbox/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const item = await getInboxService().getItem(req.params.id as string);
    if (!item) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    // 所有权检查：只能查看自己的 inbox item
    if (item.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/inbox/:id/read
 * 标记已读
 */
router.post("/inbox/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const item = await getInboxService().getItem(req.params.id as string);
    if (!item) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (item.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    await getInboxService().markAsRead(req.params.id as string);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/inbox/:id/complete
 * 完成/处理
 */
router.post("/inbox/:id/complete", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const item = await getInboxService().getItem(req.params.id as string);
    if (!item) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (item.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    const result = await getInboxService().completeItem(req.params.id as string, req.body);
    if (!result) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/inbox/:id/dismiss
 * 忽略
 */
router.post("/inbox/:id/dismiss", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const item = await getInboxService().getItem(req.params.id as string);
    if (!item) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (item.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    await getInboxService().dismissItem(req.params.id as string);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
