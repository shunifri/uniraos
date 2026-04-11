import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SkillRegistry } from "./registry/index.js";
import { ExecutionEngine, AsyncTaskManager } from "./engine/index.js";
import { WALManager } from "./wal/index.js";
import { FileWALStore } from "./wal/file-wal-store.js";
import { Autonomy, defineSkill } from "./types/index.js";
import { ConfigManager } from "./config/config-manager.js";
import { OpenAIProvider } from "./llm/openai-provider.js";
import { ClaudeProvider } from "./llm/claude-provider.js";
import { AgentLoop } from "./llm/agent-loop.js";
import { createMemorySkills } from "./memory/memory-skills.js";
import { createMultimodalSkills } from "./llm/multimodal-skills.js";
import { createDataSkills } from "./skills/data-skills.js";
import { createDatabaseSkills } from "./skills/db-skills.js";
import { createWebSkills } from "./skills/web-skills.js";
import { createDocumentSkills } from "./skills/document-skills.js";
import { createChartSkills } from "./skills/chart-skills.js";
import { createProtocolSkills } from "./skills/protocol-skills.js";
import { createKnowledgeSkills } from "./skills/knowledge-skills.js";
import { createGraphSkills } from "./skills/graph-skills.js";
import { createApiGenSkills } from "./skills/api-gen-skills.js";
import { createMetaSkills } from "./skills/meta-skills.js";
import { createPlanningSkill } from "./skills/planning-skill.js";
import { createUserConfirmSkill } from "./skills/user-confirm-skill.js";
import { SkillMarketplace } from "./skills/skill-marketplace.js";
import { OpenAIMultimodalProvider } from "./llm/openai-multimodal-provider.js";
import { PluginLoader } from "./plugin/plugin-loader.js";
import { UserSessionManager } from "./user/user-session.js";
import { requestContext } from "./user/request-context.js";
import { initDatabase } from "./db/database.js";
import { authMiddleware } from "./db/auth-middleware.js";
import { cleanExpiredSessions } from "./db/auth.js";
import * as userRepo from "./db/user-repository.js";
import * as resRepo from "./db/resource-repository.js";
import type { LLMProvider, LLMProviderConfig, MultimodalProvider } from "./llm/types.js";
import { OpenAIEmbeddingProvider } from "./memory/embedding-provider.js";
import { setGlobalKBEmbeddingProvider, setGlobalKBVisionConfig } from "./skills/knowledge-skills.js";
import type { VisionModelConfig } from "./services/doc-parser.js";
import { Orchestrator } from "./agents/index.js";
import { EvolutionController, SkillLifecycleManager, EmergenceDetector } from "./engine/index.js";
import { createEvolutionSkills } from "./skills/evolution-skills.js";
import { PromptManager } from "./llm/prompt-manager.js";
import { ModelRouter } from "./llm/model-router.js";
import {
  HttpFederationTransport,
  SkillMigrationManager,
  FederationManager,
  EvolutionEngine,
  createFederationSkills,
} from "./federation/index.js";
import { mountRoutes } from "./routes/index.js";
import { ShareRepository } from "./db/share-repository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));

// 初始化数据库
const dbInstance = initDatabase();
userRepo.ensureAdminExists();
const shareRepository = new ShareRepository(dbInstance);

// 定时清理过期 session（每小时）
setInterval(() => cleanExpiredSessions(), 60 * 60 * 1000);

// 认证中间件：解析 Bearer token，挂载 req.user
app.use(authMiddleware);

// userId 上下文中间件：已登录用户用 user.id，未登录降级为 "default"
app.use((req, _res, next) => {
  const userId = req.user?.id ?? "default";
  requestContext.run({ userId }, () => next());
});

// 核心实例
const registry = new SkillRegistry();
const walStore = new FileWALStore(join(process.cwd(), ".raos", "wal.jsonl"));
const wal = new WALManager(walStore);
const configManager = new ConfigManager();
const sessionManager = new UserSessionManager(join(process.cwd(), ".raos", "ltm"), configManager.getMemory());
const taskManager = new AsyncTaskManager();
let engine = new ExecutionEngine(registry, wal);
const evolutionController = new EvolutionController();
const emergenceDetector = new EmergenceDetector();
engine.setEmergenceDetector(emergenceDetector);
const promptManager = new PromptManager();
const modelRouter = new ModelRouter();
const lifecycleManager = new SkillLifecycleManager(registry, engine.metrics);
const marketplace = new SkillMarketplace(registry);
const pluginLoader = new PluginLoader(registry, {
  skillsDir: join(process.cwd(), "skills"),
  hotReload: true,
  continueOnError: true,
});

let currentProvider: LLMProvider | null = null;
let currentMultimodalProvider: MultimodalProvider | null = null;

// 联邦/迁移/进化 组件 — 从 ConfigManager 读取配置
const fedCfg = configManager.getFederation();
const evoCfg = configManager.getEvolution();
const instanceId = fedCfg.instanceId || `raos_${process.pid}`;
const federationTransport = new HttpFederationTransport({
  apiKey: fedCfg.federationKey || undefined,
});
const migrationManager = new SkillMigrationManager(registry, engine.metrics, federationTransport, instanceId);
const federationManager = new FederationManager({
  registry,
  metrics: engine.metrics,
  transport: federationTransport,
  migration: migrationManager,
  instanceId,
});
const evolutionEngine = new EvolutionEngine({
  registry,
  metrics: engine.metrics,
  evolutionController,
  lifecycleManager,
  config: {
    autoExecute: evoCfg.autoExecute,
    cycleIntervalMs: evoCfg.cycleIntervalMs,
    maxActionsPerCycle: evoCfg.maxActionsPerCycle,
    skipApprovalRequired: evoCfg.skipApprovalRequired,
  },
  llmProvider: currentProvider ?? undefined,
});
// 连接联邦推荐到进化引擎
evolutionEngine.getFederatedRecommendations = () => federationManager.getRecommendations();

// 启动 session 清理（每小时清理 24 小时不活跃的 session）
sessionManager.startCleanup();

/** 根据配置创建 LLM Provider */
function createProvider(config: LLMProviderConfig): LLMProvider {
  if (config.type === "claude") {
    return new ClaudeProvider(config);
  }
  // openai 和 openai-compatible 都用 OpenAIProvider
  return new OpenAIProvider(config);
}

/** 获取视觉模型配置（用于文档 OCR） */
function getVisionConfig(): VisionModelConfig | null {
  // 优先使用 vision 模型卡片
  const visionCard = configManager.getResolvedModelConfig("vision");
  if (visionCard.apiKey && visionCard.model) {
    return {
      apiKey: visionCard.apiKey,
      baseUrl: (visionCard.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: visionCard.model,
    };
  }
  // 回退到多模态配置
  const mm = configManager.getMultimodalResolved();
  if (mm?.apiKey && mm?.visionModel) {
    return {
      apiKey: mm.apiKey,
      baseUrl: (mm.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: mm.visionModel,
    };
  }
  return null;
}

/** 重建多模态 Provider */
function rebuildMultimodalProvider(): void {
  const mmConfig = configManager.getMultimodalResolved();
  if (mmConfig) {
    currentMultimodalProvider = new OpenAIMultimodalProvider(mmConfig);
    console.log(`   Multimodal provider configured (image: ${mmConfig.imageModel ?? "dall-e-3"}, vision: ${mmConfig.visionModel ?? "gpt-4o"})`);
  } else {
    currentMultimodalProvider = null;
  }
}

/** 获取 Agent 配置 */
function getAgentConfig() {
  const agentConfig = configManager.get().agent;
  return {
    maxIterations: agentConfig.maxIterations,
    systemPrompt: agentConfig.systemPrompt || undefined,
    includeTrace: agentConfig.includeTrace,
  };
}

/** 获取或创建指定用户的 AgentLoop（按角色权限过滤可用 Skill） */
function getAgentLoop(userId: string): AgentLoop | null {
  if (!currentProvider) return null;
  const session = sessionManager.getOrCreate(userId);
  if (!session.agentLoop) {
    session.agentLoop = new AgentLoop(registry, engine, currentProvider, getAgentConfig());
    // 注入用户权限，实现 role-based skill 过滤
    const permissions = userRepo.getUserPermissions(userId);
    session.agentLoop.setUserPermissions(permissions);
  }
  return session.agentLoop;
}

/** 重建所有活跃 session 的 AgentLoop（配置变更时调用） */
function rebuildAllAgentLoops(): void {
  if (!currentProvider) return;
  sessionManager.rebuildAllAgentLoops(registry, engine, currentProvider, getAgentConfig());
}

/** 获取或创建 Orchestrator（智能策略选择器） */
function getOrchestrator(): Orchestrator | null {
  if (!currentProvider) return null;
  // 共享单实例，因为 Orchestrator 本身无状态（状态在子 Agent 中）
  if (!(globalThis as any).__orchestrator) {
    const agentConfig = configManager.get().agent;
    (globalThis as any).__orchestrator = new Orchestrator(
      { registry, engine, provider: currentProvider },
      {
        autoStrategy: true,
        defaultSystemPrompt: agentConfig.systemPrompt || undefined,
        maxIterations: agentConfig.maxIterations,
      },
    );
  }
  return (globalThis as any).__orchestrator as Orchestrator;
}

/** 重建 Orchestrator（LLM 配置变更时） */
function rebuildOrchestrator(): void {
  (globalThis as any).__orchestrator = null;
}

// ===== 注册示例 Skills =====
function loadExampleSkills() {
  registry.register(
    defineSkill({
      name: "log_before",
      visible: false,
      autonomy: Autonomy.AUTO_PRE,
      handler: async (params) => {
        console.log(`[AUTO_PRE] About to execute: ${params.target}`);
        return { success: true, data: { logged: true } };
      },
      description: "自动在执行前打印日志",
    }),
  );

  registry.register(
    defineSkill({
      name: "log_after",
      visible: false,
      autonomy: Autonomy.AUTO_POST,
      handler: async (params) => {
        console.log(`[AUTO_POST] Finished: ${params.target}`);
        return { success: true, data: { logged: true } };
      },
      description: "自动在执行后打印日志",
    }),
  );

  registry.register(
    defineSkill({
      name: "checkpoint",
      visible: false,
      autonomy: Autonomy.GUARDIAN,
      handler: async (params) => {
        console.log(`[GUARDIAN] Checkpoint saved for: ${params.target}`);
        return { success: true, data: { checkpoint: Date.now() } };
      },
      description: "守护级检查点保存",
    }),
  );

  registry.register(
    defineSkill({
      name: "greet",
      visible: true,
      autonomy: Autonomy.MANUAL,
      dependencies: ["log_before", "log_after"],
      handler: async (params) => {
        const name = (params.name as string) || "World";
        return { success: true, data: { message: `Hello, ${name}!` } };
      },
      description: "打招呼 Skill，接受 name 参数",
    }),
  );

  registry.register(
    defineSkill({
      name: "add",
      visible: true,
      autonomy: Autonomy.MANUAL,
      handler: async (params) => {
        const a = Number(params.a ?? 0);
        const b = Number(params.b ?? 0);
        return { success: true, data: { result: a + b } };
      },
      description: "加法计算，接受 a 和 b 参数",
    }),
  );

  registry.register(
    defineSkill({
      name: "slow_task",
      visible: true,
      autonomy: Autonomy.MANUAL,
      timeout: 5000,
      retry: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
      handler: async (params) => {
        const delay = Number(params.delay ?? 1000);
        await new Promise((r) => setTimeout(r, delay));
        return { success: true, data: { waited: delay } };
      },
      description: "模拟慢任务，接受 delay(ms) 参数",
    }),
  );

  registry.register(
    defineSkill({
      name: "random_fail",
      visible: true,
      autonomy: Autonomy.MANUAL,
      retry: { maxRetries: 3, backoffMs: 200, backoffMultiplier: 2 },
      handler: async () => {
        if (Math.random() < 0.6) {
          throw new Error("Random failure!");
        }
        return { success: true, data: { lucky: true } };
      },
      description: "60% 概率失败的 Skill，用于测试重试",
    }),
  );

  registry.register(
    defineSkill({
      name: "get_time",
      visible: true,
      autonomy: Autonomy.MANUAL,
      handler: async () => {
        return {
          success: true,
          data: {
            iso: new Date().toISOString(),
            timestamp: Date.now(),
            readable: new Date().toLocaleString("zh-CN"),
          },
        };
      },
      description: "获取当前时间",
    }),
  );

  registry.register(
    defineSkill({
      name: "calculate",
      visible: true,
      autonomy: Autonomy.MANUAL,
      handler: async (params) => {
        const { expression } = params as { expression: string };
        if (!expression) {
          return { success: false, error: new Error("Missing expression") };
        }
        // 简单安全计算（只允许数字和基本运算符）
        if (!/^[\d\s+\-*/().]+$/.test(expression)) {
          return { success: false, error: new Error("Invalid expression") };
        }
        const result = new Function(`return (${expression})`)();
        return { success: true, data: { expression, result } };
      },
      description: "数学表达式计算，接受 expression 参数，如 '2 + 3 * 4'",
    }),
  );

  registry.register(
    defineSkill({
      name: "list_skills",
      visible: true,
      autonomy: Autonomy.MANUAL,
      handler: async () => {
        const skills = registry.listVisible().map((s) => ({
          name: s.name,
          description: s.description,
        }));
        return { success: true, data: { skills } };
      },
      description: "列出所有可用的 Skill 及其描述",
    }),
  );
}

loadExampleSkills();

// 注册记忆 Skills（handler 通过 AsyncLocalStorage 获取当前用户的 STM/LTM）
// 传入 engine 引用实现记忆 Skill 的递归自指性
for (const skill of createMemorySkills(sessionManager, engine, () => currentProvider)) {
  registry.register(skill);
}
console.log(`   Memory skills registered (STM + LTM + meta)`);

// 注册进化系统 Skills
for (const skill of createEvolutionSkills(evolutionController, emergenceDetector)) {
  registry.register(skill);
}
console.log(`   Evolution skills registered (genealogy + emergence + red-lines)`);

// 注册多模态 + 异步任务 Skills
for (const skill of createMultimodalSkills(() => currentMultimodalProvider, taskManager)) {
  registry.register(skill);
}
console.log(`   Multimodal + async task skills registered`);

// 注册数据操作 Skills (file/http/shell)
createDataSkills(registry);

// 注册数据库 Skills (SQLite + 可选 MySQL/PostgreSQL/Redis/MSSQL/Oracle)
await createDatabaseSkills(registry);

// 注册网络检索 Skills (web_fetch/web_search/web_extract_links/web_screenshot)
createWebSkills(registry);

// 注册文档解析 Skills (doc_read/doc_read_csv + PDF/Excel/Word)
createDocumentSkills(registry);

// 注册数据可视化 Skills (chart_recommend/chart_generate/chart_multi)
createChartSkills(registry);

// 注册通信协议 Skills (WebSocket + 消息总线)
createProtocolSkills(registry);

// 注册知识库 Skills (kb_ingest/kb_search/kb_list/kb_delete/kb_share/kb_shared/kb_stats/kb_rebuild)
createKnowledgeSkills(registry, sessionManager);

// 注册知识图谱 Skills (graph_query/graph_path/graph_communities)
for (const skill of createGraphSkills(sessionManager)) {
  registry.register(skill);
}
console.log(`   Graph skills registered (query + path + communities)`);

// 注册 API 文档自动生成 Skills (api_import/api_auth_config/api_list/api_delete/api_test)
createApiGenSkills(registry);

// 注册联邦/迁移/进化 Skills (skill_migrate_*/federation_*/evolution_*)
createFederationSkills(registry, migrationManager, federationManager, evolutionEngine);

// 注册元 Skills (compose/template/info)
createMetaSkills(registry, engine, () => currentProvider);

// 注册 Prompt 管理 Skills
registry.register(
  defineSkill({
    name: "prompt_register",
    description: "注册 Prompt 模板。参数: name(string), template(string), description?(string), version?(string)",
    handler: async (params) => {
      try {
        const pt = promptManager.register(
          params.name as string,
          params.template as string,
          { description: params.description as string, version: params.version as string },
        );
        return { success: true, data: pt };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
  }),
);

registry.register(
  defineSkill({
    name: "prompt_render",
    description: "渲染 Prompt 模板。参数: name(string), variables(object)",
    handler: async (params) => {
      try {
        const result = promptManager.render(
          params.name as string,
          params.variables as Record<string, string>,
        );
        return { success: true, data: { rendered: result } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
  }),
);

registry.register(
  defineSkill({
    name: "prompt_list",
    description: "列出所有 Prompt 模板。",
    handler: async () => {
      return { success: true, data: { templates: promptManager.list() } };
    },
  }),
);

console.log("   Prompt management skills registered");

// 注册多步规划 Skill
createPlanningSkill(registry, engine, () => currentProvider);

// 注册用户交互确认 Skill
registry.register(createUserConfirmSkill());
console.log("   User confirm skill registered");

// 标记所有已注册的内置 Skill 为系统 Skill
for (const skill of registry.list()) {
  if (!skill.owner) {
    (skill as any).isSystem = true;
  }
}

// 加载插件目录中的 Skill
pluginLoader.on((event) => {
  if (event.type === "loaded") console.log(`   Plugin loaded: ${event.plugin.name}@${event.plugin.version}`);
  if (event.type === "reloaded") console.log(`   Plugin reloaded: ${event.plugin.name}`);
  if (event.type === "error") console.error(`   Plugin error [${event.name}]: ${event.error.message}`);
});
pluginLoader.loadAll().then(({ loaded, errors }) => {
  if (loaded.length > 0) console.log(`   Plugins loaded: ${loaded.join(", ")}`);
  if (errors.length > 0) console.log(`   Plugin errors: ${errors.map((e) => `${e.name}(${e.error})`).join(", ")}`);

  // 插件加载后同步 Skill 资源
  syncSkillsToResources();
});

// 从持久化配置恢复 LLM Provider
if (configManager.isLLMConfigured()) {
  const llmConfig = configManager.getLLM()!;
  currentProvider = createProvider(llmConfig);
  console.log(`   LLM restored: ${llmConfig.type} / ${llmConfig.model}`);
}

// 恢复多模态 Provider
if (configManager.isMultimodalConfigured()) {
  rebuildMultimodalProvider();
}

// 恢复 Embedding Provider（从 modelCards 配置）
{
  const embeddingCard = configManager.getResolvedModelConfig("embedding");
  if (embeddingCard.apiKey && embeddingCard.model) {
    const embProvider = new OpenAIEmbeddingProvider({
      apiKey: embeddingCard.apiKey,
      baseUrl: embeddingCard.baseUrl || undefined,
      model: embeddingCard.model,
      mode: embeddingCard.embeddingMode || "openai",
    });
    setGlobalKBEmbeddingProvider(embProvider);
    sessionManager.setEmbeddingProvider(embProvider);
    console.log(`   Embedding provider restored: ${embeddingCard.model} (mode: ${embeddingCard.embeddingMode || "openai"})`);
  }
}

// 恢复视觉模型配置（用于文档 OCR）
{
  const vc = getVisionConfig();
  if (vc) {
    setGlobalKBVisionConfig(vc);
    console.log(`   Vision config restored: ${vc.model} (for doc OCR)`);
  }
}

// 同步 Skill 到资源表
function syncSkillsToResources() {
  const skills = registry.list().map((s) => ({
    name: s.name,
    description: s.description,
  }));
  const result = resRepo.syncSkillResources(skills);
  console.log(`   Skills synced to resources: ${result.added} added, ${result.total} total`);
}
syncSkillsToResources();

// 在 skill 资源同步后，确保角色的 skill 权限被正确分配
import { getDb } from "./db/database.js";
(() => {
  const db = getDb();
  // role_user 允许的 skill 列表（安全的基础 skill）
  const userAllowedSkills = [
    'user_confirm', 'kb_search', 'kb_ingest', 'kb_list', 'kb_delete', 'kb_share',
    'stm_store', 'stm_retrieve', 'stm_forget', 'ltm_store', 'ltm_search', 'ltm_delete', 'ltm_list',
    'chart_recommend', 'chart_generate', 'chart_multi',
    'doc_read', 'doc_read_csv', 'web_search', 'web_fetch',
    'graph_query', 'graph_path', 'graph_communities', 'plan_and_execute',
    'file_read', 'file_list', 'db_query', 'db_schema',
  ];
  // role_viewer (anonymous) 允许的 skill 列表（最小集）
  const anonAllowedSkills = [
    'user_confirm', 'kb_search', 'kb_list',
    'chart_recommend', 'chart_generate',
    'web_search', 'web_fetch', 'doc_read',
  ];

  const insertPerm = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT ?, id FROM permissions WHERE name = ?
  `);

  for (const skill of userAllowedSkills) {
    insertPerm.run('role_user', `skill:${skill}.execute`);
  }
  for (const skill of anonAllowedSkills) {
    insertPerm.run('role_viewer', `skill:${skill}.execute`);
  }

  // admin 角色：分配所有 skill 权限（确保新 skill 也被覆盖）
  db.exec(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT 'role_admin', id FROM permissions WHERE name LIKE 'skill:%'
  `);

  console.log(`   Role skill permissions assigned (user: ${userAllowedSkills.length}, anonymous: ${anonAllowedSkills.length})`);
})();

// ===== Mount all API routes =====
mountRoutes(app, {
  registry,
  engine,
  wal,
  configManager,
  sessionManager,
  taskManager,
  pluginLoader,
  marketplace,
  evolutionController,
  emergenceDetector,
  lifecycleManager,
  promptManager,
  modelRouter,
  federationTransport,
  migrationManager,
  federationManager,
  evolutionEngine,
  instanceId,
  getCurrentProvider: () => currentProvider,
  getCurrentMultimodalProvider: () => currentMultimodalProvider,
  createProvider,
  setCurrentProvider: (p) => { currentProvider = p; },
  getAgentLoop,
  getOrchestrator,
  getAgentConfig,
  getVisionConfig,
  rebuildMultimodalProvider,
  rebuildAllAgentLoops,
  rebuildOrchestrator,
  syncSkillsToResources,
  shareRepository,
});

// 静态文件 - UI
// assets/ 目录文件名含 content hash，可以长期缓存
app.use("/assets", express.static(join(__dirname, "ui", "assets"), {
  maxAge: "1y",
  immutable: true,
}));
// 其他静态文件不缓存（特别是 index.html）
app.use(express.static(join(__dirname, "ui"), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    // index.html 和非 hash 文件不缓存
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  },
}));

// SPA fallback — 非 API 路由全部返回 index.html（禁止缓存）
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/") && !req.path.includes(".")) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(join(__dirname, "ui", "index.html"));
  } else {
    next();
  }
});

const PORT = process.env.PORT ?? 9001;

// 启动时自动 WAL 恢复
const walRecoveryPlan = wal.recover();
if (walRecoveryPlan.entries.length > 0) {
  console.log(`\n   WAL recovery: ${walRecoveryPlan.description}`);
  wal.replay(engine).then((result) => {
    console.log(`   WAL replay complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped (${result.durationMs}ms)`);
  }).catch((err) => {
    console.error(`   WAL replay error: ${err.message}`);
  });
}

app.listen(PORT, () => {
  console.log(`\n🚀 RAOS Dev Server running at http://localhost:${PORT}`);
  console.log(`   API:  http://localhost:${PORT}/api/skills`);
  console.log(`   UI:   http://localhost:${PORT}`);
  console.log(`   Instance: ${instanceId}`);

  // 启动联邦心跳和进化引擎 — 从 ConfigManager 读取 peers
  const fedPeers = configManager.getFederation().peers;
  if (fedPeers.length > 0) {
    for (const peer of fedPeers) {
      federationTransport.addPeer({
        instanceId: peer.endpoint,
        endpoint: peer.endpoint,
        version: "2.0",
        capabilities: [],
        skillCount: 0,
        lastHeartbeat: Date.now(),
      });
    }
    federationManager.start();
    console.log(`   Federation: ${fedPeers.length} peers configured`);
  }

  const evoConfig = configManager.getEvolution();
  evolutionEngine.start();
  console.log(`   Evolution engine: started (auto=${evoConfig.autoExecute})\n`);

  // Auto-sync LTM to knowledge graph on startup (after a short delay)
  setTimeout(async () => {
    try {
      const defaultSession = sessionManager.getOrCreate("default");
      if (defaultSession.graphManager && defaultSession.ltm) {
        const entries = await defaultSession.ltm.list();
        if (entries.length > 0) {
          const result = await defaultSession.graphManager.syncFromLTM(
            entries.map((e: any) => ({ id: e.id, key: e.key, value: e.value, tags: e.tags ?? [] }))
          );
          console.log(`   Graph auto-sync: ${result.added} nodes added from LTM`);
        }
      }
    } catch (err) {
      console.log(`   Graph auto-sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 5000);
});
