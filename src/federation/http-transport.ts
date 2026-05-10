/**
 * HTTP 传输层实现
 *
 * 基于 HTTP/JSON 的联邦通信实现。
 * 可替换为 WebSocket、gRPC、消息队列等其他传输方式。
 */
import type { FederationTransport, InstanceProfile } from "./types.js";

export class HttpFederationTransport implements FederationTransport {
  readonly name = "http";
  private peers: Map<string, InstanceProfile> = new Map();
  private handlers: Map<string, (payload: unknown, from: string) => Promise<unknown>> = new Map();
  private apiKey?: string;
  private timeout: number;

  constructor(opts?: { apiKey?: string; timeout?: number }) {
    this.apiKey = opts?.apiKey;
    this.timeout = opts?.timeout ?? 15000;
  }

  /** 注册已知的对等实例 */
  addPeer(profile: InstanceProfile): void {
    this.peers.set(profile.instanceId, profile);
  }

  /** 移除对等实例 */
  removePeer(instanceId: string): void {
    this.peers.delete(instanceId);
  }

  /** 获取所有已知对等实例 */
  getPeers(): InstanceProfile[] {
    return [...this.peers.values()];
  }

  async send(endpoint: string, action: string, payload: unknown): Promise<unknown> {
    const url = `${endpoint}/api/federation/${action}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Federation request failed ${response.status}: ${errText}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async broadcast(action: string, payload: unknown): Promise<Array<{ instanceId: string; result: unknown }>> {
    const results: Array<{ instanceId: string; result: unknown }> = [];

    const promises = [...this.peers.entries()].map(async ([instanceId, profile]) => {
      try {
        const result = await this.send(profile.endpoint, action, payload);
        results.push({ instanceId, result });
      } catch (err) {
        results.push({
          instanceId,
          result: { error: err instanceof Error ? (err as Error).message : String(err) },
        });
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  onReceive(action: string, handler: (payload: unknown, from: string) => Promise<unknown>): void {
    this.handlers.set(action, handler);
  }

  /** 处理收到的联邦请求（供 Express 路由调用） */
  async handleRequest(action: string, payload: unknown, from: string): Promise<unknown> {
    const handler = this.handlers.get(action);
    if (!handler) {
      throw new Error(`Unknown federation action: ${action}`);
    }
    return handler(payload, from);
  }

  /** 获取已注册的动作列表 */
  getRegisteredActions(): string[] {
    return [...this.handlers.keys()];
  }
}
