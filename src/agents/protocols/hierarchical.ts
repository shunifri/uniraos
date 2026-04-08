/**
 * HIERARCHICAL 协议：层级式中心化决策
 *
 * 管理者拆解任务、指派给专家、审查结果、合并最终输出。
 * 适合：复杂项目管理、多级合规审查、强质量管控任务。
 */
import type { LLMProvider, Message } from "../../llm/types.js";
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
import { parseManagerDecisionJson } from "./parse-helpers.js";

interface TaskAssignment {
  agentRole: string;
  task: string;
  priority: number;
}

interface ManagerDecision {
  type: "assign" | "revise" | "complete";
  assignments?: TaskAssignment[];
  revision?: { agentRole: string; feedback: string };
  finalAnswer?: string;
}

export class HierarchicalExecutor implements ProtocolExecutor {
  readonly protocol = "HIERARCHICAL" as Protocol;
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
    const maxRounds = config.maxRounds ?? 5;

    const managerProfile = config.manager ?? {
      role: "项目经理",
      personality: "你是一个项目经理，负责拆解任务、分配给专家、审查结果并合并最终回答。",
      expertise: ["项目管理", "任务拆解"],
      allowedSkills: [],
    };

    const memberMap = new Map<string, AgentProfile>();
    for (const m of config.members) {
      memberMap.set(m.role, m);
      agents.push(m.role);
    }

    const results = new Map<string, string>();
    let totalIterations = 0;

    for (let round = 0; round < maxRounds; round++) {
      // 管理者决策
      const decision = await this.managerDecide(
        managerProfile,
        input.message,
        config.members,
        results,
        round,
      );

      allSteps.push({
        agentRole: managerProfile.role,
        type: "thinking",
        content: `第 ${round + 1} 轮决策: ${decision.type}`,
        data: decision as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      });

      if (decision.type === "complete" && decision.finalAnswer) {
        return {
          response: decision.finalAnswer,
          level: "team",
          protocol: "HIERARCHICAL" as Protocol,
          steps: allSteps,
          agents,
          iterations: totalIterations,
          metadata: { duration: Date.now() - startTime, rounds: round + 1 },
        };
      }

      if (decision.type === "assign" && decision.assignments) {
        for (const assignment of decision.assignments) {
          const profile = memberMap.get(assignment.agentRole);
          if (!profile) continue;

          const agent = agentFactory(profile);

          allSteps.push({
            agentRole: managerProfile.role,
            type: "handoff",
            content: `指派任务给 ${assignment.agentRole}: ${assignment.task}`,
            data: { target: assignment.agentRole, task: assignment.task },
            timestamp: Date.now(),
          });

          const result = await agent.run({
            message: assignment.task,
            context: { ...input.context, managerInstruction: assignment.task },
          });

          allSteps.push(...result.steps);
          totalIterations += result.iterations;
          results.set(assignment.agentRole, result.response);
        }
      }

      if (decision.type === "revise" && decision.revision) {
        const profile = memberMap.get(decision.revision.agentRole);
        if (profile) {
          const agent = agentFactory(profile);
          const prevResult = results.get(decision.revision.agentRole) ?? "";

          const result = await agent.run({
            message: `请根据以下反馈修改你的输出：\n\n反馈：${decision.revision.feedback}\n\n你之前的输出：${prevResult}`,
            context: input.context,
          });

          allSteps.push(...result.steps);
          totalIterations += result.iterations;
          results.set(decision.revision.agentRole, result.response);
        }
      }
    }

    // 超出最大轮次，强制合并
    const finalMerge = await this.mergeResults(managerProfile, input.message, results);
    return {
      response: finalMerge,
      level: "team",
      protocol: "HIERARCHICAL" as Protocol,
      steps: allSteps,
      agents,
      iterations: totalIterations,
      metadata: { duration: Date.now() - startTime, rounds: maxRounds, forceMerge: true },
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    const maxRounds = config.maxRounds ?? 5;
    const managerProfile = config.manager ?? {
      role: "项目经理",
      personality: "你是一个项目经理，负责拆解任务、分配给专家、审查结果并合并最终回答。",
      expertise: ["项目管理"],
      allowedSkills: [],
    };

    const memberMap = new Map<string, AgentProfile>();
    for (const m of config.members) {
      memberMap.set(m.role, m);
    }

    const results = new Map<string, string>();

    for (let round = 0; round < maxRounds; round++) {
      const decision = await this.managerDecide(
        managerProfile,
        input.message,
        config.members,
        results,
        round,
      );

      yield {
        event: "agent_thinking",
        agentRole: managerProfile.role,
        data: { round: round + 1, decision: decision.type },
      };

      if (decision.type === "complete" && decision.finalAnswer) {
        yield {
          event: "text_delta",
          agentRole: managerProfile.role,
          data: { text: decision.finalAnswer },
        };
        yield {
          event: "done",
          data: { response: decision.finalAnswer, rounds: round + 1 },
        };
        return;
      }

      if (decision.type === "assign" && decision.assignments) {
        for (const assignment of decision.assignments) {
          const profile = memberMap.get(assignment.agentRole);
          if (!profile) continue;

          const agent = agentFactory(profile);
          yield {
            event: "handoff",
            agentRole: managerProfile.role,
            data: { target: assignment.agentRole, task: assignment.task },
          };

          let response = "";
          for await (const event of agent.runStream({
            message: assignment.task,
            context: { ...input.context, managerInstruction: assignment.task },
          })) {
            yield event;
            if (event.event === "agent_done") {
              response = (event.data.response as string) ?? "";
            }
          }
          results.set(assignment.agentRole, response);
        }
      }

      if (decision.type === "revise" && decision.revision) {
        const profile = memberMap.get(decision.revision.agentRole);
        if (profile) {
          const agent = agentFactory(profile);
          const prevResult = results.get(decision.revision.agentRole) ?? "";

          yield {
            event: "handoff",
            agentRole: managerProfile.role,
            data: { target: decision.revision.agentRole, action: "revise", feedback: decision.revision.feedback },
          };

          let response = "";
          for await (const event of agent.runStream({
            message: `请根据以下反馈修改你的输出：\n\n反馈：${decision.revision.feedback}\n\n你之前的输出：${prevResult}`,
            context: input.context,
          })) {
            yield event;
            if (event.event === "agent_done") {
              response = (event.data.response as string) ?? "";
            }
          }
          results.set(decision.revision.agentRole, response);
        }
      }
    }

    const finalMerge = await this.mergeResults(managerProfile, input.message, results);
    yield { event: "text_delta", agentRole: managerProfile.role, data: { text: finalMerge } };
    yield { event: "done", data: { response: finalMerge, forceMerge: true } };
  }

  private async managerDecide(
    managerProfile: AgentProfile,
    userTask: string,
    members: AgentProfile[],
    results: Map<string, string>,
    round: number,
  ): Promise<ManagerDecision> {
    const membersDesc = members.map((m) => `- ${m.role}: 擅长 ${m.expertise.join(", ")}`).join("\n");

    const resultsSummary =
      results.size > 0
        ? Array.from(results.entries())
            .map(([role, result]) => `### ${role} 的输出\n${result}`)
            .join("\n\n")
        : "（暂无结果）";

    const prompt = `你是项目经理，负责协调团队完成任务。

## 用户任务
${userTask}

## 团队成员
${membersDesc}

## 当前已有结果（第 ${round + 1} 轮）
${resultsSummary}

## 指令
根据当前进展，做出决策。输出 JSON 格式（可用 markdown code block）：

1. 如果需要分配新任务：
\`\`\`json
{"decision":"assign","assignments":[{"agent":"成员角色","task":"具体任务描述"}]}
\`\`\`

2. 如果某个成员的结果需要修改：
\`\`\`json
{"decision":"revise","revision":"成员角色: 修改意见"}
\`\`\`

3. 如果所有结果已满意，合并最终答案：
\`\`\`json
{"decision":"complete","summary":"最终综合答案"}
\`\`\``;

    const response = await this.provider.chat([
      { role: "system", content: managerProfile.personality },
      { role: "user", content: prompt },
    ]);

    const content = response.content?.trim() ?? "";
    const parsed = parseManagerDecisionJson(content);

    if (parsed) {
      if (parsed.decision === "assign" && parsed.assignments) {
        return {
          type: "assign",
          assignments: parsed.assignments.map((a) => ({
            agentRole: a.agent,
            task: a.task,
            priority: 1,
          })),
        };
      }
      if (parsed.decision === "revise" && parsed.revision) {
        // revision format: "agentRole: feedback"
        const colonIdx = parsed.revision.indexOf(":");
        const agentRole = colonIdx >= 0 ? parsed.revision.slice(0, colonIdx).trim() : members[0]?.role ?? "";
        const feedback = colonIdx >= 0 ? parsed.revision.slice(colonIdx + 1).trim() : parsed.revision;
        return { type: "revise", revision: { agentRole, feedback } };
      }
      if (parsed.decision === "complete") {
        return {
          type: "complete",
          finalAnswer: parsed.summary ?? Array.from(results.values()).join("\n\n---\n\n"),
        };
      }
    }

    // fallback: 第一轮分配所有成员，否则合并
    if (round === 0) {
      return {
        type: "assign",
        assignments: members.map((m) => ({
          agentRole: m.role,
          task: userTask,
          priority: 1,
        })),
      };
    }
    return {
      type: "complete",
      finalAnswer: Array.from(results.values()).join("\n\n---\n\n"),
    };
  }

  private async mergeResults(
    managerProfile: AgentProfile,
    userTask: string,
    results: Map<string, string>,
  ): Promise<string> {
    const resultsSummary = Array.from(results.entries())
      .map(([role, result]) => `### ${role}\n${result}`)
      .join("\n\n");

    const response = await this.provider.chat([
      { role: "system", content: managerProfile.personality },
      {
        role: "user",
        content: `请将以下各专家的结果合并为一个完整的最终答案。\n\n## 原始任务\n${userTask}\n\n## 各专家结果\n${resultsSummary}\n\n请直接输出最终答案：`,
      },
    ]);

    return response.content ?? Array.from(results.values()).join("\n\n");
  }
}
