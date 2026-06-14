/**
 * RAOS Provider & Agent Lifecycle Manager
 *
 * Encapsulates LLM provider creation, agent loop management,
 * and orchestrator lifecycle.
 */

import { ClaudeProvider } from "../llm/claude-provider.js";
import { OpenAIProvider } from "../llm/openai-provider.js";
import { OpenAIMultimodalProvider } from "../llm/openai-multimodal-provider.js";
import { AgentLoop } from "../llm/agent-loop.js";
import { Orchestrator } from "../agents/index.js";
import type { LLMProvider, LLMProviderConfig, MultimodalProvider } from "../llm/types.js";
import type { VisionModelConfig } from "../services/doc-parser.js";
import type { ConfigManager } from "../config/config-manager.js";
import type { UserSessionManager } from "../user/user-session.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine, SkillAccessService } from "../engine/index.js";

export class ProviderManager {
  private currentProvider: LLMProvider | null = null;
  private currentMultimodalProvider: MultimodalProvider | null = null;

  constructor(
    private configManager: ConfigManager,
    private sessionManager: UserSessionManager,
    private registry: SkillRegistry,
    private engine: ExecutionEngine,
    private skillAccessService: SkillAccessService,
  ) {}

  getProvider(): LLMProvider | null {
    return this.currentProvider;
  }

  setProvider(p: LLMProvider | null): void {
    this.currentProvider = p;
  }

  getMultimodalProvider(): MultimodalProvider | null {
    return this.currentMultimodalProvider;
  }

  setMultimodalProvider(p: MultimodalProvider | null): void {
    this.currentMultimodalProvider = p;
  }

  createProvider(config: LLMProviderConfig): LLMProvider {
    if (config.type === "claude") {
      return new ClaudeProvider(config);
    }
    return new OpenAIProvider(config);
  }

  getVisionConfig(): VisionModelConfig | null {
    const visionCard = this.configManager.getResolvedModelConfig("vision");
    if (visionCard.apiKey && visionCard.model) {
      return {
        apiKey: visionCard.apiKey,
        baseUrl: (visionCard.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
        model: visionCard.model,
      };
    }
    const mm = this.configManager.getMultimodalResolved();
    if (mm?.apiKey && mm?.visionModel) {
      return {
        apiKey: mm.apiKey,
        baseUrl: (mm.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
        model: mm.visionModel,
      };
    }
    return null;
  }

  rebuildMultimodalProvider(): void {
    const mmConfig = this.configManager.getMultimodalResolved();
    if (mmConfig) {
      this.currentMultimodalProvider = new OpenAIMultimodalProvider(mmConfig);
      console.log(
        `   Multimodal provider configured (image: ${mmConfig.imageModel ?? "dall-e-3"}, vision: ${mmConfig.visionModel ?? "gpt-4o"})`
      );
    } else {
      this.currentMultimodalProvider = null;
    }
  }

  getAgentConfig() {
    const agentConfig = this.configManager.get().agent;
    return {
      maxIterations: agentConfig.maxIterations,
      systemPrompt: agentConfig.systemPrompt || undefined,
      includeTrace: agentConfig.includeTrace,
    };
  }

  getAgentLoop(userId: string): AgentLoop | null {
    if (!this.currentProvider) return null;
    const session = this.sessionManager.getOrCreate(userId);
    if (!session.agentLoop) {
      session.agentLoop = new AgentLoop(
        this.registry,
        this.engine,
        this.currentProvider,
        this.getAgentConfig(),
        this.skillAccessService,
      );
    }
    return session.agentLoop;
  }

  rebuildAllAgentLoops(): void {
    if (!this.currentProvider) return;
    this.sessionManager.rebuildAllAgentLoops(
      this.registry,
      this.engine,
      this.currentProvider,
      this.getAgentConfig(),
    );
  }

  getOrchestrator(): Orchestrator | null {
    if (!this.currentProvider) return null;
    if (!(globalThis as any).__orchestrator) {
      const agentConfig = this.configManager.get().agent;
      (globalThis as any).__orchestrator = new Orchestrator(
        { registry: this.registry, engine: this.engine, provider: this.currentProvider },
        {
          autoStrategy: true,
          defaultSystemPrompt: agentConfig.systemPrompt || undefined,
          maxIterations: agentConfig.maxIterations,
        },
      );
    }
    return (globalThis as any).__orchestrator as Orchestrator;
  }

  rebuildOrchestrator(): void {
    (globalThis as any).__orchestrator = null;
  }
}
