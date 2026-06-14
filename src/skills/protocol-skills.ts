/**
 * 通信协议 Skill 家族
 *
 * 提供 WebSocket、Server-Sent Events、消息队列等协议能力。
 * 让智能体能够进行双向实时通信和异步消息处理。
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";

// ===== WebSocket 管理 =====

interface WSConnection {
  ws: any; // WebSocket instance
  url: string;
  status: "connecting" | "open" | "closed" | "error";
  messages: Array<{ data: string; timestamp: number; direction: "in" | "out" }>;
  createdAt: number;
}

const wsConnections = new Map<string, WSConnection>();
let wsIdCounter = 0;

function createWSSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "ws_connect",
      description:
        "建立 WebSocket 连接。参数: url(string), protocols?(string[]), headers?(object). 返回 connectionId",
      timeout: 15000,
      handler: async (params) => {
        const url = params.url as string;
        if (!url) return { success: false, error: new Error("url 参数必填") };

        // 安全检查
        try {
          const parsed = new URL(url);
          if (!["ws:", "wss:"].includes(parsed.protocol)) {
            return { success: false, error: new Error("仅支持 ws:// 或 wss:// 协议") };
          }
        } catch {
          return { success: false, error: new Error("无效的 WebSocket URL") };
        }

        try {
          // 使用全局 WebSocket（Node 21+）或 ws 包
          let WebSocketClass: any;
          if (typeof globalThis.WebSocket !== "undefined") {
            WebSocketClass = globalThis.WebSocket;
          } else {
            try {
              // @ts-ignore — 可选依赖
              const wsModule = await import("ws");
              WebSocketClass = wsModule.default ?? wsModule.WebSocket;
            } catch {
              return { success: false, error: new Error("WebSocket 不可用。Node 21+ 内置支持，或安装 ws: npm install ws") };
            }
          }

          const connId = `ws_${++wsIdCounter}`;
          const protocols = params.protocols as string[] | undefined;

          const ws = new WebSocketClass(url, protocols);
          const conn: WSConnection = {
            ws,
            url,
            status: "connecting",
            messages: [],
            createdAt: Date.now(),
          };

          wsConnections.set(connId, conn);

          // 等待连接建立
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("连接超时")), 10000);

            ws.onopen = () => {
              conn.status = "open";
              clearTimeout(timeout);
              resolve();
            };

            ws.onerror = (err: any) => {
              conn.status = "error";
              clearTimeout(timeout);
              reject(new Error(err.message ?? "WebSocket 连接失败"));
            };

            ws.onmessage = (event: any) => {
              const data = typeof event.data === "string" ? event.data : String(event.data);
              conn.messages.push({ data, timestamp: Date.now(), direction: "in" });
              // 保留最近 100 条消息
              if (conn.messages.length > 100) {
                conn.messages = conn.messages.slice(-100);
              }
            };

            ws.onclose = () => {
              conn.status = "closed";
            };
          });

          return {
            success: true,
            data: { connectionId: connId, url, status: "open" },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "ws_send",
      description: "通过 WebSocket 发送消息。参数: connectionId(string), data(string)",
      timeout: 10000,
      handler: async (params) => {
        const connId = params.connectionId as string;
        const data = params.data as string;
        if (!connId || data === undefined) {
          return { success: false, error: new Error("connectionId 和 data 参数必填") };
        }

        const conn = wsConnections.get(connId);
        if (!conn) return { success: false, error: new Error(`连接不存在: ${connId}`) };
        if (conn.status !== "open") return { success: false, error: new Error(`连接已关闭: ${conn.status}`) };

        try {
          conn.ws.send(data);
          conn.messages.push({ data, timestamp: Date.now(), direction: "out" });
          return { success: true, data: { sent: true, connectionId: connId } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "ws_receive",
      description: "获取 WebSocket 接收到的消息。参数: connectionId(string), limit?(number, 默认 10), waitMs?(number, 等待新消息毫秒数)",
      timeout: 30000,
      handler: async (params) => {
        const connId = params.connectionId as string;
        if (!connId) return { success: false, error: new Error("connectionId 参数必填") };

        const conn = wsConnections.get(connId);
        if (!conn) return { success: false, error: new Error(`连接不存在: ${connId}`) };

        const waitMs = params.waitMs as number | undefined;
        if (waitMs && waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 10000)));
        }

        const limit = (params.limit as number) ?? 10;
        const inbound = conn.messages
          .filter((m) => m.direction === "in")
          .slice(-limit);

        return {
          success: true,
          data: {
            connectionId: connId,
            messages: inbound,
            count: inbound.length,
            status: conn.status,
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "ws_close",
      description: "关闭 WebSocket 连接。参数: connectionId(string)",
      handler: async (params) => {
        const connId = params.connectionId as string;
        if (!connId) return { success: false, error: new Error("connectionId 参数必填") };

        const conn = wsConnections.get(connId);
        if (!conn) return { success: false, error: new Error(`连接不存在: ${connId}`) };

        try {
          if (conn.status === "open") {
            conn.ws.close();
          }
          conn.status = "closed";
          wsConnections.delete(connId);
          return { success: true, data: { closed: true, connectionId: connId } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "ws_list",
      description: "列出所有 WebSocket 连接状态",
      handler: async () => {
        const connections = [...wsConnections.entries()].map(([id, conn]) => ({
          connectionId: id,
          url: conn.url,
          status: conn.status,
          messageCount: conn.messages.length,
          createdAt: conn.createdAt,
        }));
        return { success: true, data: { connections, total: connections.length } };
      },
    }),
  );
}

// ===== 进程内消息总线（简易 Pub/Sub） =====

interface PubSubChannel {
  subscribers: Array<{ id: string; callback: (message: unknown) => void }>;
  messages: Array<{ data: unknown; publishedAt: number; publisher: string }>;
}

const channels = new Map<string, PubSubChannel>();
let subIdCounter = 0;

function createMessageBusSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "mq_publish",
      description: "发布消息到频道。参数: channel(string), data(any), publisher?(string)",
      handler: async (params) => {
        const channelName = params.channel as string;
        const data = params.data;
        if (!channelName) return { success: false, error: new Error("channel 参数必填") };

        if (!channels.has(channelName)) {
          channels.set(channelName, { subscribers: [], messages: [] });
        }

        const ch = channels.get(channelName)!;
        const message = {
          data,
          publishedAt: Date.now(),
          publisher: (params.publisher as string) ?? "anonymous",
        };

        ch.messages.push(message);
        if (ch.messages.length > 1000) {
          ch.messages = ch.messages.slice(-1000);
        }

        // 通知订阅者
        for (const sub of ch.subscribers) {
          try {
            sub.callback(data);
          } catch {
            // 订阅者回调失败不影响发布
          }
        }

        return {
          success: true,
          data: {
            channel: channelName,
            published: true,
            subscriberCount: ch.subscribers.length,
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "mq_consume",
      description: "消费频道中的消息。参数: channel(string), limit?(number, 默认 10), since?(number, 时间戳)",
      handler: async (params) => {
        const channelName = params.channel as string;
        if (!channelName) return { success: false, error: new Error("channel 参数必填") };

        const ch = channels.get(channelName);
        if (!ch) {
          return { success: true, data: { channel: channelName, messages: [], count: 0 } };
        }

        const limit = (params.limit as number) ?? 10;
        const since = params.since as number | undefined;

        let messages = ch.messages;
        if (since) {
          messages = messages.filter((m) => m.publishedAt > since);
        }

        return {
          success: true,
          data: {
            channel: channelName,
            messages: messages.slice(-limit),
            count: messages.length,
            totalInChannel: ch.messages.length,
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "mq_channels",
      description: "列出所有消息频道及其状态",
      handler: async () => {
        const channelList = [...channels.entries()].map(([name, ch]) => ({
          name,
          subscriberCount: ch.subscribers.length,
          messageCount: ch.messages.length,
          lastMessageAt: ch.messages.length > 0 ? ch.messages[ch.messages.length - 1].publishedAt : null,
        }));

        return { success: true, data: { channels: channelList, total: channelList.length } };
      },
    }),
  );
}

// ===== 注册所有协议 Skills =====

export function createProtocolSkills(registry: SkillRegistry): void {
  createWSSkills(registry);
  createMessageBusSkills(registry);
  console.log("   Protocol skills registered (ws_connect/ws_send/ws_receive/ws_close/ws_list + mq_publish/mq_consume/mq_channels)");
}
