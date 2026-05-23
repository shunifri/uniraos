/**
 * Plan Agent: 基于规划执行的智能体
 *
 * 先分析任务生成执行计划，再按计划逐步执行。
 * 支持动态调整（计划中途发现问题可重新规划）。
 */
import type { Message } from "../llm/types.js";
import { getCurrentUserId } from "../user/request-context.js";
import type {
  Agent,
  AgentDeps,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  AgentStep,
} from "./types.js";
import { ReactAgent } from "./react-agent.js";

export class PlanAgent implements Agent {
  readonly name: string;
  readonly level = "plan" as const;
  readonly profile: AgentProfile;
  private deps: AgentDeps;
  private maxSteps: number;
  private allowReplan: boolean;

  constructor(
    profile: AgentProfile,
    deps: AgentDeps,
    opts?: { maxSteps?: number; allowReplan?: boolean },
  ) {
    this.name = `plan:${profile.role}`;
    this.profile = profile;
    this.deps = deps;
    this.maxSteps = opts?.maxSteps ?? 10;
    this.allowReplan = opts?.allowReplan ?? true;
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];

    // 首先生成计划
    const plan = await this.generatePlan(input);

    if (!plan || plan.steps.length === 0) {
      // 无法生成计划，降级到 React Agent
      steps.push({
        agentRole: this.profile.role,
        type: "thinking",
        content: "无法生成执行计划，降级到直接执行模式",
        timestamp: Date.now(),
      });

      const reactAgent = new ReactAgent(this.profile, this.deps, { maxIterations: this.maxSteps });
      const result = await reactAgent.run(input);
      return {
        ...result,
        level: "plan",
        steps: [...steps, ...result.steps],
      };
    }

    // 记录计划生成
    steps.push({
      agentRole: this.profile.role,
      type: "thinking",
      content: `执行计划: ${plan.steps.map((s) => s.description).join(" → ")}`,
      timestamp: Date.now(),
    });

    // 执行计划
    const results: Array<{ step: number; success: boolean; data?: unknown; error?: string }> = [];
    let iterations = 0;

    for (let i = 0; i < plan.steps.length; i++) {
      iterations++;
      const step = plan.steps[i];

      steps.push({
        agentRole: this.profile.role,
        type: "tool_call",
        data: { name: step.skill, arguments: step.params, description: step.description },
        timestamp: Date.now(),
      });

      try {
        const result = await this.deps.engine.execute(step.skill, step.params);
        results.push({ step: i + 1, success: result.success, data: result.data });

        steps.push({
          agentRole: this.profile.role,
          type: "tool_result",
          data: { success: result.success, data: result.data, error: result.error?.message },
          timestamp: Date.now(),
        });

        if (!result.success && this.allowReplan) {
          // 执行失败，尝试重新规划
          steps.push({
            agentRole: this.profile.role,
            type: "thinking",
            content: `步骤 ${i + 1} 执行失败，尝试重新规划剩余步骤`,
            timestamp: Date.now(),
          });
          break;
        }
      } catch (err) {
        results.push({ step: i + 1, success: false, error: err instanceof Error ? err.message : String(err) });

        steps.push({
          agentRole: this.profile.role,
          type: "tool_result",
          data: { success: false, error: err instanceof Error ? err.message : String(err) },
          timestamp: Date.now(),
        });

        if (this.allowReplan) break;
      }
    }

    const successCount = results.filter((r) => r.success).length;

    // 使用最后一个成功的结果作为回复，或者使用 LLM 综合结果
    const response = await this.synthesizeResponse(input, results);

    return {
      response,
      level: "plan",
      steps,
      iterations,
      metadata: {
        duration: Date.now() - startTime,
        totalSteps: plan.steps.length,
        completedSteps: results.length,
        successSteps: successCount,
      },
    };
  }

  async *runStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    yield {
      event: "agent_start",
      agentRole: this.profile.role,
      data: { level: "plan", role: this.profile.role },
    };

    // 生成计划阶段
    yield {
      event: "agent_thinking",
      agentRole: this.profile.role,
      data: { phase: "generating_plan" },
    };

    const plan = await this.generatePlan(input);

    if (!plan || plan.steps.length === 0) {
      yield {
        event: "thinking" as any,
        agentRole: this.profile.role,
        data: { content: "无法生成执行计划，降级到直接执行模式" },
      };

      // 降级到 React Agent 流式执行
      const reactAgent = new ReactAgent(this.profile, this.deps, { maxIterations: this.maxSteps });
      for await (const event of reactAgent.runStream(input)) {
        yield event;
      }
      return;
    }

    yield {
      event: "thinking" as any,
      agentRole: this.profile.role,
      data: {
        content: `执行计划: ${plan.steps.map((s) => s.description).join(" → ")}`,
      },
    };

    // 执行计划阶段
    const results: Array<{ step: number; success: boolean; data?: unknown; error?: string }> = [];
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      yield {
        event: "tool_call",
        agentRole: this.profile.role,
        data: { toolCall: { id: `step_${i + 1}`, name: step.skill, arguments: step.params } },
      };

      yield {
        event: "tool_start",
        agentRole: this.profile.role,
        data: { skillName: step.skill, toolCallId: `step_${i + 1}` },
      };

      try {
        const result = await this.deps.engine.execute(step.skill, step.params);
        results.push({ step: i + 1, success: result.success, data: result.data });

        yield {
          event: "tool_result",
          agentRole: this.profile.role,
          data: {
            skillName: step.skill,
            toolCallId: `step_${i + 1}`,
            result: { success: result.success, data: result.data, error: result.error?.message },
          },
        };

        if (!result.success && this.allowReplan) {
          yield {
            event: "thinking" as any,
            agentRole: this.profile.role,
            data: { content: `步骤 ${i + 1} 执行失败，尝试重新规划剩余步骤` },
          };
          break;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({ step: i + 1, success: false, error: errMsg });

        yield {
          event: "tool_result",
          agentRole: this.profile.role,
          data: {
            skillName: step.skill,
            toolCallId: `step_${i + 1}`,
            result: { success: false, error: errMsg },
          },
        };

        if (this.allowReplan) break;
      }
    }

    // 生成最终回复消息并发送给前端（包含 tool 结果中的 message，如 <app-design-card>）
    const response = await this.synthesizeResponse(input, results);
    yield {
      event: "message" as any,
      agentRole: this.profile.role,
      data: { role: "assistant", content: response },
    };

    yield {
      event: "agent_done",
      agentRole: this.profile.role,
      data: { response },
    };
  }

  private async generatePlan(input: AgentInput): Promise<{
    steps: Array<{ skill: string; params: Record<string, unknown>; description: string }>;
  } | null> {
    try {
      const availableSkills = this.deps.registry.listVisible().map((s) => ({
        name: s.name,
        description: s.description,
      }));

      const planPrompt = `你是一个任务规划器。根据以下任务描述，生成一个执行计划。

任务: ${input.message}

可用 Skill:
${availableSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}

请生成一个 JSON 格式的执行计划:
{
  "steps": [
    {"skill": "skill_name", "params": {...}, "description": "步骤描述"},
    ...
  ]
}

规则:
1. 每个步骤使用一个可用 Skill
2. 步骤之间可以传递数据（后续步骤可引用前序结果）
3. 最多 ${this.maxSteps} 个步骤
4. 如果任务无法用现有 Skill 完成，返回 {"steps": [], "reason": "原因"}
5. 对于简单的信息查询或整理任务，通常只需要使用 1-2 个步骤
6. 确保每个步骤的 params 是有效的，符合该 Skill 的预期参数格式

只输出 JSON，不要其他内容。`;

      console.log("=== 生成执行计划 ===");
      console.log("任务:", input.message);
      console.log("可用技能:", availableSkills.map(s => s.name).join(", "));

      const response = await this.deps.provider.chat([
        { role: "user", content: planPrompt },
      ]);

      let jsonStr = (response.content ?? "").trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      console.log("=== LLM 回复 ===");
      console.log(jsonStr);

      const plan = JSON.parse(jsonStr);

      if (!plan.steps || plan.steps.length === 0) {
        console.log("=== 计划为空，返回 null ===");
        return null;
      }

      // 验证生成的步骤是否有效
      const validSteps = plan.steps.filter((step: any) => {
        if (!step.skill) {
          console.log("无效步骤：缺少 skill 字段");
          return false;
        }
        if (!availableSkills.some(s => s.name === step.skill)) {
          console.log(`无效步骤：未知技能 ${step.skill}`);
          return false;
        }
        if (!step.params || typeof step.params !== "object") {
          step.params = {};
        }
        return true;
      });

      if (validSteps.length === 0) {
        console.log("=== 所有步骤都无效，返回 null ===");
        return null;
      }

      console.log("=== 生成的有效计划 ===");
      console.log(validSteps);

      return { steps: validSteps };
    } catch (error) {
      console.error("=== 生成计划失败 ===");
      console.error(error);
      return null;
    }
  }

  private async synthesizeResponse(
    input: AgentInput,
    results: Array<{ step: number; success: boolean; data?: unknown; error?: string }>,
  ): Promise<string> {
    const successResults = results.filter((r) => r.success);

    if (successResults.length === 0) {
      return "所有步骤执行失败，无法完成任务。";
    }

    if (successResults.length === 1) {
      const result = successResults[0].data;
      if (result && typeof result === "object") {
        if ("message" in result) {
          return String(result.message);
        }
        if ("response" in result) {
          return String(result.response);
        }
        if ("description" in result) {
          return String(result.description);
        }
        return JSON.stringify(result, null, 2);
      }
      return String(result ?? "执行完成");
    }

    return `已完成 ${successResults.length}/${results.length} 个步骤。`;
  }
}
