import { Router } from "express";
import { createReadStream } from "fs";
import { requireAuth } from "../db/auth-middleware.js";
import { requestContext } from "../user/request-context.js";
import { getKnowledgeBase, getKBPageImageList, getKBPageImagePath } from "../skills/knowledge-skills.js";
import type { RouteDependencies } from "./index.js";

export function createKnowledgeRoutes(deps: RouteDependencies): Router {
  const { engine } = deps;
  const router = Router();

  router.get("/knowledge/documents", requireAuth, async (req, res) => {
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

  router.post("/knowledge/ingest", requireAuth, async (req, res) => {
    try {
      const { name, content, path, tags } = req.body;
      if (!name || (!content && !path)) {
        res.status(400).json({ success: false, error: "name and (content or path) are required" });
        return;
      }

      const userId = req.user!.id;

      if (path && !content) {
        const kb = getKnowledgeBase(userId);
        const docId = kb.createPlaceholder(name, { source: path, tags: tags || [] });
        res.json({ success: true, docId, chunkCount: 0, totalTokens: 0, parsing: true, message: `文档 "${name}" 已创建，正在后台解析...` });

        requestContext.run({ userId }, () => {
          engine.execute("kb_ingest", {
            name,
            path,
            tags: tags || [],
            owner: userId,
            skipEmbedding: true,
          }).then((result) => {
            if (result.success) {
              const docId = (result.data as any).docId;
              if (docId) {
                engine.execute("kb_vectorize", { docId, owner: userId }).catch(() => {});
              }
            }
          }).catch(() => {});
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

  router.get("/knowledge/search", requireAuth, async (req, res) => {
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

  router.get("/knowledge/documents/:docId/content", requireAuth, (req, res) => {
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

  router.get("/knowledge/documents/:docId/pages", requireAuth, (req, res) => {
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

  router.delete("/knowledge/documents/:docId", requireAuth, async (req, res) => {
    try {
      const result = await engine.execute("kb_delete", { docId: req.params.docId, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get("/knowledge/stats", requireAuth, async (req, res) => {
    try {
      const result = await engine.execute("kb_stats", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post("/knowledge/rebuild", requireAuth, async (req, res) => {
    try {
      const result = await engine.execute("kb_rebuild", { owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post("/knowledge/share", requireAuth, async (req, res) => {
    try {
      const { docId, shared } = req.body;
      const result = await engine.execute("kb_share", { docId, shared: !!shared, owner: req.user!.id });
      res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
