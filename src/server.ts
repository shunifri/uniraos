import 'dotenv/config';
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync, rmSync, createReadStream, writeFileSync } from "fs";
import { SkillRegistry } from "./registry/index.js";
import { ExecutionEngine, AsyncTaskManager, SkillAccessService } from "./engine/index.js";
import { WALManager } from "./wal/index.js";
import { FileWALStore } from "./wal/file-wal-store.js";
import { Autonomy, defineSkill, defineSystemSkill } from "./types/index.js";
import { ConfigManager } from "./config/config-manager.js";
import { OpenAIProvider } from "./llm/openai-provider.js";
import { ClaudeProvider } from "./llm/claude-provider.js";
import { AgentLoop } from "./llm/agent-loop.js";
import { skillsToTools } from "./llm/tool-bridge.js";
import { createMemorySkills } from "./memory/memory-skills.js";
import { createMultimodalSkills } from "./llm/multimodal-skills.js";
import { createDataSkills } from "./skills/data-skills.js";
import { createDatabaseSkills } from "./skills/db-skills.js";
import { createWebSkills } from "./skills/web-skills.js";
import { createDocumentSkills } from "./skills/document-skills.js";
import { createChartSkills } from "./skills/chart-skills.js";
import { createProtocolSkills } from "./skills/protocol-skills.js";
import { createKnowledgeSkills } from "./skills/knowledge-skills.js";
import { createApiGenSkills } from "./skills/api-gen-skills.js";
import { createMetaSkills, resolveParams, createTransformSkill, createValidateSkill, createAggregateSkill } from "./skills/meta-skills.js";
import { createPlanningSkill } from "./skills/planning-skill.js";
import { createGraphSkills } from "./skills/graph-skills.js";
import { createWorkflowSkills } from "./skills/workflow-skills.js";
import { createEnterpriseSkills } from "./skills/enterprise-skills.js";
import { createIntegrationSkills } from "./skills/integration-skills.js";
import { createAdvancedSkills } from "./skills/advanced-skills.js";
import { createUserConfirmSkill } from "./skills/user-confirm-skill.js";
import { SkillMarketplace } from "./skills/skill-marketplace.js";
import { OpenAIMultimodalProvider } from "./llm/openai-multimodal-provider.js";
import { PluginLoader } from "./plugin/plugin-loader.js";
import { UserSessionManager } from "./user/user-session.js";
import { requestContext } from "./user/request-context.js";
import { initDatabaseAsync, getDb, isMySQL } from "./db/database.js";
import { ShareRepository } from "./db/share-repository.js";
import { getCustomSkillRepository } from "./db/custom-skill-repository.js";
import { extractPptxStyle } from "./services/pptx-style-extractor.js";
import { authMiddleware, requireAuth, requirePermission, requireAdmin } from "./db/auth-middleware.js";
import { initPermissionService, permissions } from "./permissions/index.js";
import { createSession, destroySession, cleanExpiredSessions } from "./db/auth.js";
import * as userRepo from "./db/user-repository.js";
import * as deptRepo from "./db/department-repository.js";
import * as resRepo from "./db/resource-repository.js";
import type { LLMProvider, LLMProviderConfig, MultimodalProvider } from "./llm/types.js";
import type { RoleAgentConfig } from "./permissions/types/role.js";
import { OpenAIEmbeddingProvider } from "./memory/embedding-provider.js";
import { setGlobalKBEmbeddingProvider, setGlobalKBVisionConfig, getKnowledgeBase, getKBPageImageList, getKBPageImagePath } from "./skills/knowledge-skills.js";
import { parseDocument, type VisionModelConfig } from "./services/doc-parser.js";
import { Orchestrator } from "./agents/index.js";
import type { AgentStreamEvent } from "./agents/index.js";
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
import { DocMindParser } from "./services/docmind-parser.js";
import { initParsingQueue, getParsingQueue } from "./services/parsing-queue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));

// 初始化数据库（异步）
await initDatabaseAsync();
await userRepo.ensureAdminExists();

// 定时清理过期 session（每小时）
setInterval(() => cleanExpiredSessions(), 60 * 60 * 1000);

// 认证中间件：解析 Bearer token，挂载 req.user
app.use(authMiddleware);

/** 解析角色 Agent 配置：优先使用请求中显式指定的角色，其次取用户第一个非系统角色 */
async function resolveRoleAgentConfig(req: any): Promise<RoleAgentConfig | undefined> {
  const explicitRole = req.body?.role || req.query?.role;
  if (explicitRole) {
    return await userRepo.getRoleAgentConfig(explicitRole) ?? undefined;
  }
  if (req.user?.id) {
    const roles = await userRepo.getUserRoles(req.user.id);
    if (roles.length > 0) {
      return await userRepo.getRoleAgentConfig(roles[0].id) ?? undefined;
    }
  }
  return undefined;
}

// userId 上下文中间件：已登录用户用 user.id，未登录降级为 "default"
app.use((req, _res, next) => {
  const user = req.user;
  requestContext.run({
    userId: user?.id ?? "default",
    userName: user?.username,
    userDisplayName: user?.displayName,
    departmentId: user?.departmentId ?? undefined,
  }, () => next());
});

// 核心实例
const registry = new SkillRegistry();
// 初始化统一权限服务
initPermissionService(registry);
const walStore = new FileWALStore(join(process.cwd(), ".raos", "wal.jsonl"));
const wal = new WALManager(walStore);
const configManager = new ConfigManager();
const sessionManager = new UserSessionManager(join(process.cwd(), ".raos", "ltm"), configManager.getMemory());
const taskManager = new AsyncTaskManager();

// 初始化 Document Mind ParsingQueue（如果已配置）
if (configManager.isDocMindConfigured()) {
  const docMindConfig = configManager.getDocMind();
  if (docMindConfig.accessKeyId && docMindConfig.accessKeySecret) {
    const parser = new DocMindParser({
      accessKeyId: docMindConfig.accessKeyId,
      accessKeySecret: docMindConfig.accessKeySecret,
      endpoint: docMindConfig.endpoint,
      regionId: docMindConfig.regionId,
    });
    const visionConfig = getVisionConfig();
    initParsingQueue(parser, (owner) => getKnowledgeBase(owner), {
      maxConcurrent: 3,
      pollingIntervalMs: 3000,
      maxPollingTimeMs: 30 * 60 * 1000,
      enableIncrementalIndex: true,
      kbImagesDir: resolve(process.cwd(), ".raos/kb_images"),
    }, sessionManager, visionConfig);
    // 确保获取队列实例触发任何必要的启动逻辑
    getParsingQueue();
    console.log("   Document Mind parsing queue initialized");
  }
}
let engine = new ExecutionEngine(registry, wal);
const skillAccessService = new SkillAccessService(registry);
const evolutionController = new EvolutionController(
  undefined,
  join(process.cwd(), ".raos", "evolution.db")
);
const emergenceDetector = new EmergenceDetector();
engine.setEmergenceDetector(emergenceDetector);
const promptManager = new PromptManager();
const modelRouter = new ModelRouter();
const lifecycleManager = new SkillLifecycleManager(registry, engine.metrics);
engine.setLifecycleManager(lifecycleManager);
const marketplace = new SkillMarketplace(registry);
const pluginLoader = new PluginLoader(registry, {
  skillsDir: join(process.cwd(), "skills"),
  hotReload: true,
  continueOnError: true,
});

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
});
// 连接联邦推荐到进化引擎
evolutionEngine.getFederatedRecommendations = () => federationManager.getRecommendations();
let currentProvider: LLMProvider | null = null;
let currentMultimodalProvider: MultimodalProvider | null = null;

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

/** 获取或创建指定用户的 AgentLoop */
function getAgentLoop(userId: string): AgentLoop | null {
  if (!currentProvider) return null;
  const session = sessionManager.getOrCreate(userId);
  if (!session.agentLoop) {
    session.agentLoop = new AgentLoop(registry, engine, currentProvider, getAgentConfig(), skillAccessService);
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
    defineSystemSkill({
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
    defineSystemSkill({
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
    defineSystemSkill({
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
    defineSystemSkill({
      name: "greet",
      visible: true,
      dependencies: ["log_before", "log_after"],
      handler: async (params) => {
        const name = (params.name as string) || "World";
        return { success: true, data: { message: `Hello, ${name}!` } };
      },
      description: "打招呼 Skill，接受 name 参数",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "add",
      visible: true,
      handler: async (params) => {
        const a = Number(params.a ?? 0);
        const b = Number(params.b ?? 0);
        return { success: true, data: { result: a + b } };
      },
      description: "加法计算，接受 a 和 b 参数",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "slow_task",
      visible: true,
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
    defineSystemSkill({
      name: "random_fail",
      visible: true,
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
    defineSystemSkill({
      name: "get_time",
      visible: true,
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
    defineSystemSkill({
      name: "calculate",
      visible: true,
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
    defineSystemSkill({
      name: "list_skills",
      visible: true,
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
await createDataSkills(registry);

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

// 注册 API 文档自动生成 Skills (api_import/api_auth_config/api_list/api_delete/api_test)
createApiGenSkills(registry);

// 注册联邦/迁移/进化 Skills (skill_migrate_*/federation_*/evolution_*)
createFederationSkills(registry, migrationManager, federationManager, evolutionEngine);

// 注册工作流 Skills (approval_submit/approval_query/approval_approve/task_create/task_query/task_update/workflow_generate)
createWorkflowSkills(registry, () => currentProvider);
console.log(`   Workflow skills registered`);

// 注册企业基础设施 Skills (email_send/email_read/im_bot_send/ldap_search/ldap_auth/calendar_query/calendar_create)
await createEnterpriseSkills(registry);

// 注册数据集成 Skills (kafka_consume/kafka_produce/mqtt_publish/mqtt_subscribe)
await createIntegrationSkills(registry);

// 注册高级 Skills (health_check/alert_query/log_query/metric_query/ftp/sftp/soap/odbc/rpa/saml/oauth2/role_sync)
await createAdvancedSkills(registry);

// 注册元 Skills (compose/template/info)
createMetaSkills(registry, engine, () => currentProvider, evolutionController);

// 注册知识图谱 Skills
for (const skill of createGraphSkills(sessionManager)) {
  registry.register(skill);
}
console.log(`   Graph skills registered (graph_query/graph_path/graph_communities/graph_deduplicate)`);

// 注册用户确认 Skill
registry.register(createUserConfirmSkill());
console.log(`   User confirmation skill registered (user_confirm)`);

// 注册 Prompt 管理 Skills
registry.register(
  defineSystemSkill({
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
  defineSystemSkill({
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
  defineSystemSkill({
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

// 从数据库加载用户自定义 Skill
(async () => {
  try {
    const repo = getCustomSkillRepository();
    const customSkills = await repo.findAll();
    let loadedCount = 0;
    for (const customSkill of customSkills) {
      try {
        const skill = await repo.reconstructSkill(customSkill);
        if (!registry.lookup(skill.name)) {
          registry.register(skill);
          loadedCount++;
        } else {
          console.log(`   Custom skill "${skill.name}" already registered, skipping`);
        }
      } catch (error) {
        console.warn(`   Failed to load custom skill ${customSkill.name}:`, error);
      }
    }
    if (loadedCount > 0) {
      console.log(`   Custom skills loaded from database: ${loadedCount}`);
      syncSkillsToResources();
    }
  } catch (error) {
    console.warn("   Failed to load custom skills from database:", error);
  }
})();

// 从持久化配置恢复 LLM Provider
if (configManager.isLLMConfigured()) {
  const llmConfig = configManager.getLLM()!;
  currentProvider = createProvider(llmConfig);
  sessionManager.setLLMProvider(currentProvider); // 确保 sessionManager 有 llmProvider
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
async function syncSkillsToResources() {
  const skills = registry.list().map((s) => ({
    name: s.name,
    description: s.description,
  }));
  const result = await resRepo.syncSkillResources(skills);
  console.log(`   Skills synced to resources: ${result.added} added, ${result.total} total`);
}
syncSkillsToResources();

// ===== Auth Routes（已移至 routes/auth-routes.ts） =====

// ===== 用户管理 API（已移至 routes/auth-routes.ts） =====

// ===== 部门管理 API（已移至 routes/auth-routes.ts） =====

// ===== 资源管理 API（已移至 routes/auth-routes.ts） =====

// ===== 角色权限管理 API（已移至 routes/auth-routes.ts） =====

// ===== Admin API 兼容路由 (/api/admin/*) =====

// 用户管理兼容路由
app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const users = await userRepo.listUsers();
  res.json({ success: true, users });
});
app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, displayName, departmentId } = req.body;
  if (!username || !password) {
    res.status(400).json({ success: false, error: "username and password are required" });
    return;
  }
  try {
    const user = await userRepo.createUser({ username, password, displayName, departmentId });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});
app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await userRepo.updateUser(userId, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});
app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await userRepo.deleteUser(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 部门管理兼容路由
app.get("/api/admin/departments", requireAuth, requireAdmin, async (_req, res) => {
  const departments = await deptRepo.listDepartments();
  res.json({ success: true, departments });
});
app.post("/api/admin/departments", requireAuth, requireAdmin, async (req, res) => {
  try {
    const dept = await deptRepo.createDepartment(req.body);
    res.json({ success: true, department: dept });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});
app.delete("/api/admin/departments/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const deptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deptRepo.deleteDepartment(deptId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 角色管理兼容路由
app.get("/api/admin/roles", requireAuth, requireAdmin, async (_req, res) => {
  const roles = await userRepo.listRoles();
  res.json({ success: true, roles });
});
app.post("/api/admin/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const role = await userRepo.createRole(req.body);
    res.json({ success: true, role });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 资源管理兼容路由
app.get("/api/admin/resources", requireAuth, requireAdmin, async (_req, res) => {
  const resources = await resRepo.listResources();
  res.json({ success: true, resources });
});

// ===== LLM Configuration APIs（带权限守卫） =====

// 获取当前 LLM 配置（隐藏 API Key）
app.get("/api/config", requireAuth, requirePermission("config.read"), (_req, res) => {
  const config = configManager.get();
  res.json({
    llm: config.llm
      ? {
          ...config.llm,
          apiKey: config.llm.apiKey ? "***" + config.llm.apiKey.slice(-4) : "",
        }
      : null,
    multimodal: {
      ...config.multimodal,
      apiKey: config.multimodal.apiKey ? "***" + config.multimodal.apiKey.slice(-4) : "",
    },
    engine: config.engine,
    agent: config.agent,
    docMind: config.docMind ? {
      ...config.docMind,
      accessKeyId: config.docMind.accessKeyId ? "***" + config.docMind.accessKeyId.slice(-4) : "",
      accessKeySecret: config.docMind.accessKeySecret ? "***" + config.docMind.accessKeySecret.slice(-4) : "",
    } : null,
    isLLMConfigured: configManager.isLLMConfigured(),
    isMultimodalConfigured: configManager.isMultimodalConfigured(),
    isDocMindConfigured: configManager.isDocMindConfigured(),
  });
});

// 设置 LLM 配置
app.post("/api/config/llm", requireAuth, requirePermission("config.write"), (req, res) => {
  const { type, apiKey, baseUrl, model, maxTokens, temperature } = req.body;

  if (!type || !apiKey || !model) {
    res.status(400).json({
      success: false,
      error: "type, apiKey, and model are required",
    });
    return;
  }

  const llmConfig: LLMProviderConfig = {
    type,
    apiKey,
    baseUrl,
    model,
    maxTokens: maxTokens ?? 4096,
    temperature: temperature ?? 0.7,
  };

  configManager.setLLM(llmConfig);
  currentProvider = createProvider(llmConfig);
  rebuildAllAgentLoops();
  rebuildOrchestrator();

  res.json({
    success: true,
    message: `LLM configured: ${type} / ${model}`,
  });
});

// 设置 Agent 配置
app.post("/api/config/agent", requireAuth, requirePermission("config.write"), (req, res) => {
  const { maxIterations, systemPrompt, includeTrace } = req.body;
  configManager.setAgent({ maxIterations, systemPrompt, includeTrace });
  rebuildAllAgentLoops();
  rebuildOrchestrator();
  res.json({ success: true });
});

// 获取多模态配置
app.get("/api/config/multimodal", requireAuth, requirePermission("config.read"), (_req, res) => {
  const mm = configManager.getMultimodal();
  res.json({
    ...mm,
    apiKey: mm.apiKey ? "***" + mm.apiKey.slice(-4) : "",
    isConfigured: configManager.isMultimodalConfigured(),
  });
});

// 获取所有模型卡片配置
app.get("/api/config/model-cards", requireAuth, requirePermission("config.read"), (_req, res) => {
  const cards = configManager.getModelCards();
  // 遮掩 apiKey，但标记是否已设置
  const masked: Record<string, any> = {};
  for (const [type, card] of Object.entries(cards)) {
    masked[type] = {
      ...card,
      hasApiKey: !!card.apiKey,
      apiKey: card.apiKey ? "***" + card.apiKey.slice(-4) : "",
    };
  }
  res.json({ success: true, cards: masked });
});

// 保存单个模型卡片配置
app.post("/api/config/model-cards/:type", requireAuth, requirePermission("config.write"), (req, res) => {
  const cardType = req.params.type as any;
  const validTypes = ["llm", "vision", "imageGen", "tts", "stt", "embedding"];
  if (!validTypes.includes(cardType)) {
    res.status(400).json({ success: false, error: `Invalid model card type: ${cardType}` });
    return;
  }
  const { type, apiKey, baseUrl, model, maxTokens, temperature, embeddingMode } = req.body;
  // 如果前端传来遮掩的 apiKey（以 *** 开头）或空值，保留已有的 key
  const existingCards = configManager.getModelCards();
  const existingCard = (existingCards as Record<string, any>)[cardType] ?? {};
  const resolvedApiKey = (!apiKey || apiKey.startsWith("***")) ? existingCard.apiKey : apiKey;
  configManager.setModelCard(cardType, { type, apiKey: resolvedApiKey, baseUrl, model, maxTokens, temperature, embeddingMode });

  // 如果保存的是 LLM 卡片且有完整信息，同步更新主 LLM 配置
  if (cardType === "llm" && type && resolvedApiKey && model) {
    configManager.setLLM({ type, apiKey: resolvedApiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 });
    currentProvider = createProvider({ type, apiKey: resolvedApiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 });
    rebuildAllAgentLoops();
    rebuildOrchestrator();
  }

  // 非 LLM 模型变更时更新多模态
  if (["vision", "imageGen", "tts", "stt"].includes(cardType)) {
    configManager.setMultimodal({ ...configManager.getMultimodal(), enabled: true });
    rebuildMultimodalProvider();
  }

  // Vision 卡片变更时，更新文档 OCR 的视觉配置
  if (cardType === "vision") {
    const vc = getVisionConfig();
    setGlobalKBVisionConfig(vc);
  }

  // Embedding 卡片变更时，更新知识库的 embedding provider
  if (cardType === "embedding") {
    const resolved = configManager.getResolvedModelConfig("embedding");
    if (resolved.apiKey && resolved.model) {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl || undefined,
        model: resolved.model,
        mode: resolved.embeddingMode || "openai",
      });
      setGlobalKBEmbeddingProvider(provider);
      sessionManager.setEmbeddingProvider(provider);
      console.log(`   Embedding provider configured: ${resolved.model} (mode: ${resolved.embeddingMode || "openai"})`);
    }
  }

  res.json({ success: true, message: `Model card '${cardType}' saved` });
});

// 设置多模态配置
app.post("/api/config/multimodal", requireAuth, requirePermission("config.write"), (req, res) => {
  const { enabled, apiKey, baseUrl, imageModel, visionModel, ttsModel, whisperModel } = req.body;

  configManager.setMultimodal({
    enabled: enabled ?? true,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    imageModel: imageModel || undefined,
    visionModel: visionModel || undefined,
    ttsModel: ttsModel || undefined,
    whisperModel: whisperModel || undefined,
  });

  rebuildMultimodalProvider();

  res.json({
    success: true,
    message: "Multimodal config saved",
    isConfigured: configManager.isMultimodalConfigured(),
  });
});

// ===== Federation Config APIs =====

app.get("/api/config/federation", requireAuth, requireAdmin, (_req, res) => {
  const cfg = configManager.getFederation();
  res.json({
    success: true,
    config: {
      ...cfg,
      federationKey: cfg.federationKey ? "***" + cfg.federationKey.slice(-4) : "",
    },
  });
});

app.post("/api/config/federation", requireAuth, requireAdmin, (req, res) => {
  const { instanceId: iid, federationKey, heartbeatIntervalMs, syncIntervalMs } = req.body;
  configManager.setFederation({
    ...(iid !== undefined && { instanceId: iid }),
    ...(federationKey !== undefined && { federationKey }),
    ...(heartbeatIntervalMs !== undefined && { heartbeatIntervalMs }),
    ...(syncIntervalMs !== undefined && { syncIntervalMs }),
  });
  // 运行时更新 transport 密钥
  if (federationKey !== undefined) {
    (federationTransport as any).apiKey = federationKey;
  }
  res.json({ success: true, message: "Federation config saved" });
});

app.post("/api/config/federation/peers", requireAuth, requireAdmin, (req, res) => {
  const { endpoint, name } = req.body;
  if (!endpoint) {
    res.status(400).json({ success: false, error: "endpoint is required" });
    return;
  }
  configManager.addFederationPeer({ endpoint, name });
  // 运行时添加到 transport
  federationTransport.addPeer({
    instanceId: endpoint,
    endpoint,
    version: "2.0",
    capabilities: [],
    skillCount: 0,
    lastHeartbeat: Date.now(),
  });
  res.json({ success: true, message: `Peer ${endpoint} added` });
});

app.delete("/api/config/federation/peers", requireAuth, requireAdmin, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    res.status(400).json({ success: false, error: "endpoint is required" });
    return;
  }
  configManager.removeFederationPeer(endpoint);
  federationTransport.removePeer(endpoint);
  res.json({ success: true, message: `Peer ${endpoint} removed` });
});

// ===== Evolution Engine Config APIs =====

app.get("/api/config/evolution-engine", requireAuth, requireAdmin, (_req, res) => {
  const cfg = configManager.getEvolution();
  res.json({ success: true, config: cfg });
});

app.post("/api/config/evolution-engine", requireAuth, requireAdmin, (req, res) => {
  const updates: Record<string, unknown> = {};
  const fields = [
    "autoExecute", "cycleIntervalMs", "maxActionsPerCycle", "skipApprovalRequired",
    "successRateThreshold", "latencyThresholdMs", "inactiveDays", "minFederationConfidence",
  ];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  configManager.setEvolution(updates as any);
  // 运行时更新 evolutionEngine
  evolutionEngine.updateConfig(updates as any);
  res.json({ success: true, config: configManager.getEvolution() });
});

// 扩展 GET /api/config 以包含 federation/evolution
app.get("/api/config/full", requireAuth, requireAdmin, (_req, res) => {
  const config = configManager.get();
  res.json({
    success: true,
    llm: config.llm ? { ...config.llm, apiKey: "***" + config.llm.apiKey.slice(-4) } : null,
    multimodal: { ...config.multimodal, apiKey: config.multimodal.apiKey ? "***" + config.multimodal.apiKey.slice(-4) : "" },
    engine: config.engine,
    agent: config.agent,
    federation: { ...config.federation, federationKey: config.federation.federationKey ? "***" : "" },
    evolution: config.evolution,
  });
});

// 测试 LLM 连接
app.post("/api/llm/test", requireAuth, requirePermission("config.read"), async (req, res) => {
  if (!currentProvider) {
    res.status(400).json({ success: false, error: "LLM not configured" });
    return;
  }

  try {
    const response = await currentProvider.chat([
      { role: "user", content: "Say hello in one sentence." },
    ]);
    res.json({
      success: true,
      response: response.content,
      model: currentProvider.model,
      usage: response.usage,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// PUT 兼容路由
app.put("/api/config/llm", requireAuth, requirePermission("config.write"), (req, res) => {
  const { type, apiKey, baseUrl, model, maxTokens, temperature } = req.body;
  if (!type || !apiKey || !model) {
    res.status(400).json({ success: false, error: "type, apiKey, and model are required" });
    return;
  }
  const llmConfig = { type, apiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 };
  configManager.setLLM(llmConfig);
  currentProvider = createProvider(llmConfig);
  rebuildAllAgentLoops();
  rebuildOrchestrator();
  res.json({ success: true, message: `LLM configured: ${type} / ${model}` });
});

app.put("/api/config/agent", requireAuth, requirePermission("config.write"), (req, res) => {
  const { maxIterations, systemPrompt, includeTrace } = req.body;
  configManager.setAgent({ maxIterations, systemPrompt, includeTrace });
  rebuildAllAgentLoops();
  rebuildOrchestrator();
  res.json({ success: true });
});

app.put("/api/config/multimodal", requireAuth, requirePermission("config.write"), (req, res) => {
  const { enabled, apiKey, baseUrl, imageModel, visionModel, ttsModel, whisperModel } = req.body;
  configManager.setMultimodal({ enabled, apiKey, baseUrl, imageModel, visionModel, ttsModel, whisperModel });
  rebuildMultimodalProvider();
  res.json({ success: true, message: "Multimodal config saved" });
});

app.put("/api/config/federation", requireAuth, requireAdmin, (req, res) => {
  const { instanceId: iid, federationKey, heartbeatIntervalMs, syncIntervalMs } = req.body;
  configManager.setFederation({ ...(iid !== undefined && { instanceId: iid }), ...(federationKey !== undefined && { federationKey }), ...(heartbeatIntervalMs !== undefined && { heartbeatIntervalMs }), ...(syncIntervalMs !== undefined && { syncIntervalMs }) });
  if (federationKey !== undefined) {
    (federationTransport as any).apiKey = federationKey;
  }
  res.json({ success: true, message: "Federation config saved" });
});

// GET /api/config/evolution 兼容路由
app.get("/api/config/evolution", requireAuth, (req, res) => {
  res.json({ success: true, config: configManager.getEvolution() });
});

app.put("/api/config/evolution", requireAuth, requireAdmin, (req, res) => {
  const updates: Record<string, unknown> = {};
  const fields = ["autoExecute", "cycleIntervalMs", "maxActionsPerCycle", "skipApprovalRequired", "successRateThreshold", "latencyThresholdMs", "inactiveDays", "minFederationConfidence"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  configManager.setEvolution(updates as any);
  evolutionEngine.updateConfig(updates as any);
  res.json({ success: true, config: configManager.getEvolution() });
});

// 测试 LLM 连接 (config 路径兼容)
app.post("/api/config/llm/test", requireAuth, requirePermission("config.read"), async (req, res) => {
  if (!currentProvider) {
    res.status(400).json({ success: false, error: "LLM not configured" });
    return;
  }

  try {
    const response = await currentProvider.chat([
      { role: "user", content: "Say hello in one sentence." },
    ]);
    res.json({
      success: true,
      response: response.content,
      model: currentProvider.model,
      usage: response.usage,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// 测试 Model Card 连接 (vision, imageGen, tts, stt, embedding)
app.post("/api/config/model-cards/:type/test", requireAuth, requirePermission("config.read"), async (req, res) => {
  const cardType = req.params.type as any;
  const validTypes = ["vision", "imageGen", "tts", "stt", "embedding"];
  if (!validTypes.includes(cardType)) {
    res.status(400).json({ success: false, error: `Invalid model card type: ${cardType}` });
    return;
  }

  const config = configManager.getResolvedModelConfig(cardType);
  if (!config.apiKey || !config.model) {
    res.status(400).json({ success: false, error: `${cardType} not configured` });
    return;
  }

  try {
    switch (cardType) {
      case "vision": {
        // 根据 apiMode 选择端点格式
        const isVolcengine = config.apiMode === "volcengine" || config.baseUrl?.includes("volces.com");
        const url = isVolcengine
          ? `${config.baseUrl}/chat/completions`
          : `${config.baseUrl || "https://api.openai.com/v1"}/chat/completions`;
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 10,
          }),
        });
        if (!response.ok) {
          const error = await response.text();
          if (response.status === 429 || response.status === 400 || response.status === 404) {
            res.json({
              success: true,
              model: config.model,
              message: response.status === 404
                ? "Vision API endpoint not found (provider may use different path)"
                : "Vision API accessible (quota or content policy may apply)",
            });
            return;
          }
          throw new Error(`API error: ${response.status} ${error}`);
        }
        res.json({
          success: true,
          model: config.model,
          message: "Vision model connection successful",
        });
        break;
      }
      case "imageGen": {
        // 根据 apiMode 选择端点格式
        const isVolcengine = config.apiMode === "volcengine" || config.baseUrl?.includes("volces.com");
        const url = isVolcengine
          ? `${config.baseUrl}/images/generations`
          : `${config.baseUrl || "https://api.openai.com/v1"}/images/generations`;
        
        const body = isVolcengine
          ? JSON.stringify({ model: config.model, prompt: "test" })
          : JSON.stringify({ model: config.model, prompt: "test", n: 1, size: "1024x1024" });
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`,
          },
          body,
        });
        if (!response.ok) {
          const error = await response.text();
          // 429 = quota exceeded, 400 = bad request (endpoint exists), 404 = endpoint not found (different provider format)
          if (response.status === 429 || response.status === 400 || response.status === 404) {
            res.json({
              success: true,
              model: config.model,
              message: response.status === 404 
                ? "Image generation API endpoint not found (provider may use different path)" 
                : "Image generation API accessible (quota or content policy may apply)",
            });
            return;
          }
          throw new Error(`API error: ${response.status} ${error}`);
        }
        res.json({
          success: true,
          model: config.model,
          message: "Image generation connection successful",
        });
        break;
      }
      case "tts": {
        // 根据 apiMode 选择端点格式
        const isVolcengine = config.apiMode === "volcengine" || config.baseUrl?.includes("volces.com");
        const url = isVolcengine
          ? `${config.baseUrl}/audio/speech`
          : `${config.baseUrl || "https://api.openai.com/v1"}/audio/speech`;
        
        const body = isVolcengine
          ? JSON.stringify({ model: config.model, input: "Hello" })
          : JSON.stringify({ model: config.model, input: "Hello", voice: "alloy" });
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`,
          },
          body,
        });
        if (!response.ok) {
          const error = await response.text();
          if (response.status === 429 || response.status === 400 || response.status === 404) {
            res.json({
              success: true,
              model: config.model,
              message: response.status === 404
                ? "TTS API endpoint not found (provider may use different path)"
                : "TTS API accessible (quota may apply)",
            });
            return;
          }
          throw new Error(`API error: ${response.status} ${error}`);
        }
        res.json({
          success: true,
          model: config.model,
          message: "TTS connection successful",
        });
        break;
      }
      case "stt": {
        // 根据 apiMode 选择端点格式
        const isVolcengine = config.apiMode === "volcengine" || config.baseUrl?.includes("volces.com");
        const url = isVolcengine
          ? `${config.baseUrl}/audio/transcriptions`
          : `${config.baseUrl || "https://api.openai.com/v1"}/audio/transcriptions`;
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
          },
          body: new FormData(),
        });
        if (response.status === 400 || response.status === 404) {
          res.json({
            success: true,
            model: config.model,
            message: response.status === 404
              ? "STT API endpoint not found (provider may use different path)"
              : "STT API accessible",
          });
          return;
        }
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API error: ${response.status} ${error}`);
        }
        res.json({
          success: true,
          model: config.model,
          message: "STT connection successful",
        });
        break;
      }
      case "embedding": {
        const isVolcengine = config.embeddingMode === "volcengine-multimodal";
        const url = isVolcengine 
          ? `${config.baseUrl}/embeddings/multimodal` 
          : `${config.baseUrl || "https://api.openai.com/v1"}/embeddings`;
        
        const body = isVolcengine
          ? JSON.stringify({
              model: config.model,
              input: [{ type: "text", text: "Hello world" }],
            })
          : JSON.stringify({
              model: config.model,
              input: "Hello world",
            });
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`,
          },
          body,
        });
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API error: ${response.status} ${error}`);
        }
        const data = await response.json();
        res.json({
          success: true,
          model: config.model,
          dimensions: data.data?.[0]?.embedding?.length,
          message: "Embedding connection successful",
        });
        break;
      }
    }
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ===== Agent Chat API（带权限守卫） =====

// Agent 对话（LLM + Tool Use）
app.post("/api/agent/chat", requireAuth, requirePermission("chat"), async (req, res) => {
  const userId = req.user!.id;
  const { message, mode, conversationId } = req.body as { message: string; mode?: "auto" | "simple" | "react" | "legacy"; conversationId?: string };
  if (!message) {
    res.status(400).json({ success: false, error: "message is required" });
    return;
  }

  // mode=legacy 或未配置 orchestrator 时，使用原有 AgentLoop
  if (mode === "legacy" || mode === "react") {
    const loop = getAgentLoop(userId);
    if (!loop) {
      res.status(400).json({ success: false, error: "LLM not configured" });
      return;
    }
    try {
      const result = await loop.run(message, { conversationId });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // mode=auto|simple|undefined → 使用 Orchestrator
  const orchestrator = getOrchestrator();
  if (!orchestrator) {
    res.status(400).json({ success: false, error: "LLM not configured" });
    return;
  }

  try {
    const roleAgentConfig = await resolveRoleAgentConfig(req);
    const result = await orchestrator.run({ message, userId, roleAgentConfig });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Agent 流式对话（SSE）— 支持 Orchestrator 自动策略，后端实时保存消息
app.post("/api/agent/chat/stream", requireAuth, requirePermission("chat.stream"), async (req, res) => {
  const userId = req.user!.id;
  const { message, mode, conversationId } = req.body as {
    message: string;
    mode?: "auto" | "simple" | "react" | "legacy";
    conversationId?: string;
  };
  if (!message) {
    res.status(400).json({ success: false, error: "message is required" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: {}\n\n`);

  let closed = false;
  res.on("close", () => { closed = true; });

  const write = (eventName: string, data: unknown) => {
    if (closed) return;
    console.log(`[SSE write] ${eventName}`);
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ===== 后端消息持久化 =====
  const convId = conversationId || undefined;

  // Fire-and-forget: 不阻塞 SSE 流式输出
  function saveMsg(role: string, content: string, opts?: { skillName?: string; status?: string; isError?: boolean; extra?: unknown }) {
    if (!convId) return;
    if (isMySQL()) {
      getMySQLAdapter().then(adapter =>
        adapter.execute(
          "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [convId, role, content, opts?.skillName || null, opts?.status || null, opts?.isError ? 1 : 0, opts?.extra ? JSON.stringify(opts.extra) : null]
        )
      ).catch(() => {});
    } else {
      try {
        const insertMsg = getDb().prepare("INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)");
        insertMsg.run(convId, role, content, opts?.skillName || null, opts?.status || null, opts?.isError ? 1 : 0, opts?.extra ? JSON.stringify(opts.extra) : null);
      } catch {}
    }
  }

  // Fire-and-forget: 不阻塞 SSE 流式输出
  function updateConvTitle(title: string) {
    if (!convId) return;
    if (isMySQL()) {
      getMySQLAdapter().then(async adapter => {
        try {
          const rows = await adapter.query<{ c: number }>("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?", [convId]);
          const msgCount = rows[0]?.c ?? 0;
          if (msgCount <= 2) { // 第一条用户消息+一条策略或助手消息
            await adapter.execute("UPDATE conversations SET title = ?, updated_at = UNIX_TIMESTAMP() WHERE id = ?", [title, convId]);
          } else {
            await adapter.execute("UPDATE conversations SET updated_at = UNIX_TIMESTAMP() WHERE id = ?", [convId]);
          }
        } catch {}
      }).catch(() => {});
    } else {
      try {
        const msgCount = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?").get(convId) as any).c;
        if (msgCount <= 2) { // 第一条用户消息+一条策略或助手消息
          getDb().prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, convId);
        } else {
          getDb().prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(convId);
        }
      } catch {}
    }
  }

  // 保存用户消息 (fire-and-forget)
  saveMsg("user", message);
  updateConvTitle(message.slice(0, 50) + (message.length > 50 ? "..." : ""));

  // 解析附件：用视觉模型 OCR 解析文件内容，拼入消息
  let enrichedMessage = message;
  const attachmentMatch = message.match(/^\[附件: (.+?)\]\n?([\s\S]*)$/);
  if (attachmentMatch) {
    const attachmentStr = attachmentMatch[1];
    const userText = attachmentMatch[2] || "";
    // 解析每个附件: "filename (路径: path)"
    const fileEntries = attachmentStr.split(", ").map((entry) => {
      const m = entry.match(/^(.+?)\s*\(路径:\s*(.+?)\)$/);
      return m ? { name: m[1], path: m[2] } : null;
    }).filter(Boolean) as Array<{ name: string; path: string }>;

    if (fileEntries.length > 0) {
      const visionConfig = getVisionConfig();
      const SAFE_BASE = join(process.cwd(), ".raos", "workspace");
      const fileContents: string[] = [];

      for (const file of fileEntries) {
        try {
          const safePath = join(SAFE_BASE, file.path);
          write("tool_start", { skillName: "doc_parse", args: { file: file.name } });
          const result = await parseDocument(safePath, visionConfig);
          if (result.success) {
            let content = result.content;
            if (content.length > 8000) content = content.slice(0, 8000) + "\n...[内容已截断]";
            fileContents.push(`### 文件: ${file.name}\n${content}`);
            write("tool_result", { result: { success: true, data: { message: `${file.name} 解析完成 (${result.format}, ${result.metadata?.method})` } } });
          } else {
            fileContents.push(`### 文件: ${file.name}\n[解析失败: ${result.error}]`);
            write("tool_result", { result: { success: false, error: result.error } });
          }
        } catch (e: any) {
          fileContents.push(`### 文件: ${file.name}\n[读取失败: ${e.message}]`);
          write("tool_result", { result: { success: false, error: e.message } });
        }
      }
      enrichedMessage = `${userText}\n\n---\n## 用户上传的文件内容\n${fileContents.join("\n\n")}`;
    }
  }

  // 用于跟踪流式文本和 chart 数据
  let currentAssistantText = "";
  let pendingToolName = "";
  let kbRefsSent = false;
  let kbRefsForSave: unknown[] = [];
  let webRefsForSave: unknown[] = [];

  try {
    const processEvent = (eventName: string, eventData: any) => {
      write(eventName, eventData);

      // 按事件类型保存消息
      if (eventName === "strategy_selected") {
        const levelMap: Record<string, string> = { simple: "直接回答", react: "逐步推理" };
        const label = levelMap[eventData.level] || eventData.level;
        saveMsg("strategy", `策略: ${label}${eventData.reasoning ? " — " + eventData.reasoning : ""}`);
      } else if (eventName === "text_delta") {
        currentAssistantText += eventData.text ?? "";
      } else if (eventName === "tool_call") {
        // tool_call 前保存已有文本（不附加 kbRefs，留给最终回复）
        if (currentAssistantText) {
          saveMsg("assistant", currentAssistantText);
          currentAssistantText = "";
        }
      } else if (eventName === "tool_start") {
        pendingToolName = eventData.skillName ?? "";
      } else if (eventName === "tool_result") {
        const r = eventData.result;
        let summary = "";
        let extra: Record<string, unknown> | undefined;

        if (r?.success) {
          if (r.data?.__type === "file_download" && r.data?.files) {
            summary = `已准备 ${r.data.files.length} 个文件`;
            extra = { fileDownload: r.data };
          } else if (r.data?.option && r.data?.chartType) {
            summary = `已生成${r.data.chartType}图表`;
            extra = { chartOptions: [r.data.option] };
          } else if (r.data?.charts && Array.isArray(r.data.charts)) {
            summary = `已生成 ${r.data.charts.length} 个图表`;
            extra = { chartOptions: r.data.charts.map((c: any) => c.option).filter(Boolean) };
          } else if (r.data?.message) {
            summary = r.data.message;
          } else if (r.data?.results && Array.isArray(r.data.results)) {
            summary = `获取到 ${r.data.results.length} 条结果`;
          } else {
            summary = "完成";
          }
        } else {
          summary = r?.error?.message || r?.error || "失败";
        }
        saveMsg("tool", summary, {
          skillName: eventData.skillName ?? pendingToolName,
          status: r?.success ? "done" : "error",
          isError: !r?.success,
          extra,
        });
      } else if (eventName === "agent_done" || eventName === "done") {
        // 保存最终 assistant 文本（附加 KB 引用 + Web 引用）
        if (currentAssistantText) {
          const extraObj: Record<string, unknown> = {};
          if (kbRefsForSave.length > 0) extraObj.kbReferences = kbRefsForSave;
          if (webRefsForSave.length > 0) extraObj.webReferences = webRefsForSave;
          const kbExtra = Object.keys(extraObj).length > 0 ? extraObj : undefined;
          saveMsg("assistant", currentAssistantText, { extra: kbExtra });
          currentAssistantText = "";
          kbRefsForSave = [];
          webRefsForSave = [];
        }
        if (eventData.hitMax) {
          saveMsg("system", "已达最大迭代次数");
        }
      } else if (eventName === "error") {
        saveMsg("assistant", eventData.error || "未知错误", { isError: true });
      }
    };

    if (mode === "legacy" || mode === "react") {
      const loop = getAgentLoop(userId);
      if (!loop) { write("error", { error: "LLM not configured" }); res.end(); return; }
      for await (const event of loop.runStream(enrichedMessage, { conversationId: convId })) {
        if (closed) break;
        processEvent(event.event, event.data);
      }
    } else {
      const orchestrator = getOrchestrator();
      if (!orchestrator) { write("error", { error: "LLM not configured" }); res.end(); return; }
      const roleAgentConfig = await resolveRoleAgentConfig(req);
      const runStreamInput: any = { message: enrichedMessage, userId, roleAgentConfig };
      if (convId) runStreamInput.conversationId = convId;
      for await (const event of orchestrator.runStream(runStreamInput)) {
        if (closed) break;
        // 从 tool_result 中收集 web 引用
        if (event.event === "tool_result") {
          const ed = event.data as any;
          orchestrator.collectWebReferences(ed.skillName ?? "", ed.result);
        }
        // 在 done/agent_done 事件保存消息之前，收集并过滤 web 引用和 KB 引用
        if (event.event === "agent_done" || event.event === "done") {
          const allWebRefs = orchestrator.getLastWebReferences(userId, convId);
          if (allWebRefs.length > 0) {
            // 只保留 AI 回复文本中实际引用了的 URL（出现了完整 URL 或域名）
            const text = currentAssistantText || "";
            const filtered = allWebRefs.filter((wr) => {
              if (text.includes(wr.url)) return true;
              try {
                const domain = new URL(wr.url).hostname;
                return text.includes(domain);
              } catch { return false; }
            });
            // 重新编号
            const webRefs = filtered.map((wr, i) => ({ ...wr, index: i + 1 }));
            if (webRefs.length > 0) {
              write("web_references", { references: webRefs });
              webRefsForSave = webRefs;
            }
          }

          // 过滤 KB 引用：只保留 AI 回复中实际引用了的（包含 [^1] 这样的引用标记）
          const allKbRefs = orchestrator.getLastKbReferences(userId, convId);
          if (allKbRefs.length > 0) {
            const text = currentAssistantText || "";
            // 检查是否包含引用标记，如 [^1], [^2] 等
            const hasKbReferences = allKbRefs.some((ref) => {
              const referencePattern = new RegExp(`\\[\\^${ref.index}\\]`);
              return referencePattern.test(text);
            });
            // 只有在实际引用了的情况下才发送
            if (hasKbReferences) {
              write("kb_references", { references: allKbRefs });
              kbRefsForSave = allKbRefs;
            }
          }
        }
        processEvent(event.event, event.data);
      }
    }

    // 流结束后，如果还有未保存的文本
    if (currentAssistantText) {
      const extraObj: Record<string, unknown> = {};
      if (kbRefsForSave.length > 0) extraObj.kbReferences = kbRefsForSave;
      if (webRefsForSave.length > 0) extraObj.webReferences = webRefsForSave;
      const extra = Object.keys(extraObj).length > 0 ? extraObj : undefined;
      saveMsg("assistant", currentAssistantText, { extra });
      currentAssistantText = "";
    }
  } catch (err) {
    write("error", { error: err instanceof Error ? err.message : String(err) });
    saveMsg("assistant", err instanceof Error ? err.message : String(err), { isError: true });
  }

  if (!closed) {
    res.end();
  }
});

// 策略分析 API — 预览 Orchestrator 会选择什么策略（不执行）
app.post("/api/agent/strategy", requireAuth, requirePermission("chat"), async (req, res) => {
  const orchestrator = getOrchestrator();
  if (!orchestrator) {
    res.status(400).json({ success: false, error: "LLM not configured" });
    return;
  }

  const { message } = req.body as { message: string };
  if (!message) {
    res.status(400).json({ success: false, error: "message is required" });
    return;
  }

  try {
    const decision = await orchestrator.analyzeStrategy(message);
    res.json({ success: true, strategy: decision });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 清空对话历史
app.post("/api/agent/clear", requireAuth, (req, res) => {
  const userId = req.user!.id;
  const session = sessionManager.getOrCreate(userId);
  if (session.agentLoop) {
    session.agentLoop.clearHistory();
  }
  // 同时清理 Orchestrator 的用户对话历史
  const orchestrator = getOrchestrator();
  if (orchestrator) {
    orchestrator.clearHistory(userId);
  }
  res.json({ success: true, message: "Conversation history cleared" });
});

// ===== 聊天历史持久化 API =====

// MySQL adapter for conversations
async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('./db/mysql-adapter.js');
  return getAdapter();
}

// 获取当前用户的会话列表
app.get("/api/conversations", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query(
        "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
        [userId]
      );
      res.json({ success: true, conversations: rows });
    } else {
      const rows = getDb().prepare(
        "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
      ).all(userId);
      res.json({ success: true, conversations: rows });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 创建新会话
app.post("/api/conversations", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const id = "conv_" + crypto.randomUUID().slice(0, 12);
  const title = req.body.title || "新对话";
  try {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000)",
        [id, userId, title]
      );
    } else {
      getDb().prepare(
        "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
      ).run(id, userId, title);
    }
    res.json({ success: true, id, title });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取某个会话的消息
app.get("/api/conversations/:id/messages", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const convId = req.params.id as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const beforeId = parseInt(req.query.before_id as string) || 0;

  try {
    let conv;
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT id FROM conversations WHERE id = ? AND user_id = ?", [convId, userId]);
      conv = rows[0];
    } else {
      conv = getDb().prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(convId, userId);
    }
    if (!conv) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }

    let rows: any[];
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      if (beforeId > 0) {
        rows = await adapter.query(
          "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
          [convId, beforeId, limit]
        );
        rows.reverse();
      } else {
        rows = await adapter.query(
          "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
          [convId, limit]
        );
        rows.reverse();
      }
    } else {
      if (beforeId > 0) {
        rows = getDb().prepare(
          "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?"
        ).all(convId, beforeId, limit) as any[];
        rows.reverse();
      } else {
        rows = getDb().prepare(
          "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?"
        ).all(convId, limit) as any[];
        rows.reverse();
      }
    }

    const msgs = rows.map((r) => ({
      ...r,
      extra: r.extra ? (typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra) : undefined,
    }));

    // 检查是否还有更早的消息
    let hasMore = false;
    if (rows.length > 0) {
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const countRows = await adapter.query("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ? AND id < ?", [convId, rows[0].id]);
        hasMore = countRows[0]?.c > 0;
      } else {
        hasMore = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ? AND id < ?").get(convId, rows[0].id) as any).c > 0;
      }
    }

    res.json({ success: true, messages: msgs, hasMore });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 向会话追加消息
app.post("/api/conversations/:id/messages", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const convId = req.params.id as string;
  console.log(`   [CHAT] Save messages to ${convId}: ${JSON.stringify((req.body.messages || []).map((m: any) => ({ role: m.role, len: m.content?.length })))}`);
  
  try {
    let conv;
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT id FROM conversations WHERE id = ? AND user_id = ?", [convId, userId]);
      conv = rows[0];
    } else {
      conv = getDb().prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(convId, userId);
    }
    if (!conv) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }

    const msgs: Array<{ role: string; content: string; skillName?: string; status?: string; isError?: boolean; extra?: unknown }> = req.body.messages || [];
    
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      for (const m of msgs) {
        const extraJson = m.extra ? JSON.stringify(m.extra) : null;
        await adapter.execute(
          "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
          [convId, m.role, m.content, m.skillName || null, m.status || null, m.isError ? 1 : 0, extraJson]
        );
      }
    } else {
      const insert = getDb().prepare(
        "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const insertMany = getDb().transaction((items: typeof msgs) => {
        for (const m of items) {
          const extraJson = m.extra ? JSON.stringify(m.extra) : null;
          insert.run(convId, m.role, m.content, m.skillName || null, m.status || null, m.isError ? 1 : 0, extraJson);
        }
      });
      insertMany(msgs);
    }

    // 更新会话标题（如果是第一条用户消息，自动设置标题）
    const firstUser = msgs.find(m => m.role === "user");
    if (firstUser) {
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const countRows = await adapter.query("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?", [convId]);
        const msgCount = countRows[0]?.c || 0;
        if (msgCount <= msgs.length) {
          const title = firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? "..." : "");
          await adapter.execute("UPDATE conversations SET title = ?, updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?", [title, convId]);
        } else {
          await adapter.execute("UPDATE conversations SET updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?", [convId]);
        }
      } else {
        const msgCount = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?").get(convId) as any).c;
        if (msgCount <= msgs.length) {
          const title = firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? "..." : "");
          getDb().prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, convId);
        } else {
          getDb().prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(convId);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 删除会话
app.delete("/api/conversations/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const convId = req.params.id as string;
  try {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute("DELETE FROM conversations WHERE id = ? AND user_id = ?", [convId, userId]);
    } else {
      getDb().prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(convId, userId);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取 Tool 定义（LLM 视角看到的 Skills）
app.get("/api/llm/tools", requireAuth, requirePermission("skills.read"), (_req, res) => {
  const tools = skillsToTools(registry.list());
  res.json(tools);
});

// ===== Metrics API =====

app.get("/api/metrics", requireAuth, requirePermission("skills.read"), (_req, res) => {
  res.json({
    success: true,
    summary: engine.metrics.getSummary(),
    skills: engine.metrics.getAllMetrics(),
  });
});

app.get("/api/metrics/skill/:name", requireAuth, requirePermission("skills.read"), (req, res) => {
  const name = req.params.name as string;
  const metrics = engine.metrics.getMetrics(name);
  if (!metrics) {
    res.status(404).json({ success: false, error: "No metrics for this skill" });
    return;
  }
  res.json({ success: true, metrics });
});

// ===== Skill Marketplace APIs =====

app.get("/api/marketplace", requireAuth, requirePermission("skills.read"), (req, res) => {
  const query = req.query.q as string | undefined;
  res.json({ success: true, packages: marketplace.search(query), stats: marketplace.stats() });
});

// POST /api/marketplace/search - 兼容前端调用
app.post("/api/marketplace/search", requireAuth, requirePermission("skills.read"), (req, res) => {
  const { query, filters } = req.body;
  // search 方法现在只接受一个参数，忽略 filters（如需支持 filters，需要修改 SkillMarketplace）
  const results = marketplace.search(query);
  res.json({ success: true, packages: results, stats: marketplace.stats() });
});

app.post("/api/marketplace/export/:name", requireAuth, requireAdmin, (req, res) => {
  const pkg = marketplace.exportSkill(req.params.name as string, {
    author: req.body.author,
    source: req.body.source,
  });
  if (!pkg) {
    res.status(404).json({ success: false, error: "Skill not found" });
    return;
  }
  res.json({ success: true, package: pkg });
});

app.post("/api/marketplace/import", requireAuth, requireAdmin, (req, res) => {
  const result = marketplace.importSkill(req.body);
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post("/api/marketplace/publish", requireAuth, requireAdmin, (req, res) => {
  marketplace.publish(req.body);
  res.json({ success: true });
});

// ===== Skill Lifecycle APIs =====

app.get("/api/lifecycle", requireAuth, requireAdmin, (_req, res) => {
  res.json({ success: true, skills: lifecycleManager.getAll() });
});

app.post("/api/lifecycle/canary", requireAuth, requireAdmin, (req, res) => {
  const { name, oldVersion, newVersion, trafficPercent, promoteThreshold, rollbackThreshold, minCalls } = req.body;
  lifecycleManager.startCanary(name, oldVersion, newVersion, {
    trafficPercent, promoteThreshold, rollbackThreshold, minCalls,
  });
  res.json({ success: true, info: lifecycleManager.getInfo(name) });
});

app.post("/api/lifecycle/evaluate/:name", requireAuth, requireAdmin, (req, res) => {
  const name = req.params.name as string;
  const result = lifecycleManager.evaluateCanary(name);
  if (result === "promote") lifecycleManager.promoteCanary(name);
  if (result === "rollback") lifecycleManager.rollbackCanary(name);
  res.json({ success: true, decision: result, info: lifecycleManager.getInfo(name) });
});

app.post("/api/lifecycle/deprecate/:name", requireAuth, requireAdmin, (req, res) => {
  lifecycleManager.deprecate(req.params.name as string);
  res.json({ success: true });
});

app.post("/api/lifecycle/retire-inactive", requireAuth, requireAdmin, (req, res) => {
  const maxInactiveMs = (req.body.maxInactiveDays ?? 30) * 86400000;
  const retired = lifecycleManager.retireInactive(maxInactiveMs);
  res.json({ success: true, retired });
});

// ===== Prompt Management APIs =====

app.get("/api/prompts", requireAuth, requirePermission("config.read"), (_req, res) => {
  res.json({ success: true, templates: promptManager.list() });
});

app.post("/api/prompts", requireAuth, requirePermission("config.write"), (req, res) => {
  try {
    const pt = promptManager.register(req.body.name, req.body.template, {
      description: req.body.description,
      version: req.body.version,
    });
    res.json({ success: true, template: pt });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/prompts/render", requireAuth, requirePermission("config.read"), (req, res) => {
  try {
    const rendered = promptManager.render(req.body.name, req.body.variables || {});
    res.json({ success: true, rendered });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete("/api/prompts/:name", requireAuth, requirePermission("config.write"), (req, res) => {
  promptManager.delete(req.params.name as string);
  res.json({ success: true });
});

// ===== Model Router APIs =====

app.get("/api/models", requireAuth, requirePermission("config.read"), (_req, res) => {
  res.json({
    success: true,
    models: modelRouter.getModels().map((m) => ({
      name: m.name,
      model: m.provider.model,
      capabilities: m.capabilities,
      costPer1kTokens: m.costPer1kTokens,
      contextWindow: m.contextWindow,
    })),
  });
});

// ===== Memory APIs（按用户隔离，带权限守卫） =====

app.get("/api/memory/stm", requireAuth, requirePermission("memory.read"), (req, res) => {
  const { stm } = sessionManager.getOrCreate(req.user!.id);
  res.json({ entries: stm.list(), size: stm.size });
});

app.get("/api/memory/ltm", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  const stats = await ltm.stats();
  res.json({ entries: await ltm.list(), ...stats });
});

app.get("/api/memory/archives", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  res.json({ archives: await ltm.getArchiveManifests() });
});

app.get("/api/memory/stats", requireAuth, requirePermission("memory.read"), async (req, res) => {
  try {
    const result = await engine.execute("memory_stats", {});

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(500).json({ success: false, error: result.error?.message || "Failed to get stats" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 定时归档调度管理
app.get("/api/memory/schedule", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  const stats = await ltm.stats();
  res.json({
    running: stats.scheduledArchive.running,
    lastRunAt: stats.scheduledArchive.lastRunAt || null,
  });
});

app.post("/api/memory/schedule", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  const { action, intervalMinutes } = req.body as {
    action: "start" | "stop";
    intervalMinutes?: number;
  };

  if (action === "start") {
    const minutes = intervalMinutes ?? 60;
    if (minutes < 1) {
      res.status(400).json({ success: false, error: "intervalMinutes must be >= 1" });
      return;
    }
    ltm.startScheduledArchive(minutes * 60 * 1000);
    res.json({ success: true, action: "started", intervalMinutes: minutes });
  } else if (action === "stop") {
    ltm.stopScheduledArchive();
    res.json({ success: true, action: "stopped" });
  } else {
    res.status(400).json({ success: false, error: "action must be 'start' or 'stop'" });
  }
});

// 兼容路由: /api/memory/schedule/start
app.post("/api/memory/schedule/start", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  const minutes = req.body?.intervalMinutes ?? 60;
  if (minutes < 1) {
    res.status(400).json({ success: false, error: "intervalMinutes must be >= 1" });
    return;
  }
  ltm.startScheduledArchive(minutes * 60 * 1000);
  res.json({ success: true, action: "started", intervalMinutes: minutes });
});

// 兼容路由: /api/memory/schedule/stop
app.post("/api/memory/schedule/stop", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  ltm.stopScheduledArchive();
  res.json({ success: true, action: "stopped" });
});

// 手动触发一次归档
app.post("/api/memory/archive", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  const reason = (req.body?.reason as string) || "manual_ui";
  const result = await ltm.archive(reason);
  res.json({
    success: true,
    archived: result.archived,
    manifest: result.manifest,
    activeRemaining: ltm.size,
  });
});

// 从归档恢复
app.post("/api/memory/restore", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { ltm } = sessionManager.getOrCreate(req.user!.id);
  const { archiveId, keys } = req.body as { archiveId: string; keys?: string[] };
  if (!archiveId) {
    res.status(400).json({ success: false, error: "archiveId is required" });
    return;
  }
  const restored = await ltm.restoreFromArchive(archiveId, keys);
  res.json({ success: true, restored, activeTotal: ltm.size });
});

// ===== Enhanced LTM APIs（新增功能）=====

// 获取用户记忆画像（当前用户）
app.get("/api/memory/profile", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const targetUserId = req.user!.id;

  try {
    const result = await engine.execute("ltm_profile", { userId: targetUserId });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Profile generation failed" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 获取指定用户记忆画像（管理员）
app.get("/api/memory/profile/:userId", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const targetUserId = req.params.userId;

  try {
    const result = await engine.execute("ltm_profile", { userId: targetUserId });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Profile generation failed" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 获取版本历史
app.get("/api/memory/versions/:key", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { key } = req.params;
  const { includeForgotten } = req.query as { includeForgotten?: string };

  try {
    const result = await engine.execute("ltm_version_history", {
      key,
      includeForgotten: includeForgotten === "true",
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Version history not available" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 查询遗忘日志
app.get("/api/memory/forgotten", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { since, limit, reason } = req.query as { since?: string; limit?: string; reason?: string };

  try {
    const result = await engine.execute("ltm_forgotten_log", {
      since: since ? parseInt(since, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      reason,
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Forgotten log not available" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 检测矛盾
app.post("/api/memory/check-conflicts", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { key, value, topN } = req.body as { key: string; value: unknown; topN?: number };

  if (!key) {
    res.status(400).json({ success: false, error: "key is required" });
    return;
  }
  if (value === undefined) {
    res.status(400).json({ success: false, error: "value is required" });
    return;
  }

  try {
    const result = await engine.execute("ltm_check_conflicts", {
      key,
      value,
      topN,
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Conflict detection failed" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 提取事实
app.post("/api/memory/extract-facts", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { text, entityContext, tags } = req.body as { text: string; entityContext?: string; tags?: string[] };

  if (!text) {
    res.status(400).json({ success: false, error: "text is required" });
    return;
  }

  try {
    const result = await engine.execute("ltm_extract_facts", {
      text,
      entityContext,
      tags,
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Fact extraction requires LLM provider" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 存储记忆
app.post("/api/memory/store", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { key, value, tags, summary, relation, expiresInSec } = req.body as {
    key: string;
    value: unknown;
    tags?: string[];
    summary?: string;
    relation?: string;
    expiresInSec?: number;
  };

  if (!key) {
    res.status(400).json({ success: false, error: "key is required" });
    return;
  }

  try {
    const result = await engine.execute("ltm_store", {
      key,
      value,
      tags,
      summary,
      relation,
      expiresInSec,
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Store operation failed" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 搜索记忆
app.get("/api/memory/search", requireAuth, requirePermission("memory.read"), async (req, res) => {
  const { query, limit, tags, rerank, filters, includeForgotten } = req.query as {
    query?: string;
    limit?: string;
    tags?: string;
    rerank?: string;
    filters?: string;
    includeForgotten?: string;
  };

  if (!query) {
    res.status(400).json({ success: false, error: "query is required" });
    return;
  }

  try {
    const parsedTags = tags ? tags.split(",") : undefined;
    let parsedFilters: any;
    if (filters) {
      try {
        parsedFilters = JSON.parse(filters);
      } catch {
        res.status(400).json({ success: false, error: "Invalid filters JSON" });
        return;
      }
    }

    const result = await engine.execute("ltm_search", {
      query,
      limit: limit ? parseInt(limit, 10) : undefined,
      tags: parsedTags,
      rerank: rerank === "true",
      filters: parsedFilters,
      includeForgotten: includeForgotten === "true",
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Search operation failed" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// 删除记忆
app.delete("/api/memory/:id", requireAuth, requirePermission("memory.write"), async (req, res) => {
  const { id } = req.params;
  const { reason, hard } = req.body as { reason?: string; hard?: boolean };

  if (!id) {
    res.status(400).json({ success: false, error: "id is required" });
    return;
  }

  try {
    const result = await engine.execute("ltm_delete", {
      id,
      reason,
      hard,
    });

    if (result.success) {
      res.json({ success: true, ...(result.data as any) });
    } else {
      res.status(400).json({ success: false, error: result.error?.message || "Delete operation failed" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ===== Knowledge Base APIs =====

app.get("/api/knowledge/documents", requireAuth, async (req, res) => {
  try {
    const result = await engine.execute("kb_list", {
      query: req.query.q || undefined,
      tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      owner: req.user!.id,
    });
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/knowledge/ingest", requireAuth, async (req, res) => {
  try {
    const { name, content, path, tags } = req.body;
    if (!name || (!content && !path)) {
      res.status(400).json({ success: false, error: "name and (content or path) are required" });
      return;
    }

    const userId = req.user!.id;

    // 如果是文件路径（需要解析），先建占位记录立即返回，后台异步解析
    if (path && !content) {
      const kb = getKnowledgeBase(userId);
      const docId = await kb.createPlaceholder(name, { source: path, tags: tags || [] });
      console.log(`[Server] 创建占位符 docId: ${docId}`);
      // 立即返回
      res.json({ success: true, docId, chunkCount: 0, totalTokens: 0, parsing: true, message: `文档 "${name}" 已创建，正在后台解析...` });

      // 后台异步：解析 → 入库 → 向量化
      requestContext.run({ userId }, () => {
        console.log(`[Server] 调用 kb_ingest 传入 _placeholderDocId: ${docId}`);
        engine.execute("kb_ingest", {
          name,
          path,
          tags: tags || [],
          owner: userId,
          skipEmbedding: true,
          _placeholderDocId: docId,
        }).then((result) => {
          if (result.success) {
            const docId = (result.data as any).docId;
            if (docId) {
              engine.execute("kb_vectorize", { docId, owner: userId }).catch(() => {});
            }
          }
        }).catch(() => {});
      });
      return;
    }

    // content 模式（已有内容，如从聊天附件加入知识库），直接入库
    const params: Record<string, unknown> = {
      name,
      content,
      tags: tags || [],
      owner: userId,
      skipEmbedding: true,
    };
    const result = await engine.execute("kb_ingest", params);
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });

    // 异步向量化
    if (result.success && result.data) {
      const docId = (result.data as any).docId;
      if (docId) {
        requestContext.run({ userId }, () => {
          engine.execute("kb_vectorize", { docId, owner: userId }).catch(() => {});
        });
      }
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/knowledge/search", requireAuth, async (req, res) => {
  try {
    const result = await engine.execute("kb_search", {
      query: String(req.query.q || ""),
      tags: req.query.tags ? String(req.query.tags).split(",") : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 10,
      owner: req.user!.id,
    });
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 获取文档解析内容
app.get("/api/knowledge/documents/:docId/content", requireAuth, async (req, res) => {
  try {
    const kb = getKnowledgeBase(req.user!.id);
    const content = await kb.getDocumentContent(req.params.docId as string);
    if (content === null) {
      res.status(404).json({ success: false, error: "文档不存在" });
    } else {
      res.json({ success: true, content });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 获取知识库文档页面图片
app.get("/api/knowledge/documents/:docId/pages", requireAuth, (req, res) => {
  const owner = req.user!.id;
  const docId = String(req.params.docId);
  const page = req.query.page ? String(req.query.page) : undefined;

  if (page) {
    const imgPath = getKBPageImagePath(owner, docId, Number(page));
    if (!imgPath) {
      res.status(404).json({ success: false, error: "page not found" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(imgPath).pipe(res);
    return;
  }

  const pages = getKBPageImageList(owner, docId);
  res.json({ success: true, pages });
});

app.delete("/api/knowledge/documents/:docId", requireAuth, async (req, res) => {
  try {
    const result = await engine.execute("kb_delete", { docId: req.params.docId, owner: req.user!.id });
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/knowledge/stats", requireAuth, async (req, res) => {
  try {
    const result = await engine.execute("kb_stats", { owner: req.user!.id });
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/knowledge/rebuild", requireAuth, async (req, res) => {
  try {
    const result = await engine.execute("kb_rebuild", { owner: req.user!.id });
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/knowledge/share", requireAuth, async (req, res) => {
  try {
    const { docId, shared } = req.body;
    const result = await engine.execute("kb_share", { docId, shared: !!shared, owner: req.user!.id });
    res.json({ success: result.success, ...(result.success ? result.data as object : { error: (result as any).error?.message }) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== User Session APIs =====

app.get("/api/user/sessions", requireAuth, (_req, res) => {
  res.json({ sessions: sessionManager.listSessions() });
});

// ===== Async Task APIs（带权限守卫） =====

app.get("/api/tasks", requireAuth, requirePermission("tasks.read"), (_req, res) => {
  const status = _req.query.status as string | undefined;
  const tasks = status
    ? taskManager.list({ status: status as import("./types/index.js").TaskStatus })
    : taskManager.list();
  res.json({ tasks, total: tasks.length });
});

app.get("/api/tasks/:taskId", requireAuth, requirePermission("tasks.read"), (req, res) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.get(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

app.post("/api/tasks/:taskId/cancel", requireAuth, requirePermission("tasks.read"), (req, res) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.cancel(taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ success: true, task });
});

app.post("/api/tasks/:taskId/wait", requireAuth, requirePermission("tasks.read"), async (req, res) => {
  const taskId = req.params.taskId as string;
  const timeoutMs = Number(req.body?.timeoutMs ?? 30000);
  try {
    const task = await taskManager.waitFor(taskId, timeoutMs);
    res.json({ success: true, task });
  } catch (err) {
    res.status(408).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ===== Plugin APIs（带权限守卫） =====

app.get("/api/plugins", requireAuth, requirePermission("plugins.manage"), (_req, res) => {
  res.json({ plugins: pluginLoader.getLoaded() });
});

app.post("/api/plugins/reload", requireAuth, requirePermission("plugins.manage"), async (req, res) => {
  const { name } = req.body as { name?: string };
  if (name) {
    try {
      const plugin = await pluginLoader.reloadPlugin(name);
      if (plugin) {
        // 同步新 Skill
        syncSkillsToResources();
        res.json({ success: true, plugin });
      } else {
        res.status(404).json({ success: false, error: `Plugin "${name}" not found` });
      }
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  } else {
    const result = await pluginLoader.loadAll();
    syncSkillsToResources();
    res.json({ success: true, ...result });
  }
});

// ===== WAL 恢复 API =====

app.get("/api/wal/status", requireAuth, (req, res) => {
  const incomplete = wal.getIncomplete();
  const lastRecovery = wal.getLastRecoveryResult();
  res.json({
    incompleteCount: incomplete.length,
    incomplete: incomplete.map((e) => ({
      id: e.id,
      skillName: e.skillName,
      timestamp: e.timestamp,
      traceId: e.traceId,
    })),
    lastRecovery,
  });
});

app.post("/api/wal/replay", requireAuth, async (req, res) => {
  try {
    const result = await wal.replay(engine);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/wal/compact", requireAuth, (req, res) => {
  try {
    wal.compact();
    res.json({ success: true, message: "WAL compacted" });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ===== 联邦 API 端点 =====

// 联邦状态概览
app.get("/api/federation/status", requireAuth, (_req, res) => {
  res.json({
    instanceId,
    evolution: evolutionEngine.getStatus(),
    federation: {
      peers: federationManager.getRemoteSnapshots().size,
      recommendations: federationManager.getRecommendations().length,
    },
    migration: {
      historyCount: migrationManager.getHistory().length,
    },
  });
});

// 获取联邦节点列表
app.get("/api/federation/peers", requireAuth, (_req, res) => {
  const peers = configManager.getFederation().peers || [];
  res.json({ success: true, peers });
});

// 添加联邦节点
app.post("/api/federation/peers", requireAuth, requireAdmin, (req, res) => {
  const { endpoint, name } = req.body;
  if (!endpoint) {
    res.status(400).json({ success: false, error: "endpoint is required" });
    return;
  }
  configManager.addFederationPeer({ endpoint, name });
  federationTransport.addPeer({
    instanceId: endpoint,
    endpoint,
    version: "2.0",
    capabilities: [],
    skillCount: 0,
    lastHeartbeat: Date.now(),
  });
  res.json({ success: true, message: `Peer ${endpoint} added` });
});

// 删除联邦节点
app.delete("/api/federation/peers/:id", requireAuth, requireAdmin, (req, res) => {
  const peerId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  configManager.removeFederationPeer(peerId);
  federationTransport.removePeer(peerId);
  res.json({ success: true, message: `Peer ${peerId} removed` });
});

// 获取联邦推荐
app.get("/api/federation/recommendations", requireAuth, (req, res) => {
  const recommendations = federationManager.getRecommendations();
  res.json({ success: true, recommendations });
});

// 联邦请求入口：远程实例通过此端点发送迁移/心跳/指标请求
// 注意：这个通用路由必须放在所有具体的 /api/federation/* 路由之后
app.post("/api/federation/:action", express.json(), async (req, res) => {
  try {
    const action = req.params.action;
    const from = (req.headers["x-raos-instance"] as string) ?? "unknown";
    const result = await federationTransport.handleRequest(action, req.body, from);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ===== Graph API =====

function getGraphManagerForUser(userId: string) {
  const session = sessionManager.getOrCreate(userId);
  return session.graphManager;
}

// GET /api/graph/data — full graph for visualization
app.get("/api/graph/data", requireAuth, requirePermission("memory.read"), async (req, res) => {
  try {
    const userId = (req as any).user?.id ?? "default";
    const gm = getGraphManagerForUser(userId);
    if (!gm) { res.json({ nodes: [], edges: [] }); return; }
    const store = await gm.getStore();
    const [nodes, edges] = await Promise.all([
      store.getAllNodes(),
      store.getAllEdges(),
    ]);
    res.json({ nodes, edges });
  } catch (err) {
    console.error("[Graph API] /api/graph/data error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/graph/stats
app.get("/api/graph/stats", requireAuth, requirePermission("memory.read"), async (req, res) => {
  try {
    const userId = (req as any).user?.id ?? "default";
    const gm = getGraphManagerForUser(userId);
    if (!gm) { res.json({ nodeCount: 0, edgeCount: 0 }); return; }
    const stats = await gm.getStats();
    res.json(stats);
  } catch (err) {
    console.error("[Graph API] /api/graph/stats error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/graph/query
app.post("/api/graph/query", requireAuth, requirePermission("memory.read"), async (req, res) => {
  try {
    const userId = (req as any).user?.id ?? "default";
    const gm = getGraphManagerForUser(userId);
    if (!gm) { res.json({ nodes: [], edges: [], seedNodes: [] }); return; }
    const { query, maxDepth, maxNodes } = req.body;
    const result = await gm.querySubgraph(query ?? "", { maxDepth, maxNodes });
    res.json(result);
  } catch (err) {
    console.error("[Graph API] /api/graph/query error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/graph/sync — sync from LTM
app.post("/api/graph/sync", requireAuth, requirePermission("memory.write"), async (req, res) => {
  try {
    const userId = (req as any).user?.id ?? "default";
    const session = sessionManager.getOrCreate(userId);
    const gm = session.graphManager;
    if (!gm) { res.status(400).json({ error: "Graph not available" }); return; }
    const entries = await session.ltm.list();
    const result = await gm.syncFromLTM(entries.map((e: any) => ({
      id: e.id, key: e.key, value: e.value, tags: e.tags ?? [],
    })));
    res.json(result);
  } catch (err) {
    console.error("[Graph API] /api/graph/sync error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/graph/communities
app.post("/api/graph/communities", requireAuth, requirePermission("memory.read"), async (req, res) => {
  try {
    const userId = (req as any).user?.id ?? "default";
    const gm = getGraphManagerForUser(userId);
    if (!gm) { res.json({ communities: [], stats: { count: 0, avgSize: 0 } }); return; }
    const result = await gm.getCommunities();
    const commList = [...result.communities.entries()].map(([id, nodes]: [number, string[]]) => ({
      id, size: nodes.length, nodes: nodes.slice(0, 20),
    }));
    res.json({ communities: commList, stats: result.stats });
  } catch (err) {
    console.error("[Graph API] /api/graph/communities error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ===== 文件上传 API（委托给 file_upload Skill） =====

/** 文件解析状态缓存：path → { status, content, error, tags } */
const fileParseCache = new Map<string, { status: "parsing" | "done" | "error"; content?: string; error?: string; format?: string; tags?: string[]; pageCount?: number }>();

/** 根据上传文件路径生成图片存储目录（存在上传人的 workspace 中） */
function getImageDir(relativePath: string): string {
  // relativePath 格式如 "uploads/u_xxx/filename.pptx"，图片存在同级 .parse-images/ 下
  const wsBase = join(process.cwd(), ".raos", "workspace");
  const parentDir = dirname(join(wsBase, relativePath));
  const baseName = relativePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "file";
  const safe = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, "_");
  return join(parentDir, ".parse-images", safe);
}

/** 将页面图片持久化到磁盘 */
function savePageImages(relativePath: string, pages: Array<{ page: number; imageBase64: string }>): void {
  if (pages.length === 0) return;
  const dir = getImageDir(relativePath);
  mkdirSync(dir, { recursive: true });
  for (const p of pages) {
    const buf = Buffer.from(p.imageBase64, "base64");
    writeFileSync(join(dir, `page-${p.page}.png`), buf);
  }
  // 写入页面列表索引
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages.map((p) => p.page)));
}

/** 读取已保存的页面图片列表 */
function getPageImageList(relativePath: string): number[] {
  const indexFile = join(getImageDir(relativePath), "pages.json");
  if (!existsSync(indexFile)) return [];
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8"));
  } catch { return []; }
}

/** 上传后异步解析文件（fire-and-forget） */
function asyncParseFile(filePath: string, relativePath: string): void {
  fileParseCache.set(relativePath, { status: "parsing" });
  const visionConfig = getVisionConfig();
  const absPath = join(process.cwd(), ".raos", "workspace", relativePath);
  parseDocument(absPath, visionConfig).then((result) => {
    if (result.success) {
      let content = result.content;
      if (content.length > 10000) content = content.slice(0, 10000) + "\n...[内容已截断]";
      // 持久化页面图片到磁盘
      const pageImages = result.pages?.filter((p) => p.imageBase64).map((p) => ({ page: p.page, imageBase64: p.imageBase64! })) || [];
      if (pageImages.length > 0) savePageImages(relativePath, pageImages);
      fileParseCache.set(relativePath, { status: "done", content, format: result.format, tags: result.tags || [], pageCount: pageImages.length });
    } else {
      fileParseCache.set(relativePath, { status: "error", error: result.error });
    }
    // 10 分钟后清理内存缓存（图片已在磁盘，不受影响）
    setTimeout(() => fileParseCache.delete(relativePath), 10 * 60 * 1000);
  }).catch((err) => {
    fileParseCache.set(relativePath, { status: "error", error: err.message });
  });
}

/** 解析 multipart/form-data（不依赖 multer） */
function parseMultipart(buf: Buffer, boundary: string): Array<{ filename: string; data: Buffer }> {
  const files: Array<{ filename: string; data: Buffer }> = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = 0;

  while (true) {
    const idx = buf.indexOf(boundaryBuf, start);
    if (idx < 0) break;
    const nextIdx = buf.indexOf(boundaryBuf, idx + boundaryBuf.length);
    if (nextIdx < 0) break;

    const part = buf.subarray(idx + boundaryBuf.length, nextIdx);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) { start = nextIdx; continue; }

    const headers = part.subarray(0, headerEnd).toString();
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (!filenameMatch) { start = nextIdx; continue; }

    const data = part.subarray(headerEnd + 4, part.length - 2); // strip trailing \r\n
    files.push({ filename: filenameMatch[1], data });
    start = nextIdx;
  }

  return files;
}

// 上传文件 — 前端 multipart 入口，内部调用 file_upload Skill
app.post("/api/upload", requireAuth, express.raw({ type: "multipart/form-data", limit: "50mb" }), async (req: any, res) => {
  try {
    const contentType = req.headers["content-type"] as string;
    const boundaryMatch = contentType?.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.status(400).json({ success: false, error: "缺少 multipart boundary" });
      return;
    }

    const files = parseMultipart(req.body as Buffer, boundaryMatch[1]);
    if (files.length === 0) {
      res.status(400).json({ success: false, error: "未发现文件" });
      return;
    }

    const mode = (req.query.mode as string) || "auto"; // "auto" | "overwrite" | "new_version"
    const folder = (req.query.folder as string) || ""; // 目标文件夹（相对 workspace）
    const results = [];
    for (const file of files) {
      const skillParams: Record<string, any> = {
        filename: file.filename,
        content: file.data.toString("base64"),
        uploadedBy: req.user?.id ?? "default",
        mode,
      };
      if (folder) skillParams.targetDir = folder;
      const result = await engine.execute("file_upload", skillParams);
      if (result.success) {
        const fileData = result.data as any;
        results.push(fileData);
        // 内容重复或名称冲突时不需要再解析
        if (fileData.path && !fileData.duplicate) {
          asyncParseFile(fileData.path, fileData.path);
        }
      }
    }

    res.json({
      success: true,
      data: {
        files: results,
        message: `已上传 ${results.length} 个文件`,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// 查询文件解析状态
app.get("/api/upload/parse-status", requireAuth, (req, res) => {
  const path = req.query.path as string;
  if (!path) {
    res.status(400).json({ success: false, error: "path required" });
    return;
  }
  const status = fileParseCache.get(path);
  if (!status) {
    res.json({ success: true, status: "unknown" });
  } else {
    // 从磁盘检查页面图片数量
    const diskPages = getPageImageList(path);
    const pageCount = status.pageCount || diskPages.length;
    res.json({ success: true, ...status, hasPageImages: pageCount > 0, pageCount });
  }
});

// 获取解析文件的页面图片
app.get("/api/upload/parse-images", requireAuth, (req, res) => {
  const path = req.query.path as string;
  const page = req.query.page as string;
  if (!path) {
    res.status(400).json({ success: false, error: "path required" });
    return;
  }

  const imgDir = getImageDir(path);

  if (page) {
    // 返回单页图片
    const imgPath = join(imgDir, `page-${page}.png`);
    if (!existsSync(imgPath)) {
      res.status(404).json({ success: false, error: "page not found" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(imgPath).pipe(res);
    return;
  }

  // 返回页码列表
  const pages = getPageImageList(path);
  res.json({ success: true, pages });
});

// 列出已上传文件 — 调用 file_upload_list Skill
app.get("/api/upload", requireAuth, async (_req, res) => {
  try {
    const result = await engine.execute("file_upload_list", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// 删除已上传文件 — 调用 file_upload_delete Skill
app.delete("/api/upload/:filename", requireAuth, async (req, res) => {
  try {
    const result = await engine.execute("file_upload_delete", { path: `uploads/${req.params.filename}` });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ===== 文件管理 API =====

const WS_BASE = join(process.cwd(), ".raos", "workspace");

// 获取文件树
app.get("/api/files/tree", requireAuth, (req, res) => {

  interface TreeNode {
    key: string;
    title: string;
    isLeaf: boolean;
    children?: TreeNode[];
    size?: number;
    modifiedAt?: number;
    ext?: string;
  }

  const userId = req.user!.id;
  const userBase = join(WS_BASE, "uploads", userId);
  if (!existsSync(userBase)) {
    res.json({ success: true, tree: [] });
    return;
  }

  // 排除中间/临时文件和目录
  const EXCLUDED_DIRS = new Set(["excel_content", "node_modules", "__MACOSX", "Excel解包文件"]);
  const EXCLUDED_EXTS = new Set([".db", ".db-shm", ".db-wal", ".tmp", ".lock"]);

  function buildTree(dir: string, prefix: string): TreeNode[] {
    const entries: TreeNode[] = [];
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (item.startsWith(".")) continue; // 隐藏文件
        if (EXCLUDED_DIRS.has(item) || item.includes("解包")) continue; // 排除临时目录
        const fullPath = join(dir, item);
        const relativePath = prefix ? `${prefix}/${item}` : item;
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            entries.push({
              key: relativePath,
              title: item,
              isLeaf: false,
              children: buildTree(fullPath, relativePath),
            });
          } else {
            const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
            if (EXCLUDED_EXTS.has(ext)) continue; // 排除临时文件
            entries.push({
              key: relativePath,
              title: item,
              isLeaf: true,
              size: stat.size,
              modifiedAt: stat.mtimeMs,
              ext,
            });
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* dir not readable */ }

    // 同名文件去重（去时间戳后相同的只保留最新）
    const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
    const deduped = new Map<string, TreeNode>();
    for (const e of entries) {
      const key = e.isLeaf ? stripTs(e.title) : e.title;
      const existing = deduped.get(key);
      if (!existing || (e.isLeaf && e.modifiedAt && existing.modifiedAt && e.modifiedAt > existing.modifiedAt)) {
        deduped.set(key, e);
      }
    }
    const result = Array.from(deduped.values());

    // 文件夹排前面，再按名称排序
    result.sort((a, b) => {
      if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
    return result;
  }

  res.json({ success: true, tree: buildTree(userBase, "") });
});

// 列出指定目录下的文件
app.get("/api/files/list", requireAuth, (req, res) => {
  const userId = req.user!.id;
  const userBase = join(WS_BASE, "uploads", userId);
  const dirPath = (req.query.path as string) || "";
  const absDir = join(userBase, dirPath);
  if (!absDir.startsWith(userBase)) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  if (!existsSync(absDir)) {
    res.json({ success: true, files: [] });
    return;
  }

  try {
    const EXCL_DIRS = new Set(["excel_content", "node_modules", "__MACOSX", "Excel解包文件"]);
    const EXCL_EXTS = new Set([".db", ".db-shm", ".db-wal", ".tmp", ".lock"]);
    const items = readdirSync(absDir);
    const files = items
      .filter((i) => !i.startsWith("."))
      .map((item) => {
        const fullPath = join(absDir, item);
        const stat = statSync(fullPath);
        const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
        return {
          name: item,
          path: dirPath ? `${dirPath}/${item}` : item,
          isDir: stat.isDirectory(),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          ext,
        };
      })
      .filter((f) => f.isDir ? (!EXCL_DIRS.has(f.name) && !f.name.includes("解包")) : !EXCL_EXTS.has(f.ext));

    // 同名文件去重（去掉时间戳后相同的只保留最新）
    const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
    const deduped = new Map<string, typeof files[0]>();
    for (const f of files) {
      const key = f.isDir ? f.name : stripTs(f.name);
      const existing = deduped.get(key);
      if (!existing || (f.modifiedAt > existing.modifiedAt)) {
        deduped.set(key, f);
      }
    }
    const result = Array.from(deduped.values());

    // 文件夹排前面
    result.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ success: true, files: result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 检查哪些文件已导入知识库（返回详细的向量化状态）
app.get("/api/files/kb-status", requireAuth, async (req, res) => {
  const userId = req.user?.id || "default";
  try {
    const kb = getKnowledgeBase(userId);
    const docs = await kb.listDocuments();
    // 返回文档名称 → 向量化状态映射
    const kbNames = docs.map((d: any) => d.name);
    const kbDocs: Record<string, { docId: string; vectorized: number; vectorTotal: number; chunkCount: number; status: string }> = {};
    for (const d of docs) {
      let status = "done";
      if (d.chunkCount === 0) status = "parsing";
      else if (d.vectorized < d.vectorTotal) status = "vectorizing";
      kbDocs[d.name] = { docId: d.docId, vectorized: d.vectorized, vectorTotal: d.vectorTotal, chunkCount: d.chunkCount, status };
    }
    res.json({ success: true, kbNames, kbDocs });
  } catch {
    res.json({ success: true, kbNames: [], kbDocs: {} });
  }
});

// 获取用户文档列表（聚合上传文件 + KB状态，去重去时间戳）
app.get("/api/files/user-documents", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const userUploadDir = join(WS_BASE, "uploads", userId);

  // 1. 扫描用户上传目录
  interface UserDoc {
    originalName: string;
    path: string;
    size: number;
    modifiedAt: number;
    ext: string;
    kbStatus: { inKb: boolean; docId?: string; vectorized?: number; vectorTotal?: number; status?: string } | null;
  }

  const fileMap = new Map<string, UserDoc>(); // originalName → latest file

  // 从文件名还原原始名：去掉 _<timestamp> 后缀
  const stripTimestamp = (name: string): string => {
    return name.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
  };

  if (existsSync(userUploadDir)) {
    try {
      const items = readdirSync(userUploadDir);
      for (const item of items) {
        if (item.startsWith(".")) continue; // 跳过隐藏文件/目录
        const fullPath = join(userUploadDir, item);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) continue; // 跳过子目录
          const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
          const originalName = stripTimestamp(item);
          const existing = fileMap.get(originalName);
          // 保留最新版本
          if (!existing || stat.mtimeMs > existing.modifiedAt) {
            fileMap.set(originalName, {
              originalName,
              path: `uploads/${userId}/${item}`,
              size: stat.size,
              modifiedAt: stat.mtimeMs,
              ext,
              kbStatus: null,
            });
          }
        } catch { /* skip */ }
      }
    } catch { /* dir not readable */ }
  }

  // 2. 获取 KB 文档状态
  try {
    const kb = getKnowledgeBase(userId);
    const docs = await kb.listDocuments();
    for (const d of docs) {
      let status = "done";
      if (d.chunkCount === 0) status = "parsing";
      else if (d.vectorized < d.vectorTotal) status = "vectorizing";
      const kbInfo = { inKb: true, docId: d.docId, vectorized: d.vectorized, vectorTotal: d.vectorTotal, status };

      const existing = fileMap.get(d.name);
      if (existing) {
        existing.kbStatus = kbInfo;
      }
      // KB 中有但上传目录没有的（如直接 content 导入的），也显示
      if (!existing) {
        fileMap.set(d.name, {
          originalName: d.name,
          path: d.source || "",
          size: 0,
          modifiedAt: d.ingestedAt || 0,
          ext: d.name.includes(".") ? d.name.slice(d.name.lastIndexOf(".")).toLowerCase() : "",
          kbStatus: kbInfo,
        });
      }
    }
  } catch { /* no KB */ }

  // 3. 排序：最近修改的在前
  const documents = Array.from(fileMap.values()).sort((a, b) => b.modifiedAt - a.modifiedAt);
  res.json({ success: true, documents });
});

// 创建文件夹
app.post("/api/files/mkdir", requireAuth, (req, res) => {
  const { path: dirPath } = req.body as { path: string };
  if (!dirPath) {
    res.status(400).json({ success: false, error: "path required" });
    return;
  }
  const absPath = join(WS_BASE, dirPath);
  if (!absPath.startsWith(WS_BASE)) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  try {
    mkdirSync(absPath, { recursive: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 移动/重命名文件
app.post("/api/files/move", requireAuth, (req, res) => {
  const { from, to } = req.body as { from: string; to: string };
  if (!from || !to) {
    res.status(400).json({ success: false, error: "from and to required" });
    return;
  }
  const absFrom = join(WS_BASE, from);
  const absTo = join(WS_BASE, to);
  if (!absFrom.startsWith(WS_BASE) || !absTo.startsWith(WS_BASE)) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  try {
    mkdirSync(dirname(absTo), { recursive: true });
    renameSync(absFrom, absTo);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除文件/文件夹
app.delete("/api/files", requireAuth, (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ success: false, error: "path required" });
    return;
  }
  const absPath = join(WS_BASE, filePath);
  if (!absPath.startsWith(WS_BASE) || absPath === WS_BASE) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  try {
    rmSync(absPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// AI 自动整理文件
app.post("/api/files/organize", requireAuth, async (req, res) => {
  try {
    // 收集所有文件（扁平）
    function collectFiles(dir: string, prefix: string): Array<{ name: string; path: string; size: number; ext: string }> {
      const result: Array<{ name: string; path: string; size: number; ext: string }> = [];
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          if (item.startsWith(".")) continue;
          const fullPath = join(dir, item);
          const relativePath = prefix ? `${prefix}/${item}` : item;
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            result.push(...collectFiles(fullPath, relativePath));
          } else {
            const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
            result.push({ name: item, path: relativePath, size: stat.size, ext });
          }
        }
      } catch {}
      return result;
    }

    const allFiles = collectFiles(WS_BASE, "");
    if (allFiles.length === 0) {
      res.json({ success: true, message: "没有文件需要整理", moves: [] });
      return;
    }

    // 用 LLM 分析文件，决定整理方案
    const fileList = allFiles.map((f) => `${f.path} (${f.ext}, ${(f.size / 1024).toFixed(1)}KB)`).join("\n");

    const prompt = `你是一个文件整理助手。请分析以下文件列表，将它们整理到合理的文件夹结构中。

当前文件列表：
${fileList}

要求：
1. 根据文件类型、名称语义进行智能分类
2. 合理的文件夹命名（中文即可）
3. 已经在合理文件夹中的文件无需移动
4. uploads/ 下的上传文件保持不动
5. 数据库文件（.db/.db-shm/.db-wal）归到"数据库"文件夹
6. 代码脚本（.py/.js/.ts）归到"脚本"文件夹
7. 文档（.docx/.pdf/.pptx/.xlsx/.md/.txt）按内容语义分类
8. 已在有意义的文件夹中（非uploads）的文件可保持不动

输出 JSON 数组（仅 JSON，无 markdown）：
[{"from": "原始路径", "to": "目标路径"}, ...]
只输出需要移动的文件。不需要移动的不要输出。`;

    const orch = getOrchestrator();
    const provider = orch?.["deps"]?.provider;
    if (!provider) {
      res.status(500).json({ success: false, error: "LLM provider not available" });
      return;
    }

    const response = await provider.chat([{ role: "user", content: prompt }]);
    const content = response.content?.trim() ?? "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      res.json({ success: true, message: "AI 分析完成，无需移动", moves: [] });
      return;
    }

    const moves = JSON.parse(jsonMatch[0]) as Array<{ from: string; to: string }>;

    // 执行移动
    const executed: Array<{ from: string; to: string; success: boolean; error?: string }> = [];
    for (const m of moves) {
      const absFrom = join(WS_BASE, m.from);
      const absTo = join(WS_BASE, m.to);
      if (!absFrom.startsWith(WS_BASE) || !absTo.startsWith(WS_BASE)) {
        executed.push({ ...m, success: false, error: "path security violation" });
        continue;
      }
      if (!existsSync(absFrom)) {
        executed.push({ ...m, success: false, error: "source not found" });
        continue;
      }
      try {
        mkdirSync(dirname(absTo), { recursive: true });
        renameSync(absFrom, absTo);
        executed.push({ ...m, success: true });
      } catch (e: any) {
        executed.push({ ...m, success: false, error: e.message });
      }
    }

    res.json({ success: true, message: `已整理 ${executed.filter((e) => e.success).length} 个文件`, moves: executed });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== Markdown 预览 & 转码下载 API =====

// 返回 markdown 原文（供前端预览）
app.get("/api/file/content", requireAuth, (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ success: false, error: "path required" });
    return;
  }
  const wsBase = join(process.cwd(), ".raos", "workspace");
  const absPath = join(wsBase, filePath);
  if (!absPath.startsWith(wsBase)) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  if (!existsSync(absPath)) {
    res.status(404).json({ success: false, error: "file not found" });
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  createReadStream(absPath).pipe(res);
});

// markdown 转码下载
app.get("/api/download/convert", requireAuth, async (req, res) => {
  const filePath = req.query.path as string;
  const format = req.query.format as string;
  if (!filePath || !format) {
    res.status(400).json({ success: false, error: "path and format required" });
    return;
  }
  if (!["pdf", "docx", "pptx"].includes(format)) {
    res.status(400).json({ success: false, error: "format must be pdf, docx, or pptx" });
    return;
  }
  const wsBase = join(process.cwd(), ".raos", "workspace");
  const absPath = join(wsBase, filePath);
  if (!absPath.startsWith(wsBase)) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  if (!existsSync(absPath)) {
    res.status(404).json({ success: false, error: "file not found" });
    return;
  }

  try {
    const mdContent = readFileSync(absPath, "utf-8");
    const baseName = (filePath.split("/").pop() || "document").replace(/\.md$/i, "");

    if (format === "pdf") {
      const buf = await convertToPdf(mdContent);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ".pdf")}`);
      res.send(buf);
    } else if (format === "docx") {
      const buf = await convertToDocx(mdContent);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ".docx")}`);
      res.send(buf);
    } else if (format === "pptx") {
      const theme = req.query.theme as string | undefined;
      const buf = await convertToPptx(mdContent, theme);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ".pptx")}`);
      res.send(buf);
    }
  } catch (e: any) {
    console.error("Convert error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- 转码函数 ---

async function convertToPdf(md: string): Promise<Buffer> {
  const { marked } = await import("marked");
  const html = await marked(md);
  const styledHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
  h1 { font-size: 24px; border-bottom: 2px solid #eee; padding-bottom: 8px; }
  h2 { font-size: 20px; margin-top: 24px; }
  h3 { font-size: 16px; margin-top: 20px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 16px 0; padding: 8px 16px; color: #666; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
</style></head><body>${html}</body></html>`;

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(styledHtml, { waitUntil: "networkidle0" });
    const pdfBuf = await page.pdf({ format: "A4", margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }, printBackground: true });
    return Buffer.from(pdfBuf);
  } finally {
    await browser.close();
  }
}

async function convertToDocx(md: string): Promise<Buffer> {
  const { marked } = await import("marked");
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const tokens = marked.lexer(md);
  const children: any[] = [];

  for (const token of tokens) {
    if (token.type === "heading") {
      const levelMap: Record<number, any> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      children.push(new Paragraph({
        text: token.text,
        heading: levelMap[token.depth] || HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      }));
    } else if (token.type === "paragraph") {
      children.push(new Paragraph({
        children: parseInlineTokens(token.tokens || [], TextRun),
        spacing: { after: 120 },
      }));
    } else if (token.type === "list") {
      for (const item of token.items) {
        children.push(new Paragraph({
          children: parseInlineTokens(item.tokens?.[0]?.type === "text" ? (item.tokens[0] as any).tokens || item.tokens : item.tokens || [], TextRun),
          bullet: { level: 0 },
          spacing: { after: 60 },
        }));
      }
    } else if (token.type === "code") {
      children.push(new Paragraph({
        children: [new TextRun({ text: token.text, font: { name: "Courier New" }, size: 20 })],
        spacing: { before: 120, after: 120 },
      }));
    } else if (token.type === "blockquote") {
      const bqText = token.tokens?.map((t: any) => t.text || t.raw || "").join("\n") || token.raw;
      children.push(new Paragraph({
        children: [new TextRun({ text: bqText, italics: true, color: "666666" })],
        indent: { left: 720 },
        spacing: { before: 120, after: 120 },
      }));
    } else if (token.type === "hr") {
      children.push(new Paragraph({
        children: [new TextRun({ text: "" })],
        border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
        spacing: { before: 240, after: 240 },
      }));
    } else if (token.type === "space") {
      // skip
    } else {
      // fallback: raw text
      const rawText = (token as any).text || (token as any).raw || "";
      if (rawText.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: rawText })],
          spacing: { after: 120 },
        }));
      }
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

function parseInlineTokens(tokens: any[], TextRun: any): any[] {
  const runs: any[] = [];
  for (const t of tokens) {
    if (t.type === "text") {
      runs.push(new TextRun({ text: t.text || t.raw || "" }));
    } else if (t.type === "strong") {
      runs.push(new TextRun({ text: t.text || "", bold: true }));
    } else if (t.type === "em") {
      runs.push(new TextRun({ text: t.text || "", italics: true }));
    } else if (t.type === "codespan") {
      runs.push(new TextRun({ text: t.text || "", font: { name: "Courier New" }, size: 20 }));
    } else if (t.type === "link") {
      runs.push(new TextRun({ text: t.text || t.href || "" }));
    } else {
      runs.push(new TextRun({ text: t.text || t.raw || "" }));
    }
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text: "" }));
  }
  return runs;
}

// ===== PPTX 主题系统 =====

interface PptxTheme {
  name: string;
  label: string;
  background: string;            // slide 背景色
  backgroundGrad?: { color: string; color2: string; type: "linear"; }; // 渐变背景
  titleColor: string;
  bodyColor: string;
  accentColor: string;            // 强调色（装饰线等）
  titleFont: string;
  bodyFont: string;
  titleSize: number;
  bodySize: number;
  coverTitleSize: number;
  coverSubtitleSize: number;
}

const PPTX_THEMES: Record<string, PptxTheme> = {
  "business-blue": {
    name: "business-blue", label: "商务蓝",
    background: "FFFFFF",
    titleColor: "1B3A5C", bodyColor: "444444", accentColor: "2B7AE0",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
  },
  "tech-dark": {
    name: "tech-dark", label: "科技深色",
    background: "1A1A2E",
    backgroundGrad: { color: "1A1A2E", color2: "16213E", type: "linear" },
    titleColor: "E0E0FF", bodyColor: "B0B0CC", accentColor: "00D4FF",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 38, coverSubtitleSize: 18,
  },
  "minimal-white": {
    name: "minimal-white", label: "简约白",
    background: "FAFAFA",
    titleColor: "222222", bodyColor: "555555", accentColor: "888888",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 26, bodySize: 15, coverTitleSize: 34, coverSubtitleSize: 16,
  },
  "vibrant-orange": {
    name: "vibrant-orange", label: "活力橙",
    background: "FFFAF5",
    titleColor: "D4520A", bodyColor: "4A4A4A", accentColor: "FF6B2B",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
  },
  "academic-green": {
    name: "academic-green", label: "学术绿",
    background: "F5FAF5",
    titleColor: "1B5E20", bodyColor: "3E3E3E", accentColor: "43A047",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
  },
};

function parsePptxFrontmatter(md: string): { theme: string; content: string } {
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fmMatch) return { theme: "business-blue", content: md };
  const fmBlock = fmMatch[1];
  const themeMatch = fmBlock.match(/theme:\s*(.+)/);
  const theme = themeMatch ? themeMatch[1].trim() : "business-blue";
  const content = md.slice(fmMatch[0].length);
  return { theme, content };
}

/** 去掉 HTML 标签，保留纯文本 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .trim();
}

/** 将 HTML <table> 转为 markdown 表格 */
function htmlTableToMarkdown(tableHtml: string): string {
  const rows: string[][] = [];
  // 匹配每一行 <tr>
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push(stripHtmlTags(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return "";

  // 统一列数
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    while (r.length < colCount) r.push("");
    return r;
  });

  // 生成 markdown 表格
  const lines: string[] = [];
  // 第一行作为表头
  lines.push("| " + normalized[0].join(" | ") + " |");
  lines.push("| " + normalized[0].map(() => "---").join(" | ") + " |");
  // 后续行
  for (let i = 1; i < normalized.length; i++) {
    lines.push("| " + normalized[i].join(" | ") + " |");
  }
  return lines.join("\n");
}

/** 清理 slide 内容中的 HTML，转为纯 markdown 格式 */
function cleanSlideHtml(raw: string): string {
  let text = raw;

  // 0. 移除 <style> 块
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // 1. 提取 <h1>~<h6> 标签为 markdown heading
  text = text.replace(/<h(\d)[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
    const clean = stripHtmlTags(content);
    return clean ? `${"#".repeat(parseInt(level))} ${clean}` : "";
  });

  // 2. 将 HTML <table> 转为 markdown 表格
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    return htmlTableToMarkdown(inner);
  });

  // 3. 提取 <div>/<p> 中的文本
  text = text.replace(/<(?:div|p)[^>]*>([\s\S]*?)<\/(?:div|p)>/gi, (_m, inner) => {
    const cleaned = stripHtmlTags(inner);
    return cleaned || "";
  });

  // 4. 移除剩余 HTML 标签
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");

  // 5. 解码剩余 HTML 实体
  text = text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

  // 6. 清理多余空行，去重连续相同行
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  const lines = text.split("\n");
  const deduped: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && deduped.length > 0 && deduped[deduped.length - 1].trim() === trimmed) continue;
    deduped.push(line);
  }

  return deduped.join("\n");
}

async function convertToPptx(md: string, themeName?: string): Promise<Buffer> {
  const pptxgenjs = await import("pptxgenjs");
  const PptxGenJS = pptxgenjs.default || pptxgenjs;
  const pptx = new (PptxGenJS as any)();
  pptx.layout = "LAYOUT_WIDE";

  // 解析 frontmatter 获取主题
  const parsed = parsePptxFrontmatter(md);
  const resolvedTheme = themeName || parsed.theme;
  let theme: PptxTheme = PPTX_THEMES[resolvedTheme] || PPTX_THEMES["business-blue"];

  // 如果不在内置主题中，尝试从 DB 查询自定义主题
  if (!PPTX_THEMES[resolvedTheme]) {
    try {
      let row: any;
      if (isMySQL()) {
        const { getMySQLAdapter } = await import('./db/mysql-adapter.js');
        const adapter = getMySQLAdapter();
        const rows = await adapter.query("SELECT * FROM custom_pptx_themes WHERE id = ? OR name = ?", [resolvedTheme, resolvedTheme]);
        row = rows[0];
      } else {
        row = getDb().prepare("SELECT * FROM custom_pptx_themes WHERE id = ? OR name = ?").get(resolvedTheme, resolvedTheme) as any;
      }
      if (row) {
        const colors = JSON.parse(row.colors_json);
        const fonts = JSON.parse(row.fonts_json);
        theme = {
          name: row.id,
          label: row.name,
          background: colors.background || "FFFFFF",
          titleColor: colors.text || colors.primary || "333333",
          bodyColor: "444444",
          accentColor: colors.secondary || colors.accent || "4472C4",
          titleFont: fonts.heading || "Microsoft YaHei",
          bodyFont: fonts.body || "Microsoft YaHei",
          titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
        };
      }
    } catch { /* DB 查询失败则使用默认主题 */ }
  }

  const content = parsed.content;

  const slides = content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  for (let si = 0; si < slides.length; si++) {
    const slideContent = slides[si];
    const slide = pptx.addSlide();

    // 设置背景
    if (theme.backgroundGrad) {
      slide.background = { color: theme.background };
    } else {
      slide.background = { color: theme.background };
    }

    // 清理 HTML 内容，转为纯 markdown
    const cleanedContent = cleanSlideHtml(slideContent);
    const lines = cleanedContent.split("\n");
    let title = "";
    let subtitle = "";
    const bullets: string[] = [];
    const tableRows: string[][] = [];  // markdown 表格数据
    let isCover = false;
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { inTable = false; continue; }

      // 检测 markdown 表格行 | col | col |
      if (/^\|.+\|$/.test(trimmed)) {
        // 跳过分隔行 |---|---|
        if (/^\|[\s\-:|]+\|$/.test(trimmed)) { inTable = true; continue; }
        const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.length > 0) { tableRows.push(cells); inTable = true; }
        continue;
      }
      inTable = false;

      if (!title && /^#{1,3}\s+/.test(trimmed)) {
        title = trimmed.replace(/^#{1,3}\s+/, "");
        if (si === 0 && /^#\s+/.test(trimmed)) isCover = true;
      } else if (/^>\s+/.test(trimmed) && !subtitle) {
        subtitle = trimmed.replace(/^>\s+/, "");
      } else if (/^[-*+]\s+/.test(trimmed)) {
        bullets.push(trimmed.replace(/^[-*+]\s+/, ""));
      } else if (trimmed && !title) {
        title = trimmed;
      } else if (trimmed) {
        bullets.push(trimmed);
      }
    }

    // 顶部装饰线
    slide.addShape("rect" as any, {
      x: 0, y: 0, w: "100%", h: 0.06,
      fill: { color: theme.accentColor },
    });

    if (isCover || (si === 0 && !bullets.length && tableRows.length === 0)) {
      // 封面页布局：居中大标题
      if (title) {
        slide.addText(title, {
          x: 0.8, y: 1.5, w: "85%", h: 1.5,
          fontSize: theme.coverTitleSize, bold: true,
          color: theme.titleColor, fontFace: theme.titleFont,
          align: "center", valign: "middle",
        });
      }
      if (subtitle) {
        slide.addText(subtitle, {
          x: 0.8, y: 3.2, w: "85%", h: 0.8,
          fontSize: theme.coverSubtitleSize, color: theme.bodyColor,
          fontFace: theme.bodyFont, align: "center", valign: "top",
        });
      }
      // 底部装饰线
      slide.addShape("rect" as any, {
        x: 4, y: 3.0, w: 5.3, h: 0.04,
        fill: { color: theme.accentColor },
      });
    } else {
      // 内容页布局
      if (title) {
        slide.addText(title, {
          x: 0.6, y: 0.25, w: "88%", h: 0.9,
          fontSize: theme.titleSize, bold: true,
          color: theme.titleColor, fontFace: theme.titleFont,
          align: "left", valign: "middle",
        });
        // 标题下装饰线
        slide.addShape("rect" as any, {
          x: 0.6, y: 1.15, w: 1.5, h: 0.04,
          fill: { color: theme.accentColor },
        });
      }

      // 计算内容区起始 Y 位置
      const contentY = title ? 1.4 : 0.4;
      let currentY = contentY;

      // 渲染 markdown 表格为 pptx 原生表格
      if (tableRows.length > 0) {
        const colCount = Math.max(...tableRows.map((r) => r.length));
        const tableWidth = 11.5; // inches (LAYOUT_WIDE ≈ 13.33)
        const colW = tableWidth / colCount;

        const pptxRows: any[][] = tableRows.map((row, ri) => {
          while (row.length < colCount) row.push("");
          return row.map((cell) => ({
            text: cell,
            options: {
              fontSize: ri === 0 ? 12 : 11,
              bold: ri === 0,
              color: ri === 0 ? "FFFFFF" : theme.bodyColor,
              fontFace: theme.bodyFont,
              align: "center" as const,
              valign: "middle" as const,
              fill: ri === 0 ? { color: theme.accentColor } : undefined,
            },
          }));
        });

        const rowH = 0.4;
        const tableH = Math.min(pptxRows.length * rowH, 4.5);

        slide.addTable(pptxRows, {
          x: 0.6, y: currentY, w: tableWidth,
          colW: Array(colCount).fill(colW),
          rowH,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
          autoPage: false,
        });

        currentY += tableH + 0.2;
      }

      // 渲染 bullet 要点（在表格下方）
      if (bullets.length > 0) {
        const remainH = 6.0 - currentY;
        const bodyText = bullets.map((b) => ({
          text: b,
          options: {
            fontSize: theme.bodySize, color: theme.bodyColor,
            fontFace: theme.bodyFont,
            bullet: { type: "bullet" as const },
            breakLine: true,
            lineSpacingMultiple: 1.5,
          },
        }));
        slide.addText(bodyText, {
          x: 0.6, y: currentY, w: "88%", h: remainH > 0.5 ? remainH : 4.5,
          valign: "top",
          paraSpaceAfter: 6,
        });
      }
    }

    // 页码（非封面页）
    if (si > 0 || (!isCover && bullets.length > 0)) {
      slide.addText(`${si + 1}`, {
        x: "90%", y: "92%", w: 0.8, h: 0.3,
        fontSize: 10, color: theme.bodyColor,
        fontFace: theme.bodyFont, align: "right",
      });
    }
  }

  const arrBuf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(arrBuf as ArrayBuffer);
}

// PPTX 主题列表 API（内置 + 自定义）
app.get("/api/pptx/themes", requireAuth, async (req: any, res) => {
  const builtIn = Object.values(PPTX_THEMES).map((t) => ({
    name: t.name, label: t.label, custom: false,
    preview: { bg: t.background, title: t.titleColor, accent: t.accentColor },
  }));

  let custom: any[] = [];
  try {
    const userId = req.user?.id;
    if (userId) {
      let rows: any[];
      if (isMySQL()) {
        const { getMySQLAdapter } = await import('./db/mysql-adapter.js');
        const adapter = getMySQLAdapter();
        rows = await adapter.query("SELECT * FROM custom_pptx_themes WHERE user_id = ? ORDER BY created_at DESC", [userId]);
      } else {
        rows = getDb().prepare("SELECT * FROM custom_pptx_themes WHERE user_id = ? ORDER BY created_at DESC").all(userId) as any[];
      }
      custom = rows.map((r) => {
        const colors = JSON.parse(r.colors_json);
        return {
          name: r.id, label: r.name, custom: true,
          sourceFile: r.source_file,
          preview: { bg: colors.background || "FFFFFF", title: colors.text || colors.primary, accent: colors.secondary || colors.accent },
        };
      });
    }
  } catch { /* 表可能不存在 */ }

  res.json({ success: true, themes: [...builtIn, ...custom] });
});

// PPTX 风格学习 — 上传 PPTX 提取主题
app.post("/api/pptx/themes/learn", requireAuth, express.raw({ type: "multipart/form-data", limit: "50mb" }), async (req: any, res) => {
  try {
    const contentType = req.headers["content-type"] as string;
    const boundaryMatch = contentType?.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.status(400).json({ success: false, error: "缺少 multipart boundary" });
      return;
    }

    const parts = parseMultipart(req.body as Buffer, boundaryMatch[1]);
    const pptxFile = parts.find((p) => p.filename.toLowerCase().endsWith(".pptx"));
    if (!pptxFile) {
      res.status(400).json({ success: false, error: "请上传 .pptx 文件" });
      return;
    }

    // 从 multipart 文本字段提取 name（简单方式：用查询参数或文件名）
    const themeName = (req.query.name as string) || undefined;

    const style = await extractPptxStyle(pptxFile.data, pptxFile.filename, themeName);

    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: "未认证" });
      return;
    }

    if (isMySQL()) {
      const { getMySQLAdapter } = await import('./db/mysql-adapter.js');
      const adapter = getMySQLAdapter();
      await adapter.execute(
        "INSERT INTO custom_pptx_themes (id, user_id, name, colors_json, fonts_json, source_file, created_at) VALUES (?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
        [id, userId, style.name, JSON.stringify(style.colors), JSON.stringify(style.fonts), style.sourceFile]
      );
    } else {
      getDb().prepare(
        "INSERT INTO custom_pptx_themes (id, user_id, name, colors_json, fonts_json, source_file) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, userId, style.name, JSON.stringify(style.colors), JSON.stringify(style.fonts), style.sourceFile);
    }

    res.json({
      success: true,
      theme: {
        id,
        name: style.name,
        colors: style.colors,
        fonts: style.fonts,
        sourceFile: style.sourceFile,
      },
    });
  } catch (e: any) {
    console.error("PPTX style learn error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除自定义 PPTX 主题
app.delete("/api/pptx/themes/:id", requireAuth, async (req: any, res) => {
  try {
    const themeId = req.params.id;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: "未认证" });
      return;
    }

    let success = false;
    if (isMySQL()) {
      const { getMySQLAdapter } = await import('./db/mysql-adapter.js');
      const adapter = getMySQLAdapter();
      const result = await adapter.execute("DELETE FROM custom_pptx_themes WHERE id = ? AND user_id = ?", [themeId, userId]);
      success = result.affectedRows > 0;
    } else {
      const result = getDb().prepare("DELETE FROM custom_pptx_themes WHERE id = ? AND user_id = ?").run(themeId, userId);
      success = result.changes > 0;
    }
    if (!success) {
      res.status(404).json({ success: false, error: "主题不存在或无权删除" });
      return;
    }

    res.json({ success: true, deleted: themeId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== 文件下载 API =====

// 单文件下载
app.get("/api/download", requireAuth, (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ success: false, error: "path required" });
    return;
  }
  const absPath = join(process.cwd(), ".raos", "workspace", filePath);
  if (!absPath.startsWith(join(process.cwd(), ".raos", "workspace"))) {
    res.status(403).json({ success: false, error: "access denied" });
    return;
  }
  if (!existsSync(absPath)) {
    res.status(404).json({ success: false, error: "file not found" });
    return;
  }
  const fileName = filePath.split("/").pop() || "download";
  const encodedName = encodeURIComponent(fileName);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedName}`);
  res.setHeader("Content-Length", statSync(absPath).size);
  createReadStream(absPath).pipe(res);
});

// 多文件 zip 下载
app.post("/api/download/zip", requireAuth, async (req, res) => {
  const { files } = req.body as { files: string[] };
  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: "files array required" });
    return;
  }

  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const wsBase = join(process.cwd(), ".raos", "workspace");

    for (const f of files) {
      const absPath = join(wsBase, f);
      if (!absPath.startsWith(wsBase) || !existsSync(absPath)) continue;
      const fileName = f.split("/").pop() || f;
      zip.file(fileName, readFileSync(absPath));
    }

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="files_${Date.now()}.zip"`);
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
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

const PORT = process.env.PORT ?? 3000;

// 挂载 routes/ 目录下的所有路由
mountRoutes(app, {
  registry,
  engine,
  skillAccessService,
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
  getAgentLoop: (userId: string) => sessionManager.getOrCreate(userId).agentLoop ?? null,
  getOrchestrator: () => getOrchestrator(),
  getAgentConfig: () => configManager.getAgent(),
  getVisionConfig: () => {
    const mm = configManager.getMultimodal();
    if (!mm.enabled || !mm.apiKey || !mm.visionModel) return null;
    return { apiKey: mm.apiKey, baseUrl: mm.baseUrl || "", model: mm.visionModel };
  },
  rebuildMultimodalProvider: () => {
    const mm = configManager.getMultimodal();
    if (!mm.enabled || !mm.apiKey) {
      currentMultimodalProvider = null;
      return;
    }
    currentMultimodalProvider = new OpenAIMultimodalProvider({
      apiKey: mm.apiKey,
      baseUrl: mm.baseUrl || undefined,
      imageModel: mm.imageModel,
      visionModel: mm.visionModel,
      ttsModel: mm.ttsModel,
      whisperModel: mm.whisperModel,
    });
  },
  rebuildAllAgentLoops: () => {
    if (currentProvider) {
      sessionManager.rebuildAllAgentLoops(registry, engine, currentProvider, configManager.getAgent());
    }
  },
  rebuildOrchestrator: () => {
    (globalThis as any).__orchestrator = null;
  },
  syncSkillsToResources: () => {
    // 同步技能到资源
    const skills = registry.list();
    const resourceSkills = skills.filter((s: any) => s.type === "resource").map((s: any) => s.name);
    if (resourceSkills.length > 0) {
      console.log(`   Skills synced to resources: ${resourceSkills.length} total`);
    }
  },
  shareRepository: ShareRepository.getInstance(),
});

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
});

// 处理未捕获的异常，防止进程崩溃
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
  // 记录错误但不退出，保持服务可用
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
  // 记录错误但不退出
});

// 优雅关闭：处理 SIGTERM 和 SIGINT
process.on("SIGTERM", () => {
  console.log("\n✓ SIGTERM received, closing resources...");
  evolutionController.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n✓ SIGINT received, closing resources...");
  evolutionController.close();
  process.exit(0);
});
