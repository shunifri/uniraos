/**
 * BLACKBOARD 协议：黑板式共享上下文
 *
 * 所有智能体共享一个"黑板"数据结构，异步协同。
 * 每个专家根据黑板上的当前状态决定是否介入、贡献什么。
 * 适合：复杂故障排查、非线性逻辑推理、多源数据融合分析。
 */
import type { LLMProvider } from "../../llm/types.js";
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  AgentStep,
  Blackboard,
  BlackboardEntry,
  Protocol,
  ProtocolExecutor,
  TeamConfig,
} from "../types.js";

/** 内存黑板实现 */
class InMemoryBlackboard implements Blackboard {
  entries = new Map<string, BlackboardEntry>();
  private subscribers: Array<(entry: BlackboardEntry) => void> = [];
  private versionCounter = 0;

  read(key: string): BlackboardEntry | undefined {
    return this.entries.get(key);
  }

  write(key: string, value: unknown, author: string): void {
    this.versionCounter++;
    const entry: BlackboardEntry = {
      key,
      value,
      author,
      timestamp: Date.now(),
      version: this.versionCounter,
    };
    this.entries.set(key, entry);
    for (const cb of this.subscribers) {
      cb(entry);
    }
  }

  list(): BlackboardEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  subscribe(callback: (entry: BlackboardEntry) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
  }

  toContext(): Record<string, unknown> {
    const ctx: Record<string, unknown> = {};
    for (const [key, entry] of this.entries) {
      ctx[key] = { value: entry.value, author: entry.author, version: entry.version };
    }
    return ctx;
  }
}

export class BlackboardExecutor implements ProtocolExecutor {
  readonly protocol = "BLACKBOARD" as Protocol;
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

    const blackboard = new InMemoryBlackboard();
    blackboard.write("task", input.message, "system");
    if (input.context) {
      blackboard.write("initial_context", input.context, "system");
    }

    let totalIterations = 0;
    let finalResponse = "";

    for (let round = 0; round < maxRounds; round++) {
      allSteps.push({
        agentRole: "blackboard",
        type: "blackboard_update",
        content: `第 ${round + 1} 轮，黑板有 ${blackboard.entries.size} 条记录`,
        data: { round, entryCount: blackboard.entries.size },
        timestamp: Date.now(),
      });

      // 询问每个专家是否要介入
      const contributors = await this.selectContributors(
        blackboard,
        config.members,
        round,
      );

      if (contributors.length === 0) {
        // 没有专家要介入了，生成最终答案
        finalResponse = await this.synthesize(blackboard, input.message);
        break;
      }

      // 各专家基于黑板状态贡献
      for (const member of contributors) {
        const agent = agentFactory(member);
        agents.push(member.role);

        const boardState = blackboard.toContext();
        const result = await agent.run({
          message: `请根据黑板上的信息，贡献你的专业分析。完成后，用 [BB:key] value 格式在回复末尾标记你要写入黑板的内容。\n\n当前黑板状态:\n${JSON.stringify(boardState, null, 2)}\n\n原始任务: ${input.message}`,
          context: boardState,
        });

        allSteps.push(...result.steps);
        totalIterations += result.iterations;

        // 解析黑板写入
        const writes = this.parseBoardWrites(result.response, member.role);
        for (const w of writes) {
          blackboard.write(w.key, w.value, member.role);
          allSteps.push({
            agentRole: member.role,
            type: "blackboard_update",
            content: `写入 [${w.key}]: ${String(w.value).substring(0, 100)}`,
            data: { key: w.key, value: w.value },
            timestamp: Date.now(),
          });
        }

        // 如果没有显式写入，将回复本身作为贡献
        if (writes.length === 0) {
          blackboard.write(`${member.role}_analysis_r${round}`, result.response, member.role);
        }
      }

      // 检查是否有专家写入了 "conclusion" 或 "final_answer"
      const conclusion = blackboard.read("conclusion") ?? blackboard.read("final_answer");
      if (conclusion) {
        finalResponse = String(conclusion.value);
        break;
      }
    }

    if (!finalResponse) {
      finalResponse = await this.synthesize(blackboard, input.message);
    }

    return {
      response: finalResponse,
      level: "team",
      protocol: "BLACKBOARD" as Protocol,
      steps: allSteps,
      agents: [...new Set(agents)],
      iterations: totalIterations,
      metadata: {
        duration: Date.now() - startTime,
        boardEntries: blackboard.entries.size,
      },
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    const maxRounds = config.maxRounds ?? 5;
    const blackboard = new InMemoryBlackboard();
    blackboard.write("task", input.message, "system");

    for (let round = 0; round < maxRounds; round++) {
      yield {
        event: "blackboard_update",
        agentRole: "blackboard",
        data: { round, entryCount: blackboard.entries.size, board: blackboard.toContext() },
      };

      const contributors = await this.selectContributors(blackboard, config.members, round);
      if (contributors.length === 0) break;

      for (const member of contributors) {
        const agent = agentFactory(member);
        const boardState = blackboard.toContext();

        yield {
          event: "agent_start",
          agentRole: member.role,
          data: { round },
        };

        let response = "";
        for await (const event of agent.runStream({
          message: `请根据黑板上的信息，贡献你的专业分析。用 [BB:key] value 格式标记你要写入黑板的内容。\n\n当前黑板:\n${JSON.stringify(boardState, null, 2)}\n\n原始任务: ${input.message}`,
          context: boardState,
        })) {
          yield event;
          if (event.event === "agent_done") {
            response = (event.data.response as string) ?? "";
          }
        }

        const writes = this.parseBoardWrites(response, member.role);
        for (const w of writes) {
          blackboard.write(w.key, w.value, member.role);
          yield {
            event: "blackboard_update",
            agentRole: member.role,
            data: { key: w.key, value: w.value },
          };
        }
        if (writes.length === 0) {
          blackboard.write(`${member.role}_r${round}`, response, member.role);
        }
      }

      const conclusion = blackboard.read("conclusion") ?? blackboard.read("final_answer");
      if (conclusion) {
        yield { event: "done", data: { response: String(conclusion.value) } };
        return;
      }
    }

    const finalResponse = await this.synthesize(blackboard, input.message);
    yield { event: "text_delta", agentRole: "blackboard", data: { text: finalResponse } };
    yield { event: "done", data: { response: finalResponse } };
  }

  private async selectContributors(
    blackboard: InMemoryBlackboard,
    members: AgentProfile[],
    round: number,
  ): Promise<AgentProfile[]> {
    if (round === 0) return members; // 第一轮所有人参与

    const boardState = JSON.stringify(blackboard.toContext(), null, 2);
    const membersDesc = members.map((m) => `- ${m.role}: ${m.expertise.join(", ")}`).join("\n");

    const response = await this.provider.chat([
      {
        role: "user",
        content: `根据当前黑板状态，哪些专家应该在第 ${round + 1} 轮继续贡献？如果信息已足够可以得出结论，返回空数组。

黑板状态:
${boardState}

可用专家:
${membersDesc}

仅输出 JSON 数组，包含应参与的角色名（不要 markdown）：
["角色名1", "角色名2"] 或 []`,
      },
    ]);

    try {
      const content = response.content?.trim() ?? "[]";
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const roles = JSON.parse(jsonMatch[0]) as string[];
        if (roles.length === 0) return [];
        return members.filter((m) => roles.includes(m.role));
      }
    } catch {}

    return []; // 解析失败，结束
  }

  private parseBoardWrites(
    response: string,
    author: string,
  ): Array<{ key: string; value: string }> {
    const writes: Array<{ key: string; value: string }> = [];
    const regex = /\[BB:(\w+)\]\s*(.+?)(?=\[BB:|\s*$)/gs;
    let match;

    while ((match = regex.exec(response)) !== null) {
      writes.push({ key: match[1], value: match[2].trim() });
    }

    return writes;
  }

  private async synthesize(blackboard: InMemoryBlackboard, task: string): Promise<string> {
    const boardState = JSON.stringify(blackboard.toContext(), null, 2);

    const response = await this.provider.chat([
      {
        role: "user",
        content: `根据黑板上所有专家的分析，综合得出最终答案。\n\n原始任务: ${task}\n\n黑板内容:\n${boardState}\n\n请直接输出最终答案：`,
      },
    ]);

    return response.content ?? "[黑板协议: 无法综合结果]";
  }
}
