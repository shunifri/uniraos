import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { extractSubgraph, findShortestPath } from "../../../src/memory/knowledge-graph/bfs-extractor.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";

const TEST_OWNER = "bfs_test_owner";

describe.sequential("BFS Extractor", () => {
  let store: GraphStore;
  let ids: Record<string, string>;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "bfs_test_user", "test_hash", 1]
      );
    } catch (err: any) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
  });

  beforeEach(async () => {
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();

    const nodeA = await store.addNode({ id: "A", label: "Alpha", type: "concept", tags: ["start"], properties: {}, createdAt: Date.now() });
    const nodeB = await store.addNode({ id: "B", label: "Beta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeC = await store.addNode({ id: "C", label: "Gamma", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeD = await store.addNode({ id: "D", label: "Delta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeE = await store.addNode({ id: "E", label: "Epsilon", type: "concept", tags: ["start"], properties: {}, createdAt: Date.now() });
    const nodeF = await store.addNode({ id: "F", label: "Zeta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeG = await store.addNode({ id: "G", label: "Eta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });

    ids = { A: nodeA.id, B: nodeB.id, C: nodeC.id, D: nodeD.id, E: nodeE.id, F: nodeF.id, G: nodeG.id };

    await store.addEdge(ids.A, ids.B, "EXTRACTED", "related");
    await store.addEdge(ids.B, ids.C, "EXTRACTED", "related");
    await store.addEdge(ids.C, ids.D, "EXTRACTED", "related");
    await store.addEdge(ids.A, ids.E, "EXTRACTED", "related");
    await store.addEdge(ids.E, ids.F, "EXTRACTED", "related");
    await store.addEdge(ids.F, ids.G, "EXTRACTED", "related");
  });

  afterEach(async () => {
    try { await store.clearGraph(); } catch { /* ignore */ }
  });

  describe("extractSubgraph", () => {
    it("returns seed node A and its neighbors with default depth", async () => {
      const result = await extractSubgraph(store, "Alpha");
      const nodeIds = result.nodes.map(n => n.id);
      expect(result.seedNodes).toContain(ids.A);
      expect(nodeIds).toContain(ids.A);
      expect(nodeIds).toContain(ids.B);
      expect(nodeIds).toContain(ids.E);
    });

    it("limits traversal depth with maxDepth=1", async () => {
      const result = await extractSubgraph(store, "Alpha", { maxDepth: 1 });
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds).toContain(ids.A);
      expect(nodeIds).toContain(ids.B);
      expect(nodeIds).toContain(ids.E);
      expect(nodeIds).not.toContain(ids.C);
      expect(nodeIds).not.toContain(ids.F);
    });

    it("caps results with maxNodes=3", async () => {
      const result = await extractSubgraph(store, "Alpha", { maxNodes: 3 });
      expect(result.nodes.length).toBeLessThanOrEqual(3);
    });

    it("returns empty result for non-matching query", async () => {
      const result = await extractSubgraph(store, "zzz");
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.seedNodes).toHaveLength(0);
    });

    it("multi-term query scores nodes by label and tag matches", async () => {
      const result = await extractSubgraph(store, "alpha start", { maxSeeds: 1 });
      expect(result.seedNodes).toContain(ids.A);
      expect(result.seedNodes).not.toContain(ids.E);
    });

    it("collects only edges between visited nodes", async () => {
      const result = await extractSubgraph(store, "Alpha", { maxDepth: 1 });
      const visitedIds = new Set(result.nodes.map(n => n.id));
      for (const edge of result.edges) {
        expect(visitedIds.has(edge.source)).toBe(true);
        expect(visitedIds.has(edge.target)).toBe(true);
      }
    });
  });

  describe("findShortestPath", () => {
    it("finds path A -> D via A->B->C->D", async () => {
      const result = await findShortestPath(store, ids.A, ids.D);
      expect(result).not.toBeNull();
      const pathIds = result!.path.map(n => n.id);
      expect(pathIds).toEqual([ids.A, ids.B, ids.C, ids.D]);
      expect(result!.edges).toHaveLength(3);
    });

    it("finds path A -> G via A->E->F->G", async () => {
      const result = await findShortestPath(store, ids.A, ids.G);
      expect(result).not.toBeNull();
      const pathIds = result!.path.map(n => n.id);
      expect(pathIds).toEqual([ids.A, ids.E, ids.F, ids.G]);
      expect(result!.edges).toHaveLength(3);
    });

    it("returns null when maxDepth is too small for distant nodes", async () => {
      const result = await findShortestPath(store, ids.A, ids.D, 1);
      expect(result).toBeNull();
    });

    it("returns null for non-existent source node", async () => {
      const result = await findShortestPath(store, "nonexistent", ids.A);
      expect(result).toBeNull();
    });

    it("returns null for non-existent target node", async () => {
      const result = await findShortestPath(store, ids.A, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns single-node path when source equals target", async () => {
      const result = await findShortestPath(store, ids.A, ids.A);
      expect(result).not.toBeNull();
      expect(result!.path).toHaveLength(1);
      expect(result!.path[0].id).toBe(ids.A);
      expect(result!.edges).toHaveLength(0);
    });
  });
});
