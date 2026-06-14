import { Router } from "express";
import express from "express";
import { requireAuth, requireAdmin, requirePermission } from "../permissions/middleware/auth-middleware.js";
import { defineSkill } from "../types/index.js";
import { createSkillFromApproval, type ApprovalData } from "../skills/meta-skills.js";
import type { RouteDependencies } from "./types.js";

export function createEvolutionRoutes(deps: RouteDependencies): Router {
  const {
    registry,
    engine,
    evolutionController,
    emergenceDetector,
    lifecycleManager,
    marketplace,
    federationTransport,
    federationManager,
    migrationManager,
    evolutionEngine,
    instanceId,
  } = deps;
  const router = Router();

  // ===== Evolution Control APIs =====

  router.get("/evolution/config", requireAuth, requireAdmin, (_req, res) => {
    res.json({ success: true, config: evolutionController.getConfig() });
  });

  router.post("/evolution/config", requireAuth, requireAdmin, (req, res) => {
    const allowed = ["maxGenerationDepth", "maxGenerationsPerHour", "requireHumanApproval", "forbiddenPrefixes", "forbiddenCapabilities"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    evolutionController.updateConfig(updates as any);
    res.json({ success: true, config: evolutionController.getConfig() });
  });

  router.get("/evolution/history", requireAuth, requireAdmin, (_req, res) => {
    res.json({
      success: true,
      history: evolutionController.getGenerationHistory(),
    });
  });

  router.get("/evolution/pending", requireAuth, requireAdmin, (_req, res) => {
    res.json({
      success: true,
      pending: evolutionController.getPendingApprovals(),
    });
  });

  // 审批路由已合并至 /evolution/approvals/:id/approve（使用 runInSandbox 安全沙箱）

  router.post("/evolution/reject/:id", requireAuth, requireAdmin, async (req, res) => {
    const success = await evolutionController.reject(req.params.id as string, req.body.reason || "Rejected");
    if (!success) {
      res.status(404).json({ success: false, error: "Approval not found" });
      return;
    }
    res.json({ success: true });
  });

  // ===== Skill Marketplace APIs =====

  router.get("/marketplace", requireAuth, requirePermission("skills.read"), (req, res) => {
    const query = req.query.q as string | undefined;
    res.json({ success: true, packages: marketplace.search(query), stats: marketplace.stats() });
  });

  router.post("/marketplace/export/:name", requireAuth, requireAdmin, (req, res) => {
    const pkg = marketplace.exportSkill(req.params.name as string, {
      author: req.body.author,
      source: req.body.source,
    });
    if (!pkg) {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    res.json({ success: true, package: pkg });
  });

  router.post("/marketplace/import", requireAuth, requireAdmin, (req, res) => {
    const result = marketplace.importSkill(req.body);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  router.post("/marketplace/publish", requireAuth, requireAdmin, (req, res) => {
    marketplace.publish(req.body);
    res.json({ success: true });
  });

  // ===== Skill Lifecycle APIs =====

  router.get("/lifecycle", requireAuth, requireAdmin, (req, res) => {
    let skills = lifecycleManager.getAll();
    if (req.query.status) {
      skills = skills.filter((s) => s.state === req.query.status);
    }
    res.json({ success: true, skills });
  });

  router.post("/lifecycle/canary", requireAuth, requireAdmin, (req, res) => {
    const { name, oldVersion, newVersion, trafficPercent, promoteThreshold, rollbackThreshold, minCalls } = req.body;
    lifecycleManager.startCanary(name, oldVersion, newVersion, {
      trafficPercent, promoteThreshold, rollbackThreshold, minCalls,
    });
    res.json({ success: true, info: lifecycleManager.getInfo(name) });
  });

  // POST /api/lifecycle/canary/:name — Enable canary for a skill (frontend compatible)
  router.post("/lifecycle/canary/:name", requireAuth, requireAdmin, (req, res) => {
    const name = req.params.name as string;
    const skill = registry.lookup(name);
    if (!skill) {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    lifecycleManager.startCanary(name, skill.version ?? "1.0.0", (skill.version ?? "1.0.0") + "-canary", {
      trafficPercent: 10, promoteThreshold: 0.95, rollbackThreshold: 0.5, minCalls: 100,
    });
    res.json({ success: true, info: lifecycleManager.getInfo(name) });
  });

  router.post("/lifecycle/evaluate/:name", requireAuth, requireAdmin, (req, res) => {
    const name = req.params.name as string;
    const result = lifecycleManager.evaluateCanary(name);
    if (result === "promote") lifecycleManager.promoteCanary(name);
    if (result === "rollback") lifecycleManager.rollbackCanary(name);
    res.json({ success: true, decision: result, info: lifecycleManager.getInfo(name) });
  });

  router.post("/lifecycle/deprecate/:name", requireAuth, requireAdmin, (req, res) => {
    lifecycleManager.deprecate(req.params.name as string);
    res.json({ success: true });
  });

  router.post("/lifecycle/retire-inactive", requireAuth, requireAdmin, (req, res) => {
    const maxInactiveMs = (req.body.maxInactiveDays ?? 30) * 86400000;
    const retired = lifecycleManager.retireInactive(maxInactiveMs);
    res.json({ success: true, retired });
  });

  // ===== Evolution APIs =====

  router.get("/evolution/genealogy", requireAuth, requirePermission("config.read"), (req, res) => {
    const action = (req.query.action as string) || "tree";
    const name = req.query.name as string | undefined;

    switch (action) {
      case "ancestry":
        if (!name) { res.status(400).json({ error: "name required" }); return; }
        res.json({ success: true, ancestry: evolutionController.getAncestry(name) });
        break;
      case "descendants":
        if (!name) { res.status(400).json({ error: "name required" }); return; }
        res.json({ success: true, descendants: evolutionController.getDescendants(name) });
        break;
      case "siblings":
        if (!name) { res.status(400).json({ error: "name required" }); return; }
        res.json({ success: true, siblings: evolutionController.getSiblings(name) });
        break;
      case "stats":
        res.json({ success: true, stats: evolutionController.getGenealogyStats() });
        break;
      default:
        res.json({ success: true, tree: evolutionController.getGenealogyTree() });
    }
  });

  router.get("/evolution/emergence", requireAuth, requirePermission("config.read"), (req, res) => {
    const since = req.query.since ? Number(req.query.since) : undefined;
    const severity = req.query.severity as string | undefined;
    const type = req.query.type as string | undefined;

    if (req.query.report === "true") {
      res.json({ success: true, report: emergenceDetector.getReport() });
    } else {
      res.json({ success: true, patterns: emergenceDetector.getPatterns({ since, severity, type }) });
    }
  });

  router.get("/evolution/red-lines", requireAuth, requirePermission("config.read"), (_req, res) => {
    res.json({
      success: true,
      redLines: evolutionController.getRedLines().map((r) => ({
        id: r.id,
        description: r.description,
        blocking: r.blocking,
      })),
      violations: evolutionController.getViolations(),
    });
  });

  router.post("/evolution/red-lines", requireAuth, requirePermission("config.write"), (req, res) => {
    const { action, id, description, blocking } = req.body as {
      action: "add" | "remove";
      id: string;
      description?: string;
      blocking?: boolean;
    };

    if (action === "remove") {
      const removed = evolutionController.removeRedLine(id);
      res.json({ success: true, removed });
    } else if (action === "add") {
      if (!id || !description) {
        res.status(400).json({ success: false, error: "id and description required" });
        return;
      }
      evolutionController.addRedLine({
        id,
        description,
        blocking: blocking ?? true,
        check: (ctx) => {
          // Custom red lines can match by skill name pattern in the description
          // Description format: "block:pattern" will block skills matching the pattern
          if (description.startsWith("block:")) {
            const pattern = description.slice(6).trim();
            if (ctx.skillName.includes(pattern)) {
              return `Custom red line "${id}": skill "${ctx.skillName}" matches blocked pattern "${pattern}"`;
            }
          }
          return null;
        },
      });
      res.json({ success: true, added: id });
    } else {
      res.status(400).json({ success: false, error: "action must be 'add' or 'remove'" });
    }
  });

  // ===== Approval Workflow API Endpoints =====

  // GET /api/evolution/approvals — List approvals by status (pending | approved | rejected)
  router.get("/evolution/approvals", requireAuth, requireAdmin, async (req, res) => {
    const status = (req.query.status as string) || "pending";
    const approvals = await evolutionController.getApprovalsByStatus(status);
    res.json({ approvals, status });
  });

  // POST /api/evolution/approvals/:id/approve
  // 兼容旧路径 /evolution/approve/:id
  router.post("/evolution/approve/:id", requireAuth, requireAdmin, async (req, res) => {
    const approval = await evolutionController.approve(req.params.id as string);
    if (!approval) {
      res.status(404).json({ success: false, error: "Approval not found or already processed" });
      return;
    }
    try {
      const skill = await createSkillFromApproval(approval as ApprovalData, engine);
      if (!registry.lookup(approval.name)) {
        registry.register(skill);
      }
      await evolutionController.recordGeneration(approval.name, approval.generatedBy);
      res.json({ success: true, name: approval.name });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  router.post("/evolution/approvals/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    const approval = await evolutionController.approve(req.params.id as string);
    if (!approval) {
      res.status(404).json({ error: "Approval not found or already processed" });
      return;
    }
    try {
      const skill = await createSkillFromApproval(approval as ApprovalData, engine);
      if (!registry.lookup(approval.name)) {
        registry.register(skill);
      }
      await evolutionController.recordGeneration(approval.name, approval.generatedBy);
      res.json({ approved: true, skillName: approval.name });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? (err as Error).message : String(err) });
    }
  });

  // POST /api/evolution/approvals/:id/reject
  router.post("/evolution/approvals/:id/reject", requireAuth, requireAdmin, async (req, res) => {
    const reason = req.body?.reason ?? "Rejected by admin";
    const success = await evolutionController.reject(req.params.id as string, reason);
    if (!success) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    res.json({ rejected: true, reason });
  });

  // GET /api/evolution/status — Get evolution engine status (alias)
  router.get("/evolution/status", requireAuth, requireAdmin, (req, res) => {
    res.json({
      running: evolutionEngine.getStatus().running ?? false,
      cycles: evolutionEngine.getStatus().cycleCount ?? 0,
      pending: evolutionEngine.getPendingActions().length,
      executed: evolutionEngine.getExecutedActions().length,
    });
  });

  // POST /api/evolution/start — Start evolution engine
  router.post("/evolution/start", requireAuth, requireAdmin, (req, res) => {
    evolutionEngine.start();
    res.json({ success: true, message: "Evolution engine started" });
  });

  // POST /api/evolution/stop — Stop evolution engine
  router.post("/evolution/stop", requireAuth, requireAdmin, (req, res) => {
    evolutionEngine.stop();
    res.json({ success: true, message: "Evolution engine stopped" });
  });

  // GET /api/evolution/engine/status
  router.get("/evolution/engine/status", requireAuth, requireAdmin, (req, res) => {
    res.json(evolutionEngine.getStatus());
  });

  // POST /api/evolution/engine/cycle — Manual trigger
  router.post("/evolution/engine/cycle", requireAuth, requireAdmin, async (req, res) => {
    const result = await evolutionEngine.runCycle();
    res.json({ actions: result.actions.length, executed: result.executed.length, details: result });
  });

  // GET /api/evolution/engine/actions
  router.get("/evolution/engine/actions", requireAuth, requireAdmin, (req, res) => {
    res.json({ pending: evolutionEngine.getPendingActions(), executed: evolutionEngine.getExecutedActions() });
  });

  // ===== Federation API endpoints =====

  // POST /api/federation/join — Join federation network
  router.post("/federation/join", requireAuth, requireAdmin, (req, res) => {
    federationManager.start();
    res.json({ success: true, message: "Joined federation" });
  });

  // POST /api/federation/leave — Leave federation network
  router.post("/federation/leave", requireAuth, requireAdmin, (req, res) => {
    federationManager.stop();
    res.json({ success: true, message: "Left federation" });
  });

  // POST /api/federation/sync — dedicated sync endpoint (called by the frontend)
  router.post("/federation/sync", requireAuth, async (_req, res) => {
    try {
      const result = await federationTransport.handleRequest("sync", {}, "local");
      res.json({ success: true, ...(result as Record<string, unknown>) });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/federation/:action", requireAuth, requireAdmin, express.json(), async (req, res) => {
    try {
      const action = Array.isArray(req.params.action) ? req.params.action[0] : req.params.action;
      const rawFrom = req.headers["x-raos-instance"];
      const from = (typeof rawFrom === "string" ? rawFrom : Array.isArray(rawFrom) ? rawFrom[0] : "unknown") ?? "unknown";
      const result = await federationTransport.handleRequest(action, req.body, from);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/federation/status", requireAuth, requireAdmin, (_req, res) => {
    res.json({
      instanceId,
      evolution: evolutionEngine.getStatus(),
      federation: {
        peers: federationManager.getRemoteSnapshots().size,
        recommendations: federationManager.getRecommendations().length,
      },
      migration: {
        historyCount: migrationManager.getHistory().length,
      },
    });
  });

  // GET /api/federation/peers — List all peers
  router.get("/federation/peers", requireAuth, requireAdmin, (_req, res) => {
    const peers = (federationTransport as any).getPeers?.() ?? [];
    res.json(peers.map((p: any) => ({
      instanceId: p.instanceId,
      endpoint: p.endpoint,
      version: p.version || "1.0.0",
      skillCount: p.skillCount || 0,
      lastHeartbeat: p.lastHeartbeat || new Date().toISOString(),
      status: p.status || "online",
    })));
  });

  // POST /api/federation/peers — Add a peer
  router.post("/federation/peers", requireAuth, requireAdmin, (req, res) => {
    const { instanceId: peerId, endpoint } = req.body;
    if (!peerId || !endpoint) {
      res.status(400).json({ error: "instanceId and endpoint required" });
      return;
    }
    (federationTransport as any).addPeer?.({ instanceId: peerId, endpoint, version: "1.0.0" });
    res.json({ success: true });
  });

  // DELETE /api/federation/peers/:id — Remove a peer
  router.delete("/federation/peers/:id", requireAuth, requireAdmin, (req, res) => {
    const peerId = req.params.id;
    (federationTransport as any).removePeer?.(peerId);
    res.json({ success: true });
  });

  // GET /api/federation/recommendations — List recommendations
  router.get("/federation/recommendations", requireAuth, requireAdmin, (_req, res) => {
    const recommendations = federationManager.getRecommendations();
    res.json(recommendations.map((r: any) => ({
      id: `${r.sourceInstance}-${r.skillName}`,
      type: r.action,
      skillName: r.skillName,
      sourceInstance: r.sourceInstance,
      confidence: r.confidence,
      reason: r.reason,
    })));
  });

  // POST /api/federation/accept-recommendation/:id — Accept a recommendation
  router.post("/federation/accept-recommendation/:id", requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id;
    const recommendations = federationManager.getRecommendations();
    const rec = recommendations.find((r: any) => `${r.sourceInstance}-${r.skillName}` === id);
    if (!rec) {
      res.status(404).json({ error: "Recommendation not found" });
      return;
    }
    const result = await federationManager.acceptRecommendation(rec.skillName);
    res.json(result);
  });

  // POST /api/federation/ignore-recommendation/:id — Ignore a recommendation
  router.post("/federation/ignore-recommendation/:id", requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id;
    // Remove from recommendations list (not implemented in manager, just return success)
    res.json({ success: true });
  });

  // GET /api/federation/migrations — List migration history
  router.get("/federation/migrations", requireAuth, requireAdmin, (_req, res) => {
    const history = migrationManager.getHistory();
    res.json(history.map((h: any, index: number) => ({
      id: `${h.skillName}-${index}`,
      skillName: h.skillName,
      sourceInstance: h.sourceInstance,
      targetInstance: h.targetInstance,
      status: h.success ? "success" : "failed",
    })));
  });

  // GET /api/federation/metrics — Get metrics comparison
  router.get("/federation/metrics", requireAuth, requireAdmin, (_req, res) => {
    const localSkills = registry.list().map((s) => {
      const m = (federationManager as any).metrics?.getMetrics(s.name);
      return {
        skillName: s.name,
        localSuccessRate: m?.successRate ?? 0,
        remotePeers: [] as any[],
        bestSource: "local",
      };
    });
    res.json(localSkills);
  });

  return router;
}
