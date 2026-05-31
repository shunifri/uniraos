/**
 * App 路由 — 提供应用设计（app_designs）的查询接口
 * 用于第三方 widget 嵌入场景：根据 appId 获取应用包含的 skills
 * 以及获取 anonymous 角色的 skill 白名单
 */

import { Router } from "express";
import { getDb, isMySQL } from "../db/database.js";
import { getMySQLAdapter } from "../db/mysql-adapter.js";
import { requireAuth, requirePermission } from "../permissions/middleware/auth-middleware.js";
import { permissions } from "../permissions/index.js";
import type { RouteDependencies } from "./types.js";

export function createAppRoutes(deps: RouteDependencies): Router {
  const router = Router();
  const pm = permissions.createMiddleware(permissions.service);

  /**
   * GET /api/apps/:appId
   * 返回应用设计详情，包括 components 中的 skills 列表
   */
  router.get("/apps/:appId", pm.requireAuth, async (req, res) => {
    try {
      const appId = req.params.appId;
      const userId = req.user!.id;

      let row: any;
      if (isMySQL()) {
        const adapter = getMySQLAdapter();
        const rows = await adapter.query("SELECT * FROM app_designs WHERE id = ?", [appId]);
        row = rows[0];
      } else {
        const db = getDb();
        row = db.prepare("SELECT * FROM app_designs WHERE id = ?").get(appId);
      }

      if (!row) {
        res.status(404).json({ success: false, error: "应用不存在" });
        return;
      }

      // 权限校验：已发布的应用允许任何人访问（嵌入场景），未发布的仅限所有者
      if (row.status !== "applied" && row.owner_id !== userId) {
        res.status(403).json({ success: false, error: "无权访问此应用" });
        return;
      }

      const designJson = typeof row.design_json === "string" ? JSON.parse(row.design_json) : row.design_json;
      const components = typeof row.components === "string" ? JSON.parse(row.components) : row.components ?? [];

      // 提取各类型组件列表（应用部署后生成的组件）
      const typedComponents = components as Array<{ type: string; key: string; name: string; status: string }>;
      const skills = typedComponents
        .filter((c) => c.type === "skill" && c.status === "created")
        .map((c) => ({ key: c.key, name: c.name }));
      const forms = typedComponents
        .filter((c) => c.type === "form" && c.status === "created")
        .map((c) => ({ key: c.key, name: c.name }));
      const workflows = typedComponents
        .filter((c) => c.type === "workflow" && c.status === "created")
        .map((c) => ({ key: c.key, name: c.name }));

      res.json({
        success: true,
        data: {
          id: row.id,
          name: row.name,
          description: row.description || "",
          version: row.version || 1,
          status: row.status,
          design: designJson,
          skills,
          forms,
          workflows,
        },
      });
    } catch (e: unknown) {
      console.error("[app-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  /**
   * DELETE /api/apps/:appId
   * 级联删除应用及其关联组件（表单/工作流/技能/知识库）
   */
  router.delete("/apps/:appId", pm.requireAuth, async (req, res) => {
    try {
      const appId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
      const userId = req.user!.id;

      let row: any;
      if (isMySQL()) {
        const adapter = getMySQLAdapter();
        const rows = await adapter.query("SELECT * FROM app_designs WHERE id = ?", [appId]);
        row = rows[0];
      } else {
        const db = getDb();
        row = db.prepare("SELECT * FROM app_designs WHERE id = ?").get(appId);
      }

      if (!row) {
        res.status(404).json({ success: false, error: "应用不存在" });
        return;
      }

      if (row.owner_id !== userId) {
        res.status(403).json({ success: false, error: "无权删除此应用" });
        return;
      }

      // 调用 AppDesignerService 执行级联删除
      const { AppDesignerService } = await import("../skills/app-designer-skill.js");
      const service = new AppDesignerService();
      const { deleted, errors } = await service.deleteDesign(appId, userId);

      res.json({
        success: true,
        data: { appId, deleted, errors, message: `应用已删除，级联清理 ${deleted.length} 个组件` },
      });
    } catch (e: unknown) {
      console.error("[app-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  /**
   * GET /api/permissions/anonymous-skills
   * 公开接口：返回 anonymous 角色的 skill 执行权限列表
   * 用于 widget 嵌入场景，让匿名用户也能使用基础 skills
   */
  router.get("/permissions/anonymous-skills", async (req, res) => {
    try {
      let rows: any[] = [];
      if (isMySQL()) {
        const adapter = getMySQLAdapter();
        rows = await adapter.query(
          `SELECT p.name
           FROM permissions p
           JOIN role_permissions rp ON rp.permission_id = p.id
           JOIN roles r ON r.id = rp.role_id
           WHERE r.name = 'anonymous' AND p.name LIKE 'skill:%.execute'`,
          []
        );
      } else {
        const db = getDb();
        rows = db.prepare(
          `SELECT p.name
           FROM permissions p
           JOIN role_permissions rp ON rp.permission_id = p.id
           JOIN roles r ON r.id = rp.role_id
           WHERE r.name = 'anonymous' AND p.name LIKE 'skill:%.execute'`
        ).all() as any[];
      }

      const skills = rows
        .map((r) => r.name)
        .filter((name: string) => name.startsWith("skill:") && name.endsWith(".execute"))
        .map((name: string) => name.slice(6, -8)); // 去掉前缀 skill: 和后缀 .execute

      res.json({ success: true, data: { skills } });
    } catch (e: unknown) {
      console.error("[app-routes] error:", e);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  return router;
}
