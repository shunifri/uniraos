import { Router } from "express";
import { requireAuth, requirePermission, requireAdmin } from "../db/auth-middleware.js";
import { getDb, isMySQL } from "../db/database.js";
import * as userRepo from "../db/user-repository.js";
import * as deptRepo from "../db/department-repository.js";
import * as resRepo from "../db/resource-repository.js";
import type { RouteDependencies } from "./index.js";

export function createAdminCompatRoutes(deps: RouteDependencies): Router {
  const {
    configManager,
    federationTransport,
    evolutionEngine,
    getCurrentProvider,
    createProvider,
    setCurrentProvider,
    rebuildAllAgentLoops,
    rebuildOrchestrator,
    rebuildMultimodalProvider,
  } = deps;

  const router = Router();

  // ===== Admin API 兼容路由 (/api/admin/*) =====

  // 用户管理兼容路由
  router.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    const users = await userRepo.listUsers();
    res.json({ success: true, users });
  });

  router.post("/admin/users", requireAuth, requireAdmin, async (req, res) => {
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

  router.put("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      await userRepo.updateUser(userId, req.body);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      await userRepo.deleteUser(userId);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 部门管理兼容路由
  router.get("/admin/departments", requireAuth, requireAdmin, async (_req, res) => {
    const departments = await deptRepo.listDepartments();
    res.json({ success: true, departments });
  });

  router.post("/admin/departments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const dept = await deptRepo.createDepartment(req.body);
      res.json({ success: true, department: dept });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/admin/departments/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const deptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      await deptRepo.deleteDepartment(deptId);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 角色管理兼容路由
  router.get("/admin/roles", requireAuth, requireAdmin, async (_req, res) => {
    const roles = await userRepo.listRoles();
    res.json({ success: true, roles });
  });

  router.post("/admin/roles", requireAuth, requireAdmin, async (req, res) => {
    try {
      const role = await userRepo.createRole(req.body);
      res.json({ success: true, role });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 资源管理兼容路由
  router.get("/admin/resources", requireAuth, requireAdmin, async (_req, res) => {
    const resources = await resRepo.listResources();
    res.json({ success: true, resources });
  });

  // PUT 兼容路由
  router.put("/config/llm", requireAuth, requirePermission("config.write"), (req, res) => {
    const { type, apiKey, baseUrl, model, maxTokens, temperature } = req.body;
    if (!type || !apiKey || !model) {
      res.status(400).json({ success: false, error: "type, apiKey, and model are required" });
      return;
    }
    const llmConfig = { type, apiKey, baseUrl, model, maxTokens: maxTokens ?? 4096, temperature: temperature ?? 0.7 };
    configManager.setLLM(llmConfig);
    setCurrentProvider(createProvider(llmConfig));
    rebuildAllAgentLoops();
    rebuildOrchestrator();
    res.json({ success: true, message: `LLM configured: ${type} / ${model}` });
  });

  router.put("/config/agent", requireAuth, requirePermission("config.write"), (req, res) => {
    const { maxIterations, systemPrompt, includeTrace } = req.body;
    configManager.setAgent({ maxIterations, systemPrompt, includeTrace });
    rebuildAllAgentLoops();
    rebuildOrchestrator();
    res.json({ success: true });
  });

  router.put("/config/multimodal", requireAuth, requirePermission("config.write"), (req, res) => {
    const { enabled, apiKey, baseUrl, imageModel, visionModel, ttsModel, whisperModel } = req.body;
    configManager.setMultimodal({ enabled, apiKey, baseUrl, imageModel, visionModel, ttsModel, whisperModel });
    rebuildMultimodalProvider();
    res.json({ success: true, message: "Multimodal config saved" });
  });

  router.put("/config/federation", requireAuth, requireAdmin, (req, res) => {
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

  // GET /api/config/evolution 兼容路由
  router.get("/config/evolution", requireAuth, (_req, res) => {
    res.json({ success: true, config: configManager.getEvolution() });
  });

  router.put("/config/evolution", requireAuth, requireAdmin, (req, res) => {
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

  // 测试 LLM 连接 (config 路径兼容)
  router.post("/config/llm/test", requireAuth, requirePermission("config.read"), async (_req, res) => {
    const llmProvider = getCurrentProvider();
    if (!llmProvider) {
      res.status(400).json({ success: false, error: "LLM not configured" });
      return;
    }

    try {
      const response = await llmProvider.chat([
        { role: "user", content: "Say hello in one sentence." },
      ]);
      res.json({
        success: true,
        response: response.content,
        model: llmProvider.model,
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
  router.post("/config/model-cards/:type/test", requireAuth, requirePermission("config.read"), async (req, res) => {
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

  return router;
}
