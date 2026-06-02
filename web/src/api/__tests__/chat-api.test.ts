import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiCreateConversation, startChatStream } from "../index";
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

describe("Chat API — startChatStream", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("should return streamId on success", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, streamId: "stream-123" }));

    const body = { message: "hello", conversationId: "c1" };
    const result = await startChatStream(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/agent/chat/start", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(body),
    }));
    expect(result).toEqual({ success: true, streamId: "stream-123" });
  });

  it("should throw on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Bad request" }, 400));
    await expect(startChatStream({ message: "" })).rejects.toThrow("Bad request");
  });
});
