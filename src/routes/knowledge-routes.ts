import { Router } from "express";
import { createReadStream, existsSync } from "fs";
import { resolve, join } from "path";
import { cwd } from "process";
import { permissions } from "../permissions/index.js";
import { requestContext } from "../user/request-context.js";
import { getKnowledgeBase, getKBPageImageList, getKBPageImagePath } from "../skills/knowledge-skills.js";
import type { RouteDependencies } from "./types.js";
import type { ParsingUpdate } from "../services/parsing-queue.js";
import { getParsingQueue } from "../services/parsing-queue.js";
import { log } from "../utils/logger.js";

export function createKnowledgeRoutes(deps: RouteDependencies): Router {
  const { engine } = deps;
  const router = Router();

  // 创建权限中间件实例 - 延迟到函数内部创建
  const pm = permissions.createMiddleware(permissions.service);

  router.get("/knowledge/documents", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const result = await engine.execute("kb_list", {
        query: req.query.q || undefined,
        tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        owner: req.user!.id,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.post("/knowledge/ingest", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const { name, content, path, tags } = req.body;
      if (!name || (!content && !path)) {
        res.status(400).json({ success: false, error: "name and (content or path) are required" });
        return;
      }

      const userId = req.user!.id;

      if (path && !content) {
        log("info", "knowledge.path_mode", { name, path });

        const kb = getKnowledgeBase(userId);
        const docId = await kb.createPlaceholder(name, { source: path, tags: tags || [] });
        log("info", "knowledge.placeholder_created", { docId });
        res.json({ success: true, docId, chunkCount: 0, totalTokens: 0, parsing: true, message: `文档 "${name}" 已创建，正在后台解析...` });

        log("info", "knowledge.starting_ingest", { docId });
        try {
          void requestContext.run({ userId }, async () => {
            console.log(`[API] requestContext.run 回调已执行`);
            try {
              const kb2 = getKnowledgeBase(userId);
              console.log(`[API] 调用 kb_ingest 传入 _placeholderDocId: ${docId}`);
              const result = await engine.execute("kb_ingest", {
                name,
                path,
                tags: tags || [],
                owner: userId,
                skipEmbedding: true,
                _placeholderDocId: docId,
              });
              console.log(`[API] kb_ingest 执行结果:`, JSON.stringify(result));
              if (result.success) {
                const resultDocId = (result.data as any).docId;
                if (resultDocId) {
                  engine.execute("kb_vectorize", { docId: resultDocId, owner: userId }).catch(() => {});
                }
              } else {
                // 解析失败，标记占位文档为失败
                console.error(`[kb_ingest] Async ingest failed for placeholder ${docId}:`, (result as any).error);
                await kb2.updateParsingStatus(docId, {
                  parsingStatus: 'failed',
                  parsingProgress: 0,
                });
              }
            } catch (err) {
              // 异常失败，标记占位文档为失败
              console.error(`[kb_ingest] Async ingest threw exception for placeholder ${docId}:`, err);
              try {
                const kb2 = getKnowledgeBase(userId);
                await kb2.updateParsingStatus(docId, {
                  parsingStatus: 'failed',
                  parsingProgress: 0,
                });
              } catch (updateErr) {
                console.error(`[kb_ingest] Failed to update parsing status:`, updateErr);
              }
            }
          });
        } catch (ctxErr) {
          console.error(`[API] requestContext.run 异常:`, ctxErr);
        }
        return;
      }

      const params: Record<string, unknown> = {
        name,
        content,
        tags: tags || [],
        owner: userId,
        skipEmbedding: true,
      };
      const result = await engine.execute("kb_ingest", params);
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });

      if (result.success && result.data) {
        const docId = (result.data as any).docId;
        if (docId) {
          requestContext.run({ userId }, () => {
            engine.execute("kb_vectorize", { docId, owner: userId }).catch(() => {});
          });
        }
      }
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get("/knowledge/search", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const result = await engine.execute("kb_search", {
        query: String(req.query.q || ""),
        tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 10,
        owner: req.user!.id,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get("/knowledge/documents/:docId/content", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), (req, res) => {
    try {
      const kb = getKnowledgeBase(req.user!.id);
      const content = kb.getDocumentContent(req.params.docId as string);
      if (content === null) {
        res.status(404).json({ success: false, error: "文档不存在" });
      } else {
        res.json({ success: true, content });
      }
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get("/knowledge/documents/:docId/pages", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), (req, res) => {
    const owner = req.user!.id;
    const docId = String(req.params.docId);
    const page = req.query.page ? String(req.query.page) : undefined;

    if (page) {
      const imgPath = getKBPageImagePath(owner, docId, Number(page));
      if (!imgPath) {
        res.status(404).json({ success: false, error: "page not found" });
        return;
      }
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      createReadStream(imgPath).pipe(res);
      return;
    }

    const pages = getKBPageImageList(owner, docId);
    res.json({ success: true, pages });
  });

  // GET /api/knowledge/documents/:docId/layouts — Get document layouts and media items
  router.get("/knowledge/documents/:docId/layouts", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const owner = req.user!.id;
      const docId = String(req.params.docId);
      const kb = getKnowledgeBase(owner);

      // Get document data using existing KB methods
      const layouts = await kb.getLayouts(docId);
      const segments = await kb.getSegments(docId);
      const parsingStatus = await kb.getParsingStatus(docId);

      // Check if document exists (getParsingStatus returns null if not found)
      if (!parsingStatus) {
        res.status(404).json({ success: false, error: "Document not found" });
        return;
      }

      // Return basic layout info from document metadata
      const mediaItems = { images: [], tables: [] };
      const mediaType = parsingStatus.mediaType || 'document';
      const pageCount = layouts.length || 0;

      res.json({
        success: true,
        layouts,
        mediaItems,
        mediaType,
        pageCount,
      });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.delete("/knowledge/documents/:docId", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const result = await engine.execute("kb_delete", { docId: req.params.docId, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get("/knowledge/stats", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const result = await engine.execute("kb_stats", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.post("/knowledge/rebuild", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_MANAGE), async (req, res) => {
    try {
      const result = await engine.execute("kb_rebuild", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.post("/knowledge/share", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const { docId, shared } = req.body;
      const scope = shared ? "all" : "none";
      const result = await engine.execute("kb_share", { docId, scope, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  // SSE: 文档解析进度流
  router.get("/knowledge/documents/:docId/stream", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    const owner = req.user!.id;
    const docId = String(req.params.docId);

    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 获取解析队列
    const queue = getParsingQueue();

    if (!queue) {
      res.write(`data: ${JSON.stringify({ status: 'failed', error: '解析队列未初始化' })}\n\n`);
      res.end();
      return;
    }

    // 获取当前任务状态
    const task = queue.getTask(docId);
    if (!task || task.owner !== owner) {
      // 内存队列中无任务（可能因服务器重启丢失），查询数据库 fallback
      try {
        const kb = getKnowledgeBase(owner);
        const dbStatus = await kb.getParsingStatus(docId);
        if (dbStatus) {
          const isDone = dbStatus.parsingStatus === 'success' || dbStatus.parsingStatus === 'failed';
          // 如果任务仍在 processing 但队列已丢失（服务重启后无法恢复），标记为失败
          const fallbackStatus = isDone ? dbStatus.parsingStatus : 'failed';
          const fallbackError = isDone
            ? (dbStatus.parsingStatus === 'failed' ? '解析失败' : undefined)
            : '解析任务已丢失（可能因服务重启），请刷新页面查看最新状态';
          res.write(`data: ${JSON.stringify({
            docId,
            status: fallbackStatus,
            progress: dbStatus.parsingProgress,
            processedSegments: 0,
            totalSegments: 0,
            canPreview: isDone,
            canSearch: isDone,
            error: fallbackError,
          })}\n\n`);
          res.end();
          return;
        }
      } catch (e: unknown) {
        console.warn(`[SSE] Failed to fetch parsing status fallback for ${docId}:`, (e as Error).message);
      }
      res.write(`data: ${JSON.stringify({ status: 'failed', error: '任务不存在' })}\n\n`);
      res.end();
      return;
    }

    // 订阅进度更新
    const unsubscribe = queue.subscribe(docId, (update: ParsingUpdate) => {
      res.write(`data: ${JSON.stringify(update)}\n\n`);

      // 如果任务完成或失败，关闭连接并取消订阅
      if (update.status === 'success' || update.status === 'failed') {
        unsubscribe(); // 立即取消订阅防止内存泄漏
        res.end();
      }
    });

    // 客户端断开时取消订阅（防止连接提前关闭导致的内存泄漏）
    req.on('close', () => {
      unsubscribe();
    });

    // 发送初始状态
    res.write(`data: ${JSON.stringify({
      docId,
      status: task.status,
      progress: task.progress,
      processedSegments: task.processedSegments,
      totalSegments: task.totalSegments,
      canPreview: task.processedSegments > 0,
      canSearch: task.processedSegments > 0,
    })}\n\n`);
  });

  // 获取文档内嵌图片
  router.get("/knowledge/documents/:docId/images/:imageId", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const owner = req.user!.id;
      const docId = req.params.docId as string;
      const imageId = req.params.imageId as string;
      const kb = getKnowledgeBase(owner);

      // 验证文档存在且属于当前用户
      const docs = await kb.listDocuments({ limit: 1000 });
      const doc = docs.find((d) => d.docId === docId);
      if (!doc) {
        res.status(404).json({ success: false, error: "文档不存在或无权访问" });
        return;
      }

      // 查找图片文件（支持多种扩展名）
      const imageDir = resolve(cwd(), ".raos", "knowledge", owner, "doc-images", docId);
      const exts = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
      let imagePath: string | null = null;
      let mimeType = "image/png";

      for (const ext of exts) {
        const candidate = join(imageDir, `${imageId}.${ext}`);
        if (existsSync(candidate)) {
          imagePath = candidate;
          mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          break;
        }
      }

      if (!imagePath) {
        res.status(404).json({ success: false, error: "图片不存在" });
        return;
      }

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      createReadStream(imagePath).pipe(res);
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  return router;
}
