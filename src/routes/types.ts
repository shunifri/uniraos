/**
 * Route dependencies type — extracted to avoid circular imports
 * between routes/index.ts and individual route modules.
 */

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
  federationTransport: any;
  migrationManager: any;
  federationManager: any;
  evolutionEngine: any;
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
