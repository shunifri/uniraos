/**
 * Route aggregator — mounts all API route modules onto the Express app.
 */

import type { Express } from "express";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine, AsyncTaskManager } from "../engine/index.js";
import type { WALManager } from "../wal/index.js";
import type { ConfigManager } from "../config/config-manager.js";
import type { UserSessionManager } from "../user/user-session.js";
import type { PluginLoader } from "../plugin/plugin-loader.js";
import type { SkillMarketplace } from "../skills/skill-marketplace.js";
import type { EvolutionController, SkillLifecycleManager, EmergenceDetector } from "../engine/index.js";
import type { PromptManager } from "../llm/prompt-manager.js";
import type { ModelRouter } from "../llm/model-router.js";
import type { LLMProvider, LLMProviderConfig, MultimodalProvider } from "../llm/types.js";
import type { Orchestrator } from "../agents/index.js";
import type { AgentLoop } from "../llm/agent-loop.js";
import type {
  HttpFederationTransport,
  SkillMigrationManager,
  FederationManager,
  EvolutionEngine,
} from "../federation/index.js";

import { createAuthRoutes } from "./auth-routes.js";
import { createSkillRoutes } from "./skill-routes.js";
import { createConfigRoutes } from "./config-routes.js";
import { createAgentRoutes } from "./agent-routes.js";
import { createMemoryRoutes } from "./memory-routes.js";
import { createEvolutionRoutes } from "./evolution-routes.js";
import { createKnowledgeRoutes } from "./knowledge-routes.js";
import { createFileRoutes } from "./file-routes.js";
import { createGraphRoutes } from "./graph-routes.js";
import { createShareRoutes } from "./share-routes.js";
import { createAdminCompatRoutes } from "./admin-compat-routes.js";
import connectionsRoutes from "./connections-routes.js";
import formRoutes from "./form-routes.js";
import workflowFormRoutes from "./workflow-form-routes.js";
import workflowTaskRoutes from "./workflow-task-routes.js";
import formValidationRoutes from "./form-validation-routes.js";
import inboxRoutes from "../inbox/inbox-routes.js";
import schedulerRoutes from "../scheduler/scheduler-routes.js";
import type { ShareRepository } from "../db/share-repository.js";
import type { SkillAccessService } from "../engine/index.js";

export interface RouteDependencies {
  registry: SkillRegistry;
  engine: ExecutionEngine;
  skillAccessService: SkillAccessService;
  wal: WALManager;
  configManager: ConfigManager;
  sessionManager: UserSessionManager;
  taskManager: AsyncTaskManager;
  pluginLoader: PluginLoader;
  marketplace: SkillMarketplace;
  evolutionController: EvolutionController;
  emergenceDetector: EmergenceDetector;
  lifecycleManager: SkillLifecycleManager;
  promptManager: PromptManager;
  modelRouter: ModelRouter;
  federationTransport: HttpFederationTransport;
  migrationManager: SkillMigrationManager;
  federationManager: FederationManager;
  evolutionEngine: EvolutionEngine;
  instanceId: string;

  // Mutable references / accessors
  getCurrentProvider: () => LLMProvider | null;
  getCurrentMultimodalProvider: () => MultimodalProvider | null;
  createProvider: (config: LLMProviderConfig) => LLMProvider;
  setCurrentProvider: (p: LLMProvider | null) => void;
  getAgentLoop: (userId: string) => AgentLoop | null;
  getOrchestrator: () => Orchestrator | null;
  getAgentConfig: () => { maxIterations: number; systemPrompt?: string; includeTrace: boolean };
  getVisionConfig: () => { apiKey: string; baseUrl: string; model: string } | null;
  rebuildMultimodalProvider: () => void;
  rebuildAllAgentLoops: () => void;
  rebuildOrchestrator: () => void;
  syncSkillsToResources: () => void;
  shareRepository?: ShareRepository;
}

export function mountRoutes(app: Express, deps: RouteDependencies): void {
  app.use("/api", createAuthRoutes(deps));
  app.use("/api", createSkillRoutes(deps));
  app.use("/api", createConfigRoutes(deps));
  app.use("/api", createAgentRoutes(deps));
  app.use("/api", createMemoryRoutes(deps));
  app.use("/api", createEvolutionRoutes(deps));
  app.use("/api", createKnowledgeRoutes(deps));
  app.use("/api", createFileRoutes(deps));
  app.use("/api", createGraphRoutes(deps));
  if (deps.shareRepository) {
    app.use("/api", createShareRoutes({ ...deps, shareRepository: deps.shareRepository }));
  }
  app.use("/api", createAdminCompatRoutes(deps));
  app.use("/api/connections", connectionsRoutes);
  app.use("/api", formRoutes);
  app.use("/api", workflowFormRoutes);
  app.use("/api", workflowTaskRoutes);
  app.use("/api", formValidationRoutes);
  app.use("/api", inboxRoutes);
  app.use("/api", schedulerRoutes);
}
