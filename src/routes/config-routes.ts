import { Router } from "express";
import { requireAuth, requireAdmin, requirePermission } from "../db/auth-middleware.js";
import { OpenAIEmbeddingProvider } from "../memory/embedding-provider.js";
import { setGlobalKBEmbeddingProvider, setGlobalKBVisionConfig } from "../skills/knowledge-skills.js";
import type { LLMProviderConfig } from "../llm/types.js";
import type { RouteDependencies } from "./index.js";

export function createConfigRoutes(deps: RouteDependencies): Router {
  const {
    configManager,
    sessionManager,
    federationTransport,
    evolutionEngine,
    getCurrentProvider,
    createProvider,
    setCurrentProvider,
    rebuildMultimodalProvider,
    rebuildAllAgentLoops,
    rebuildOrchestrator,
    getVisionConfig,
  } = deps;
  const router = Router();

  // Get current LLM config (hide API Key)
  router.get("/config", requireAuth, requirePermission("config.read"), (_req, res) => {
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
      isLLMConfigured: configManager.isLLMConfigured(),
      isMultimodalConfigured: configManager.isMultimodalConfigured(),
    });
  });

  // Set LLM config
  router.post("/config/llm", requireAuth, requirePermission("config.write"), (req, res) => {
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
    setCurrentProvider(createProvider(llmConfig));
    rebuildAllAgentLoops();
    rebuildOrchestrator();

    res.json({
      success: true,
      message: `LLM configured: ${type} / ${model}`,
    });
  });

  // Set Agent config
  router.post("/config/agent", requireAuth, requirePermission("config.write"), (req, res) => {
    const { maxIterations, systemPrompt, includeTrace } = req.body;
    configManager.setAgent({ maxIterations, systemPrompt, includeTrace });
    rebuildAllAgentLoops();
    rebuildOrchestrator();
    res.json({ success: true });
  });

  // Get multimodal config
  router.get("/config/multimodal", requireAuth, requirePermission("config.read"), (_req, res) => {
    const mm = configManager.getMultimodal();
    res.json({
      ...mm,
      apiKey: mm.apiKey ? "***" + mm.apiKey.slice(-4) : "",
      isConfigured: configManager.isMultimodalConfigured(),
    });
  });

  // Get all model card configs
  router.get("/config/model-cards", requireAuth, requirePermission("config.read"), (_req, res) => {
    const cards = configManager.getModelCards();
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

  // Save single model card config
  router.post("/config/model-cards/:type", requireAuth, requirePermission("config.write"), (req, res) => {
    const cardType = req.params.type as any;
    const validTypes = ["llm", "vision", "imageGen", "tts", "stt", "embedding"];
    if (!validTypes.includes(cardType)) {
      res.status(400).json({ success: false, error: `Invalid model card type: ${cardType}` });
      return;
    }
    const { type, apiKey, baseUrl, model, maxTokens, temperature, embeddingMode } = req.body;
    const existingCards = configManager.getModelCards();
    const existingCard = (existingCards as Record<string, any>)[cardType] ?? {};
    const resolvedApiKey = (!apiKey || apiKey.startsWith("***")) ? existingCard.apiKey : apiKey;
    configManager.setModelCard(cardType, { type, apiKey: resolvedApiKey, baseUrl, model, maxTokens, temperature, embeddingMode });

    if (cardType === "llm" && type && resolvedApiKey && model) {
      configManager.setLLM({ type, apiKey: resolvedApiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 });
      setCurrentProvider(createProvider({ type, apiKey: resolvedApiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 }));
      rebuildAllAgentLoops();
      rebuildOrchestrator();
    }

    if (["vision", "imageGen", "tts", "stt"].includes(cardType)) {
      configManager.setMultimodal({ ...configManager.getMultimodal(), enabled: true });
      rebuildMultimodalProvider();
    }

    if (cardType === "vision") {
      const vc = getVisionConfig();
      setGlobalKBVisionConfig(vc);
    }

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

  // Set multimodal config
  router.post("/config/multimodal", requireAuth, requirePermission("config.write"), (req, res) => {
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

  router.get("/config/federation", requireAuth, requireAdmin, (_req, res) => {
    const cfg = configManager.getFederation();
    res.json({
      success: true,
      config: {
        ...cfg,
        federationKey: cfg.federationKey ? "***" + cfg.federationKey.slice(-4) : "",
      },
    });
  });

  router.post("/config/federation", requireAuth, requireAdmin, (req, res) => {
    const { instanceId: iid, federationKey, heartbeatIntervalMs, syncIntervalMs } = req.body;
    configManager.setFederation({
      ...(iid !== undefined && { instanceId: iid }),
      ...(federationKey !== undefined && { federationKey }),
      ...(heartbeatIntervalMs !== undefined && { heartbeatIntervalMs }),
      ...(syncIntervalMs !== undefined && { syncIntervalMs }),
    });
    if (federationKey !== undefined) {
      (federationTransport as any).apiKey = federationKey;
    }
    res.json({ success: true, message: "Federation config saved" });
  });

  router.post("/config/federation/peers", requireAuth, requireAdmin, (req, res) => {
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

  router.delete("/config/federation/peers", requireAuth, requireAdmin, (req, res) => {
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

  router.get("/config/evolution-engine", requireAuth, requireAdmin, (_req, res) => {
    const cfg = configManager.getEvolution();
    res.json({ success: true, config: cfg });
  });

  router.post("/config/evolution-engine", requireAuth, requireAdmin, (req, res) => {
    const updates: Record<string, unknown> = {};
    const fields = [
      "autoExecute", "cycleIntervalMs", "maxActionsPerCycle", "skipApprovalRequired",
      "successRateThreshold", "latencyThresholdMs", "inactiveDays", "minFederationConfidence",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    configManager.setEvolution(updates as any);
    evolutionEngine.updateConfig(updates as any);
    res.json({ success: true, config: configManager.getEvolution() });
  });

  // Full config
  router.get("/config/full", requireAuth, requireAdmin, (_req, res) => {
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

  // Test LLM connection
  router.post("/llm/test", requireAuth, requirePermission("config.read"), async (req, res) => {
    const provider = getCurrentProvider();
    if (!provider) {
      res.status(400).json({ success: false, error: "LLM not configured" });
      return;
    }

    try {
      const response = await provider.chat([
        { role: "user", content: "Say hello in one sentence." },
      ]);
      res.json({
        success: true,
        response: response.content,
        model: provider.model,
        usage: response.usage,
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
