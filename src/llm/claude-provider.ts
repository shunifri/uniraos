/**
 * Claude (Anthropic) Provider
 */
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  LLMStreamChunk,
  Message,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (
      config.baseUrl ?? "https://api.anthropic.com"
    ).replace(/\/$/, "");
    this.maxTokens = config.maxTokens ?? 4096;
    this.temperature = config.temperature ?? 0.7;
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    stream = false,
  ): Record<string, unknown> {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: nonSystemMsgs.map((m) => this.formatMessage(m)),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    if (stream) body.stream = true;
    return body;
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<LLMResponse> {
    const body = this.buildRequestBody(messages, tools);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Claude API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as ClaudeResponse;
    return this.parseResponse(data);
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
  ): AsyncIterable<LLMStreamChunk> {
    const body = this.buildRequestBody(messages, tools, true);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Claude API error (${res.status}): ${errorText}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // 当前 content block 追踪
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let inToolUse = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);

          let event: Record<string, unknown>;
          try { event = JSON.parse(payload); } catch { continue; }

          const eventType = event.type as string;

          if (eventType === "content_block_start") {
            const block = event.content_block as Record<string, unknown>;
            if (block?.type === "tool_use") {
              inToolUse = true;
              currentToolId = block.id as string;
              currentToolName = block.name as string;
              currentToolArgs = "";
            }
          } else if (eventType === "content_block_delta") {
            const delta = event.delta as Record<string, unknown>;
            if (delta?.type === "text_delta") {
              yield { type: "text_delta", text: delta.text as string };
            } else if (delta?.type === "input_json_delta") {
              const partial = delta.partial_json as string;
              currentToolArgs += partial;
              yield {
                type: "tool_call_delta",
                toolCallId: currentToolId,
                toolCallName: currentToolName,
                toolCallArgs: partial,
              };
            }
          } else if (eventType === "content_block_stop") {
            if (inToolUse) {
              yield {
                type: "tool_call_complete",
                toolCallId: currentToolId,
                toolCallName: currentToolName,
                toolCallArgs: currentToolArgs,
              };
              inToolUse = false;
            }
          } else if (eventType === "message_delta") {
            const delta = event.delta as Record<string, unknown>;
            const usage = event.usage as Record<string, number> | undefined;
            yield {
              type: "done",
              finishReason: delta?.stop_reason === "tool_use" ? "tool_calls" : "stop",
              usage: usage ? {
                promptTokens: usage.input_tokens ?? 0,
                completionTokens: usage.output_tokens ?? 0,
                totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
              } : undefined,
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private formatMessage(msg: Message): Record<string, unknown> {
    if (msg.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId,
            content: msg.content,
          },
        ],
      };
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const content: unknown[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      return { role: "assistant", content };
    }

    return {
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    };
  }

  private parseResponse(data: ClaudeResponse): LLMResponse {
    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent || null,
      toolCalls,
      finishReason:
        data.stop_reason === "tool_use"
          ? "tool_calls"
          : data.stop_reason === "max_tokens"
            ? "length"
            : "stop",
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens:
              data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
    };
  }
}

// Claude API response types
interface ClaudeResponse {
  content: (
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  )[];
  stop_reason: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}
