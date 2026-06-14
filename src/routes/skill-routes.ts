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
    req.setTimeout(300000); // 覆盖全局 30s 超时，允许长时 skill 执行
    // 仅记录非敏感元数据，req.body 可能包含文件内容/密码等敏感数据
    const { skillName } = req.body as { skillName: string; params?: Record<string, unknown> };
    console.log("[skill-routes] /execute START", { skillName, userId: req.user?.id });
    const { params } = req.body as {
      skillName: string;
      params?: Record<string, unknown>;
    };

    // 检查用户是否有该 skill 的执行权限（使用统一权限服务完整检查）
    const userId = req.user!.id;
    console.log("[skill-routes] checking permission for", skillName, "user:", userId);
    const canExecute = await permissions.hasSkillPermission(userId, skillName);
    console.log("[skill-routes] permission result:", canExecute);
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
      console.log("[skill-routes] executing skill:", skillName);
      const result = await requestContext.run(ctx, () => engine.execute(skillName, params ?? {}));
      console.log("[skill-routes] skill result:", result.success, "error?:", !!result.error);
      try {
        // Error 对象无法被 JSON 序列化，转换为字符串
        const response = {
          ...result,
          error: result.error instanceof Error ? (result.error as Error).message : result.error,
        };
        res.json(response);
        console.log("[skill-routes] res.json OK");
      } catch (jsonErr) {
        console.error("[skill-routes] Failed to serialize result for skill:", skillName, "error:", jsonErr instanceof Error ? jsonErr.message : jsonErr);
        res.status(500).json({
          success: false,
          error: "Result serialization failed",
          errorType: jsonErr instanceof Error ? jsonErr.constructor.name : "UnknownError",
        });
      }
    } catch (err) {
      console.error("[skill-routes] Caught error:", err);
      res.status(400).json({
        success: false,
        error: "Skill execution failed",
      });
    }
  });

  // Dynamic Skill registration
  router.post("/skills", pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_MANAGE), async (req, res) => {
    const { name, visible, autonomy, dependencies, timeout, description, paramSchema, handler } =
      req.body;

    try {
      // 安全：通过 Worker 沙箱执行自定义 handler，替代危险的 new Function
      let handlerFn: import("../types/index.js").SkillHandler;
      if (handler && typeof handler === "string") {
        const handlerCode = handler;
        handlerFn = async (params, context) => {
          const { runInSandbox } = await import("../engine/worker-sandbox.js");
          const { getGlobalExecutionEngine } = await import("../engine/execution-engine.js");
          const sandboxCtx = {
            callSkill: async (skillName: string, skillParams: Record<string, unknown>) => {
              const engine = getGlobalExecutionEngine();
              if (!engine) throw new Error("Execution engine not available");
              const result = await engine.execute(skillName, skillParams);
              if (!result.success) {
                throw new Error(result.error?.message || `Skill "${skillName}" 执行失败`);
              }
              return result.data;
            },
            user: context?.user,
          };
          const result = await runInSandbox(
            handlerCode,
            params as Record<string, unknown>,
            { timeout: timeout ?? 30000 },
            sandboxCtx
          );
          if (!result.success) {
            return { success: false, error: new Error(result.error ?? "Sandbox execution failed") };
          }
          return { success: true, data: result.data };
        };
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
  router.delete("/skills/:name", pm.requireAuth, async (req, res) => {
    try {
      const name = req.params.name as string;
      const skill = registry.lookup(name);
      if (!skill) {
        return res.status(404).json({ success: false, error: "Skill not found" });
      }
      // Allow deletion if user is admin OR user is the skill owner (system skills require admin)
      const userId = (req as any).user?.id;
      const isAdmin = await permissions.hasPermission(userId, permissions.constants.API.SKILLS_MANAGE);
      if (skill.isSystem && !isAdmin) {
        return res.status(403).json({ success: false, error: "系统 Skill 需要管理员权限才能删除" });
      }
      if (!isAdmin && skill.owner && skill.owner !== userId) {
        return res.status(403).json({ success: false, error: "无权删除此 Skill" });
      }
      registry.unregister(name);

      // 同时从数据库删除持久化记录
      const repo = getCustomSkillRepository();
      const effectiveOwnerId = skill.owner || userId;
      if (effectiveOwnerId) {
        await repo.deleteByName(name, effectiveOwnerId);
      }

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
