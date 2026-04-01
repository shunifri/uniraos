/**
 * LLM Provider 抽象类型
 */

/** 支持的 LLM 提供商 */
export type LLMProviderType = "openai" | "claude" | "openai-compatible";

/** LLM 提供商配置 */
export interface LLMProviderConfig {
  type: LLMProviderType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/** 消息角色 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** 对话消息 */
export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具定义（传给 LLM 的） */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** LLM 响应 */
export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** LLM 流式输出块 */
export interface LLMStreamChunk {
  type: "text_delta" | "tool_call_delta" | "tool_call_complete" | "done";
  /** 文字增量 */
  text?: string;
  /** tool call 相关字段 */
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgs?: string;
  /** 结束原因 */
  finishReason?: string;
  /** token 用量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** LLM Provider 接口 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
  /** 流式输出（可选，向后兼容） */
  chatStream?(messages: Message[], tools?: ToolDefinition[]): AsyncIterable<LLMStreamChunk>;
}

// ===== 多模态类型 =====

/** 多模态内容类型 */
export type MediaType = "image" | "audio" | "video";

/** 多模态生成请求 */
export interface MediaGenerateRequest {
  /** 生成类型 */
  type: MediaType;
  /** 文本提示词 */
  prompt: string;
  /** 可选：参考图/音频（base64 或 URL） */
  referenceMedia?: string;
  /** 模型名称（可选，覆盖默认） */
  model?: string;
  /** 类型特定参数 */
  options?: Record<string, unknown>;
}

/** 多模态生成结果 */
export interface MediaGenerateResult {
  /** 生成的内容 URL 或 base64 */
  url?: string;
  base64?: string;
  /** 内容类型 (e.g. image/png, audio/mp3) */
  mimeType: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 多模态理解请求 */
export interface MediaUnderstandRequest {
  /** 内容类型 */
  type: MediaType;
  /** 媒体内容（base64 或 URL） */
  media: string;
  /** 理解提示词（如 "描述这张图片"） */
  prompt: string;
  /** 模型名称 */
  model?: string;
}

/** 多模态理解结果 */
export interface MediaUnderstandResult {
  /** 理解结果文本 */
  content: string;
  /** 结构化数据（如 OCR 结果、标签等） */
  structured?: Record<string, unknown>;
}

/** 多模态 Provider 接口 */
export interface MultimodalProvider {
  readonly name: string;
  /** 支持的生成类型 */
  supportedGenerateTypes: MediaType[];
  /** 支持的理解类型 */
  supportedUnderstandTypes: MediaType[];
  /** 生成多媒体内容 */
  generate(request: MediaGenerateRequest): Promise<MediaGenerateResult>;
  /** 理解/分析多媒体内容 */
  understand(request: MediaUnderstandRequest): Promise<MediaUnderstandResult>;
}
