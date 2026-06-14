import { Router } from "express";
import { createReadStream, existsSync } from "fs";
import { resolve, join } from "path";
import { cwd } from "process";
import { permissions } from "../permissions/index.js";
import { requestContext } from "../user/request-context.js";
import { getKnowledgeBase, getKBPageImageList, getKBPageImagePath } from "../skills/knowledge-skills.js";
import { createKBCollection, listKBCollections, deleteKBCollection } from "../services/kb-collection-service.js";
import type { RouteDependencies } from "./types.js";
import { log } from "../utils/logger.js";
import { getDb } from "../db/database.js";
import { ingestQueue } from "../utils/ingest-queue.js";

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
        collectionId: req.query.collectionId ? String(req.query.collectionId) : undefined,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
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
        const collectionId = req.body.collectionId ? String(req.body.collectionId) : undefined;
        const docId = await kb.createPlaceholder(name, { source: path, tags: tags || [], collectionId });
        log("info", "knowledge.placeholder_created", { docId, collectionId });
        res.json({ success: true, docId, chunkCount: 0, totalTokens: 0, parsing: true, message: `文档 "${name}" 已创建，正在后台解析...` });

        log("info", "knowledge.starting_ingest", { docId, collectionId });
        ingestQueue.enqueue(
          async () => {
            await requestContext.run({ userId }, async () => {
              const kb2 = getKnowledgeBase(userId);
              try {
                const result = await engine.execute("kb_ingest", {
                  name,
                  path,
                  tags: tags || [],
                  owner: userId,
                  skipEmbedding: true,
                  _placeholderDocId: docId,
                  collectionId,
                });
                if (result.success) {
                  const resultDocId = (result.data as any).docId;
                  if (resultDocId) {
                    // P1-21 修复: 解析成功 → 进度跳到 60% (解析完成, 正在向量化)
                    await kb2.updateParsingStatus(docId, { parsingProgress: 60 });
                    await engine.execute("kb_vectorize", { docId: resultDocId, owner: userId });
                    // 向量化完成 → 90%
                    await kb2.updateParsingStatus(docId, { parsingProgress: 90 });
                  }
                } else {
                  console.error(`[kb_ingest] Async ingest failed for placeholder ${docId}:`, (result as any).error);
                  await kb2.updateParsingStatus(docId, {
                    parsingStatus: 'failed',
                    parsingProgress: 0,
                  });
                }
              } catch (err) {
                // P1-21 修复: engine.execute 在 IngestQueue 5min 超时时 THROW (不是返回 success:false),
                // 之前的代码只检查 result.success, 异常会跳过 else 分支, 导致 DB 里
                // parsingStatus 永远停留在 5%. 现在用 try/catch 兜底, 一定更新状态.
                console.error(`[kb_ingest] Async ingest threw for placeholder ${docId}:`, err);
                try {
                  await kb2.updateParsingStatus(docId, {
                    parsingStatus: 'failed',
                    parsingProgress: 0,
                  });
                } catch (statusErr) {
                  console.error(`[kb_ingest] Failed to update parsing status to 'failed':`, statusErr);
                }
              }
            });
          },
          { id: `ingest_${docId}`, docId, userId, name }
        );
        return;
      }

      const params: Record<string, unknown> = {
        name,
        content,
        tags: tags || [],
        owner: userId,
        skipEmbedding: true,
        collectionId: req.body.collectionId ? String(req.body.collectionId) : undefined,
      };
      const result = await engine.execute("kb_ingest", params);
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });

      if (result.success && result.data) {
        const resultDocId = (result.data as any).docId as string;
        if (resultDocId) {
          ingestQueue.enqueue(
            async () => {
              await requestContext.run({ userId }, async () => {
                await engine.execute("kb_vectorize", { docId: resultDocId, owner: userId });
              });
            },
            { id: `vectorize_${resultDocId}`, docId: resultDocId, userId, name }
          );
        }
      }
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.get("/knowledge/search", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const result = await engine.execute("kb_search", {
        query: String(req.query.q || ""),
        tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 10,
        owner: req.user!.id,
        collectionId: req.query.collectionId ? String(req.query.collectionId) : undefined,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.get("/knowledge/documents/:docId/content", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const kb = getKnowledgeBase(req.user!.id);
      const content = await kb.getDocumentContent(req.params.docId as string);
      if (content === null) {
        res.status(404).json({ success: false, error: "文档不存在" });
      } else {
        res.json({ success: true, content });
      }
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
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
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.delete("/knowledge/documents/:docId", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const result = await engine.execute("kb_delete", { docId: req.params.docId, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // 更新文档分类
  router.put("/knowledge/documents/:docId", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const docId = req.params.docId;
      const { collectionId } = req.body;
      const owner = req.user!.id;

      const db = getDb();
      const result = db.prepare(
        "UPDATE kb_documents SET collection_id = ? WHERE doc_id = ? AND owner_id = ?"
      ).run(collectionId || null, docId, owner);

      if (result.changes === 0) {
        res.status(404).json({ success: false, error: "文档不存在或无权限" });
        return;
      }

      res.json({ success: true, data: { docId, collectionId: collectionId || null } });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.get("/knowledge/stats", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const result = await engine.execute("kb_stats", {
        owner: req.user!.id,
        collectionId: req.query.collectionId ? String(req.query.collectionId) : undefined,
      });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/knowledge/rebuild", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_MANAGE), async (req, res) => {
    try {
      const result = await engine.execute("kb_rebuild", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/knowledge/share", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const { docId, shared } = req.body;
      const scope = shared ? "all" : "none";
      const result = await engine.execute("kb_share", { docId, scope, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: "Operation failed" }) });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // SSE: 文档解析进度流 (Community Edition: Document Mind queue removed; DB fallback only)
  router.get("/knowledge/documents/:docId/stream", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    const owner = req.user!.id;
    const docId = String(req.params.docId);

    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const kb = getKnowledgeBase(owner);
      const dbStatus = await kb.getParsingStatus(docId);
      if (dbStatus) {
        const isDone = dbStatus.parsingStatus === 'success' || dbStatus.parsingStatus === 'failed';
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
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // === 知识库集合（Collection）路由 ===

  router.get("/knowledge/collections", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), async (req, res) => {
    try {
      const owner = req.user!.id;
      const collections = await listKBCollections(owner);
      res.json({ success: true, data: { collections, total: collections.length } });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/knowledge/collections", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        res.status(400).json({ success: false, error: "name is required" });
        return;
      }
      const owner = req.user!.id;
      const collection = await createKBCollection(owner, { name, description });
      res.json({ success: true, data: { collection } });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.delete("/knowledge/collections/:id", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_WRITE), async (req, res) => {
    try {
      const owner = req.user!.id;
      const id = req.params.id as string;
      await deleteKBCollection(id, owner);
      res.json({ success: true, data: { message: "集合已删除，文档已移回默认知识库" } });
    } catch (e: unknown) {
      console.error("[knowledge-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // 查询全局文档处理队列状态
  router.get("/knowledge/queue", pm.requireAuth, pm.requirePermission(permissions.constants.API.KNOWLEDGE_READ), (req, res) => {
    const status = ingestQueue.getStatus();
    // 只返回当前用户相关的任务
    const userId = req.user!.id;
    const userTasks = status.tasks.filter((t) => t.userId === userId);
    res.json({
      success: true,
      data: {
        ...status,
        tasks: userTasks,
        userPending: userTasks.filter((t) => t.status === "pending").length,
        userRunning: userTasks.filter((t) => t.status === "running").length,
      },
    });
  });

  return router;
}
