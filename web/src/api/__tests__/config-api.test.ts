import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getConfig,
  saveLLMConfig,
  saveAgentConfig,
  saveMultimodalConfig,
  testLLM,
  getFederationConfig,
  saveFederationConfig,
  addPeer,
  removePeer,
  getEvolutionConfig,
  saveEvolutionConfig,
} from "../index";
import {
  installFetchMock,
  uninstallFetchMock,
  makeJsonResponse,
} from "../../test-utils/api-test-utils";

vi.mock("../../store/auth", () => ({
  useAuthStore: {
    getState: () => ({ token: "test-token", logout: vi.fn() }),
  },
}));

describe("Config API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = installFetchMock(vi.fn());
  });

  afterEach(() => {
    uninstallFetchMock();
  });

  it("getConfig should call GET /api/config", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
    const result = await getConfig();
    expect(mockFetch).toHaveBeenCalledWith("/api/config", expect.any(Object));
    expect(result).toEqual({ models: [] });
  });

  it("saveLLMConfig should call POST /api/config/llm", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    const config = { provider: "openai", apiKey: "sk-xxx" };
    const result = await saveLLMConfig(config);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/llm",
      expect.objectContaining({ method: "POST", body: JSON.stringify(config) }),
    );
    expect(result).toEqual({ success: true });
  });

  it("saveAgentConfig should call POST /api/config/agent", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await saveAgentConfig({ systemPrompt: "hello" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/agent",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ systemPrompt: "hello" }) }),
    );
  });

  it("saveMultimodalConfig should call POST /api/config/multimodal", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await saveMultimodalConfig({ vision: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/multimodal",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ vision: true }) }),
    );
  });

  it("testLLM should call POST /api/config/llm/test", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, latency: 120 }));
    const payload = { provider: "openai", model: "gpt-4" };
    const result = await testLLM(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/llm/test",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
    expect(result).toEqual({ success: true, latency: 120 });
  });

  it("getFederationConfig should call GET /api/config/federation", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ peers: [] }));
    await getFederationConfig();
    expect(mockFetch).toHaveBeenCalledWith("/api/config/federation", expect.any(Object));
  });

  it("saveFederationConfig should call PUT /api/config/federation", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await saveFederationConfig({ enabled: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/federation",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) }),
    );
  });

  it("addPeer should call POST /api/config/federation/peers", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await addPeer({ url: "http://peer-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/federation/peers",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "http://peer-1" }) }),
    );
  });

  it("removePeer should call DELETE /api/config/federation/peers with endpoint in body", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await removePeer("peer-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/federation/peers",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ endpoint: "peer-1" }) }),
    );
  });

  it("getEvolutionConfig should call GET /api/config/evolution-engine", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ enabled: true }));
    await getEvolutionConfig();
    expect(mockFetch).toHaveBeenCalledWith("/api/config/evolution-engine", expect.any(Object));
  });

  it("saveEvolutionConfig should call POST /api/config/evolution-engine", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    await saveEvolutionConfig({ budget: 100 });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/evolution-engine",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ budget: 100 }) }),
    );
  });
});
