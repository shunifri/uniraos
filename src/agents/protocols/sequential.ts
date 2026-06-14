/**
 * SEQUENTIAL 协议：顺序式流水线
 *
 * 线性单向流，每个智能体处理完后将结果传递给下一个。
 * 适合：翻译→校对→润色、自动化发布流程等确定性管线。
 *
 * ROADMAP-Q3 item #1 (2026-06-08): 在单步执行外包一层 withTimeout (stepTimeout),
 *   任一阶段超时返回错误响应并标记 timedOut=true, 而非阻塞整个流水线.
 */
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
import { withTimeout } from "../timeout-utils.js";
import { AgentTimeoutError } from "../../utils/errors.js";

export class SequentialExecutor implements ProtocolExecutor {
  readonly protocol = "SEQUENTIAL" as Protocol;

  async execute(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): Promise<AgentOutput> {
    const startTime = Date.now();
    const allSteps: AgentStep[] = [];
    const agents: string[] = [];

    let currentInput = input.message;
    let currentContext = input.context ?? {};
    let totalIterations = 0;
    let timedOut = false;
    let timedOutAtStage: number | undefined;

    for (let i = 0; i < config.members.length; i++) {
      const member = config.members[i];
      const agent = agentFactory(member);
      agents.push(member.role);

      const stepLabel = config.pipelineSteps?.[i] ?? `步骤 ${i + 1}`;

      allSteps.push({
        agentRole: member.role,
        type: "handoff",
        content: `流水线阶段: ${stepLabel}`,
        data: { stage: i, stepLabel },
        timestamp: Date.now(),
      });

      const agentInput: AgentInput = {
        message: currentInput,
        context: {
          ...currentContext,
          pipelineStage: i,
          pipelineStep: stepLabel,
          totalStages: config.members.length,
        },
      };

      let result: AgentOutput;
      const stepTimeout = config.stepTimeout ?? 0;
      try {
        result = stepTimeout > 0
          ? await withTimeout(agent.run(agentInput), stepTimeout, `SEQUENTIAL stage ${i}`)
          : await agent.run(agentInput);
      } catch (err) {
        if (err instanceof AgentTimeoutError) {
          timedOut = true;
          timedOutAtStage = i;
          allSteps.push({
            agentRole: member.role,
            type: "response",
            content: `[SEQUENTIAL 超时] stage ${i} (${stepLabel}) 超过 ${stepTimeout}ms`,
            timestamp: Date.now(),
          });
          return {
            response: `[SEQUENTIAL 超时] stage ${i} (${stepLabel}) 超过 ${stepTimeout}ms`,
            level: "team",
            protocol: "SEQUENTIAL" as Protocol,
            steps: allSteps,
            agents,
            iterations: totalIterations,
            metadata: {
              duration: Date.now() - startTime,
              stages: config.members.length,
              completedStages: i,
              timedOut: true,
              timedOutStage: i,
            },
          };
        }
        throw err;
      }

      allSteps.push(...result.steps);
      totalIterations += result.iterations;

      // 传递给下一个阶段
      currentInput = result.response;
      currentContext = {
        ...currentContext,
        [`stage_${i}_result`]: result.response,
      };
    }

    const metadata: Record<string, unknown> = {
      duration: Date.now() - startTime,
      stages: config.members.length,
    };
    if (timedOut) {
      metadata.timedOut = true;
      if (timedOutAtStage !== undefined) metadata.timedOutStage = timedOutAtStage;
    }

    return {
      response: currentInput,
      level: "team",
      protocol: "SEQUENTIAL" as Protocol,
      steps: allSteps,
      agents,
      iterations: totalIterations,
      metadata,
    };
  }

  async *executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent> {
    let currentInput = input.message;
    let currentContext = input.context ?? {};

    for (let i = 0; i < config.members.length; i++) {
      const member = config.members[i];
      const agent = agentFactory(member);
      const stepLabel = config.pipelineSteps?.[i] ?? `步骤 ${i + 1}`;

      yield {
        event: "handoff",
        agentRole: member.role,
        data: { stage: i, stepLabel, totalStages: config.members.length },
      };

      const agentInput: AgentInput = {
        message: currentInput,
        context: {
          ...currentContext,
          pipelineStage: i,
          pipelineStep: stepLabel,
          totalStages: config.members.length,
        },
      };

      let response = "";
      for await (const event of agent.runStream(agentInput)) {
        yield event;
        if (event.event === "agent_done") {
          response = (event.data.response as string) ?? "";
        }
      }

      currentInput = response;
      currentContext = { ...currentContext, [`stage_${i}_result`]: response };
    }
  }
}
