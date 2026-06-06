/**
 * P1-24 修复: OpenAI Embedding Provider 在 batch 超过 25 时会切分串行调用。
 * 起因: 某些 OpenAI 兼容 embedding API (Gitee AI Qwen3-Embedding-8B) 单次 batch
 * 超过 25-30 会 400 "No schema matches, </input>" 错误, 即使单 text OK.
 * 修法: 内部按 25 一批切分, 串行调用合并结果.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("P1-24: OpenAIEmbeddingProvider batch chunking", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // Helper: mock fetch 返回 n 个 embeddings
  function mockFetchReturning(n: number, dim = 1024) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      const batchSize = body.input.length;
      return new Response(
        JSON.stringify({
          data: Array.from({ length: batchSize }, (_, i) => ({
            embedding: new Array(dim).fill(0).map((_, j) => (i + j) % 1),
            index: i,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
  }

  it("单 batch (n <= 25) 应该单次 fetch 调用", async () => {
    globalThis.fetch = mockFetchReturning(10) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    const r = await p.embed(Array(10).fill("hello"));
    expect(r).toHaveLength(10);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("50 texts 应该切分成 2 个 batch 各 25", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (url, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: any, i: number) => ({
            embedding: new Array(1024).fill(0),
            index: i,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    const r = await p.embed(Array(50).fill("测试文本"));
    expect(r).toHaveLength(50);
    // 50 / 25 = 2 batches
    expect(callCount).toBe(2);
  });

  it("100 texts 应该切分成 4 个 batch (25+25+25+25)", async () => {
    let callCount = 0;
    const batchSizes: number[] = [];
    globalThis.fetch = vi.fn(async (url, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      batchSizes.push(body.input.length);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: any, i: number) => ({
            embedding: new Array(1024).fill(0),
            index: i,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    const r = await p.embed(Array(100).fill("测试文本"));
    expect(r).toHaveLength(100);
    expect(callCount).toBe(4);
    expect(batchSizes).toEqual([25, 25, 25, 25]);
  });

  it("26 texts (边界值) 应该切分成 2 个 batch (25+1)", async () => {
    let callCount = 0;
    const batchSizes: number[] = [];
    globalThis.fetch = vi.fn(async (url, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      batchSizes.push(body.input.length);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: any, i: number) => ({
            embedding: new Array(1024).fill(0),
            index: i,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    const r = await p.embed(Array(26).fill("测试文本"));
    expect(r).toHaveLength(26);
    expect(callCount).toBe(2);
    expect(batchSizes).toEqual([25, 1]);
  });

  it("当 API 返回 400 时应该传播错误 (修复前是 50 个 text 整批 400, 修复后只有失败那批 400)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (url, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      const batchSize = body.input.length;
      // 模拟所有 batch 失败 (不依赖 batch size)
      return new Response(
        JSON.stringify({ error: { code: "400", message: "test failure" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    await expect(p.embed(Array(30).fill("测试文本"))).rejects.toThrow(/400/);
    // 30 / 25 = 2 batches, 第一次失败就 reject
    expect(callCount).toBe(1);
  });

  it("过滤掉空字符串后 batch 数应该减少", async () => {
    let callCount = 0;
    const batchSizes: number[] = [];
    globalThis.fetch = vi.fn(async (url, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      batchSizes.push(body.input.length);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: any, i: number) => ({
            embedding: new Array(1024).fill(0),
            index: i,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    // 30 个 text, 但中间 5 个是空字符串
    const texts: string[] = [];
    for (let i = 0; i < 30; i++) {
      if (i % 6 === 0) texts.push(""); // 5 个空
      else texts.push(`text ${i}`);
    }
    const r = await p.embed(texts);
    // 25 个有效
    expect(r).toHaveLength(25);
    // 1 batch (25 fits in 1)
    expect(callCount).toBe(1);
    expect(batchSizes).toEqual([25]);
  });

  it("空 input 数组应该返回空, 不发请求", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    const r = await p.embed([]);
    expect(r).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("全空字符串应该返回空, 不发请求", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;
    const { OpenAIEmbeddingProvider } = await import(
      "../../src/memory/embedding-provider.js"
    );
    const p = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      mode: "openai",
    });

    const r = await p.embed(["", "  ", ""]);
    expect(r).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
