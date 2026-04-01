/**
 * A2A 协议：对等式点对点移交
 *
 * Agent-to-Agent 授权式移交，当前智能体明确决定将任务完全交给另一个智能体。
 * 适合：专家咨询接力、技术支持转接、垂直领域深度协作。
 */
import type { LLMProvider } from "../../llm/types.js";
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  AgentStep,
  Protocol,
  ProtocolExecutor,
  TeamConfig,
} from "../types.js";

export class A2AExecutor implements ProtocolExecutor {
  readonly protocol = "A2A" as Protocol;
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async execute(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): Promise<AgentOutput> {
    const startTime = Date.now();
    const allSteps: AgentStep[] = [];
    const agents: string[] = [];
    const maxHandoffs = config.maxRounds ?? 5;

    // 先选择最合适的初始智能体
    let currentProfile = await this.selectBestAgent(input.message, config.members);
    let currentMessage = input.message;
    let currentContext = input.context ?? {};
    let totalIterations = 0;

    for (let i = 0; i < maxHandoffs; i++) {
      const agent = agentFactory(currentProfile);
      agents.push(currentProfile.role);

      const result = await agent.run({
        message: currentMessage,
        context: {
          ...currentContext,
          availablePeers: config.members
            .filter((m) => m.role !== currentProfile.role)
            .map((m) => ({ role: m.role, expertise: m.expertise })),
        },
      });

      allSteps.push(...result.steps);
      totalIterations += result.iterations;

      // 检查是否有移交请求
      const transfer = this.parseTransfer(result.response, config.members, currentProfile.role);

      if (!transfer) {
        return {
          response: result.response,
          level: "team",
          protocol: "A2A" as Protocol,
          steps: allSteps,
          agents,
          iterations: totalIterations,
          metadata: { duration: Date.now() - startTime, handoffs: i },
        };
      }

      allSteps.push({
        agentRole: currentProfile.role,
        type: "handoff",
        content: `移交给 ${transfer.target.role}: ${transfer.reason}`,
        data: { from: currentProfile.role, to: transfer.target.role, reason: transfer.reason },
        timestamp: Date.now(),
      });

      currentProfile = transfer.target;
      currentMessage = transfer.briefing;
      currentContext = {
        ...currentContext,
        transferFrom: currentProfile.role,
        transferReason: transfer.reason,
        previousResponse: result.response,
      };
    }

    return {
      response: "[A2A 达到最大移交次数]",
      level: "team",
      protocol: "A2A" as Protocol,
      steps: allSteps,
      agents,
      iterations: totalIterations,
      metadata: { duration: Date.now() - startTime, handoffs: maxHandoffs },
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    const maxHandoffs = config.maxRounds ?? 5;
    let currentProfile = await this.selectBestAgent(input.message, config.members);
    let currentMessage = input.message;
    let currentContext = input.context ?? {};

    for (let i = 0; i < maxHandoffs; i++) {
      const agent = agentFactory(currentProfile);

      yield {
        event: "agent_start",
        agentRole: currentProfile.role,
        data: { level: "react", role: currentProfile.role, handoff: i },
      };

      let response = "";
      for await (const event of agent.runStream({
        message: currentMessage,
        context: {
          ...currentContext,
          availablePeers: config.members
            .filter((m) => m.role !== currentProfile.role)
            .map((m) => ({ role: m.role, expertise: m.expertise })),
        },
      })) {
        yield event;
        if (event.event === "agent_done") {
          response = (event.data.response as string) ?? "";
        }
      }

      const transfer = this.parseTransfer(response, config.members, currentProfile.role);
      if (!transfer) {
        yield { event: "done", data: { response, handoffs: i } };
        return;
      }

      yield {
        event: "handoff",
        agentRole: currentProfile.role,
        data: { from: currentProfile.role, to: transfer.target.role, reason: transfer.reason },
      };

      currentProfile = transfer.target;
      currentMessage = transfer.briefing;
      currentContext = {
        ...currentContext,
        transferFrom: currentProfile.role,
        transferReason: transfer.reason,
        previousResponse: response,
      };
    }
  }

  private async selectBestAgent(message: string, members: AgentProfile[]): Promise<AgentProfile> {
    // 通过 LLM 选择最合适的初始智能体
    const membersDesc = members
      .map((m, i) => `${i}. ${m.role} - 擅长: ${m.expertise.join(", ")}`)
      .join("\n");

    const response = await this.provider.chat([
      {
        role: "user",
        content: `根据用户的任务，选择最合适的初始处理者。只输出序号。\n\n任务: ${message}\n\n候选者:\n${membersDesc}`,
      },
    ]);

    const idx = parseInt(response.content ?? "0");
    return members[isNaN(idx) || idx < 0 || idx >= members.length ? 0 : idx];
  }

  private parseTransfer(
    response: string,
    members: AgentProfile[],
    currentRole: string,
  ): { target: AgentProfile; reason: string; briefing: string } | null {
    // 查找 [TRANSFER:角色名] 标记
    const match = response.match(/\[TRANSFER:(.+?)\]\s*(.*)/s);
    if (!match) return null;

    const targetRole = match[1].trim();
    const rest = match[2].trim();

    const target = members.find((m) => m.role === targetRole && m.role !== currentRole);
    if (!target) return null;

    const reasonMatch = rest.match(/原因[:：]\s*(.*?)(?:\n|$)/);
    const reason = reasonMatch?.[1] ?? rest.split("\n")[0];
    const briefing = rest.replace(/原因[:：].*?(?:\n|$)/, "").trim() || response.replace(/\[TRANSFER:.*$/s, "").trim();

    return { target, reason, briefing };
  }
}
