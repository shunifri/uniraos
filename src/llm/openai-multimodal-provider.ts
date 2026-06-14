/**
 * OpenAI 兼容多模态 Provider
 * 支持：DALL-E 图像生成、GPT-4o 视觉理解、TTS 语音生成、Whisper 语音识别
 * 兼容 OpenAI 接口的其他服务也可使用
 */
import type {
  MultimodalProvider,
  MediaType,
  MediaGenerateRequest,
  MediaGenerateResult,
  MediaUnderstandRequest,
  MediaUnderstandResult,
} from "./types.js";

export interface OpenAIMultimodalConfig {
  apiKey: string;
  baseUrl?: string;
  /** 图像生成模型（默认 dall-e-3） */
  imageModel?: string;
  /** 视觉理解模型（默认 gpt-4o） */
  visionModel?: string;
  /** TTS 模型（默认 tts-1） */
  ttsModel?: string;
  /** 语音识别模型（默认 whisper-1） */
  whisperModel?: string;
}

export class OpenAIMultimodalProvider implements MultimodalProvider {
  readonly name = "openai-multimodal";
  readonly supportedGenerateTypes: MediaType[] = ["image", "audio"];
  readonly supportedUnderstandTypes: MediaType[] = ["image", "audio"];

  private apiKey: string;
  private baseUrl: string;
  private imageModel: string;
  private visionModel: string;
  private ttsModel: string;
  private whisperModel: string;

  constructor(config: OpenAIMultimodalConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.imageModel = config.imageModel ?? "dall-e-3";
    this.visionModel = config.visionModel ?? "gpt-4o";
    this.ttsModel = config.ttsModel ?? "tts-1";
    this.whisperModel = config.whisperModel ?? "whisper-1";
  }

  async generate(request: MediaGenerateRequest): Promise<MediaGenerateResult> {
    switch (request.type) {
      case "image":
        return this.generateImage(request);
      case "audio":
        return this.generateAudio(request);
      default:
        throw new Error(`Unsupported generate type: ${request.type}`);
    }
  }

  async understand(request: MediaUnderstandRequest): Promise<MediaUnderstandResult> {
    switch (request.type) {
      case "image":
        return this.understandImage(request);
      case "audio":
        return this.understandAudio(request);
      default:
        throw new Error(`Unsupported understand type: ${request.type}`);
    }
  }

  // ===== 图像生成 (DALL-E) =====
  private async generateImage(request: MediaGenerateRequest): Promise<MediaGenerateResult> {
    const model = request.model ?? this.imageModel;
    const size = (request.options?.size as string) ?? "1024x1024";
    const quality = (request.options?.quality as string) ?? "standard";
    const style = (request.options?.style as string) ?? "natural";
    const responseFormat = (request.options?.response_format as string) ?? "url";

    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: 1,
      size,
      quality,
      style,
      response_format: responseFormat,
    };

    const res = await this.fetch("/images/generations", body);

    const imageData = res.data?.[0];
    if (!imageData) throw new Error("No image data returned");

    return {
      url: imageData.url,
      base64: imageData.b64_json,
      mimeType: "image/png",
      metadata: {
        revisedPrompt: imageData.revised_prompt,
        model,
        size,
      },
    };
  }

  // ===== 图像理解 (GPT-4o Vision) =====
  private async understandImage(request: MediaUnderstandRequest): Promise<MediaUnderstandResult> {
    const model = request.model ?? this.visionModel;

    // 构建 vision 消息
    const imageContent = request.media.startsWith("data:")
      ? { type: "image_url", image_url: { url: request.media } }
      : request.media.startsWith("http")
        ? { type: "image_url", image_url: { url: request.media } }
        : { type: "image_url", image_url: { url: `data:image/png;base64,${request.media}` } };

    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: request.prompt },
            imageContent,
          ],
        },
      ],
      max_tokens: 2048,
    };

    const res = await this.fetchRaw("/chat/completions", body);
    const content = res.choices?.[0]?.message?.content ?? "";

    return {
      content,
      structured: { model },
    };
  }

  // ===== 语音生成 (TTS) =====
  private async generateAudio(request: MediaGenerateRequest): Promise<MediaGenerateResult> {
    const model = request.model ?? this.ttsModel;
    const voice = (request.options?.voice as string) ?? "alloy";
    const responseFormat = (request.options?.response_format as string) ?? "mp3";

    const body = {
      model,
      input: request.prompt,
      voice,
      response_format: responseFormat,
    };

    const res = await globalThis.fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`TTS API error (${res.status}): ${errText}`);
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      base64,
      mimeType: `audio/${responseFormat}`,
      metadata: { model, voice, responseFormat },
    };
  }

  // ===== 语音识别 (Whisper) =====
  private async understandAudio(request: MediaUnderstandRequest): Promise<MediaUnderstandResult> {
    const model = request.model ?? this.whisperModel;

    // media 可能是 base64 或 URL，需要转成 FormData
    let audioBuffer: Buffer;
    if (request.media.startsWith("http")) {
      const fetchRes = await globalThis.fetch(request.media);
      audioBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } else {
      // base64
      const base64Data = request.media.replace(/^data:audio\/\w+;base64,/, "");
      audioBuffer = Buffer.from(base64Data, "base64");
    }

    // Whisper 用 multipart/form-data
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mp3" });
    const formData = new FormData();
    formData.append("file", blob, "audio.mp3");
    formData.append("model", model);
    if (request.prompt) {
      formData.append("prompt", request.prompt);
    }

    const res = await globalThis.fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Whisper API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { text: string };

    return {
      content: data.text,
      structured: { model },
    };
  }

  // ===== 通用请求 =====
  private async fetch(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    return this.fetchRaw(path, body);
  }

  private async fetchRaw(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Multimodal API error (${res.status}): ${errText}`);
    }

    return res.json();
  }
}
