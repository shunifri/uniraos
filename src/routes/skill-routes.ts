import { Router } from "express";
import { permissions } from "../permissions/index.js";
import { Autonomy, defineSkill } from "../types/index.js";
import { skillsToTools } from "../llm/tool-bridge.js";
import { getCustomSkillRepository } from "../db/custom-skill-repository.js";
import { requestContext } from "../user/request-context.js";
import type { RouteDependencies } from "./types.js";

export function createSkillRoutes(deps: RouteDependencies): Router {
  const { registry, engine, wal, taskManager, pluginLoader, syncSkillsToResources } = deps;
  const router = Router();

  // 创建权限中间件实例 - 延迟到函数内部创建
  const pm = permissions.createMiddleware(permissions.service);

  // List all Skills (filtered by user permissions for non-admin)
  router.get("/skills", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), async (req, res) => {
    const userId = req.user!.id;
    const result = await permissions.getAccessibleSkills(userId);
    const skills = result.skills.map((s) => ({
      name: s.name,
      visible: s.visible,
      autonomy: s.autonomy,
      dependencies: s.dependencies,
      timeout: s.timeout,
      retry: s.retry,
      description: s.description,
      paramSchema: s.paramSchema ?? null,
      owner: s.owner,
      isSystem: s.isSystem ?? false,
      source: s.isSystem
        ? "system"
        : (result.sourceMap.get(s.name) === "shared"
            ? "shared"
            : (s.owner === userId
                ? "own"
                : (result.sourceMap.get(s.name) || "role"))),
    }));
    res.json(skills);
  });

  // List visible Skills (filtered by user permissions)
  router.get("/skills/visible", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), async (req, res) => {
    const userId = req.user!.id;
    const result = await permissions.getAccessibleSkills(userId, { visibleOnly: true });
    const skills = result.skills.map((s) => ({
      name: s.name,
      autonomy: s.autonomy,
      dependencies: s.dependencies,
      description: s.description,
    }));
    res.json(skills);
  });

  // Execute Skill (with per-skill permission check)
  router.post("/execute", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_EXECUTE), async (req, res) => {
    const { skillName, params } = req.body as {
      skillName: string;
      params?: Record<string, unknown>;
    };

    // 检查用户是否有该 skill 的执行权限（使用统一权限服务完整检查）
    const userId = req.user!.id;
    const canExecute = await permissions.hasSkillPermission(userId, skillName);
    if (!canExecute) {
      res.status(403).json({ success: false, error: `无权执行技能: ${skillName}` });
      return;
    }

    try {
      // 注入请求上下文，确保 skill handler 中的 getCurrentUserId() 能获取正确用户
      const ctx = {
        userId: req.user!.id || "default",
        userName: req.user!.username,
        userDisplayName: req.user!.displayName,
        departmentId: (req.user as any)?.departmentId,
        requestId: req.headers["x-request-id"] as string | undefined,
      };
      const result = await requestContext.run(ctx, () => engine.execute(skillName, params ?? {}));
      try {
        res.json(result);
      } catch (jsonErr) {
        console.error("[skill-routes] Failed to serialize result:", jsonErr, "result keys:", Object.keys(result));
        res.status(500).json({
          success: false,
          error: "Result serialization failed",
          errorType: jsonErr instanceof Error ? jsonErr.constructor.name : "UnknownError",
        });
      }
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? (err as Error).message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "UnknownError",
      });
    }
  });

  // Dynamic Skill registration
  router.post("/skills", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_MANAGE), async (req, res) => {
    const { name, visible, autonomy, dependencies, timeout, description, paramSchema, handler } =
      req.body;

    try {
      // 将 handler 代码字符串恢复为可执行函数
      let handlerFn: import("../types/index.js").SkillHandler;
      if (handler && typeof handler === "string") {
        try {
          const fn = new Function("return " + handler)();
          if (typeof fn === "function") {
            handlerFn = fn as import("../types/index.js").SkillHandler;
          } else {
            handlerFn = async (params) => ({ success: true, data: { echo: params } });
          }
        } catch {
          handlerFn = async (params) => ({ success: true, data: { echo: params } });
        }
      } else {
        handlerFn = async (params) => ({ success: true, data: { echo: params } });
      }

      const skill = defineSkill({
        name,
        visible: visible ?? true,
        autonomy: autonomy ?? Autonomy.MANUAL,
        dependencies: dependencies ?? [],
        timeout: timeout ?? 30000,
        description: description ?? "",
        owner: req.user!.id,
        paramSchema: paramSchema ?? undefined,
        handler: handlerFn,
      });
      registry.register(skill);

      // 持久化到数据库（同时保存 handler 原始代码字符串以便重建）
      const repo = getCustomSkillRepository();
      await repo.create(skill, req.user!.id, typeof handler === "string" ? handler : undefined);

      syncSkillsToResources();
      res.json({ success: true, message: `Skill "${name}" registered` });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? (err as Error).message : String(err),
      });
    }
  });

  // Delete Skill
  router.delete("/skills/:name", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_MANAGE), (req, res) => {
    try {
      registry.unregister(req.params.name as string);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? (err as Error).message : String(err),
      });
    }
  });

  // Topological order
  router.get("/topology", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), (_req, res) => {
    try {
      const order = registry.getTopologicalOrder();
      res.json({ order });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? (err as Error).message : String(err),
      });
    }
  });

  // WAL status
  router.get("/wal", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), (_req, res) => {
    res.json({
      all: wal.getAll(),
      incomplete: wal.getIncomplete(),
      recovery: wal.recover(),
    });
  });

  // Execution history
  router.get("/history", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), (_req, res) => {
    res.json(engine.getHistory());
  });

  // Metrics
  router.get("/metrics", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), (_req, res) => {
    res.json({
      success: true,
      summary: engine.metrics.getSummary(),
      skills: engine.metrics.getAllMetrics(),
    });
  });

  router.get("/metrics/skill/:name", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), (req, res) => {
    const name = req.params.name as string;
    const metrics = engine.metrics.getMetrics(name);
    if (!metrics) {
      res.status(404).json({ success: false, error: "No metrics for this skill" });
      return;
    }
    res.json({ success: true, metrics });
  });

  // LLM Tools（按用户权限过滤）
  router.get("/llm/tools", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), async (req, res) => {
    const userId = req.user!.id;
    const accessible = await permissions.getAccessibleSkills(userId);
    const tools = skillsToTools(accessible.skills);
    res.json(tools);
  });

  // Async Task APIs
  router.get("/tasks", pm.requireAuth, pm.requirePermission(permissions.constants.API.TASKS_READ), (_req, res) => {
    const status = _req.query.status as string | undefined;
    const tasks = status
      ? taskManager.list({ status: status as import("../types/index.js").TaskStatus })
      : taskManager.list();
    res.json({ tasks, total: tasks.length });
  });

  router.get("/tasks/:taskId", pm.requireAuth, pm.requirePermission(permissions.constants.API.TASKS_READ), (req, res) => {
    const taskId = req.params.taskId as string;
    const task = taskManager.get(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(task);
  });

  router.post("/tasks/:taskId/cancel", pm.requireAuth, pm.requirePermission(permissions.constants.API.TASKS_READ), (req, res) => {
    const taskId = req.params.taskId as string;
    const task = taskManager.cancel(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ success: true, task });
  });

  router.post("/tasks/:taskId/wait", pm.requireAuth, pm.requirePermission(permissions.constants.API.TASKS_READ), async (req, res) => {
    const taskId = req.params.taskId as string;
    const timeoutMs = Number(req.body?.timeoutMs ?? 30000);
    try {
      const task = await taskManager.waitFor(taskId, timeoutMs);
      res.json({ success: true, task });
    } catch (err) {
      res.status(408).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  // Plugin APIs
  router.get("/plugins", pm.requireAuth, pm.requirePermission(permissions.constants.API.PLUGINS_MANAGE), (_req, res) => {
    res.json({ plugins: pluginLoader.getLoaded() });
  });

  router.post("/plugins/reload", pm.requireAuth, pm.requirePermission(permissions.constants.API.PLUGINS_MANAGE), async (req, res) => {
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
        res.status(400).json({ success: false, error: err instanceof Error ? (err as Error).message : String(err) });
      }
    } else {
      const result = await pluginLoader.loadAll();
      syncSkillsToResources();
      res.json({ success: true, ...result });
    }
  });

  // WAL recovery APIs
  router.get("/wal/status", pm.requireAuth, pm.requirePermission(permissions.constants.API.SYSTEM_MANAGE), (req, res) => {
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

  router.post("/wal/replay", pm.requireAuth, pm.requirePermission(permissions.constants.API.SYSTEM_MANAGE), async (req, res) => {
    try {
      const result = await wal.replay(engine);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? (err as Error).message : String(err),
      });
    }
  });

  router.post("/wal/compact", pm.requireAuth, pm.requirePermission(permissions.constants.API.SYSTEM_MANAGE), (req, res) => {
    try {
      wal.compact();
      res.json({ success: true, message: "WAL compacted" });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? (err as Error).message : String(err),
      });
    }
  });

  // Models
  router.get("/models", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (_req, res) => {
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
  router.get("/prompts", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (_req, res) => {
    res.json({ success: true, templates: deps.promptManager.list() });
  });

  router.post("/prompts", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
    try {
      const pt = deps.promptManager.register(req.body.name, req.body.template, {
        description: req.body.description,
        version: req.body.version,
      });
      res.json({ success: true, template: pt });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/prompts/render", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_READ), (req, res) => {
    try {
      const rendered = deps.promptManager.render(req.body.name, req.body.variables || {});
      res.json({ success: true, rendered });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  router.delete("/prompts/:name", pm.requireAuth, pm.requirePermission(permissions.constants.API.CONFIG_WRITE), (req, res) => {
    deps.promptManager.delete(req.params.name as string);
    res.json({ success: true });
  });

  return router;
}
