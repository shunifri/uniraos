import type { WorkflowInstance, WorkflowTask } from "./types.js";
import { getInboxService } from "../inbox/index.js";
import { getWorkflowRepository } from "./repository.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";

export interface ServiceContext {
  instance: WorkflowInstance;
  task?: WorkflowTask;
  config: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export type ServiceHandler = (context: ServiceContext) => Promise<unknown>;

export class ServiceTaskRegistry {
  private handlers = new Map<string, ServiceHandler>();

  register(name: string, handler: ServiceHandler): void {
    this.handlers.set(name, handler);
  }

  get(name: string): ServiceHandler | undefined {
    return this.handlers.get(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}

// ===== echo: 简单回显（用于测试和调试） =====
export async function echoHandler(context: ServiceContext): Promise<unknown> {
  return { echoed: context.config, variables: context.variables };
}

// ===== notify: 向用户 inbox 发送通知 =====
export async function notifyHandler(context: ServiceContext): Promise<unknown> {
  const { userId, title, content, category = "system" } = context.config as {
    userId?: string;
    title: string;
    content: string;
    category?: string;
  };

  const targetUserId = userId || context.instance.starter || "default";
  if (!title || !content) {
    throw new Error("notify requires title and content");
  }

  const item = await getInboxService().createItem({
    userId: targetUserId,
    type: "notification",
    category: "system_alert",
    title,
    description: content,
    source: "workflow",
    sourceId: String(context.task?.id ?? ""),
    payload: { resultData: context.variables },
  });

  return { sent: true, itemId: item.id, userId: targetUserId };
}

// ===== http_request: HTTP 调用 =====
export async function httpRequestHandler(context: ServiceContext): Promise<unknown> {
  const {
    url,
    method = "GET",
    headers = {},
    body,
    timeout = 30000,
  } = context.config as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    timeout?: number;
  };

  if (!url || typeof url !== "string") {
    throw new Error("http_request requires a valid url");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchBody =
      body !== undefined
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined;

    const response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseBody}`);
    }

    try {
      return JSON.parse(responseBody);
    } catch {
      return { status: response.status, body: responseBody };
    }
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ===== email_notification: 发送邮件 =====
export async function emailNotificationHandler(context: ServiceContext): Promise<unknown> {
  const {
    connection,
    to,
    subject,
    body,
    html = false,
    cc,
  } = context.config as {
    connection?: string;
    to?: string;
    subject?: string;
    body?: string;
    html?: boolean;
    cc?: string;
  };

  if (!to || !subject || !body) {
    throw new Error("email_notification requires to, subject, and body");
  }

  // 如果没有指定 connection，尝试使用默认 SMTP 配置
  let connName = connection;
  if (!connName) {
    const repo = getWorkflowRepository();
    const conns = await repo.listConnections("smtp");
    if (conns.length === 0) {
      throw new Error("没有可用的 SMTP 连接配置，请指定 connection 参数");
    }
    connName = conns[0].name;
  }

  const repo = getWorkflowRepository();
  const conn = await repo.getConnectionByName(connName);
  if (!conn || conn.type !== "smtp") {
    throw new Error(`SMTP 连接配置不存在或类型错误: ${connName}`);
  }

  const cfg = conn.config as { host: string; port: number; secure: boolean; user: string; pass: string };

  try {
    const nodemailer = await import("nodemailer") as any;
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });

    const toList = to.split(",").map((s) => s.trim());
    const ccList = cc ? cc.split(",").map((s) => s.trim()) : undefined;

    const info = await transporter.sendMail({
      from: cfg.user,
      to: toList,
      cc: ccList,
      subject,
      text: html ? undefined : body,
      html: html ? body : undefined,
    });

    return { sent: true, messageId: info.messageId, to: toList };
  } catch (err) {
    throw new Error(`邮件发送失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ===== im_bot_send: 发送 IM 机器人消息 =====
export async function imBotSendHandler(context: ServiceContext): Promise<unknown> {
  const {
    connection,
    content,
    msgType = "text",
    at,
  } = context.config as {
    connection?: string;
    content?: string;
    msgType?: string;
    at?: string;
  };

  if (!content) {
    throw new Error("im_bot_send requires content");
  }

  let connName = connection;
  if (!connName) {
    const repo = getWorkflowRepository();
    const conns = await repo.listConnections();
    const imConn = conns.find((c) => c.type === "dingtalk" || c.type === "wecom" || c.type === "lark");
    if (!imConn) {
      throw new Error("没有可用的 IM 连接配置，请指定 connection 参数");
    }
    connName = imConn.name;
  }

  const repo = getWorkflowRepository();
  const conn = await repo.getConnectionByName(connName);
  if (!conn) {
    throw new Error(`IM 连接配置不存在: ${connName}`);
  }

  const cfg = conn.config as { platform: string; webhook: string; secret?: string };
  const atList = at ? at.split(",").map((s) => s.trim()) : [];

  let body: unknown;
  let headers: Record<string, string> = { "Content-Type": "application/json" };

  if (cfg.platform === "dingtalk") {
    if (msgType === "markdown") {
      body = { msgtype: "markdown", markdown: { title: content.slice(0, 20), text: content } };
    } else {
      body = { msgtype: "text", text: { content } };
    }
    if (atList.length > 0) {
      (body as Record<string, unknown>).at = { atMobiles: atList };
    }
  } else if (cfg.platform === "wecom") {
    if (msgType === "markdown") {
      body = { msgtype: "markdown", markdown: { content } };
    } else {
      body = { msgtype: "text", text: { content, mentioned_mobile_list: atList } };
    }
  } else if (cfg.platform === "lark" || cfg.platform === "feishu") {
    body = { msg_type: msgType === "markdown" ? "interactive" : "text", content: { text: content } };
  } else {
    throw new Error(`不支持的 IM 平台: ${cfg.platform}`);
  }

  const response = await fetchWithTimeout(cfg.webhook, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    retries: 1,
  });

  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || result.errcode || result.code) {
    throw new Error(`IM 发送失败: ${JSON.stringify(result)}`);
  }

  return { sent: true, platform: cfg.platform };
}

export const defaultRegistry = new ServiceTaskRegistry();
defaultRegistry.register("notify", notifyHandler);
defaultRegistry.register("http_request", httpRequestHandler);
defaultRegistry.register("email_notification", emailNotificationHandler);
defaultRegistry.register("im_bot_send", imBotSendHandler);
// 保留 echo 别名用于向后兼容
defaultRegistry.register("echo", echoHandler);
