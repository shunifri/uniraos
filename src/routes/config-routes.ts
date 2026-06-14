import { Router } from "express";
import { permissions } from "../permissions/index.js";
import { OpenAIEmbeddingProvider } from "../memory/embedding-provider.js";
import { setGlobalKBEmbeddingProvider, setGlobalKBVisionConfig } from "../skills/knowledge-skills.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { resolveEndpoint } from "../utils/endpoint-url.js";
import type { LLMProviderConfig } from "../llm/types.js";
import type { RouteDependencies } from "./types.js";

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

  // 创建权限中间件实例 - 延迟到函数内部创建
  const pm = permissions.createMiddleware(permissions.service);

  // Get current LLM config (hide API Key)
  router.get("/config", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (_req, res) => {
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
      } : undefined,
      isLLMConfigured: configManager.isLLMConfigured(),
      isMultimodalConfigured: configManager.isMultimodalConfigured(),
      isDocMindConfigured: configManager.isDocMindConfigured(),
    });
  });

  // Set LLM config
  router.post("/config/llm", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
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
    const provider = createProvider(llmConfig);
    setCurrentProvider(provider);
    sessionManager.setLLMProvider(provider); // 确保 sessionManager 有最新的 llmProvider
    rebuildAllAgentLoops();
    rebuildOrchestrator();

    res.json({
      success: true,
      message: `LLM configured: ${type} / ${model}`,
    });
  });

  // Set Agent config
  router.post("/config/agent", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
    const { maxIterations, systemPrompt, includeTrace } = req.body;
    configManager.setAgent({ maxIterations, systemPrompt, includeTrace });
    rebuildAllAgentLoops();
    rebuildOrchestrator();
    res.json({ success: true });
  });

  // Get multimodal config
  router.get("/config/multimodal", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (_req, res) => {
    const mm = configManager.getMultimodal();
    res.json({
      ...mm,
      apiKey: mm.apiKey ? "***" + mm.apiKey.slice(-4) : "",
      isConfigured: configManager.isMultimodalConfigured(),
    });
  });

  // Get all model card configs
  router.get("/config/model-cards", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (_req, res) => {
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
  router.post("/config/model-cards/:type", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
    const cardType = req.params.type as any;
    const validTypes = ["llm", "vision", "imageGen", "tts", "stt", "embedding"];
    if (!validTypes.includes(cardType)) {
      res.status(400).json({ success: false, error: `Invalid model card type: ${cardType}` });
      return;
    }
    const { type, apiKey, baseUrl, model, maxTokens, temperature, embeddingMode, apiMode, inheritFromLLM } = req.body;
    const existingCards = configManager.getModelCards();
    const existingCard = (existingCards as Record<string, any>)[cardType] ?? {};

    // 解析最终 apiKey/baseUrl:
    // - inheritFromLLM === true (非 LLM 卡): 清空, 让 getResolvedModelConfig 回退到 LLM 的配置
    // - apiKey 缺失 / "***xxx" 掩码: 保持原值 (用户没改)
    // - apiKey 为新字符串: 替换
    let resolvedApiKey: string;
    let resolvedBaseUrl: string | undefined;
    if (cardType !== "llm" && inheritFromLLM === true) {
      resolvedApiKey = "";
      resolvedBaseUrl = undefined;
    } else {
      if (apiKey === undefined || apiKey === null) {
        resolvedApiKey = existingCard.apiKey || "";
      } else if (typeof apiKey === "string" && apiKey.startsWith("***")) {
        resolvedApiKey = existingCard.apiKey || "";
      } else {
        resolvedApiKey = apiKey;
      }
      resolvedBaseUrl = baseUrl;
    }
    configManager.setModelCard(cardType, { type, apiKey: resolvedApiKey, baseUrl: resolvedBaseUrl, model, maxTokens, temperature, embeddingMode, apiMode });

    if (cardType === "llm" && type && resolvedApiKey && model) {
      configManager.setLLM({ type, apiKey: resolvedApiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 });
      const provider = createProvider({ type, apiKey: resolvedApiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 });
      setCurrentProvider(provider);
      sessionManager.setLLMProvider(provider); // 确保 sessionManager 有最新的 llmProvider
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
  router.post("/config/multimodal", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
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

  router.get("/config/federation", pm.requireAuth, pm.requireAdmin(), (_req, res) => {
    const cfg = configManager.getFederation();
    res.json({
      success: true,
      config: {
        ...cfg,
        federationKey: cfg.federationKey ? "***" + cfg.federationKey.slice(-4) : "",
      },
    });
  });

  router.post("/config/federation", pm.requireAuth, pm.requireAdmin(), (req, res) => {
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

  router.post("/config/federation/peers", pm.requireAuth, pm.requireAdmin(), (req, res) => {
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

  router.delete("/config/federation/peers", pm.requireAuth, pm.requireAdmin(), (req, res) => {
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

  router.get("/config/evolution-engine", pm.requireAuth, pm.requireAdmin(), (_req, res) => {
    const cfg = configManager.getEvolution();
    res.json({ success: true, config: cfg });
  });

  router.post("/config/evolution-engine", pm.requireAuth, pm.requireAdmin(), (req, res) => {
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

  // ===== Document Mind Config APIs =====

  router.get("/config/docmind", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (_req, res) => {
    const cfg = configManager.getDocMind();
    res.json({
      success: true,
      config: {
        ...cfg,
        accessKeyId: cfg.accessKeyId ? "***" + cfg.accessKeyId.slice(-4) : "",
        accessKeySecret: cfg.accessKeySecret ? "***" + cfg.accessKeySecret.slice(-4) : "",
      },
    });
  });

  router.post("/config/docmind", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
    const { enabled, accessKeyId, accessKeySecret, endpoint, regionId, multimediaMode, maxPollingMinutes, pollingIntervalSeconds } = req.body;

    const existing = configManager.getDocMind();
    const resolvedAccessKeyId = (!accessKeyId || accessKeyId.startsWith("***")) ? existing.accessKeyId : accessKeyId;
    const resolvedAccessKeySecret = (!accessKeySecret || accessKeySecret.startsWith("***")) ? existing.accessKeySecret : accessKeySecret;

    configManager.setDocMind({
      enabled: enabled ?? existing.enabled ?? false,
      accessKeyId: resolvedAccessKeyId || "",
      accessKeySecret: resolvedAccessKeySecret || "",
      endpoint: endpoint || existing.endpoint || "docmind-api.cn-hangzhou.aliyuncs.com",
      regionId: regionId || existing.regionId || "cn-hangzhou",
      multimediaMode: multimediaMode || existing.multimediaMode || "advance",
      maxPollingMinutes: maxPollingMinutes ?? existing.maxPollingMinutes ?? 30,
      pollingIntervalSeconds: pollingIntervalSeconds ?? existing.pollingIntervalSeconds ?? 3,
    });

    res.json({
      success: true,
      message: "Document Mind config saved",
      isConfigured: configManager.isDocMindConfigured(),
    });
  });

  // Full config
  router.get("/config/full", pm.requireAuth, pm.requireAdmin(), (_req, res) => {
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
  router.post("/llm/test", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), async (req, res) => {
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

  // Test Model Card connection (vision, imageGen, tts, stt, embedding)
  router.post("/config/model-cards/:type/test", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), async (req, res) => {
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

    // 拼完整 endpoint URL: baseUrl 可能是基础 URL (https://ark.cn-beijing.volces.com/api/v3)
    // 也可能已是完整 endpoint (https://api.openai.com/v1/chat/completions). 检测后智能拼接.
    // resolveEndpoint 已抽到 src/utils/endpoint-url.ts, 这里直接用.

    try {
      // 根据不同类型进行简单测试
      switch (cardType) {
        case "vision": {
          // Vision 模型测试 - 用 32x32 透明 PNG 当占位图
          // 之前发 content: "Hello" 纯文本被很多 vision provider (Doubao/Qwen) 拒绝 → 400
          // 改成 OpenAI vision 标准格式 (text + image_url data URL), 所有 provider 都接受
          // 1x1 PNG 不行, Doubao 要求最小 14x14, 用 32x32 留点 buffer
          const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAO8GECAAARlDNO4AAAAASUVORK5CYII=";
          const url = resolveEndpoint(config.baseUrl, "/chat/completions", "https://api.openai.com/v1");
          const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: "Hi" },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
                ],
              }],
              max_tokens: 10,
            }),
          });
          if (!response.ok) {
            const error = await response.text();
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
          // Image Gen 测试 - 尝试一个简单请求（不实际生成图片）
          const url = resolveEndpoint(config.baseUrl, "/images/generations", "https://api.openai.com/v1");
          const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              prompt: "test",
              n: 1,
              size: "1024x1024",
            }),
          });
          if (!response.ok) {
            const error = await response.text();
            if (response.status === 429 || response.status === 400) {
              res.json({
                success: true,
                model: config.model,
                message: "Image generation API accessible (quota or content policy may apply)",
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
          // TTS 测试 - 检查 API 可达性
          const url = resolveEndpoint(config.baseUrl, "/audio/speech", "https://api.openai.com/v1");
          const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              input: "Hello",
              voice: "alloy",
            }),
          });
          if (!response.ok) {
            const error = await response.text();
            if (response.status === 429) {
              res.json({
                success: true,
                model: config.model,
                message: "TTS API accessible (quota may apply)",
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
          // STT 测试 - 检查 API 可达性
          const url = resolveEndpoint(config.baseUrl, "/audio/transcriptions", "https://api.openai.com/v1");
          const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${config.apiKey}`,
            },
            body: new FormData(), // 空表单测试
          });
          // STT 会返回 400 因为缺少文件，但说明 API 可达
          if (response.status === 400) {
            res.json({
              success: true,
              model: config.model,
              message: "STT API accessible",
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
          // Embedding 测试
          const url = resolveEndpoint(config.baseUrl, "/embeddings", "https://api.openai.com/v1");
          const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              input: "Hello world",
            }),
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

  // Test Document Mind connection
  router.post("/config/docmind/test", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), async (req, res) => {
    const config = configManager.getDocMind();
    if (!config.enabled || !config.accessKeyId || !config.accessKeySecret) {
      res.status(400).json({ success: false, error: "Document Mind not configured" });
      return;
    }

    try {
      // 尝试调用 Document Mind API 的一个简单端点
      const endpoint = config.endpoint || "docmind-api.cn-hangzhou.aliyuncs.com";
      const url = `https://${endpoint}/?Action=GetDocParserResult&Version=2022-07-11`;

      // 尝试获取一个不存在的任务，验证凭证
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.accessKeyId}:${config.accessKeySecret}`,
        },
        body: JSON.stringify({ Id: "test" }),
      });

      // 即使返回 404 或 400，只要网络可达就算连接成功
      if (response.status === 404 || response.status === 400 || response.status === 200) {
        res.json({
          success: true,
          endpoint: config.endpoint,
          region: config.regionId,
          message: "Document Mind API accessible",
        });
        return;
      }

      const errorText = await response.text();
      res.status(400).json({
        success: false,
        error: `API returned ${response.status}: ${errorText}`,
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
