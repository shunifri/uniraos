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

const mockGetAccessibleSkills = vi.fn(() => Promise.resolve({ skills: [], sourceMap: new Map() }));
const mockHasSkillPermission = vi.fn(() => Promise.resolve(true));

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
    getAccessibleSkills: (...args: any[]) => mockGetAccessibleSkills(...args),
    hasSkillPermission: (...args: any[]) => mockHasSkillPermission(...args),
  },
}));

vi.mock("../../src/db/custom-skill-repository.js", () => ({
  getCustomSkillRepository: vi.fn(() => ({
    create: vi.fn(() => Promise.resolve()),
    deleteByName: vi.fn(() => Promise.resolve()),
  })),
}));

function createMockDeps() {
  return {
    registry: {
      register: vi.fn(),
      unregister: vi.fn(),
      list: vi.fn(() => []),
      lookup: vi.fn(),
      get: vi.fn(),
      getTopologicalOrder: vi.fn(() => ["a", "b"]),
    },
    engine: {
      execute: vi.fn(() => Promise.resolve({ success: true, data: {} })),
      getHistory: vi.fn(() => []),
      metrics: {
        getSummary: vi.fn(() => ({})),
        getAllMetrics: vi.fn(() => []),
        getMetrics: vi.fn(() => ({})),
      },
    },
    wal: {
      getAll: vi.fn(() => []),
      getIncomplete: vi.fn(() => []),
      recover: vi.fn(() => []),
      getLastRecoveryResult: vi.fn(() => null),
      replay: vi.fn(() => Promise.resolve({ recovered: 0 })),
      compact: vi.fn(),
    },
    taskManager: {
      list: vi.fn(() => []),
      get: vi.fn(() => undefined),
      cancel: vi.fn(() => undefined),
      waitFor: vi.fn(() => Promise.resolve({})),
    },
    pluginLoader: {
      getLoaded: vi.fn(() => []),
      reloadPlugin: vi.fn(() => Promise.resolve(undefined)),
      loadAll: vi.fn(() => Promise.resolve({ loaded: 0, errors: 0 })),
    },
    syncSkillsToResources: vi.fn(),
    modelRouter: {
      getModels: vi.fn(() => []),
    },
    promptManager: {
      list: vi.fn(() => []),
      register: vi.fn(() => ({ name: "test", template: "hello" })),
      render: vi.fn(() => "rendered"),
      delete: vi.fn(),
    },
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

const { createSkillRoutes } = await import("../../src/routes/skill-routes.js");

describe("Skill Routes", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeHandlers)) {
      delete routeHandlers[key];
    }
    vi.clearAllMocks();
  });

  it("should register GET /skills", () => {
    createSkillRoutes(createMockDeps());
    expect(routeHandlers["GET /skills"]).toBeDefined();
  });

  it("GET /skills should return skill list", async () => {
    const deps = createMockDeps();
    mockGetAccessibleSkills.mockResolvedValue({
      skills: [
        { name: "skill_a", visible: true, autonomy: "MANUAL", dependencies: [], timeout: 30000, retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 }, description: "Test", owner: "user_1", isSystem: false, version: "1.0.0", handler: async () => ({ success: true }) },
      ],
      sourceMap: new Map(),
    });
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    await routeHandlers["GET /skills"](req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe("skill_a");
  });

  it("GET /skills/visible should return visible skills", async () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    await routeHandlers["GET /skills/visible"](req, res);

    expect(res.json).toHaveBeenCalled();
  });

  it("POST /execute should execute a skill", async () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({ skillName: "echo", params: { text: "hi" } });
    const res = createMockRes();

    await routeHandlers["POST /execute"](req, res);

    expect(deps.engine.execute).toHaveBeenCalledWith("echo", { text: "hi" });
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("POST /execute should handle errors", async () => {
    const deps = createMockDeps();
    deps.engine.execute = vi.fn(() => Promise.reject(new Error("Execution failed")));
    createSkillRoutes(deps);
    const req = createMockReq({ skillName: "fail", params: {} });
    const res = createMockRes();

    await routeHandlers["POST /execute"](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("POST /skills should register a new skill", async () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({ name: "new_skill", visible: true, description: "A new skill" });
    const res = createMockRes();

    await routeHandlers["POST /skills"](req, res);

    expect(deps.registry.register).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("DELETE /skills/:name should unregister a skill", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({}, { name: "old_skill" });
    const res = createMockRes();

    routeHandlers["DELETE /skills/:name"](req, res);

    expect(deps.registry.unregister).toHaveBeenCalledWith("old_skill");
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /topology should return topological order", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /topology"](req, res);

    expect(res.json.mock.calls[0][0].order).toEqual(["a", "b"]);
  });

  it("GET /wal should return WAL status", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /wal"](req, res);

    expect(res.json).toHaveBeenCalled();
  });

  it("GET /history should return execution history", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /history"](req, res);

    expect(deps.engine.getHistory).toHaveBeenCalled();
  });

  it("GET /metrics should return metrics summary", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /metrics"](req, res);

    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /metrics/skill/:name should return 404 when no metrics", () => {
    const deps = createMockDeps();
    deps.engine.metrics.getMetrics = vi.fn(() => null);
    createSkillRoutes(deps);
    const req = createMockReq({}, { name: "unknown" });
    const res = createMockRes();

    routeHandlers["GET /metrics/skill/:name"](req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("GET /tasks should list tasks", () => {
    const deps = createMockDeps();
    deps.taskManager.list = vi.fn(() => [{ id: "t1", status: "PENDING" }]);
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /tasks"](req, res);

    expect(res.json.mock.calls[0][0].tasks).toHaveLength(1);
  });

  it("GET /tasks/:taskId should return 404 for missing task", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({}, { taskId: "missing" });
    const res = createMockRes();

    routeHandlers["GET /tasks/:taskId"](req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("POST /tasks/:taskId/cancel should cancel task", () => {
    const deps = createMockDeps();
    deps.taskManager.cancel = vi.fn(() => ({ id: "t1", status: "CANCELLED" }));
    createSkillRoutes(deps);
    const req = createMockReq({}, { taskId: "t1" });
    const res = createMockRes();

    routeHandlers["POST /tasks/:taskId/cancel"](req, res);

    expect(deps.taskManager.cancel).toHaveBeenCalledWith("t1");
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("POST /tasks/:taskId/wait should wait for task", async () => {
    const deps = createMockDeps();
    deps.taskManager.waitFor = vi.fn(() => Promise.resolve({ id: "t1", status: "COMPLETED" }));
    createSkillRoutes(deps);
    const req = createMockReq({ timeoutMs: 5000 }, { taskId: "t1" });
    const res = createMockRes();

    await routeHandlers["POST /tasks/:taskId/wait"](req, res);

    expect(deps.taskManager.waitFor).toHaveBeenCalledWith("t1", 5000);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /plugins should return loaded plugins", () => {
    const deps = createMockDeps();
    deps.pluginLoader.getLoaded = vi.fn(() => [{ name: "p1" }]);
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /plugins"](req, res);

    expect(res.json.mock.calls[0][0].plugins).toHaveLength(1);
  });

  it("POST /plugins/reload should reload a plugin", async () => {
    const deps = createMockDeps();
    deps.pluginLoader.reloadPlugin = vi.fn(() => Promise.resolve({ name: "p1" }));
    createSkillRoutes(deps);
    const req = createMockReq({ name: "p1" });
    const res = createMockRes();

    await routeHandlers["POST /plugins/reload"](req, res);

    expect(deps.pluginLoader.reloadPlugin).toHaveBeenCalledWith("p1");
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("POST /plugins/reload should load all when no name", async () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({});
    const res = createMockRes();

    await routeHandlers["POST /plugins/reload"](req, res);

    expect(deps.pluginLoader.loadAll).toHaveBeenCalled();
  });

  it("GET /wal/status should return WAL status", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /wal/status"](req, res);

    expect(res.json.mock.calls[0][0].incompleteCount).toBeDefined();
  });

  it("POST /wal/replay should replay WAL", async () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    await routeHandlers["POST /wal/replay"](req, res);

    expect(deps.wal.replay).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("POST /wal/compact should compact WAL", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["POST /wal/compact"](req, res);

    expect(deps.wal.compact).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /models should return models", () => {
    const deps = createMockDeps();
    deps.modelRouter.getModels = vi.fn(() => [{ name: "gpt-4", provider: { model: "gpt-4" }, capabilities: [], costPer1kTokens: 0, contextWindow: 8000 }]);
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /models"](req, res);

    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("GET /prompts should list templates", () => {
    const deps = createMockDeps();
    deps.promptManager.list = vi.fn(() => [{ name: "hello", template: "Hi {{name}}" }]);
    createSkillRoutes(deps);
    const req = createMockReq();
    const res = createMockRes();

    routeHandlers["GET /prompts"](req, res);

    expect(res.json.mock.calls[0][0].templates).toHaveLength(1);
  });

  it("POST /prompts should register template", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({ name: "test", template: "Hello" });
    const res = createMockRes();

    routeHandlers["POST /prompts"](req, res);

    expect(deps.promptManager.register).toHaveBeenCalledWith("test", "Hello", { description: undefined, version: undefined });
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("POST /prompts/render should render template", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({ name: "test", variables: { name: "World" } });
    const res = createMockRes();

    routeHandlers["POST /prompts/render"](req, res);

    expect(deps.promptManager.render).toHaveBeenCalledWith("test", { name: "World" });
    expect(res.json.mock.calls[0][0].rendered).toBe("rendered");
  });

  it("DELETE /prompts/:name should delete template", () => {
    const deps = createMockDeps();
    createSkillRoutes(deps);
    const req = createMockReq({}, { name: "test" });
    const res = createMockRes();

    routeHandlers["DELETE /prompts/:name"](req, res);

    expect(deps.promptManager.delete).toHaveBeenCalledWith("test");
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });
});
