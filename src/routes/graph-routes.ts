import { Router } from "express";
import { permissions } from "../permissions/index.js";
import type { RouteDependencies } from "./index.js";

// 创建权限中间件实例
const pm = permissions.createMiddleware(permissions.service);

export function createGraphRoutes(deps: RouteDependencies): Router {
  const router = Router();
  const { sessionManager } = deps;

  function getGraphManager(req: any) {
    const userId = req.user?.id ?? "default";
    const session = sessionManager.getOrCreate(userId);
    return session.graphManager;
  }

  // GET /api/graph/data — full graph for visualization
  router.get("/graph/data", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const gm = getGraphManager(req);
    if (!gm) { res.json({ nodes: [], edges: [] }); return; }
    const store = await gm.getStore();
    const [nodes, edges] = await Promise.all([
      store.getAllNodes(),
      store.getAllEdges(),
    ]);
    res.json({ nodes, edges });
  });

  // GET /api/graph/stats
  router.get("/graph/stats", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const gm = getGraphManager(req);
    if (!gm) { res.json({ nodeCount: 0, edgeCount: 0 }); return; }
    res.json(await gm.getStats());
  });

  // POST /api/graph/query
  router.post("/graph/query", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const gm = getGraphManager(req);
    if (!gm) { res.json({ nodes: [], edges: [], seedNodes: [] }); return; }
    const { query, maxDepth, maxNodes } = req.body;
    const result = await gm.querySubgraph(query ?? "", { maxDepth, maxNodes });
    res.json(result);
  });

  // POST /api/graph/sync — sync from LTM
  router.post("/graph/sync", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const userId = (req as any).user?.id ?? "default";
    const session = sessionManager.getOrCreate(userId);
    const gm = session.graphManager;
    if (!gm) { res.status(400).json({ error: "Graph not available" }); return; }
    const entries = await session.ltm.list();
    const result = await gm.syncFromLTM(entries.map((e: any) => ({
      id: e.id, key: e.key, value: e.value, tags: e.tags ?? [],
    })));
    res.json(result);
  });

  // POST /api/graph/clear — clear entire graph
  router.post("/graph/clear", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_WRITE), async (req, res) => {
    const userId = (req as any).user?.id ?? "default";
    const session = sessionManager.getOrCreate(userId);
    const gm = session.graphManager;
    if (!gm) { res.status(400).json({ error: "Graph not available" }); return; }
    const result = await gm.clearGraph();
    res.json(result);
  });

  // POST /api/graph/communities
  router.post("/graph/communities", pm.requireAuth, pm.requirePermission(permissions.constants.API.MEMORY_READ), async (req, res) => {
    const gm = getGraphManager(req);
    if (!gm) { res.json({ communities: [], stats: { count: 0, avgSize: 0 } }); return; }
    const result = await gm.getCommunities();
    const commList = [...result.communities.entries()].map(([id, nodes]: [number, string[]]) => ({
      id, size: nodes.length, nodes: nodes.slice(0, 20),
    }));
    res.json({ communities: commList, stats: result.stats });
  });

  return router;
}
