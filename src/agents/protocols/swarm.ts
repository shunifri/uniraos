/**
 * SWARM 协议：蜂群式动态自组织
 *
 * 去中心化快速接力，当前智能体可以动态决定是否将任务移交给更合适的智能体。
 * 适合：智能客服路由、多轮对话接力、高并发任务。
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
import { parseHandoffJson } from "./parse-helpers.js";

export class SwarmExecutor implements ProtocolExecutor {
  readonly protocol = "SWARM" as Protocol;
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
    const maxRounds = config.maxRounds ?? 10;

    let currentAgent = this.selectInitialAgent(config.members, input.message);
    let currentMessage = input.message;
    let currentContext = input.context ?? {};
    let totalIterations = 0;

    for (let round = 0; round < maxRounds; round++) {
      const agent = agentFactory(currentAgent);
      agents.push(currentAgent.role);

      allSteps.push({
        agentRole: currentAgent.role,
        type: "handoff",
        content: `蜂群接力: ${currentAgent.role} 接手`,
        data: { round, role: currentAgent.role },
        timestamp: Date.now(),
      });

      // 执行当前智能体，附带移交指令
      const agentInput: AgentInput = {
        message: this.buildSwarmPrompt(currentMessage, currentAgent, config.members),
        context: currentContext,
      };

      const result = await agent.run(agentInput);
      allSteps.push(...result.steps);
      totalIterations += result.iterations;

      // 检查是否需要移交
      const handoff = this.parseHandoff(result.response, config.members);

      if (!handoff) {
        // 没有移交，当前智能体的回答就是最终答案
        return {
          response: result.response,
          level: "team",
          protocol: "SWARM" as Protocol,
          steps: allSteps,
          agents,
          iterations: totalIterations,
          metadata: { duration: Date.now() - startTime, rounds: round + 1 },
        };
      }

      // 移交给下一个智能体
      currentAgent = handoff.target;
      currentMessage = handoff.message;
      currentContext = {
        ...currentContext,
        previousAgent: currentAgent.role,
        previousResponse: result.response,
      };
    }

    return {
      response: "[蜂群达到最大接力轮次]",
      level: "team",
      protocol: "SWARM" as Protocol,
      steps: allSteps,
      agents,
      iterations: totalIterations,
      metadata: { duration: Date.now() - startTime, rounds: maxRounds },
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    const maxRounds = config.maxRounds ?? 10;
    let currentAgent = this.selectInitialAgent(config.members, input.message);
    let currentMessage = input.message;
    let currentContext = input.context ?? {};

    for (let round = 0; round < maxRounds; round++) {
      const agent = agentFactory(currentAgent);

      yield {
        event: "handoff",
        agentRole: currentAgent.role,
        data: { round, role: currentAgent.role, action: "swarm_takeover" },
      };

      const agentInput: AgentInput = {
        message: this.buildSwarmPrompt(currentMessage, currentAgent, config.members),
        context: currentContext,
      };

      let response = "";
      for await (const event of agent.runStream(agentInput)) {
        yield event;
        if (event.event === "agent_done") {
          response = (event.data.response as string) ?? "";
        }
      }

      const handoff = this.parseHandoff(response, config.members);
      if (!handoff) {
        yield { event: "done", data: { response, rounds: round + 1 } };
        return;
      }

      currentAgent = handoff.target;
      currentMessage = handoff.message;
      currentContext = {
        ...currentContext,
        previousAgent: currentAgent.role,
        previousResponse: response,
      };
    }
  }

  private selectInitialAgent(members: AgentProfile[], message: string): AgentProfile {
    // 简单启发式：选第一个成员
    return members[0];
  }

  private buildSwarmPrompt(
    message: string,
    current: AgentProfile,
    allMembers: AgentProfile[],
  ): string {
    const others = allMembers
      .filter((m) => m.role !== current.role)
      .map((m) => `- ${m.role}: 擅长 ${m.expertise.join(", ")}`)
      .join("\n");

    return `${message}

---
[蜂群协议] 你是 ${current.role}。如果这个任务不在你的专长范围内，或者你认为其他成员能更好地处理，请在回复末尾用 JSON 代码块表示移交：
\`\`\`json
{"handoff": true, "target": "目标角色名", "reason": "移交原因"}
\`\`\`
也可以使用旧格式：[HANDOFF:目标角色名] 移交说明

可移交的成员：
${others}

如果你能直接处理，请正常回答，不要添加移交标记。`;
  }

  private parseHandoff(
    response: string,
    members: AgentProfile[],
  ): { target: AgentProfile; message: string } | null {
    const handoffResult = parseHandoffJson(response);
    if (!handoffResult) return null;

    const target = members.find(
      (m) => m.role === handoffResult.target || m.role.toLowerCase() === handoffResult.target.toLowerCase(),
    );
    if (!target) return null;

    // 清除移交标记，保留正文
    const cleanResponse = response
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/\[HANDOFF:.*$/s, "")
      .trim();

    return {
      target,
      message: handoffResult.reason || cleanResponse,
    };
  }
}
