/**
 * 远程智能体（Remote Agent）
 *
 * 实现 Agent 接口但将执行委托给另一个 RAOS 实例。
 * 通过 HTTP 调用远程 /chat 端点，实现跨实例多智能体协作。
 *
 * 可注入 TeamAgent 的 agentFactory，使团队跨越多个 RAOS 实例。
 */
import type { Agent, AgentInput, AgentOutput, AgentProfile, AgentStreamEvent, AgentLevel } from "./types.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";

export interface RemoteAgentConfig {
  /** 远程 RAOS 实例的 URL（如 http://192.168.1.100:3000） */
  endpoint: string;
  /** 远程实例的认证 token */
  apiKey?: string;
  /** 请求超时（ms） */
  timeout?: number;
  /** 自定义请求头 */
  headers?: Record<string, string>;
}

export class RemoteAgent implements Agent {
  readonly name: string;
  readonly level: AgentLevel = "react";
  readonly profile: AgentProfile;
  private config: RemoteAgentConfig;

  constructor(profile: AgentProfile, config: RemoteAgentConfig) {
    this.name = `remote:${profile.role}@${new URL(config.endpoint).host}`;
    this.profile = profile;
    this.config = config;
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const url = `${this.config.endpoint}/chat`;
    const timeout = this.config.timeout ?? 60000;

    try {
      const response = await fetchWithTimeout(url, {
        timeoutMs: timeout,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.headers,
        },
        body: JSON.stringify({
          message: `[Role: ${this.profile.role}] ${input.message}`,
          systemPrompt: this.profile.personality,
          context: input.context,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Remote agent error ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;

      return {
        response: data.response ?? data.reply ?? String(data),
        level: "react",
        steps: [{
          agentRole: this.profile.role,
          type: "response",
          content: data.response ?? data.reply,
          timestamp: Date.now(),
          data: { remote: true, endpoint: this.config.endpoint },
        }],
        iterations: 1,
        metadata: {
          remote: true,
          endpoint: this.config.endpoint,
          statusCode: response.status,
        },
      };
    } catch (err) {
      throw err;
    }
  }

  async *runStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    yield {
      event: "agent_start",
      agentRole: this.profile.role,
      data: { remote: true, endpoint: this.config.endpoint },
    };

    try {
      const output = await this.run(input);

      yield {
        event: "text_delta",
        agentRole: this.profile.role,
        data: { content: output.response },
      };

      yield {
        event: "agent_done",
        agentRole: this.profile.role,
        data: { response: output.response },
      };
    } catch (err) {
      yield {
        event: "error",
        agentRole: this.profile.role,
        data: { error: err instanceof Error ? (err as Error).message : String(err) },
      };
    }
  }
}

/**
 * 创建远程 Agent 工厂函数
 * 可注入 TeamAgent 的 agentFactory 参数
 */
export function createRemoteAgentFactory(
  remoteConfig: RemoteAgentConfig,
): (profile: AgentProfile) => Agent {
  return (profile: AgentProfile) => new RemoteAgent(profile, remoteConfig);
}
