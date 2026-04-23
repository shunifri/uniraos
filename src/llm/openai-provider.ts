/**
 * OpenAI 兼容 Provider（支持 OpenAI、DeepSeek、本地 Ollama 等）
 */
import type {
  ChatOptions,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  LLMStreamChunk,
  Message,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMProviderConfig) {
    this.name = config.type;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
    // max_tokens 是输出 token 上限，大多数模型限制在 4096~32768 之间
    this.maxTokens = Math.min(config.maxTokens ?? 4096, 32768);
    this.temperature = config.temperature ?? 0.7;
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    stream = false,
    options?: ChatOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => this.formatMessage(m)),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (stream) body.stream = true;

    // 深度思考模式：不同模型有不同的 API 参数
    if (options?.deepThink) {
      // DeepSeek 的思考模式 (火山引擎/官方 API)
      body.thinking = { type: "enabled", budget_tokens: 8192 };
      // 思考模式下不支持 temperature
      delete body.temperature;
      console.log(`   [DeepThink] Enabled for model ${this.model}, budget_tokens=8192`);
    }

    return body;
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const body = this.buildRequestBody(messages, tools, false, options);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`LLM API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    if (choice) {
      const rawContent = choice.message.content;
      console.log(`[OpenAIProvider] rawContent type: ${typeof rawContent}, isArray: ${Array.isArray(rawContent)}, preview: ${typeof rawContent === "string" ? rawContent.slice(0, 100) : JSON.stringify(rawContent).slice(0, 100)}`);
    }
    return this.parseResponse(data);
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMStreamChunk> {
    const body = this.buildRequestBody(messages, tools, true, options);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`LLM API error (${res.status}): ${errorText}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // 按 index 缓冲 tool call 增量
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
    let loggedR = false, loggedC = false; // 每次 chatStream 调用独立的日志标记

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            // flush remaining tool calls
            for (const [, tc] of toolCallBuffers) {
              yield {
                type: "tool_call_complete",
                toolCallId: tc.id,
                toolCallName: tc.name,
                toolCallArgs: tc.args,
              };
            }
            yield { type: "done" };
            return;
          }

          let data: OpenAIStreamDelta;
          try { data = JSON.parse(payload); } catch { continue; }

          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;
          // DEBUG: 打印 content 到来（不管是否同时有 reasoning）
          if (delta.content && !loggedC) {
            console.log(`   [Provider] content arrived: "${String(delta.content).slice(0, 80)}", hasReasoning=${!!delta.reasoning_content}`);
            loggedC = true;
          }

          // reasoning_content (DeepSeek thinking mode)
          if (delta.reasoning_content) {
            if (!loggedR) { console.log("   [Provider] Got reasoning_content"); loggedR = true; }
            yield { type: "text_delta", text: delta.reasoning_content, reasoning: true } as any;
          }

          // text content
          if (delta.content) {
            if (!loggedC) { console.log(`   [Provider] Got content: "${(delta.content as string).slice(0, 50)}"`); loggedC = true; }
            let text = delta.content as string;
            // 如果包含 <think> 标签，提取思考内容单独发送
            if (text.includes("<think>") || text.includes("</think>")) {
              // 累积处理：移除 think 标签，内容作为 reasoning 发送
              text = text.replace(/<think>/g, "").replace(/<\/think>/g, "");
              if (text.trim()) {
                yield { type: "text_delta", text };
              }
            } else {
              yield { type: "text_delta", text };
            }
          }

          // tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallBuffers.has(idx)) {
                toolCallBuffers.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" });
              }
              const buf = toolCallBuffers.get(idx)!;
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) {
                buf.args += tc.function.arguments;
                yield {
                  type: "tool_call_delta",
                  toolCallId: buf.id,
                  toolCallName: buf.name,
                  toolCallArgs: tc.function.arguments,
                };
              }
            }
          }

          // finish_reason
          const finishReason = data.choices?.[0]?.finish_reason;
          if (finishReason) {
            console.log(`   [Provider] finish_reason=${finishReason}, hasContent=${!!delta.content}, deltaKeys=${Object.keys(delta).join(",")}`);
          }
          if (finishReason === "tool_calls" || finishReason === "stop") {
            for (const [, tc] of toolCallBuffers) {
              yield {
                type: "tool_call_complete",
                toolCallId: tc.id,
                toolCallName: tc.name,
                toolCallArgs: tc.args,
              };
            }
            toolCallBuffers.clear();
            if (finishReason === "stop") {
              yield { type: "done", finishReason: "stop", usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              } : undefined };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private formatMessage(
    msg: Message,
  ): Record<string, unknown> {
    // content 必须是 string，部分 API（如 DeepSeek）不接受 null
    const formatted: Record<string, unknown> = {
      role: msg.role,
      content: msg.content ?? "",
    };

    if (msg.role === "tool" && msg.toolCallId) {
      formatted.tool_call_id = msg.toolCallId;
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      formatted.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    return formatted;
  }

  private parseResponse(data: OpenAIChatResponse): LLMResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      return {
        content: null,
        toolCalls: [],
        finishReason: "error",
      };
    }

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJsonParse(tc.function.arguments),
      }),
    );

    const finishReason =
      choice.finish_reason === "tool_calls"
        ? "tool_calls"
        : choice.finish_reason === "length"
          ? "length"
          : toolCalls.length > 0
            ? "tool_calls"
            : "stop";

    // 规范化 content：某些兼容 API 可能返回对象/数组而不是字符串
    let content: string | null = null;
    const rawContent = choice.message.content;
    if (typeof rawContent === "string") {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      // OpenAI 多模态格式：content = [{type: "text", text: "..."}, ...]
      // 防御性处理：text 字段可能是对象（某些兼容 API）
      content = rawContent
        .filter((item: unknown) => typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "text")
        .map((item: unknown) => {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") return text;
          if (text !== null && text !== undefined) {
            try {
              return JSON.stringify(text);
            } catch {
              return String(text);
            }
          }
          return "";
        })
        .join("");
    } else if (rawContent !== null && rawContent !== undefined) {
      // 兜底：对象格式直接 JSON.stringify
      try {
        content = JSON.stringify(rawContent);
      } catch {
        content = String(rawContent);
      }
    }

    return {
      content,
      toolCalls,
      finishReason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}

// OpenAI streaming delta types
interface OpenAIStreamDelta {
  choices?: {
    delta: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// OpenAI API response types
// content 可能是 string、null，也可能是数组（OpenAI 多模态新格式）或对象（某些兼容 API）
interface OpenAIChatResponse {
  choices: {
    message: {
      role: string;
      content: string | null | unknown[] | Record<string, unknown>;
      tool_calls?: {
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
