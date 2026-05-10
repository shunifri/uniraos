import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "../../src/utils/fetch-with-timeout.js";

describe("fetchWithTimeout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return response on success", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    fetchMock.mockResolvedValue(mockResponse);

    const res = await fetchWithTimeout("http://example.com");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should pass options to fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    fetchMock.mockResolvedValue(mockResponse);

    await fetchWithTimeout("http://example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.com",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      }),
    );
  });

  it("should use AbortSignal.timeout by default", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    fetchMock.mockResolvedValue(mockResponse);

    await fetchWithTimeout("http://example.com");

    const callArg = fetchMock.mock.calls[0][1];
    expect(callArg.signal).toBeInstanceOf(AbortSignal);
  });
});
