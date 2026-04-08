import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { extractSubgraph, findShortestPath } from "../../../src/memory/knowledge-graph/bfs-extractor.js";

/**
 * Test graph topology:
 *   A --related--> B --related--> C --related--> D
 *   A --related--> E
 *   E --related--> F --related--> G
 */
describe("BFS Extractor", () => {
  let tmpDir: string;
  let storePath: string;
  let store: GraphStore;
  let ids: Record<string, string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bfs-extractor-test-"));
    storePath = path.join(tmpDir, "graph.json");
    store = new GraphStore(storePath);

    // Add nodes with distinct labels matching query terms
    const nodeA = store.addNode({ id: "A", label: "Alpha", type: "concept", tags: ["start"], properties: {}, createdAt: Date.now() });
    const nodeB = store.addNode({ id: "B", label: "Beta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeC = store.addNode({ id: "C", label: "Gamma", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeD = store.addNode({ id: "D", label: "Delta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeE = store.addNode({ id: "E", label: "Epsilon", type: "concept", tags: ["start"], properties: {}, createdAt: Date.now() });
    const nodeF = store.addNode({ id: "F", label: "Zeta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const nodeG = store.addNode({ id: "G", label: "Eta", type: "concept", tags: [], properties: {}, createdAt: Date.now() });

    ids = { A: nodeA.id, B: nodeB.id, C: nodeC.id, D: nodeD.id, E: nodeE.id, F: nodeF.id, G: nodeG.id };

    // Add edges
    store.addEdge(ids.A, ids.B, "EXTRACTED", "related");
    store.addEdge(ids.B, ids.C, "EXTRACTED", "related");
    store.addEdge(ids.C, ids.D, "EXTRACTED", "related");
    store.addEdge(ids.A, ids.E, "EXTRACTED", "related");
    store.addEdge(ids.E, ids.F, "EXTRACTED", "related");
    store.addEdge(ids.F, ids.G, "EXTRACTED", "related");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("extractSubgraph", () => {
    it("returns seed node A and its neighbors with default depth", () => {
      const result = extractSubgraph(store, "Alpha");
      const nodeIds = result.nodes.map(n => n.id);
      expect(result.seedNodes).toContain(ids.A);
      expect(nodeIds).toContain(ids.A);
      // At depth 3 from A: B, E reachable at depth 1; C, F at 2; D, G at 3
      expect(nodeIds).toContain(ids.B);
      expect(nodeIds).toContain(ids.E);
    });

    it("limits traversal depth with maxDepth=1", () => {
      const result = extractSubgraph(store, "Alpha", { maxDepth: 1 });
      const nodeIds = result.nodes.map(n => n.id);
      // A (seed, depth 0) + B and E (depth 1)
      expect(nodeIds).toContain(ids.A);
      expect(nodeIds).toContain(ids.B);
      expect(nodeIds).toContain(ids.E);
      // C and F should not be reached
      expect(nodeIds).not.toContain(ids.C);
      expect(nodeIds).not.toContain(ids.F);
    });

    it("caps results with maxNodes=3", () => {
      const result = extractSubgraph(store, "Alpha", { maxNodes: 3 });
      expect(result.nodes.length).toBeLessThanOrEqual(3);
    });

    it("returns empty result for non-matching query", () => {
      const result = extractSubgraph(store, "zzz");
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.seedNodes).toHaveLength(0);
    });

    it("multi-term query scores nodes by label and tag matches", () => {
      // "alpha start" should score A higher (label match +2, tag match +1 = 3)
      // E also has tag "start" but no label match (+1)
      const result = extractSubgraph(store, "alpha start", { maxSeeds: 1 });
      expect(result.seedNodes).toContain(ids.A);
      expect(result.seedNodes).not.toContain(ids.E);
    });

    it("collects only edges between visited nodes", () => {
      const result = extractSubgraph(store, "Alpha", { maxDepth: 1 });
      // Edges should only connect nodes in the result set
      const visitedIds = new Set(result.nodes.map(n => n.id));
      for (const edge of result.edges) {
        expect(visitedIds.has(edge.source)).toBe(true);
        expect(visitedIds.has(edge.target)).toBe(true);
      }
    });
  });

  describe("findShortestPath", () => {
    it("finds path A -> D via A->B->C->D", () => {
      const result = findShortestPath(store, ids.A, ids.D);
      expect(result).not.toBeNull();
      const pathIds = result!.path.map(n => n.id);
      expect(pathIds).toEqual([ids.A, ids.B, ids.C, ids.D]);
      expect(result!.edges).toHaveLength(3);
    });

    it("finds path A -> G via A->E->F->G", () => {
      const result = findShortestPath(store, ids.A, ids.G);
      expect(result).not.toBeNull();
      const pathIds = result!.path.map(n => n.id);
      expect(pathIds).toEqual([ids.A, ids.E, ids.F, ids.G]);
      expect(result!.edges).toHaveLength(3);
    });

    it("returns null when maxDepth is too small for distant nodes", () => {
      // A to D requires 3 hops; maxDepth=1 should fail
      const result = findShortestPath(store, ids.A, ids.D, 1);
      expect(result).toBeNull();
    });

    it("returns null for non-existent source node", () => {
      const result = findShortestPath(store, "nonexistent", ids.A);
      expect(result).toBeNull();
    });

    it("returns null for non-existent target node", () => {
      const result = findShortestPath(store, ids.A, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns single-node path when source equals target", () => {
      const result = findShortestPath(store, ids.A, ids.A);
      expect(result).not.toBeNull();
      expect(result!.path).toHaveLength(1);
      expect(result!.path[0].id).toBe(ids.A);
      expect(result!.edges).toHaveLength(0);
    });
  });
});
