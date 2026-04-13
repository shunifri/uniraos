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
    this.maxIterations = opts?.maxIterations ?? 15;
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
          result = { success: false, error: err instanceof Error ? err.message : String(err) };
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
            result = { success: false, error: err instanceof Error ? err.message : String(err) };
          }

          // 检测 user_confirm：暂停等待用户确认
          if (result.success && (result.data as any)?.__userConfirm) {
            const confirmData = result.data as any;
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };
            // 等待用户确认（通过 confirmQueue）
            const { confirmQueue } = await import("../skills/user-confirm-skill.js");
            const userResponse = await new Promise<unknown>((resolve, reject) => {
              const timer = setTimeout(() => { confirmQueue.delete(confirmData.confirmId); reject(new Error("用户确认超时")); }, 600000);
              confirmQueue.set(confirmData.confirmId, { resolve, reject, timeout: timer });
            }).catch((err: any) => ({ cancelled: true, message: err.message }));
            // 将用户回复作为 tool result
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
            result = { success: false, error: err instanceof Error ? err.message : String(err) };
          }

          // 检测 user_confirm
          if (result.success && (result.data as any)?.__userConfirm) {
            const confirmData = result.data as any;
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };
            const { confirmQueue } = await import("../skills/user-confirm-skill.js");
            const userResponse = await new Promise<unknown>((resolve, reject) => {
              const timer = setTimeout(() => { confirmQueue.delete(confirmData.confirmId); reject(new Error("用户确认超时")); }, 600000);
              confirmQueue.set(confirmData.confirmId, { resolve, reject, timeout: timer });
            }).catch((err: any) => ({ cancelled: true, message: err.message }));
            messages.push({ role: "tool", content: JSON.stringify({ userResponse, confirmed: true }), toolCallId: toolCall.id });
          } else {
            yield { event: "tool_result", agentRole: this.profile.role, data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };
            messages.push({ role: "tool", content: JSON.stringify(result, null, 2), toolCallId: toolCall.id });
          }
        }
      }
    }

    const lastMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
    yield { event: "agent_done", agentRole: this.profile.role, data: { response: lastMsg?.content ?? "[max iterations]" } };
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

    // 注入其他上下文（排除已处理的 memoryContext）
    const otherContext = input.context ? Object.fromEntries(
      Object.entries(input.context).filter(([k]) => k !== "memoryContext")
    ) : {};
    if (Object.keys(otherContext).length > 0) {
      systemPrompt += `\n\n## 上下文信息\n${JSON.stringify(otherContext, null, 2)}`;
    }

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
