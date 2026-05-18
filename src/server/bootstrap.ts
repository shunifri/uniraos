import { join, resolve } from "path";
import { SkillRegistry } from "../registry/index.js";
import { ExecutionEngine, AsyncTaskManager, SkillAccessService, setGlobalExecutionEngine } from "../engine/index.js";
import { WALManager } from "../wal/index.js";
import { FileWALStore } from "../wal/file-wal-store.js";
import { defineSkill, defineSystemSkill } from "../types/index.js";
import { ConfigManager } from "../config/config-manager.js";
import { AgentLoop } from "../llm/agent-loop.js";
import { createMemorySkills } from "../memory/memory-skills.js";
import { createMultimodalSkills } from "../llm/multimodal-skills.js";
import { createDataSkills } from "../skills/data-skills.js";
import { createDatabaseSkills } from "../skills/db-skills.js";
import { createWebSkills } from "../skills/web-skills.js";
import { createDocumentSkills } from "../skills/document-skills.js";
import { createChartSkills } from "../skills/chart-skills.js";
import { createProtocolSkills } from "../skills/protocol-skills.js";
import { createKnowledgeSkills } from "../skills/knowledge-skills.js";
import { createApiGenSkills } from "../skills/api-gen-skills.js";
import { createMetaSkills } from "../skills/meta-skills.js";
import { registerAppDesignerSkill } from "../skills/app-designer-skill.js";
import { createPlanningSkill } from "../skills/planning-skill.js";
import { createPlanExecutionSkills } from "../skills/plan-execution-skills.js";
import { createGraphSkills } from "../skills/graph-skills.js";
import { createWorkflowSkills } from "../skills/workflow-skills.js";
import { createSchedulerSkills } from "../skills/scheduler-skills.js";
import { createEnterpriseSkills } from "../skills/enterprise-skills.js";
import { createIntegrationSkills } from "../skills/integration-skills.js";
import { createAdvancedSkills } from "../skills/advanced-skills.js";
import { createUserConfirmSkill } from "../skills/user-confirm-skill.js";
import { SkillMarketplace } from "../skills/skill-marketplace.js";
import { OpenAIMultimodalProvider } from "../llm/openai-multimodal-provider.js";
import { PluginLoader } from "../plugin/plugin-loader.js";
import { UserSessionManager } from "../user/user-session.js";
import { getCustomSkillRepository } from "../db/custom-skill-repository.js";
import { initPermissionService } from "../permissions/index.js";
import { OpenAIEmbeddingProvider } from "../memory/embedding-provider.js";
import { setGlobalKBEmbeddingProvider, setGlobalKBVisionConfig, getKnowledgeBase } from "../skills/knowledge-skills.js";
import { EvolutionController, SkillLifecycleManager, EmergenceDetector, setGlobalEvolutionController } from "../engine/index.js";
import { createEvolutionSkills } from "../skills/evolution-skills.js";
import { PromptManager } from "../llm/prompt-manager.js";
import { ModelRouter } from "../llm/model-router.js";
import {
  HttpFederationTransport,
  SkillMigrationManager,
  FederationManager,
  EvolutionEngine,
  createFederationSkills,
} from "../federation/index.js";
import { ProviderManager } from "./provider-manager.js";
import { loadExampleSkills, syncSkillsToResources } from "./skill-bootstrap.js";
import { DocMindParser } from "../services/docmind-parser.js";
import { initParsingQueue, getParsingQueue } from "../services/parsing-queue.js";
import type { LLMProvider, LLMProviderConfig, MultimodalProvider } from "../llm/types.js";

export interface BootstrapResult {
  registry: SkillRegistry;
  engine: ExecutionEngine;
  wal: WALManager;
  configManager: ConfigManager;
  sessionManager: UserSessionManager;
  taskManager: AsyncTaskManager;
  skillAccessService: SkillAccessService;
  providerManager: ProviderManager;
  evolutionController: EvolutionController;
  emergenceDetector: EmergenceDetector;
  promptManager: PromptManager;
  modelRouter: ModelRouter;
  lifecycleManager: SkillLifecycleManager;
  marketplace: SkillMarketplace;
  pluginLoader: PluginLoader;
  federationTransport: HttpFederationTransport;
  migrationManager: SkillMigrationManager;
  federationManager: FederationManager;
  evolutionEngine: EvolutionEngine;
  instanceId: string;
}

export async function bootstrap(): Promise<BootstrapResult> {
  // 核心实例
  const registry = new SkillRegistry();
  initPermissionService(registry);
  const walStore = new FileWALStore(join(process.cwd(), ".raos", "wal.jsonl"));
  const wal = new WALManager(walStore);
  const configManager = new ConfigManager();
  const sessionManager = new UserSessionManager(join(process.cwd(), ".raos", "ltm"), configManager.getMemory());
  const taskManager = new AsyncTaskManager();

  const engine = new ExecutionEngine(registry, wal);
  setGlobalExecutionEngine(engine);
  const skillAccessService = new SkillAccessService(registry);
  const providerManager = new ProviderManager(configManager, sessionManager, registry, engine, skillAccessService);

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
      const visionConfig = providerManager.getVisionConfig();
      initParsingQueue(parser, (owner) => getKnowledgeBase(owner), {
        maxConcurrent: 3,
        pollingIntervalMs: 3000,
        maxPollingTimeMs: 30 * 60 * 1000,
        enableIncrementalIndex: true,
        kbImagesDir: resolve(process.cwd(), ".raos/kb_images"),
      }, sessionManager, visionConfig);
      getParsingQueue();
      console.log("   Document Mind parsing queue initialized");
    }
  }

  const evolutionController = new EvolutionController(
    undefined,
    join(process.cwd(), ".raos", "evolution.db")
  );
  setGlobalEvolutionController(evolutionController);
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

  // 联邦/迁移/进化 组件
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
  evolutionEngine.getFederatedRecommendations = () => federationManager.getRecommendations();

  // 启动 session 清理
  sessionManager.startCleanup();

  loadExampleSkills(registry);

  // 注册所有 Skills
  for (const skill of createMemorySkills(sessionManager, engine, () => providerManager.getProvider())) {
    registry.register(skill);
  }
  console.log(`   Memory skills registered (STM + LTM + meta)`);

  for (const skill of createEvolutionSkills(evolutionController, emergenceDetector)) {
    registry.register(skill);
  }
  console.log(`   Evolution skills registered (genealogy + emergence + red-lines)`);

  for (const skill of createMultimodalSkills(() => providerManager.getMultimodalProvider(), taskManager)) {
    registry.register(skill);
  }
  console.log(`   Multimodal + async task skills registered`);

  await createDataSkills(registry);
  await createDatabaseSkills(registry);
  createWebSkills(registry);
  createDocumentSkills(registry);
  createChartSkills(registry);
  createProtocolSkills(registry);
  createKnowledgeSkills(registry, sessionManager);
  createApiGenSkills(registry);
  createFederationSkills(registry, migrationManager, federationManager, evolutionEngine);
  createWorkflowSkills(registry, () => providerManager.getProvider());
  console.log(`   Workflow skills registered`);
  createSchedulerSkills(registry);
  await createEnterpriseSkills(registry);
  await createIntegrationSkills(registry);
  await createAdvancedSkills(registry);
  createMetaSkills(registry, engine, () => providerManager.getProvider(), evolutionController);
  registerAppDesignerSkill(registry, engine, () => providerManager.getProvider());

  for (const skill of createGraphSkills(sessionManager)) {
    registry.register(skill);
  }
  console.log(`   Graph skills registered (graph_query/graph_path/graph_communities/graph_deduplicate)`);

  registry.register(createUserConfirmSkill());
  console.log(`   User confirmation skill registered (user_confirm)`);

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

  createPlanningSkill(registry, engine, () => providerManager.getProvider());
  createPlanExecutionSkills(registry);
  console.log("   Plan execution skills registered (plan_create/list/status/execute/pause/resume/cancel/delete/resume_all)");

  // 加载插件
  pluginLoader.on((event) => {
    if (event.type === "loaded") console.log(`   Plugin loaded: ${event.plugin.name}@${event.plugin.version}`);
    if (event.type === "reloaded") console.log(`   Plugin reloaded: ${event.plugin.name}`);
    if (event.type === "error") console.error(`   Plugin error [${event.name}]: ${event.error.message}`);
  });
  void pluginLoader.loadAll().then(({ loaded, errors }) => {
    if (loaded.length > 0) console.log(`   Plugins loaded: ${loaded.join(", ")}`);
    if (errors.length > 0) console.log(`   Plugin errors: ${errors.map((e) => `${e.name}(${e.error})`).join(", ")}`);
    void syncSkillsToResources(registry);
  });

  // 从数据库加载用户自定义 Skill
  void (async () => {
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
        void syncSkillsToResources(registry);
      }
    } catch (error) {
      console.warn("   Failed to load custom skills from database:", error);
    }
  })();

  // 从持久化配置恢复 Provider
  if (configManager.isLLMConfigured()) {
    const llmConfig = configManager.getLLM()!;
    providerManager.setProvider(providerManager.createProvider(llmConfig));
    sessionManager.setLLMProvider(providerManager.getProvider()!);
    console.log(`   LLM restored: ${llmConfig.type} / ${llmConfig.model}`);
  }

  if (configManager.isMultimodalConfigured()) {
    providerManager.rebuildMultimodalProvider();
  }

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

  {
    const vc = providerManager.getVisionConfig();
    if (vc) {
      setGlobalKBVisionConfig(vc);
      console.log(`   Vision config restored: ${vc.model} (for doc OCR)`);
    }
  }

  void syncSkillsToResources(registry);

  return {
    registry,
    engine,
    wal,
    configManager,
    sessionManager,
    taskManager,
    skillAccessService,
    providerManager,
    evolutionController,
    emergenceDetector,
    promptManager,
    modelRouter,
    lifecycleManager,
    marketplace,
    pluginLoader,
    federationTransport,
    migrationManager,
    federationManager,
    evolutionEngine,
    instanceId,
  };
}
