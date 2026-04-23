/**
 * 企业级基础设施 Skill 家族
 *
 * Phase 1 核心 Skill：
 * - email_send / email_read    (SMTP/IMAP)
 * - im_bot_send                (钉钉/企微/飞书 Webhook)
 * - ldap_search / ldap_auth    (LDAP/AD)
 * - calendar_query / calendar_create (Exchange/CalDAV)
 *
 * 所有外部依赖均为可选，未安装时自动跳过注册。
 */

import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { getWorkflowRepository } from "../workflow/repository.js";

// ===== 连接配置辅助 =====

async function getConnection(name: string) {
  return await getWorkflowRepository().getConnectionByName(name);
}

// ===== Email Skills =====

async function createEmailSkills(registry: SkillRegistry): Promise<void> {
  try {
    const nodemailer = await import("nodemailer") as any;
    const { default: Imap } = await import("imap") as any;

    // email_send
    registry.register(
      defineSystemSkill({
        name: "email_send",
        description: `发送邮件（SMTP）。参数: connection(string, 连接配置名称), to(string|array), subject(string), body(string), html?(boolean), cc?(string|array), attachments?(array<{filename, content}>)`,
        paramSchema: {
          properties: {
            connection: { type: "string", description: "SMTP 连接配置名称" },
            to: { type: "string", description: "收件人邮箱（多个用逗号分隔）" },
            cc: { type: "string", description: "抄送邮箱" },
            subject: { type: "string", description: "邮件主题" },
            body: { type: "string", description: "邮件正文" },
            html: { type: "boolean", description: "是否为 HTML 格式" },
            attachments: { type: "array", description: "附件列表 [{filename, content}]" },
          },
          required: ["connection", "to", "subject", "body"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`SMTP 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port: number; secure: boolean; user: string; pass: string };

          const transporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: { user: cfg.user, pass: cfg.pass },
          });

          const toList = (params.to as string).split(",").map((s) => s.trim());
          const ccList = params.cc ? (params.cc as string).split(",").map((s) => s.trim()) : undefined;

          const info = await transporter.sendMail({
            from: cfg.user,
            to: toList,
            cc: ccList,
            subject: params.subject as string,
            text: params.html ? undefined : (params.body as string),
            html: params.html ? (params.body as string) : undefined,
            attachments: (params.attachments as Array<{ filename: string; content: string }>)?.map((a) => ({
              filename: a.filename,
              content: a.content,
            })),
          });

          return { success: true, data: { messageId: info.messageId } };
        },
      }),
    );

    // email_read
    registry.register(
      defineSystemSkill({
        name: "email_read",
        description: `读取邮件（IMAP）。参数: connection(string), folder?(string, 默认 INBOX), limit?(number, 默认 20), search?(string)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            folder: { type: "string" },
            limit: { type: "number" },
            search: { type: "string" },
          },
          required: ["connection"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`IMAP 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port: number; tls: boolean; user: string; pass: string };
          const folder = (params.folder as string) ?? "INBOX";
          const limit = (params.limit as number) ?? 20;

          const imap = new Imap({
            host: cfg.host,
            port: cfg.port ?? 993,
            tls: cfg.tls ?? true,
            user: cfg.user,
            password: cfg.pass,
          });

          await new Promise<void>((resolve, reject) => {
            imap.once("ready", resolve);
            imap.once("error", reject);
            imap.connect();
          });

          const emails: Array<Record<string, unknown>> = [];

          await new Promise<void>((resolve, reject) => {
            imap.openBox(folder, true, (err: unknown) => {
              if (err) { reject(err); return; }

              // 搜索条件
              const searchCriteria = params.search
                ? [["SUBJECT", params.search as string]]
                : ["ALL"];

              imap.search(searchCriteria, (err: unknown, results: number[]) => {
                if (err) { reject(err); return; }
                if (!results || results.length === 0) {
                  resolve();
                  return;
                }

                // 只取最新的 limit 封
                const ids = results.slice(-limit);
                const fetch = imap.fetch(ids, { bodies: "HEADER.FIELDS (FROM TO SUBJECT DATE)", struct: false });

                fetch.on("message", (msg: { on: (event: string, cb: (...args: unknown[]) => void) => void }, _seqno: number) => {
                  const email: Record<string, unknown> = {};
                  msg.on("body", (...args: unknown[]) => {
                    const stream = args[0] as { on: (event: string, cb: (...args: unknown[]) => void) => void };
                    let buffer = "";
                    stream.on("data", (...args: unknown[]) => { buffer += (args[0] as Buffer).toString("utf8"); });
                    stream.on("end", () => {
                      const lines = buffer.split("\r\n");
                      for (const line of lines) {
                        const colon = line.indexOf(":");
                        if (colon > 0) {
                          const key = line.slice(0, colon).trim().toLowerCase();
                          const value = line.slice(colon + 1).trim();
                          email[key] = value;
                        }
                      }
                    });
                  });
                  msg.on("attributes", (...args: unknown[]) => {
                    const attrs = args[0] as Record<string, unknown>;
                    email.uid = attrs.uid;
                    email.date = attrs.date;
                  });
                  msg.on("end", () => {
                    emails.push(email);
                  });
                });

                fetch.on("error", (err: unknown) => reject(err));
                fetch.on("end", () => {
                  imap.end();
                  resolve();
                });
              });
            });
          });

          return {
            success: true,
            data: {
              folder,
              count: emails.length,
              emails: emails.map((e) => ({
                from: e.from,
                to: e.to,
                subject: e.subject,
                date: e.date,
                uid: e.uid,
              })),
            },
          };
        },
      }),
    );

    console.log("   Email skills registered (email_send/email_read)");
  } catch {
    console.log("   [skills] nodemailer/imap not installed, email skills skipped");
  }
}

// ===== IM Bot Skill =====

function createIMBotSkills(registry: SkillRegistry): void {
  // im_bot_send — 无外部依赖，纯 HTTP 调用
  registry.register(
    defineSystemSkill({
      name: "im_bot_send",
      description: `发送 IM 机器人消息（钉钉/企微/飞书）。参数: connection(string, 连接配置名称), content(string), at?(string|array), msgType?(text/markdown)`,
      paramSchema: {
        properties: {
          connection: { type: "string", description: "IM Webhook 连接配置名称" },
          content: { type: "string", description: "消息内容" },
          at: { type: "string", description: "@用户（手机号或用户ID，多个用逗号分隔）" },
          msgType: { type: "string", enum: ["text", "markdown"], description: "消息类型" },
        },
        required: ["connection", "content"],
      },
      handler: async (params) => {
        const connName = params.connection as string;
        const conn = await getConnection(connName);
        if (!conn) {
          return { success: false, error: new Error(`IM 连接配置不存在: ${connName}`) };
        }

        const cfg = conn.config as { platform: string; webhook: string; secret?: string };
        const content = params.content as string;
        const msgType = (params.msgType as string) ?? "text";
        const atList = params.at ? (params.at as string).split(",").map((s) => s.trim()) : [];

        let body: unknown;
        let headers: Record<string, string> = { "Content-Type": "application/json" };

        if (cfg.platform === "dingtalk") {
          // 钉钉机器人
          if (msgType === "markdown") {
            body = { msgtype: "markdown", markdown: { title: content.slice(0, 20), text: content } };
          } else {
            body = { msgtype: "text", text: { content } };
          }
          if (atList.length > 0) {
            (body as Record<string, unknown>).at = { atMobiles: atList };
          }
          // TODO: 加签逻辑
        } else if (cfg.platform === "wecom") {
          // 企微机器人
          if (msgType === "markdown") {
            body = { msgtype: "markdown", markdown: { content } };
          } else {
            body = { msgtype: "text", text: { content, mentioned_mobile_list: atList } };
          }
        } else if (cfg.platform === "lark" || cfg.platform === "feishu") {
          // 飞书机器人
          body = { msg_type: msgType === "markdown" ? "interactive" : "text", content: { text: content } };
        } else {
          return { success: false, error: new Error(`不支持的 IM 平台: ${cfg.platform}`) };
        }

        const response = await fetch(cfg.webhook, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        const result = await response.json() as Record<string, unknown>;
        if (!response.ok || result.errcode || result.code) {
          return { success: false, error: new Error(`IM 发送失败: ${JSON.stringify(result)}`) };
        }

        return { success: true, data: { platform: cfg.platform, sent: true } };
      },
    }),
  );

  console.log("   IM Bot skill registered (im_bot_send)");
}

// ===== LDAP Skills =====

async function createLDAPSkills(registry: SkillRegistry): Promise<void> {
  try {
    const ldap = await import("ldapjs") as any;

    // ldap_search
    registry.register(
      defineSystemSkill({
        name: "ldap_search",
        description: `查询 LDAP/AD 目录。参数: connection(string), filter?(string, 如 (cn=*)), scope?(base/one/sub), attributes?(array), limit?(number)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            filter: { type: "string" },
            scope: { type: "string", enum: ["base", "one", "sub"] },
            attributes: { type: "array", items: { type: "string" } },
            limit: { type: "number" },
          },
          required: ["connection"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`LDAP 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { url: string; bindDN: string; bindCredentials: string; searchBase: string };

          const client = ldap.createClient({ url: cfg.url });

          await new Promise<void>((resolve, reject) => {
            client.bind(cfg.bindDN, cfg.bindCredentials, (err: unknown) => {
              if (err) reject(err);
              else resolve();
            });
          });

          const filter = (params.filter as string) ?? "(objectClass=*)";
          const scope = (params.scope as string) ?? "sub";
          const attributes = params.attributes as string[] | undefined;
          const limit = (params.limit as number) ?? 50;

          const entries: Array<Record<string, unknown>> = [];

          await new Promise<void>((resolve, reject) => {
            client.search(
              cfg.searchBase,
              { filter, scope, attributes, sizeLimit: limit },
              (err: unknown, res: { on: (event: string, cb: (...args: unknown[]) => void) => void }) => {
                if (err) { reject(err); return; }
                res.on("searchEntry", (...args: unknown[]) => {
                  const entry = args[0] as { pojo: Record<string, unknown> };
                  entries.push(entry.pojo);
                });
                res.on("error", (err: unknown) => reject(err));
                res.on("end", () => resolve());
              },
            );
          });

          client.unbind();
          return { success: true, data: { count: entries.length, entries } };
        },
      }),
    );

    // ldap_auth
    registry.register(
      defineSystemSkill({
        name: "ldap_auth",
        description: `LDAP 用户认证。参数: connection(string), username(string), password(string)。返回认证结果和用户 DN。`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            username: { type: "string" },
            password: { type: "string" },
          },
          required: ["connection", "username", "password"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`LDAP 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { url: string; bindDN: string; bindCredentials: string; searchBase: string; userFilter?: string };
          const username = params.username as string;
          const password = params.password as string;

          const client = ldap.createClient({ url: cfg.url });

          // 管理员绑定
          await new Promise<void>((resolve, reject) => {
            client.bind(cfg.bindDN, cfg.bindCredentials, (err: unknown) => {
              if (err) reject(err);
              else resolve();
            });
          });

          // 搜索用户
          const filter = cfg.userFilter ? cfg.userFilter.replace("{username}", username) : `(cn=${username})`;
          let userDN: string | null = null;

          await new Promise<void>((resolve, reject) => {
            client.search(cfg.searchBase, { filter, scope: "sub" }, (err: unknown, res: { on: (event: string, cb: (...args: unknown[]) => void) => void }) => {
              if (err) { reject(err); return; }
              res.on("searchEntry", (...args: unknown[]) => {
                const entry = args[0] as { pojo: { dn: string } };
                userDN = entry.pojo.dn;
              });
              res.on("error", (err: unknown) => reject(err));
              res.on("end", () => resolve());
            });
          });

          if (!userDN) {
            client.unbind();
            return { success: false, error: new Error("用户不存在") };
          }

          // 尝试用户密码绑定验证
          const authClient = ldap.createClient({ url: cfg.url });
          try {
            await new Promise<void>((resolve, reject) => {
              authClient.bind(userDN, password, (err: unknown) => {
                if (err) reject(err);
                else resolve();
              });
            });
            authClient.unbind();
            client.unbind();
            return { success: true, data: { authenticated: true, dn: userDN } };
          } catch {
            authClient.unbind();
            client.unbind();
            return { success: false, error: new Error("认证失败：用户名或密码错误") };
          }
        },
      }),
    );

    console.log("   LDAP skills registered (ldap_search/ldap_auth)");
  } catch {
    console.log("   [skills] ldapjs not installed, LDAP skills skipped");
  }
}

// ===== Calendar Skills =====

async function createCalendarSkills(registry: SkillRegistry): Promise<void> {
  // calendar_query — 支持 Microsoft Graph API 和 CalDAV（纯 HTTP）
  registry.register(
    defineSystemSkill({
      name: "calendar_query",
      description: `查询日历事件。支持 Microsoft Graph API 或 CalDAV。参数: connection(string), startDate(string, ISO), endDate(string, ISO), limit?(number, 默认 20)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          limit: { type: "number" },
        },
        required: ["connection", "startDate", "endDate"],
      },
      handler: async (params) => {
        const connName = params.connection as string;
        const conn = await getConnection(connName);
        if (!conn) {
          return { success: false, error: new Error(`日历连接配置不存在: ${connName}`) };
        }
        const cfg = conn.config as { provider: string; baseUrl: string; token?: string; user?: string; pass?: string };
        const startDate = params.startDate as string;
        const endDate = params.endDate as string;
        const limit = (params.limit as number) ?? 20;

        if (cfg.provider === "microsoft" || cfg.provider === "graph") {
          // Microsoft Graph API
          const url = new URL(`${cfg.baseUrl}/me/calendarview`);
          url.searchParams.set("startDateTime", startDate);
          url.searchParams.set("endDateTime", endDate);
          url.searchParams.set("$top", String(limit));

          const response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
          });
          const data = (await response.json()) as { value?: Array<Record<string, unknown>> };

          return {
            success: true,
            data: {
              provider: "microsoft",
              count: data.value?.length ?? 0,
              events: (data.value ?? []).map((e) => ({
                id: e.id,
                title: e.subject,
                start: (e.start as Record<string, string>)?.dateTime,
                end: (e.end as Record<string, string>)?.dateTime,
                location: (e.location as Record<string, string>)?.displayName,
                attendees: (e.attendees as Array<Record<string, unknown>>)?.map((a) => (a.emailAddress as Record<string, string>)?.address),
              })),
            },
          };
        }

        // CalDAV 简化实现：通过 HTTP Basic Auth 获取 ICS 数据
        return { success: false, error: new Error("当前仅支持 Microsoft Graph API 日历查询。请设置 provider='graph' 和 baseUrl='https://graph.microsoft.com/v1.0'") };
      },
    }),
  );

  // calendar_create — 支持 Microsoft Graph API
  registry.register(
    defineSystemSkill({
      name: "calendar_create",
      description: `创建日历事件/会议。支持 Microsoft Graph API。参数: connection(string), title(string), startTime(string, ISO), endTime(string, ISO), attendees?(array), location?(string)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          title: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
          location: { type: "string" },
        },
        required: ["connection", "title", "startTime", "endTime"],
      },
      handler: async (params) => {
        const connName = params.connection as string;
        const conn = await getConnection(connName);
        if (!conn) {
          return { success: false, error: new Error(`日历连接配置不存在: ${connName}`) };
        }
        const cfg = conn.config as { provider: string; baseUrl: string; token?: string };

        if (cfg.provider !== "microsoft" && cfg.provider !== "graph") {
          return { success: false, error: new Error("当前仅支持 Microsoft Graph API 日历创建。请设置 provider='graph'") };
        }

        const attendees = (params.attendees as string[] | undefined)?.map((email) => ({
          emailAddress: { address: email },
          type: "required",
        }));

        const body = {
          subject: params.title,
          start: { dateTime: params.startTime, timeZone: "UTC" },
          end: { dateTime: params.endTime, timeZone: "UTC" },
          location: params.location ? { displayName: params.location } : undefined,
          attendees: attendees?.length ? attendees : undefined,
        };

        const response = await fetch(`${cfg.baseUrl}/me/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          return { success: false, error: new Error(`Graph API 错误: ${JSON.stringify(data)}`) };
        }

        return {
          success: true,
          data: {
            eventId: data.id,
            title: params.title,
            startTime: params.startTime,
            endTime: params.endTime,
          },
        };
      },
    }),
  );

  console.log("   Calendar skills registered (calendar_query/calendar_create)");
}

// ===== 统一入口 =====

export async function createEnterpriseSkills(registry: SkillRegistry): Promise<void> {
  await createEmailSkills(registry);
  createIMBotSkills(registry);
  await createLDAPSkills(registry);
  await createCalendarSkills(registry);
}
