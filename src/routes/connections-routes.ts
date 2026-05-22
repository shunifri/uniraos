/**
 * Connection 配置中心 API 路由
 *
 * 管理 SMTP/LDAP/Kafka/MQTT 等外部系统的连接配置
 */

import { Router } from "express";
import { requireAuth } from "../permissions/middleware/auth-middleware.js";
import { getWorkflowRepository } from "../workflow/repository.js";
import type { Connection } from "../workflow/types.js";

const router = Router();

// 所有路由需要认证
router.use(requireAuth);

/** 列出连接配置 */
router.get("/", async (_req, res) => {
  try {
    const type = _req.query.type as string | undefined;
    const repo = getWorkflowRepository();
    const items = await repo.listConnections(type);
    // 不返回凭证
    const safe = items.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      config: c.config,
      isActive: c.isActive,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
    res.json({ success: true, data: safe });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/** 获取单个连接配置 */
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const repo = getWorkflowRepository();
    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }
    res.json({
      success: true,
      data: {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        config: conn.config,
        isActive: conn.isActive,
        createdBy: conn.createdBy,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
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
        config: conn.config,
        isActive: conn.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/** 更新连接配置 */
router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body as Partial<Connection>;
    const repo = getWorkflowRepository();

    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }

    await repo.updateConnection(id, {
      name: body.name,
      config: body.config,
      credentials: body.credentials,
      isActive: body.isActive,
    });

    res.json({ success: true, data: { id } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/** 删除连接配置 */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const repo = getWorkflowRepository();

    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
    }

    await repo.deleteConnection(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/** 测试连接 */
router.post("/:id/test", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const repo = getWorkflowRepository();

    const conn = await repo.getConnectionById(id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "连接配置不存在" });
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
        testResult = { success: false, message: `SMTP 连接测试失败: ${e instanceof Error ? (e as Error).message : String(e)}` };
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
        testResult = { success: false, message: `LDAP 连接测试失败: ${e instanceof Error ? (e as Error).message : String(e)}` };
      }
    }

    res.json({ success: true, data: testResult });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
