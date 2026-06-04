import { describe, it, expect, vi, beforeEach } from "vitest";

const routeHandlers: Record<string, Function> = {};

vi.mock("express", () => ({
  Router: () => ({
    get: (path: string, ...handlers: Function[]) => {
      routeHandlers[`GET ${path}`] = handlers[handlers.length - 1];
    },
    post: (path: string, ...handlers: Function[]) => {
      routeHandlers[`POST ${path}`] = handlers[handlers.length - 1];
    },
    delete: (path: string, ...handlers: Function[]) => {
      routeHandlers[`DELETE ${path}`] = handlers[handlers.length - 1];
    },
  }),
}));

vi.mock("../../src/permissions/index.js", () => ({
  permissions: {
    createMiddleware: () => ({
      requireAuth: (req: any, res: any, next: any) => next(),
      requirePermission: () => (req: any, res: any, next: any) => next(),
      requireAdmin: () => (req: any, res: any, next: any) => next(),
      requireSkillAccess: () => (req: any, res: any, next: any) => next(),
    }),
    constants: {
      API: {
        CONFIG_READ: "config:read",
        CONFIG_WRITE: "config:write",
        SKILLS_READ: "skills:read",
        SKILLS_EXECUTE: "skills:execute",
        SKILLS_MANAGE: "skills:manage",
        TASKS_READ: "tasks:read",
        PLUGINS_MANAGE: "plugins:manage",
        SYSTEM_MANAGE: "system:manage",
      },
    },
    helpers: {},
    getAccessibleSkills: vi.fn(),
    hasSkillPermission: vi.fn(),
  },
}));

vi.mock("../../src/memory/embedding-provider.js", () => ({
  OpenAIEmbeddingProvider: vi.fn(),
}));

vi.mock("../../src/skills/knowledge-skills.js", () => ({
  setGlobalKBEmbeddingProvider: vi.fn(),
  setGlobalKBVisionConfig: vi.fn(),
}));

function createMockDeps() {
  return {
    configManager: {
      get: vi.fn(() => ({
        llm: { type: "openai", apiKey: "sk-test1234567890", model: "gpt-4", baseUrl: "https://api.openai.com", maxTokens: 4096, temperature: 0.7 },
        multimodal: { enabled: false, apiKey: "", baseUrl: "", imageModel: "", visionModel: "", ttsModel: "", whisperModel: "" },
        engine: {},
        agent: {},
        docMind: { enabled: false, accessKeyId: "", accessKeySecret: "", endpoint: "", regionId: "", multimediaMode: "", maxPollingMinutes: 30, pollingIntervalSeconds: 3 },
        federation: { instanceId: "", federationKey: "", heartbeatIntervalMs: 30000, syncIntervalMs: 60000 },
        evolution: { autoExecute: false, cycleIntervalMs: 3600000, maxActionsPerCycle: 5 },
      })),
      getMultimodal: vi.fn(() => ({ enabled: false, apiKey: "", baseUrl: "", imageModel: "", visionModel: "", ttsModel: "", whisperModel: "" })),
      getModelCards: vi.fn(() => ({})),
      getFederation: vi.fn(() => ({ instanceId: "test", federationKey: "key123", heartbeatIntervalMs: 30000, syncIntervalMs: 60000 })),
      getEvolution: vi.fn(() => ({ autoExecute: false, cycleIntervalMs: 3600000 })),
      getDocMind: vi.fn(() => ({ enabled: false, accessKeyId: "", accessKeySecret: "" })),
      isLLMConfigured: vi.fn(() => true),
      isMultimodalConfigured: vi.fn(() => false),
      isDocMindConfigured: vi.fn(() => false),
      setLLM: vi.fn(),
      setAgent: vi.fn(),
      setMultimodal: vi.fn(),
      setModelCard: vi.fn(),
      setFederation: vi.fn(),
      setEvolution: vi.fn(),
      setDocMind: vi.fn(),
      addFederationPeer: vi.fn(),
      removeFederationPeer: vi.fn(),
      getResolvedModelConfig: vi.fn(() => ({ apiKey: "test", model: "test-model", baseUrl: "https://api.test.com" })),
    },
    sessionManager: { setLLMProvider: vi.fn(), setEmbeddingProvider: vi.fn() },
    federationTransport: { apiKey: "", addPeer: vi.fn(), removePeer: vi.fn() },
    evolutionEngine: { updateConfig: vi.fn() },
    getCurrentProvider: vi.fn(() => null),
    createProvider: vi.fn(() => ({ name: "mock", model: "mock", chat: vi.fn() })),
    setCurrentProvider: vi.fn(),
    rebuildMultimodalProvider: vi.fn(),
    rebuildAllAgentLoops: vi.fn(),
    rebuildOrchestrator: vi.fn(),
    getVisionConfig: vi.fn(() => null),
  } as any;
}

function createMockReq(body: any = {}, params: any = {}, query: any = {}): any {
  return { body, params, query, user: { id: "user_1" } };
}

function createMockRes(): any {
  const res: any = {
    statusCode: 200,
    status: vi.fn(function(code: number) { res.statusCode = code; return this; }),
    json: vi.fn(function(data: any) { return this; }),
    setHeader: vi.fn(),
  };
  return res;
}

const { createConfigRoutes } = await import("../../src/routes/config-routes.js");

describe("Config Routes", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeHandlers)) {
      delete routeHandlers[key];
    }
    vi.clearAllMocks();
  });

  it("should register GET /config", () => {
    createConfigRoutes(createMockDeps());
    expect(routeHandlers["GET /config"]).toBeDefined();
  });

  it("GET /config should return masked config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /config"](req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.llm.apiKey).toMatch(/^\*\*\*/);
    expect(data.isLLMConfigured).toBe(true);
  });

  it("POST /config/llm should validate required fields", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ type: "openai" }); // missing apiKey and model
    const res = createMockRes();

    routeHandlers["POST /config/llm"](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const data = res.json.mock.calls[0][0];
    expect(data.success).toBe(false);
  });

  it("POST /config/llm should set LLM config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ type: "openai", apiKey: "sk-new", model: "gpt-4o" });
    const res = createMockRes();

    routeHandlers["POST /config/llm"](req, res);

    expect(deps.configManager.setLLM).toHaveBeenCalled();
    expect(deps.rebuildAllAgentLoops).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /config/full should return full config with masked keys", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /config/full"](req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.llm.apiKey).toMatch(/^\*\*\*/);
  });

  it("POST /config/agent should update agent config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ maxIterations: 20 });
    const res = createMockRes();

    routeHandlers["POST /config/agent"](req, res);

    expect(deps.configManager.setAgent).toHaveBeenCalledWith({ maxIterations: 20, systemPrompt: undefined, includeTrace: undefined });
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("POST /llm/test should error when provider not configured", async () => {
    const deps = createMockDeps();
    deps.getCurrentProvider = vi.fn(() => null);
    createConfigRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    await routeHandlers["POST /llm/test"](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("GET /config/federation should return masked federation config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /config/federation"](req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.config.federationKey).toMatch(/^\*\*\*/);
  });

  it("POST /config/federation/peers should require endpoint", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ name: "Peer" }); // missing endpoint
    const res = createMockRes();

    routeHandlers["POST /config/federation/peers"](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("POST /config/federation/peers should add peer", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ endpoint: "https://peer.example.com", name: "Peer" });
    const res = createMockRes();

    routeHandlers["POST /config/federation/peers"](req, res);

    expect(deps.configManager.addFederationPeer).toHaveBeenCalled();
    expect(deps.federationTransport.addPeer).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("DELETE /config/federation/peers should require endpoint", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({}); // missing endpoint
    const res = createMockRes();

    routeHandlers["DELETE /config/federation/peers"](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("GET /config/evolution-engine should return evolution config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /config/evolution-engine"](req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.config).toBeDefined();
  });

  it("POST /config/evolution-engine should update evolution config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ autoExecute: true, maxActionsPerCycle: 10 });
    const res = createMockRes();

    routeHandlers["POST /config/evolution-engine"](req, res);

    expect(deps.configManager.setEvolution).toHaveBeenCalled();
    expect(deps.evolutionEngine.updateConfig).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /config/docmind should return masked docmind config", () => {
    const deps = createMockDeps();
    deps.configManager.getDocMind = vi.fn(() => ({ enabled: true, accessKeyId: "ak-test123", accessKeySecret: "sk-test456" }));
    createConfigRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /config/docmind"](req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.config.accessKeyId).toMatch(/^\*\*\*/);
  });

  it("POST /config/docmind should save docmind config", () => {
    const deps = createMockDeps();
    createConfigRoutes(deps);
    const req = createMockReq({ enabled: true, accessKeyId: "new-id", accessKeySecret: "new-secret" });
    const res = createMockRes();

    routeHandlers["POST /config/docmind"](req, res);

    expect(deps.configManager.setDocMind).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  // P3 修复: 测试 model-cards 的 inheritFromLLM 持久化逻辑
  describe("model-cards/:type with inheritFromLLM", () => {
    it("should clear apiKey and baseUrl when inheritFromLLM=true (non-LLM card)", () => {
      const deps = createMockDeps();
      // 已有 vision card, apiKey 之前是 LLM 的 key (用户在测试 inherit)
      deps.configManager.getModelCards = vi.fn(() => ({
        vision: { type: "openai-compatible", apiKey: "old-key", baseUrl: "https://old.url", model: "doubao-x" },
      }));
      createConfigRoutes(deps);
      const req = createMockReq({
        type: "openai-compatible",
        model: "doubao-x",
        inheritFromLLM: true,
      }, { type: "vision" });
      const res = createMockRes();

      routeHandlers["POST /config/model-cards/:type"](req, res);

      expect(deps.configManager.setModelCard).toHaveBeenCalledWith(
        "vision",
        expect.objectContaining({
          apiKey: "",
          baseUrl: undefined,
          model: "doubao-x",
        }),
      );
    });

    it("should preserve masked apiKey (***xxx) when inheritFromLLM is not set", () => {
      const deps = createMockDeps();
      deps.configManager.getModelCards = vi.fn(() => ({
        vision: { type: "openai-compatible", apiKey: "real-key-1234", baseUrl: "https://ark.x", model: "doubao-y" },
      }));
      createConfigRoutes(deps);
      const req = createMockReq({
        type: "openai-compatible",
        apiKey: "***1234", // masked, user did not change
        baseUrl: "https://ark.x",
        model: "doubao-y",
      }, { type: "vision" });
      const res = createMockRes();

      routeHandlers["POST /config/model-cards/:type"](req, res);

      expect(deps.configManager.setModelCard).toHaveBeenCalledWith(
        "vision",
        expect.objectContaining({ apiKey: "real-key-1234" }),
      );
    });

    it("should use new apiKey when user provides a new value", () => {
      const deps = createMockDeps();
      deps.configManager.getModelCards = vi.fn(() => ({
        vision: { type: "openai-compatible", apiKey: "old-key", model: "doubao-z" },
      }));
      createConfigRoutes(deps);
      const req = createMockReq({
        type: "openai-compatible",
        apiKey: "brand-new-key-5678",
        model: "doubao-z",
      }, { type: "vision" });
      const res = createMockRes();

      routeHandlers["POST /config/model-cards/:type"](req, res);

      expect(deps.configManager.setModelCard).toHaveBeenCalledWith(
        "vision",
        expect.objectContaining({ apiKey: "brand-new-key-5678" }),
      );
    });
  });
});
