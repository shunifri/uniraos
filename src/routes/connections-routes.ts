/**
 * Connection 配置中心 API 路由
 *
 * 管理 SMTP/LDAP/Kafka/MQTT 等外部系统的连接配置
 */

import { Router } from "express";
import { requireAuth } from "../permissions/middleware/auth-middleware.js";
import { getUserRoles } from "../db/user-repository.js";
import { getWorkflowRepository } from "../workflow/repository.js";
import type { Connection } from "../workflow/types.js";

/** 敏感键名正则 — 递归脱敏连接配置中的凭证 */
const SENSITIVE_KEY_RE = /^(password|passwd|pwd|secret|token|apikey|api_key|auth|cookie|privatekey|private_key|secretkey|secret_key|credential|credentials|certificate|cert|bindcredentials|bind_credentials|accesskey|access_key|accesskeysecret|access_key_secret)$/i;

/** 递归脱敏对象中的敏感字段 */
function sanitizeConfig(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeConfig);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(key) && typeof value === "string") {
      result[key] = "***";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeConfig(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const router = Router();

// 所有路由需要认证
router.use(requireAuth);

/** 列出连接配置 */
router.get("/", async (req, res) => {
  try {
    const type = req.query.type as string | undefined;
    const userId = (req as any).user?.id;
    const repo = getWorkflowRepository();
    const items = await repo.listConnections(type);
    // 只返回当前用户创建的连接（管理员可查看全部）
    const roles = await getUserRoles(userId);
    const isAdmin = roles.some((r) => r.name === "admin");
    const filtered = isAdmin ? items : items.filter((c) => c.createdBy === userId);
    // 不返回凭证，递归脱敏 config 中的敏感字段
    const safe = filtered.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      config: sanitizeConfig(c.config),
      isActive: c.isActive,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
    res.json({ success: true, data: safe });
  } catch (error) {
    console.error("[connections-routes] list error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** 获取单个连接配置 */
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = (req as any).user?.id;
    const repo = getWorkflowRepository();
    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }
    // 所有权校验：只能查看自己的连接（管理员除外）
    const roles = await getUserRoles(userId);
    const isAdmin = roles.some((r) => r.name === "admin");
    if (!isAdmin && conn.createdBy !== userId) {
      return res.status(403).json({ success: false, error: "无权查看此连接配置" });
    }
    res.json({
      success: true,
      data: {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        config: sanitizeConfig(conn.config),
        isActive: conn.isActive,
        createdBy: conn.createdBy,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      },
    });
  } catch (error) {
    console.error("[connections-routes] get error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** 创建连接配置 */
router.post("/", async (req, res) => {
  try {
    const body = req.body as Partial<Connection>;
    const userId = (req as any).user?.id || "anonymous";
    const repo = getWorkflowRepository();

    if (!body.name || !body.type || !body.config) {
      return res.status(400).json({ success: false, error: "name, type, config 为必填项" });
    }

    // 检查名称是否已存在
    const existing = (await repo.listConnections()).find((c) => c.name === body.name);
    if (existing) {
      return res.status(409).json({ success: false, error: `连接名称已存在: ${body.name}` });
    }

    const conn = await repo.createConnection({
      name: body.name,
      type: body.type,
      config: body.config,
      credentials: body.credentials,
      isActive: body.isActive ?? true,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      data: {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        config: sanitizeConfig(conn.config),
        isActive: conn.isActive,
      },
    });
  } catch (error) {
    console.error("[connections-routes] create error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** 更新连接配置 */
router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = (req as any).user?.id;
    const body = req.body as Partial<Connection>;
    const repo = getWorkflowRepository();

    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }
    // 所有权校验：只能修改自己的连接（管理员除外）
    const roles = await getUserRoles(userId);
    const isAdmin = roles.some((r) => r.name === "admin");
    if (!isAdmin && conn.createdBy !== userId) {
      return res.status(403).json({ success: false, error: "无权修改此连接配置" });
    }

    await repo.updateConnection(id, {
      name: body.name,
      config: body.config,
      credentials: body.credentials,
      isActive: body.isActive,
    });

    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error("[connections-routes] update error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** 删除连接配置 */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = (req as any).user?.id;
    const repo = getWorkflowRepository();

    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }
    // 所有权校验：只能删除自己的连接（管理员除外）
    const roles = await getUserRoles(userId);
    const isAdmin = roles.some((r) => r.name === "admin");
    if (!isAdmin && conn.createdBy !== userId) {
      return res.status(403).json({ success: false, error: "无权删除此连接配置" });
    }

    await repo.deleteConnection(id);
    res.json({ success: true });
  } catch (error) {
    console.error("[connections-routes] delete error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** 测试连接 */
router.post("/:id/test", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = (req as any).user?.id;
    const repo = getWorkflowRepository();

    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }
    // 所有权校验：只能测试自己的连接（管理员除外）
    const roles = await getUserRoles(userId);
    const isAdmin = roles.some((r) => r.name === "admin");
    if (!isAdmin && conn.createdBy !== userId) {
      return res.status(403).json({ success: false, error: "无权测试此连接配置" });
    }

    // 简化测试：根据类型执行不同的测试逻辑
    let testResult = { success: false, message: "未实现该类型的连接测试" };

    if (conn.type === "smtp") {
      try {
        const nodemailer = await import("nodemailer") as any;
        const cfg = conn.config as { host: string; port: number; secure: boolean; user: string; pass: string };
        const transporter = nodemailer.createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          auth: { user: cfg.user, pass: cfg.pass },
        });
        await transporter.verify();
        testResult = { success: true, message: "SMTP 连接测试成功" };
      } catch (e) {
        console.error("[connections-routes] SMTP test failed:", e);
        testResult = { success: false, message: "SMTP 连接测试失败" };
      }
    } else if (conn.type === "ldap") {
      try {
        const ldap = await import("ldapjs") as any;
        const cfg = conn.config as { url: string; bindDN: string; bindCredentials: string };
        const client = ldap.createClient({ url: cfg.url });
        await new Promise<void>((resolve, reject) => {
          client.bind(cfg.bindDN, cfg.bindCredentials, (err: unknown) => {
            if (err) reject(err);
            else resolve();
          });
        });
        client.unbind();
        testResult = { success: true, message: "LDAP 连接测试成功" };
      } catch (e) {
        console.error("[connections-routes] LDAP test failed:", e);
        testResult = { success: false, message: "LDAP 连接测试失败" };
      }
    }

    res.json({ success: true, data: testResult });
  } catch (error) {
    console.error("[connections-routes] test error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
