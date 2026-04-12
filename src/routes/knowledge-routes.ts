import { Router } from "express";
import { createReadStream } from "fs";
import { requireAuth, requirePermission } from "../db/auth-middleware.js";
import { requestContext } from "../user/request-context.js";
import { getKnowledgeBase, getKBPageImageList, getKBPageImagePath } from "../skills/knowledge-skills.js";
import type { RouteDependencies } from "./index.js";
import type { ParsingUpdate } from "../services/parsing-queue.js";

export function createKnowledgeRoutes(deps: RouteDependencies): Router {
  const { engine } = deps;
  const router = Router();

  router.get("/knowledge/documents", requireAuth, requirePermission("knowledge.read"), async (req, res) => {
    try {
      const result = await engine.execute("kb_list", {
        query: req.query.q || undefined,
        tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        owner: req.user!.id,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post("/knowledge/ingest", requireAuth, requirePermission("knowledge.write"), async (req, res) => {
    try {
      const { name, content, path, tags } = req.body;
      if (!name || (!content && !path)) {
        res.status(400).json({ success: false, error: "name and (content or path) are required" });
        return;
      }

      const userId = req.user!.id;

      if (path && !content) {
        const kb = getKnowledgeBase(userId);
        const docId = await kb.createPlaceholder(name, { source: path, tags: tags || [] });
        res.json({ success: true, docId, chunkCount: 0, totalTokens: 0, parsing: true, message: `文档 "${name}" 已创建，正在后台解析...` });

        console.log(`[API] 创建占位符 docId: ${docId}`);
        requestContext.run({ userId }, () => {
          const kb = getKnowledgeBase(userId);
          console.log(`[API] 调用 kb_ingest 传入 _placeholderDocId: ${docId}`);
          engine.execute("kb_ingest", {
            name,
            path,
            tags: tags || [],
            owner: userId,
            skipEmbedding: true,
            _placeholderDocId: docId,
          }).then(async (result) => {
            if (result.success) {
              const resultDocId = (result.data as any).docId;
              if (resultDocId) {
                engine.execute("kb_vectorize", { docId: resultDocId, owner: userId }).catch(() => {});
              }
            } else {
              // 解析失败，标记占位文档为失败
              console.error(`[kb_ingest] Async ingest failed for placeholder ${docId}:`, (result as any).error);
              await kb.updateParsingStatus(docId, {
                parsingStatus: 'failed',
                parsingProgress: 0,
              });
            }
          }).catch(async (err) => {
            // 异常失败，标记占位文档为失败
            console.error(`[kb_ingest] Async ingest threw exception for placeholder ${docId}:`, err);
            await kb.updateParsingStatus(docId, {
              parsingStatus: 'failed',
              parsingProgress: 0,
            });
          });
        });
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
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get("/knowledge/search", requireAuth, requirePermission("knowledge.read"), async (req, res) => {
    try {
      const result = await engine.execute("kb_search", {
        query: String(req.query.q || ""),
        tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 10,
        owner: req.user!.id,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get("/knowledge/documents/:docId/content", requireAuth, requirePermission("knowledge.read"), (req, res) => {
    try {
      const kb = getKnowledgeBase(req.user!.id);
      const content = kb.getDocumentContent(req.params.docId as string);
      if (content === null) {
        res.status(404).json({ success: false, error: "文档不存在" });
      } else {
        res.json({ success: true, content });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get("/knowledge/documents/:docId/pages", requireAuth, requirePermission("knowledge.read"), (req, res) => {
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
  router.get("/knowledge/documents/:docId/layouts", requireAuth, requirePermission("knowledge.read"), async (req, res) => {
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
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.delete("/knowledge/documents/:docId", requireAuth, requirePermission("knowledge.write"), async (req, res) => {
    try {
      const result = await engine.execute("kb_delete", { docId: req.params.docId, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get("/knowledge/stats", requireAuth, requirePermission("knowledge.read"), async (req, res) => {
    try {
      const result = await engine.execute("kb_stats", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post("/knowledge/rebuild", requireAuth, requirePermission("knowledge.manage"), async (req, res) => {
    try {
      const result = await engine.execute("kb_rebuild", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post("/knowledge/share", requireAuth, requirePermission("knowledge.write"), async (req, res) => {
    try {
      const { docId, shared } = req.body;
      const result = await engine.execute("kb_share", { docId, shared: !!shared, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // SSE: 文档解析进度流
  router.get("/knowledge/documents/:docId/stream", requireAuth, requirePermission("knowledge.read"), (req, res) => {
    const owner = req.user!.id;
    const docId = String(req.params.docId);

    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 获取解析队列
    const { getParsingQueue } = require("../services/parsing-queue.js");
    const queue = getParsingQueue();

    if (!queue) {
      res.write(`data: ${JSON.stringify({ status: 'failed', error: '解析队列未初始化' })}\n\n`);
      res.end();
      return;
    }

    // 获取当前任务状态
    const task = queue.getTask(docId);
    if (!task || task.owner !== owner) {
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

  return router;
}
