/**
 * ReAct Agent: 基于 Reasoning-Acting 循环的智能体
 *
 * 封装现有 AgentLoop，支持自定义 Profile、Skill 过滤。
 * 具备自省与自主工具调用能力。
 */
import type { ChatOptions, Message, ToolDefinition } from "../llm/types.js";
import { skillsToTools } from "../llm/tool-bridge.js";
import { getCurrentUserId } from "../user/request-context.js";
import type { SkillAccessService } from "../engine/skill-access-service.js";
import { SkillAccessService as SkillAccessServiceImpl } from "../engine/skill-access-service.js";
import type {
  Agent,
  AgentDeps,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  AgentStep,
} from "./types.js";

export class ReactAgent implements Agent {
  readonly name: string;
  readonly level = "react" as const;
  readonly profile: AgentProfile;
  private deps: AgentDeps;
  private maxIterations: number;
  private skillAccessService: SkillAccessService;

  constructor(
    profile: AgentProfile,
    deps: AgentDeps,
    opts?: { maxIterations?: number; skillAccessService?: SkillAccessService },
  ) {
    this.name = `react:${profile.role}`;
    this.profile = profile;
    this.deps = deps;
    // P1-29: 默认 maxIterations 15 不够多 query 数据分析任务 (用户真实场景跑了 15 次 tool 正好 hitMax).
    // 提到 30, 给 LLM 足够空间先 batch 查数据再总结.
    this.maxIterations = opts?.maxIterations ?? 30;
    this.skillAccessService = opts?.skillAccessService ?? new SkillAccessServiceImpl(deps.registry);
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];
    const tools = await this.getFilteredTools();
    const messages = this.buildMessages(input);
    const chatOptions: ChatOptions | undefined = input.context?.deepThink ? { deepThink: true } : undefined;

    let iterations = 0;
    let hitMax = false;

    while (iterations < this.maxIterations) {
      iterations++;

      const response = await this.deps.provider.chat(messages, tools, chatOptions);

      if (response.content) {
        steps.push({
          agentRole: this.profile.role,
          type: "response",
          content: response.content,
          timestamp: Date.now(),
        });
      }

      if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0) {
        messages.push({ role: "assistant", content: response.content ?? "" });
        break;
      }

      messages.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        steps.push({
          agentRole: this.profile.role,
          type: "tool_call",
          data: { name: toolCall.name, arguments: toolCall.arguments },
          timestamp: Date.now(),
        });

        let result: Record<string, unknown>;
        try {
          const params = toolCall.arguments.params
            ? (toolCall.arguments.params as Record<string, unknown>)
            : toolCall.arguments;
          const execResult = await this.deps.engine.execute(toolCall.name, params);
          result = {
            success: execResult.success,
            data: execResult.data,
            error: execResult.error?.message,
          };
        } catch (err) {
          result = { success: false, error: err instanceof Error ? (err as Error).message : String(err) };
        }

        if (result.success && (result.data as any)?.__userConfirm) {
          result = { success: false, error: "user_confirm requires streaming mode (SSE)" };
        }

        steps.push({
          agentRole: this.profile.role,
          type: "tool_result",
          data: result,
          timestamp: Date.now(),
        });

        messages.push({
          role: "tool",
          content: JSON.stringify(result, null, 2),
          toolCallId: toolCall.id,
        });
      }

      if (iterations >= this.maxIterations) hitMax = true;
    }

    const lastMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
    const response = lastMsg?.content ?? "[ReAct Agent reached max iterations]";

    return {
      response,
      level: "react",
      steps,
      iterations,
      metadata: {
        duration: Date.now() - startTime,
        hitMaxIterations: hitMax,
      },
    };
  }

  async *runStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    const tools = await this.getFilteredTools();
    const messages = this.buildMessages(input);
    // deepThink 只在第一轮迭代使用，后续迭代不再触发深度思考
    let chatOptions: ChatOptions | undefined = input.context?.deepThink ? { deepThink: true } : undefined;

    yield {
      event: "agent_start",
      agentRole: this.profile.role,
      data: { level: "react", role: this.profile.role, skills: tools.map((t) => t.function.name) },
    };

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      yield {
        event: "agent_thinking",
        agentRole: this.profile.role,
        data: { iteration: iterations },
      };

        if (this.deps.provider.chatStream) {
          let textContent = "";
          const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

          let thinkBuf = "";
          for await (const chunk of this.deps.provider.chatStream(messages, tools, chatOptions)) {
          if (chunk.type === "text_delta" && chunk.text) {
            // reasoning_content → thinking 事件
            if ((chunk as any).reasoning) {
              thinkBuf += chunk.text;
              if (thinkBuf.length > 100) {
                yield { event: "thinking" as any, agentRole: this.profile.role, data: { content: thinkBuf } };
                thinkBuf = "";
              }
              continue;
            }
            if (thinkBuf) {
              yield { event: "thinking" as any, agentRole: this.profile.role, data: { content: thinkBuf } };
              thinkBuf = "";
            }
            textContent += chunk.text;
            yield { event: "text_delta", agentRole: this.profile.role, data: { text: chunk.text } };
          } else if (chunk.type === "tool_call_complete") {
            const tc = {
              id: chunk.toolCallId!,
              name: chunk.toolCallName!,
              arguments: safeJsonParse(chunk.toolCallArgs ?? "{}"),
            };
            toolCalls.push(tc);
            yield { event: "tool_call", agentRole: this.profile.role, data: { toolCall: tc } };
          }
        }
        // Flush remaining think buffer
        if (thinkBuf) {
          yield { event: "thinking" as any, agentRole: this.profile.role, data: { content: thinkBuf } };
          thinkBuf = "";
        }

        if (toolCalls.length === 0) {
          messages.push({ role: "assistant", content: textContent });
          yield { event: "agent_done", agentRole: this.profile.role, data: { response: textContent } };
          return;
        }

        messages.push({ role: "assistant", content: textContent, toolCalls });
        // 第一轮之后关闭 deepThink，后续迭代不再触发深度思考
        chatOptions = undefined;

        for (const toolCall of toolCalls) {
          yield { event: "tool_start", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id } };

          let result: Record<string, unknown>;
          try {
            const params = toolCall.arguments.params
              ? (toolCall.arguments.params as Record<string, unknown>)
              : toolCall.arguments;
            const execResult = await this.deps.engine.execute(toolCall.name, params);
            result = { success: execResult.success, data: execResult.data, error: execResult.error?.message };
          } catch (err) {
            result = { success: false, error: err instanceof Error ? (err as Error).message : String(err) };
          }

          // 检测 user_confirm：暂停等待用户确认
          if (result.success && (result.data as any)?.__userConfirm) {
            const confirmData = result.data as any;
            // 直接发送 user_confirm 事件，确保前端能正确显示 ConfirmCard
            yield { event: "user_confirm", agentRole: this.profile.role, data: confirmData };
            // 等待用户确认（通过 confirmQueue），不设超时，用户想填多久都行
            const { confirmQueue } = await import("../skills/user-confirm-skill.js");
            const userResponse = await new Promise<unknown>((resolve, reject) => {
              confirmQueue.set(confirmData.confirmId, { resolve, reject });
            }).catch((err: unknown) => ({ cancelled: true, message: (err as Error).message }));
            // 发送包含用户响应的 tool_result 事件，确保后端持久化用户提交的表单数据
            const userResult = { success: true, data: { userResponse } };
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result: userResult } };
            // 将用户回复作为 tool result 加入对话上下文
            messages.push({ role: "tool", content: JSON.stringify({ userResponse, confirmed: true }), toolCallId: toolCall.id });
          } else {
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };
            messages.push({ role: "tool", content: JSON.stringify(result, null, 2), toolCallId: toolCall.id });
          }
        }
      } else {
        // 非流式 fallback
        const response = await this.deps.provider.chat(messages, tools, chatOptions);

        if (response.content) {
          yield { event: "text_delta", agentRole: this.profile.role, data: { text: response.content } };
        }

        if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0) {
          messages.push({ role: "assistant", content: response.content ?? "" });
          yield { event: "agent_done", agentRole: this.profile.role, data: { response: response.content ?? "" } };
          return;
        }

        messages.push({ role: "assistant", content: response.content ?? "", toolCalls: response.toolCalls });

        for (const toolCall of response.toolCalls) {
          yield { event: "tool_start", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id } };

          let result: Record<string, unknown>;
          try {
            const params = toolCall.arguments.params
              ? (toolCall.arguments.params as Record<string, unknown>)
              : toolCall.arguments;
            const execResult = await this.deps.engine.execute(toolCall.name, params);
            result = { success: execResult.success, data: execResult.data, error: execResult.error?.message };
          } catch (err) {
            result = { success: false, error: err instanceof Error ? (err as Error).message : String(err) };
          }

          // 检测 user_confirm
          if (result.success && (result.data as any)?.__userConfirm) {
            const confirmData = result.data as any;
            // 直接发送 user_confirm 事件，确保前端能正确显示 ConfirmCard
            yield { event: "user_confirm", agentRole: this.profile.role, data: confirmData };
            const { confirmQueue } = await import("../skills/user-confirm-skill.js");
            // 等待用户确认，不设超时
            const userResponse = await new Promise<unknown>((resolve, reject) => {
              confirmQueue.set(confirmData.confirmId, { resolve, reject });
            }).catch((err: unknown) => ({ cancelled: true, message: (err as Error).message }));
            // 发送包含用户响应的 tool_result 事件，确保后端持久化用户提交的表单数据
            const userResult = { success: true, data: { userResponse } };
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result: userResult } };
            messages.push({ role: "tool", content: JSON.stringify({ userResponse, confirmed: true }), toolCallId: toolCall.id });
          } else {
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };
            messages.push({ role: "tool", content: JSON.stringify(result, null, 2), toolCallId: toolCall.id });
          }
        }
      }
    }

    // P1-29: 之前 hitMax 时直接用 lastMsg.content (空字符串) 返回, 用户看不到任何总结.
    // 真实场景: 最后一轮 LLM 只发 tool_call 没生成 content, 准备下轮总结但已经 hitMax 被截断.
    // 修法: 强制调一次 final LLM, 移除 tools, 让它基于已收集的 tool_result 给出总结.
    const lastMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
    if (!lastMsg?.content || !lastMsg.content.trim()) {
      try {
        const summaryMessages: Message[] = [
          ...messages,
          { role: "user", content: "你已用完所有迭代次数, 请直接基于已收集的工具结果给出最终分析/总结. 不要继续调用工具." },
        ];
        let summary = "";
        if (this.deps.provider.chatStream) {
          for await (const chunk of this.deps.provider.chatStream(summaryMessages, [], { deepThink: false })) {
            if (chunk.type === "text_delta" && chunk.text) {
              summary += chunk.text;
              yield { event: "text_delta", agentRole: this.profile.role, data: { text: chunk.text } };
            }
          }
        } else {
          const r = await this.deps.provider.chat(summaryMessages, []);
          summary = r.content ?? "";
          if (summary) yield { event: "text_delta", agentRole: this.profile.role, data: { text: summary } };
        }
        if (summary) {
          messages.push({ role: "assistant", content: summary });
          yield { event: "agent_done", agentRole: this.profile.role, data: { response: summary } };
          return;
        }
      } catch (err) {
        // 总结失败, fallthrough 到老逻辑
        console.warn("[react-agent] final summary failed:", err);
      }
    }

    yield { event: "agent_done", agentRole: this.profile.role, data: { response: lastMsg?.content ?? "[max iterations] 已达到最大迭代次数, 请尝试简化问题或拆成多次对话." } };
  }

  private async getFilteredTools(): Promise<ToolDefinition[]> {
    try {
      const userId = getCurrentUserId();
      if (!userId || userId === "default") {
        // 未登录用户，返回所有可见 Skill
        return skillsToTools(this.deps.registry.listVisible());
      }

      // 使用 SkillAccessService 获取可用 Skill（带缓存）
      const accessResult = await this.skillAccessService.getAccessibleSkills(userId, {
        visibleOnly: true,
        allowedSkills: this.profile.allowedSkills.length > 0 ? this.profile.allowedSkills : undefined,
      });

      return skillsToTools(accessResult.skills);
    } catch {
      // DB 不可用或无用户上下文，返回所有可见 Skill
      return skillsToTools(this.deps.registry.listVisible());
    }
  }

  private buildMessages(input: AgentInput): Message[] {
    let systemPrompt = this.profile.personality;

    // 注入记忆上下文（由 Orchestrator 检索后传入）
    if (input.context?.memoryContext && typeof input.context.memoryContext === "string") {
      systemPrompt += input.context.memoryContext;
    }

    // 注入计划上下文（纯文本，直接追加）
    if (input.context?.planContext && typeof input.context.planContext === "string") {
      systemPrompt += input.context.planContext as string;
    }

    // 注入其他上下文（排除已处理的 memoryContext 和 planContext）
    const otherContext = input.context ? Object.fromEntries(
      Object.entries(input.context).filter(([k]) => k !== "memoryContext" && k !== "planContext")
    ) : {};
    if (Object.keys(otherContext).length > 0) {
      systemPrompt += `\n\n## 上下文信息\n${JSON.stringify(otherContext, null, 2)}`;
    }

    // user_confirm 使用规则：当需要人机交互确认时，必须调用 user_confirm 工具
    systemPrompt += `\n\n## 人机交互规则（必须严格遵守）\n1. 当任务需要用户做出选择、填写信息或确认操作时，不要直接在回答文本中列出问题或选项。必须调用 user_confirm 工具，在前端生成交互卡片（选项卡/表单/确认框），暂停对话等待用户操作。\n2. 严禁在回答末尾用"是否需要..."、"请问..."、"请告诉我..."、"您是否需要..."等方式追问用户。如果需要用户确认，必须在回答开头或中间就调用 user_confirm 工具。\n3. 回答完毕后直接结束，不要追加任何追问或推荐问题。\n适用场景：让用户选择方案/专业/时间、收集用户信息、确认删除/提交/继续、审批决策等。`;

    const messages: Message[] = [{ role: "system", content: systemPrompt }];

    if (input.history) {
      messages.push(...input.history);
    }

    messages.push({ role: "user", content: input.message });
    return messages;
  }
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}
