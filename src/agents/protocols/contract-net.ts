/**
 * CONTRACT_NET 协议：合同网招标投标制
 *
 * 发布任务招标，各智能体提交竞标方案（信心度+方法+成本），择优执行。
 * 适合：寻找最优解、分布式计算分配、多方案择优场景。
 */
import type { LLMProvider } from "../../llm/types.js";
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  AgentStep,
  Bid,
  Protocol,
  ProtocolExecutor,
  TeamConfig,
} from "../types.js";
import { parseBidJson } from "./parse-helpers.js";

export class ContractNetExecutor implements ProtocolExecutor {
  readonly protocol = "CONTRACT_NET" as Protocol;
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

    // 阶段1: 招标 - 收集所有智能体的竞标
    allSteps.push({
      agentRole: "coordinator",
      type: "thinking",
      content: `发布招标: ${input.message.substring(0, 100)}...`,
      timestamp: Date.now(),
    });

    const bids = await this.collectBids(input.message, config.members);

    for (const bid of bids) {
      allSteps.push({
        agentRole: bid.agentRole,
        type: "bid",
        content: `竞标: 信心度 ${(bid.confidence * 100).toFixed(0)}%, 方案: ${bid.approach}`,
        data: bid as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      });
    }

    // 阶段2: 评标 - 选择最佳方案
    const winner = this.selectWinner(bids);
    if (!winner) {
      return {
        response: "[合同网: 无有效竞标]",
        level: "team",
        protocol: "CONTRACT_NET" as Protocol,
        steps: allSteps,
        agents,
        iterations: 0,
        metadata: { duration: Date.now() - startTime },
      };
    }

    const winnerProfile = config.members.find((m) => m.role === winner.agentRole)!;
    agents.push(winner.agentRole);

    allSteps.push({
      agentRole: "coordinator",
      type: "thinking",
      content: `中标: ${winner.agentRole} (信心度: ${(winner.confidence * 100).toFixed(0)}%)`,
      data: { winner: winner.agentRole, bid: winner },
      timestamp: Date.now(),
    });

    // 阶段3: 执行 - 中标者执行任务
    const agent = agentFactory(winnerProfile);
    const result = await agent.run({
      message: input.message,
      context: {
        ...input.context,
        bidApproach: winner.approach,
        contractNet: true,
      },
    });

    allSteps.push(...result.steps);

    return {
      response: result.response,
      level: "team",
      protocol: "CONTRACT_NET" as Protocol,
      steps: allSteps,
      agents,
      iterations: result.iterations,
      metadata: {
        duration: Date.now() - startTime,
        totalBids: bids.length,
        winner: winner.agentRole,
        winnerConfidence: winner.confidence,
      },
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    yield {
      event: "agent_thinking",
      agentRole: "coordinator",
      data: { phase: "bidding", task: input.message.substring(0, 100) },
    };

    const bids = await this.collectBids(input.message, config.members);

    for (const bid of bids) {
      yield {
        event: "bid",
        agentRole: bid.agentRole,
        data: bid as unknown as Record<string, unknown>,
      };
    }

    const winner = this.selectWinner(bids);
    if (!winner) {
      yield { event: "error", data: { error: "无有效竞标" } };
      return;
    }

    const winnerProfile = config.members.find((m) => m.role === winner.agentRole)!;

    yield {
      event: "agent_thinking",
      agentRole: "coordinator",
      data: { phase: "awarded", winner: winner.agentRole, confidence: winner.confidence },
    };

    const agent = agentFactory(winnerProfile);
    for await (const event of agent.runStream({
      message: input.message,
      context: { ...input.context, bidApproach: winner.approach, contractNet: true },
    })) {
      yield event;
    }
  }

  private async collectBids(task: string, members: AgentProfile[]): Promise<Bid[]> {
    const bidPromises = members.map(async (member) => {
      const response = await this.provider.chat([
        {
          role: "system",
          content: `你是 ${member.role}，擅长 ${member.expertise.join(", ")}。`,
        },
        {
          role: "user",
          content: `以下任务正在招标，请评估你是否适合处理。输出 JSON（支持 markdown code block）：
\`\`\`json
{"confidence": 0.0到1.0的信心度, "approach": "你的处理方案简述", "estimatedSteps": 预估步骤数}
\`\`\`

任务: ${task}`,
        },
      ]);

      const content = response.content?.trim() ?? "";
      const bidResult = parseBidJson(content);

      return {
        agentRole: member.role,
        confidence: bidResult.confidence,
        estimatedCost: 1000,
        estimatedTime: (bidResult.estimatedSteps ?? 5) * 1000,
        approach: bidResult.approach,
      } as Bid;
    });

    return Promise.all(bidPromises);
  }

  private selectWinner(bids: Bid[]): Bid | null {
    if (bids.length === 0) return null;

    // 综合评分：confidence * 0.6 + (1/cost) * 0.2 + (1/time) * 0.2
    const scored = bids.map((bid) => ({
      bid,
      score:
        bid.confidence * 0.6 +
        (1 / Math.max(bid.estimatedCost, 1)) * 0.2 * 10000 +
        (1 / Math.max(bid.estimatedTime, 1)) * 0.2 * 100000,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0].bid;
  }
}
