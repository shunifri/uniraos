/**
 * Simple Agent: 标准 AI 接口封装
 *
 * 不使用工具调用，仅做纯 LLM 推理。适合简单问答、闲聊、知识查询。
 * 支持自定义角色人格与 Profile。
 */
import type { Message } from "../llm/types.js";
import type {
  Agent,
  AgentDeps,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  AgentStep,
} from "./types.js";

export class SimpleAgent implements Agent {
  readonly name: string;
  readonly level = "simple" as const;
  readonly profile: AgentProfile;
  private deps: AgentDeps;

  constructor(profile: AgentProfile, deps: AgentDeps) {
    this.name = `simple:${profile.role}`;
    this.profile = profile;
    this.deps = deps;
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];

    const messages = this.buildMessages(input);

    const response = await this.deps.provider.chat(messages);

    const reply = response.content ?? "";

    steps.push({
      agentRole: this.profile.role,
      type: "response",
      content: reply,
      timestamp: Date.now(),
    });

    return {
      response: reply,
      level: "simple",
      steps,
      iterations: 1,
      metadata: {
        duration: Date.now() - startTime,
        usage: response.usage,
      },
    };
  }

  async *runStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    const messages = this.buildMessages(input);

    yield {
      event: "agent_start",
      agentRole: this.profile.role,
      data: { level: "simple", role: this.profile.role },
    };

    if (this.deps.provider.chatStream) {
      let fullText = "";
      for await (const chunk of this.deps.provider.chatStream(messages)) {
        if (chunk.type === "text_delta" && chunk.text) {
          fullText += chunk.text;
          yield {
            event: "text_delta",
            agentRole: this.profile.role,
            data: { text: chunk.text },
          };
        }
      }

      yield {
        event: "agent_done",
        agentRole: this.profile.role,
        data: { response: fullText },
      };
    } else {
      const response = await this.deps.provider.chat(messages);
      const reply = response.content ?? "";

      yield {
        event: "text_delta",
        agentRole: this.profile.role,
        data: { text: reply },
      };
      yield {
        event: "agent_done",
        agentRole: this.profile.role,
        data: { response: reply },
      };
    }
  }

  private buildMessages(input: AgentInput): Message[] {
    const systemPrompt = this.buildSystemPrompt(input);
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
    ];

    if (input.history) {
      messages.push(...input.history);
    }

    messages.push({ role: "user", content: input.message });
    return messages;
  }

  private buildSystemPrompt(input: AgentInput): string {
    let prompt = this.profile.personality;

    // 注入记忆上下文
    if (input.context?.memoryContext && typeof input.context.memoryContext === "string") {
      prompt += input.context.memoryContext;
    }

    // 注入其他上下文
    const otherContext = input.context ? Object.fromEntries(
      Object.entries(input.context).filter(([k]) => k !== "memoryContext")
    ) : {};
    if (Object.keys(otherContext).length > 0) {
      prompt += `\n\n## 上下文信息\n${JSON.stringify(otherContext, null, 2)}`;
    }

    return prompt;
  }
}
