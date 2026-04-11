import { Router } from "express";
import { requireAuth, requirePermission } from "../db/auth-middleware.js";
import { Autonomy, defineSkill } from "../types/index.js";
import { skillsToTools } from "../llm/tool-bridge.js";
import { getUserPermissions } from "../db/user-repository.js";
import type { RouteDependencies } from "./index.js";

export function createSkillRoutes(deps: RouteDependencies): Router {
  const { registry, engine, wal, taskManager, pluginLoader, syncSkillsToResources } = deps;
  const router = Router();

  // List all Skills (filtered by user permissions for non-admin)
  router.get("/skills", requireAuth, requirePermission("skills.read"), (req, res) => {
    const userId = req.user!.id;
    const permissions = getUserPermissions(userId);
    const isAdmin = permissions.some(p => p === "users.manage" || p === "roles.manage");
    const allSkills = isAdmin ? registry.list() : registry.listByPermissions(permissions);
    const skills = allSkills.map((s) => ({
      name: s.name,
      visible: s.visible,
      autonomy: s.autonomy,
      dependencies: s.dependencies,
      timeout: s.timeout,
      retry: s.retry,
      description: s.description,
      paramSchema: s.paramSchema ?? null,
    }));
    res.json(skills);
  });

  // List visible Skills (filtered by user permissions)
  router.get("/skills/visible", requireAuth, requirePermission("skills.read"), (req, res) => {
    const userId = req.user!.id;
    const permissions = getUserPermissions(userId);
    const isAdmin = permissions.some(p => p === "users.manage" || p === "roles.manage");
    const allSkills = isAdmin ? registry.listVisible() : registry.listVisibleByPermissions(permissions);
    const skills = allSkills.map((s) => ({
      name: s.name,
      autonomy: s.autonomy,
      dependencies: s.dependencies,
      description: s.description,
    }));
    res.json(skills);
  });

  // Execute Skill (with per-skill permission check)
  router.post("/execute", requireAuth, requirePermission("skills.execute"), async (req, res) => {
    const { skillName, params } = req.body as {
      skillName: string;
      params?: Record<string, unknown>;
    };

    // 检查用户是否有该 skill 的执行权限
    const userId = req.user!.id;
    const permissions = getUserPermissions(userId);
    const isAdmin = permissions.some(p => p === "users.manage" || p === "roles.manage");
    if (!isAdmin && !permissions.includes(`skill:${skillName}.execute`)) {
      res.status(403).json({ success: false, error: `无权执行技能: ${skillName}` });
      return;
    }

    try {
      const result = await engine.execute(skillName, params ?? {});
      res.json(result);
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "UnknownError",
      });
    }
  });

  // Dynamic Skill registration
  router.post("/skills", requireAuth, requirePermission("skills.manage"), (req, res) => {
    const { name, visible, autonomy, dependencies, timeout, description } =
      req.body;

    try {
      registry.register(
        defineSkill({
          name,
          visible: visible ?? true,
          autonomy: autonomy ?? Autonomy.MANUAL,
          dependencies: dependencies ?? [],
          timeout: timeout ?? 30000,
          description: description ?? "",
          handler: async (params) => {
            return { success: true, data: { echo: params } };
          },
        }),
      );
      syncSkillsToResources();
      res.json({ success: true, message: `Skill "${name}" registered` });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Delete Skill
  router.delete("/skills/:name", requireAuth, requirePermission("skills.manage"), (req, res) => {
    try {
      registry.unregister(req.params.name as string);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Topological order
  router.get("/topology", requireAuth, requirePermission("skills.read"), (_req, res) => {
    try {
      const order = registry.getTopologicalOrder();
      res.json({ order });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // WAL status
  router.get("/wal", requireAuth, requirePermission("skills.read"), (_req, res) => {
    res.json({
      all: wal.getAll(),
      incomplete: wal.getIncomplete(),
      recovery: wal.recover(),
    });
  });

  // Execution history
  router.get("/history", requireAuth, requirePermission("skills.read"), (_req, res) => {
    res.json(engine.getHistory());
  });

  // Metrics
  router.get("/metrics", requireAuth, requirePermission("skills.read"), (_req, res) => {
    res.json({
      success: true,
      summary: engine.metrics.getSummary(),
      skills: engine.metrics.getAllMetrics(),
    });
  });

  router.get("/metrics/skill/:name", requireAuth, requirePermission("skills.read"), (req, res) => {
    const name = req.params.name as string;
    const metrics = engine.metrics.getMetrics(name);
    if (!metrics) {
      res.status(404).json({ success: false, error: "No metrics for this skill" });
      return;
    }
    res.json({ success: true, metrics });
  });

  // LLM Tools
  router.get("/llm/tools", requireAuth, requirePermission("skills.read"), (_req, res) => {
    const tools = skillsToTools(registry.list());
    res.json(tools);
  });

  // Async Task APIs
  router.get("/tasks", requireAuth, requirePermission("tasks.read"), (_req, res) => {
    const status = _req.query.status as string | undefined;
    const tasks = status
      ? taskManager.list({ status: status as import("../types/index.js").TaskStatus })
      : taskManager.list();
    res.json({ tasks, total: tasks.length });
  });

  router.get("/tasks/:taskId", requireAuth, requirePermission("tasks.read"), (req, res) => {
    const taskId = req.params.taskId as string;
    const task = taskManager.get(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(task);
  });

  router.post("/tasks/:taskId/cancel", requireAuth, requirePermission("tasks.read"), (req, res) => {
    const taskId = req.params.taskId as string;
    const task = taskManager.cancel(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ success: true, task });
  });

  router.post("/tasks/:taskId/wait", requireAuth, requirePermission("tasks.read"), async (req, res) => {
    const taskId = req.params.taskId as string;
    const timeoutMs = Number(req.body?.timeoutMs ?? 30000);
    try {
      const task = await taskManager.waitFor(taskId, timeoutMs);
      res.json({ success: true, task });
    } catch (err) {
      res.status(408).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Plugin APIs
  router.get("/plugins", requireAuth, requirePermission("plugins.manage"), (_req, res) => {
    res.json({ plugins: pluginLoader.getLoaded() });
  });

  router.post("/plugins/reload", requireAuth, requirePermission("plugins.manage"), async (req, res) => {
    const { name } = req.body as { name?: string };
    if (name) {
      try {
        const plugin = await pluginLoader.reloadPlugin(name);
        if (plugin) {
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

  // WAL recovery APIs
  router.get("/wal/status", requireAuth, (req, res) => {
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

  router.post("/wal/replay", requireAuth, async (req, res) => {
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

  router.post("/wal/compact", requireAuth, (req, res) => {
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

  // Models
  router.get("/models", requireAuth, requirePermission("config.read"), (_req, res) => {
    res.json({
      success: true,
      models: deps.modelRouter.getModels().map((m) => ({
        name: m.name,
        model: m.provider.model,
        capabilities: m.capabilities,
        costPer1kTokens: m.costPer1kTokens,
        contextWindow: m.contextWindow,
      })),
    });
  });

  // Prompts
  router.get("/prompts", requireAuth, requirePermission("config.read"), (_req, res) => {
    res.json({ success: true, templates: deps.promptManager.list() });
  });

  router.post("/prompts", requireAuth, requirePermission("config.write"), (req, res) => {
    try {
      const pt = deps.promptManager.register(req.body.name, req.body.template, {
        description: req.body.description,
        version: req.body.version,
      });
      res.json({ success: true, template: pt });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post("/prompts/render", requireAuth, requirePermission("config.read"), (req, res) => {
    try {
      const rendered = deps.promptManager.render(req.body.name, req.body.variables || {});
      res.json({ success: true, rendered });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete("/prompts/:name", requireAuth, requirePermission("config.write"), (req, res) => {
    deps.promptManager.delete(req.params.name as string);
    res.json({ success: true });
  });

  return router;
}
