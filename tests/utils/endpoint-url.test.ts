import { describe, it, expect } from "vitest";
import { resolveEndpoint } from "../../src/utils/endpoint-url.js";

describe("resolveEndpoint", () => {
  const DEFAULT = "https://api.openai.com/v1";

  it("appends path when baseUrl is a base URL (no trailing endpoint)", () => {
    expect(resolveEndpoint("https://ark.cn-beijing.volces.com/api/v3", "/chat/completions", DEFAULT))
      .toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  });

  it("uses baseUrl as-is when it already ends with the endpoint path", () => {
    expect(resolveEndpoint("https://api.openai.com/v1/chat/completions", "/chat/completions", DEFAULT))
      .toBe("https://api.openai.com/v1/chat/completions");
  });

  it("strips trailing slash before appending", () => {
    expect(resolveEndpoint("https://ark.cn-beijing.volces.com/api/v3/", "/chat/completions", DEFAULT))
      .toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  });

  it("strips multiple trailing slashes before appending", () => {
    expect(resolveEndpoint("https://example.com/v1///", "/embeddings", DEFAULT))
      .toBe("https://example.com/v1/embeddings");
  });

  it("falls back to default when baseUrl is undefined", () => {
    expect(resolveEndpoint(undefined, "/chat/completions", DEFAULT))
      .toBe("https://api.openai.com/v1/chat/completions");
  });

  it("falls back to default when baseUrl is empty string", () => {
    expect(resolveEndpoint("", "/chat/completions", DEFAULT))
      .toBe("https://api.openai.com/v1/chat/completions");
  });

  it("falls back to default when baseUrl is whitespace only", () => {
    expect(resolveEndpoint("   ", "/chat/completions", DEFAULT))
      .toBe("https://api.openai.com/v1/chat/completions");
  });

  it("handles different endpoint paths (imageGen, tts, stt, embedding)", () => {
    expect(resolveEndpoint("https://api.openai.com/v1", "/images/generations", DEFAULT))
      .toBe("https://api.openai.com/v1/images/generations");
    expect(resolveEndpoint("https://api.openai.com/v1", "/audio/speech", DEFAULT))
      .toBe("https://api.openai.com/v1/audio/speech");
    expect(resolveEndpoint("https://api.openai.com/v1", "/audio/transcriptions", DEFAULT))
      .toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(resolveEndpoint("https://api.openai.com/v1", "/embeddings", DEFAULT))
      .toBe("https://api.openai.com/v1/embeddings");
  });
});
