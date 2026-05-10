import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiCreateConversation, streamChat } from "../index";
import { installFetchMock, uninstallFetchMock, makeJsonResponse } from "../../test-utils/api-test-utils";

const mockAuthState = {
  token: "test-token",
  logout: vi.fn(),
};

vi.mock("../../store/auth", () => ({
  useAuthStore: {
    getState: () => mockAuthState,
  },
}));

describe("Chat API — apiCreateConversation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("should return conversation id on success", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, id: "conv-123" }));
    const id = await apiCreateConversation("Test Chat");
    expect(mockFetch).toHaveBeenCalledWith("/api/conversations", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "Test Chat" }),
    }));
    expect(id).toBe("conv-123");
  });

  it("should return null on non-success response", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: false }));
    const id = await apiCreateConversation("Test");
    expect(id).toBeNull();
  });

  it("should return null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));
    const id = await apiCreateConversation("Test");
    expect(id).toBeNull();
  });
});

describe("Chat API — streamChat", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("should return ReadableStream on success", async () => {
    const fakeStream = new ReadableStream();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: fakeStream,
      json: async () => ({}),
    } as unknown as Response);

    const body = { message: "hello", conversationId: "c1" };
    const stream = await streamChat(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/agent/chat/stream", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(body),
    }));
    expect(stream).toBe(fakeStream);
  });

  it("should throw on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Bad request" }, 400));
    await expect(streamChat({ message: "" })).rejects.toThrow("Bad request");
  });

  it("should throw when response body is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
      json: async () => ({}),
    } as unknown as Response);
    await expect(streamChat({ message: "hi" })).rejects.toThrow("Response body is empty");
  });
});
