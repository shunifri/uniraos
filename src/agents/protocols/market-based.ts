/**
 * MARKET_BASED 协议：市场式经济博弈
 *
 * 基于"算力/Token 成本"等资源的最优配置。
 * 根据任务复杂度和智能体的成本效率进行经济优化调度。
 * 适合：资源敏感型任务、高成本模型与低成本模型的混合调度。
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

interface TaskFragment {
  id: number;
  description: string;
  complexity: "low" | "medium" | "high";
  assignedTo?: string;
}

interface MarketAllocation {
  agentRole: string;
  tasks: TaskFragment[];
  expectedCost: number;
}

export class MarketBasedExecutor implements ProtocolExecutor {
  readonly protocol = "MARKET_BASED" as Protocol;
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

    // 阶段1: 任务分片 + 复杂度评估
    const fragments = await this.decomposeTask(input.message);

    allSteps.push({
      agentRole: "market",
      type: "thinking",
      content: `任务分解为 ${fragments.length} 个子任务`,
      data: { fragments },
      timestamp: Date.now(),
    });

    // 阶段2: 市场分配 - 低复杂度给低成本，高复杂度给高能力
    const allocations = this.allocate(fragments, config.members);

    for (const alloc of allocations) {
      allSteps.push({
        agentRole: "market",
        type: "thinking",
        content: `分配给 ${alloc.agentRole}: ${alloc.tasks.length} 个子任务, 预估成本 ${alloc.expectedCost}`,
        data: alloc as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      });
    }

    // 阶段3: 并行执行
    const results = new Map<string, string>();
    let totalIterations = 0;

    const execPromises = allocations.map(async (alloc) => {
      const profile = config.members.find((m) => m.role === alloc.agentRole)!;
      const agent = agentFactory(profile);
      agents.push(alloc.agentRole);

      const taskDescs = alloc.tasks.map((t) => `- ${t.description}`).join("\n");
      const result = await agent.run({
        message: `请完成以下子任务：\n${taskDescs}\n\n原始任务背景: ${input.message}`,
        context: { ...input.context, marketAllocation: true },
      });

      return { role: alloc.agentRole, result, steps: result.steps };
    });

    const execResults = await Promise.all(execPromises);

    for (const { role, result, steps } of execResults) {
      allSteps.push(...steps);
      results.set(role, result.response);
      totalIterations += result.iterations;
    }

    // 阶段4: 合并结果
    const finalResponse = await this.mergeResults(input.message, results);

    return {
      response: finalResponse,
      level: "team",
      protocol: "MARKET_BASED" as Protocol,
      steps: allSteps,
      agents,
      iterations: totalIterations,
      metadata: {
        duration: Date.now() - startTime,
        fragments: fragments.length,
        allocations: allocations.length,
      },
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    const fragments = await this.decomposeTask(input.message);

    yield {
      event: "agent_thinking",
      agentRole: "market",
      data: { phase: "decompose", fragmentCount: fragments.length },
    };

    const allocations = this.allocate(fragments, config.members);

    for (const alloc of allocations) {
      yield {
        event: "agent_thinking",
        agentRole: "market",
        data: { phase: "allocate", agent: alloc.agentRole, taskCount: alloc.tasks.length, cost: alloc.expectedCost },
      };
    }

    // 顺序执行每个分配（流式无法真正并行输出）
    const results = new Map<string, string>();

    for (const alloc of allocations) {
      const profile = config.members.find((m) => m.role === alloc.agentRole)!;
      const agent = agentFactory(profile);

      const taskDescs = alloc.tasks.map((t) => `- ${t.description}`).join("\n");

      yield {
        event: "agent_start",
        agentRole: alloc.agentRole,
        data: { tasks: alloc.tasks.length },
      };

      let response = "";
      for await (const event of agent.runStream({
        message: `请完成以下子任务：\n${taskDescs}\n\n原始任务背景: ${input.message}`,
        context: { ...input.context, marketAllocation: true },
      })) {
        yield event;
        if (event.event === "agent_done") {
          response = (event.data.response as string) ?? "";
        }
      }
      results.set(alloc.agentRole, response);
    }

    const finalResponse = await this.mergeResults(input.message, results);
    yield { event: "text_delta", agentRole: "market", data: { text: finalResponse } };
    yield { event: "done", data: { response: finalResponse } };
  }

  private async decomposeTask(task: string): Promise<TaskFragment[]> {
    const response = await this.provider.chat([
      {
        role: "user",
        content: `将以下任务分解为独立的子任务，评估每个子任务的复杂度。仅输出 JSON 数组（不要 markdown）：
[{"id":1,"description":"子任务描述","complexity":"low|medium|high"}]

任务: ${task}`,
      },
    ]);

    try {
      const content = response.content?.trim() ?? "[]";
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as TaskFragment[];
      }
    } catch {}

    // fallback: 不分解
    return [{ id: 1, description: task, complexity: "medium" }];
  }

  private allocate(fragments: TaskFragment[], members: AgentProfile[]): MarketAllocation[] {
    if (members.length === 0) return [];

    // 按成本排序成员（低成本优先）
    const sorted = [...members].sort((a, b) => (a.costPerToken ?? 1) - (b.costPerToken ?? 1));

    const allocMap = new Map<string, MarketAllocation>();
    for (const m of members) {
      allocMap.set(m.role, { agentRole: m.role, tasks: [], expectedCost: 0 });
    }

    // 低复杂度给低成本，高复杂度给高能力（排序末尾）
    const lowTasks = fragments.filter((f) => f.complexity === "low");
    const medTasks = fragments.filter((f) => f.complexity === "medium");
    const highTasks = fragments.filter((f) => f.complexity === "high");

    // 分配策略
    for (const task of highTasks) {
      const agent = sorted[sorted.length - 1]; // 最高能力
      const alloc = allocMap.get(agent.role)!;
      alloc.tasks.push(task);
      alloc.expectedCost += (agent.costPerToken ?? 1) * 2000;
    }

    for (const task of medTasks) {
      // 轮询分配
      const leastLoaded = [...allocMap.values()].sort((a, b) => a.tasks.length - b.tasks.length)[0];
      leastLoaded.tasks.push(task);
      const member = members.find((m) => m.role === leastLoaded.agentRole)!;
      leastLoaded.expectedCost += (member.costPerToken ?? 1) * 1000;
    }

    for (const task of lowTasks) {
      const agent = sorted[0]; // 最低成本
      const alloc = allocMap.get(agent.role)!;
      alloc.tasks.push(task);
      alloc.expectedCost += (agent.costPerToken ?? 0.1) * 500;
    }

    return [...allocMap.values()].filter((a) => a.tasks.length > 0);
  }

  private async mergeResults(originalTask: string, results: Map<string, string>): Promise<string> {
    if (results.size === 1) {
      return results.values().next().value!;
    }

    const resultsSummary = Array.from(results.entries())
      .map(([role, result]) => `### ${role}\n${result}`)
      .join("\n\n");

    const response = await this.provider.chat([
      {
        role: "user",
        content: `请合并以下各智能体的结果为一个完整的答案。\n\n## 原始任务\n${originalTask}\n\n## 各智能体结果\n${resultsSummary}\n\n请直接输出合并后的答案：`,
      },
    ]);

    return response.content ?? Array.from(results.values()).join("\n\n");
  }
}
