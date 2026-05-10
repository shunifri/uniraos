/**
 * Embedding Provider 接口
 *
 * 为 LTM 提供文本向量化能力，支持语义搜索。
 * 可接入 OpenAI/Claude 或其他 embedding 服务。
 */

export interface EmbeddingProvider {
  /** 将文本列表转换为向量 */
  embed(texts: string[]): Promise<number[][]>;
  /** 向量维度 */
  readonly dimension: number;
  /** Provider 名称 */
  readonly name: string;
}

/** 计算两个向量的余弦相似度 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Embedding API 模式
 * - openai: 标准 OpenAI 格式（/embeddings, input: string[]）
 * - volcengine-multimodal: 火山引擎多模态格式（/embeddings/multimodal, input: [{type,text}]）
 */
export type EmbeddingApiMode = "openai" | "volcengine-multimodal";

/**
 * OpenAI Embedding Provider
 * 兼容 OpenAI 标准格式和火山引擎多模态格式
 */
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 1536;
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private mode: EmbeddingApiMode;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string; mode?: EmbeddingApiMode }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.model = config.model ?? "text-embedding-3-small";
    this.mode = config.mode ?? "openai";
    this.name = this.mode === "volcengine-multimodal" ? "volcengine" : "openai";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (this.mode === "volcengine-multimodal") {
      return this.embedVolcengineMultimodal(texts);
    }
    return this.embedOpenAI(texts);
  }

  /** 标准 OpenAI 格式 */
  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    const response = await fetchWithTimeout(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
      timeoutMs: 60_000,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  /**
   * 火山引擎多模态 embedding 格式
   * 端点: /embeddings/multimodal
   * 输入: { model, input: [{type:"text", text:"..."}] }
   * 响应: { data: { embedding: number[] } } — 注意 data 是对象不是数组
   * 每次只接受一组 input，需逐条调用
   */
  private async embedVolcengineMultimodal(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const response = await fetchWithTimeout(`${this.baseUrl}/embeddings/multimodal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: [{ type: "text", text }],
        }),
        timeoutMs: 120_000,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Volcengine Embedding API error ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        data: { embedding: number[] };
      };

      results.push(data.data.embedding);
    }

    return results;
  }
}

/**
 * 本地简易 Embedding Provider（无需 API）
 *
 * 使用 TF-IDF 风格的稀疏向量作为 embedding。
 * 效果不如神经网络模型，但零成本、零延迟。
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 512;
  readonly name = "local";
  private vocabulary = new Map<string, number>();
  private idf = new Map<string, number>();
  private docCount = 0;

  async embed(texts: string[]): Promise<number[][]> {
    // 更新词汇表
    for (const text of texts) {
      this.docCount++;
      const tokens = this.tokenize(text);
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, this.vocabulary.size % this.dimension);
        }
        this.idf.set(token, (this.idf.get(token) ?? 0) + 1);
      }
    }

    return texts.map((text) => this.embedSingle(text));
  }

  private embedSingle(text: string): number[] {
    const vector = new Float64Array(this.dimension);
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token);
      if (idx === undefined) continue;

      const tfScore = count / tokens.length;
      const idfScore = Math.log((this.docCount + 1) / ((this.idf.get(token) ?? 0) + 1));
      vector[idx] += tfScore * idfScore;
    }

    // L2 归一化
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return Array.from(vector);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }
}
