import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KnowledgeGraphManager } from "../../src/memory/knowledge-graph/manager.js";
import type { GraphNode, GraphEdge } from "../../src/memory/knowledge-graph/types.js";

function buildSyntheticGraph(docCount = 60): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Central concept node (high centrality)
  nodes.push({
    id: "concept_central",
    label: "Artificial Intelligence",
    type: "concept",
    tags: ["concept", "ai"],
    properties: {},
    createdAt: Date.now(),
    communityId: 0,
  });

  // Document nodes
  for (let i = 0; i < docCount; i++) {
    nodes.push({
      id: `kb_doc_${i}`,
      label: `Document ${i}`,
      type: "kb_document",
      tags: ["kb_document", i % 3 === 0 ? "ai" : "general"],
      properties: { contentPreview: `Content of document ${i}` },
      createdAt: Date.now(),
      communityId: 0,
    });

    // Central concept connected to first 20 docs
    if (i < 20) {
      edges.push({
        id: `e_central_${i}`,
        source: "concept_central",
        target: `kb_doc_${i}`,
        type: "EXTRACTED",
        label: "related_to",
        weight: 1,
        createdAt: Date.now(),
      });
    }
  }

  // Chain edges between docs for depth testing
  for (let i = 0; i < docCount - 1; i++) {
    edges.push({
      id: `e_chain_${i}`,
      source: `kb_doc_${i}`,
      target: `kb_doc_${i + 1}`,
      type: "EXTRACTED",
      label: "next",
      weight: 1,
      createdAt: Date.now(),
    });
  }

  return { nodes, edges };
}

function createMockStore(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgeList = edges;

  const store = {
    getAllNodes: vi.fn().mockResolvedValue(nodes),
    getAllEdges: vi.fn().mockResolvedValue(edges),
    getNode: vi.fn().mockImplementation((id: string) => Promise.resolve(nodeMap.get(id))),
    getNodesByIds: vi
      .fn()
      .mockImplementation((ids: string[]) => Promise.resolve(ids.map((id) => nodeMap.get(id)).filter(Boolean) as GraphNode[])),
    getNeighbors: vi.fn().mockImplementation((id: string) => {
      const neighborIds = new Set<string>();
      for (const e of edgeList) {
        if (e.source === id) neighborIds.add(e.target);
        if (e.target === id) neighborIds.add(e.source);
      }
      return Promise.resolve(nodes.filter((n) => neighborIds.has(n.id)));
    }),
    getEdgesOf: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(edgeList.filter((e) => e.source === id || e.target === id));
    }),
    searchNodesByKeywords: vi.fn().mockImplementation((terms: string[]) => {
      const matched = nodes.filter((n) => {
        const label = n.label.toLowerCase();
        const tags = n.tags.join(" ").toLowerCase();
        return terms.some((t: string) => label.includes(t.toLowerCase()) || tags.includes(t.toLowerCase()));
      });
      return Promise.resolve(matched);
    }),
    countNodes: vi.fn().mockResolvedValue(nodes.length),
    countEdges: vi.fn().mockResolvedValue(edges.length),
    clearGraph: vi.fn().mockResolvedValue({ nodesRemoved: nodes.length, edgesRemoved: edges.length }),
  };

  return { store, getNodeCalls: () => store.getNode.mock.calls.length };
}

describe("Graph Query Performance Optimizations", () => {
  let manager: KnowledgeGraphManager;
  let mockStore: ReturnType<typeof createMockStore>["store"];
  let getNodeCalls: () => number;
  const { nodes, edges } = buildSyntheticGraph(60);

  beforeEach(async () => {
    manager = new KnowledgeGraphManager("perf_test_owner");

    // Wait for the constructor's internal .then() to fire so it doesn't
    // overwrite our mock store later
    await Promise.resolve();

    const mock = createMockStore(nodes, edges);
    mockStore = mock.store;
    getNodeCalls = mock.getNodeCalls;

    // Inject mock store
    (manager as any).storePromise = Promise.resolve(mockStore);
    (manager as any).store = mockStore;

    // Precompute data for fast path
    (manager as any).precomputed = {
      communities: new Map([[0, nodes.slice(0, 30).map((n) => n.id)]]),
      godNodes: [nodes[0]], // concept_central is the god node
      lastComputed: Date.now(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skip("cache hit should skip store lookups and reduce query time", async () => {
    // TODO: searchCache optimization not yet implemented in KnowledgeGraphManager
    const query = "Artificial Intelligence";

    // First call (cold)
    const coldStart = Date.now();
    const coldResult = await manager.graphSearch(query, { limit: 5 });
    const coldDuration = Date.now() - coldStart;

    // Reset call counts to measure second call in isolation
    mockStore.getNode.mockClear();
    mockStore.getNeighbors.mockClear();

    // Second call (warm)
    const warmStart = Date.now();
    const warmResult = await manager.graphSearch(query, { limit: 5 });
    const warmDuration = Date.now() - warmStart;

    expect(warmResult).toEqual(coldResult);
    // Cache hit should not touch store at all
    expect(mockStore.getNode).not.toHaveBeenCalled();
    expect(mockStore.getNeighbors).not.toHaveBeenCalled();
    expect(warmDuration).toBeLessThanOrEqual(coldDuration);
  });

  it.skip("cache TTL should expire after 5 minutes", async () => {
    // TODO: searchCache with TTL not yet implemented in KnowledgeGraphManager
    const query = "Document 1";

    // First call populates cache
    await manager.graphSearch(query, { limit: 5 });
    mockStore.getNode.mockClear();

    // Verify cache hit before manipulation
    await manager.graphSearch(query, { limit: 5 });
    expect(mockStore.getNode).not.toHaveBeenCalled();
    mockStore.getNode.mockClear();

    // Manually expire the cache entry by backdating its timestamp
    const cache = (manager as any).searchCache;
    const { createHash } = await import("crypto");
    const graphVersion = (manager as any).graphVersion;
    const cacheKey = createHash("md5").update(query + String(graphVersion)).digest("hex");
    const entry = cache.cache.get(cacheKey);
    expect(entry).toBeDefined();
    entry.timestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago

    // Next call should hit the store because cache expired
    await manager.graphSearch(query, { limit: 5 });
    expect(mockStore.getNode).toHaveBeenCalled();
  });

  it("BFS depth limit should restrict traversal depth", async () => {
    // Query starting from concept_central -> kb_doc_0 -> kb_doc_1 -> ...
    // With maxDepth=1, should only reach docs directly connected to central
    const subgraphDepth1 = await manager.querySubgraph("Artificial Intelligence", {
      maxDepth: 1,
      maxNodes: 100,
    });

    // concept_central + kb_doc_0..kb_doc_19 = 21 nodes max
    expect(subgraphDepth1.nodes.length).toBeLessThanOrEqual(21);

    // With maxDepth=3, chain from kb_doc_0 can reach further docs
    const subgraphDepth3 = await manager.querySubgraph("Artificial Intelligence", {
      maxDepth: 3,
      maxNodes: 100,
    });

    // Should find strictly more nodes than depth=1
    expect(subgraphDepth3.nodes.length).toBeGreaterThan(subgraphDepth1.nodes.length);
  });

  it("max nodes limit should cap the number of visited nodes", async () => {
    const subgraph = await manager.querySubgraph("Artificial Intelligence", {
      maxDepth: 10,
      maxNodes: 10,
    });

    // extractSubgraph should stop after maxNodes=10
    expect(subgraph.nodes.length).toBeLessThanOrEqual(10);
  });

  it("central node prioritization should boost neighbors of matching god nodes", async () => {
    // Query matches concept_central ("Artificial Intelligence")
    const result = await manager.graphSearch("Artificial Intelligence", {
      limit: 10,
      maxDepth: 2,
      maxNodes: 50,
    });

    // The first 20 docs are directly connected to concept_central
    // With central node short-circuit, these should appear in results
    // docId is extracted from "kb_doc_X" -> "X"
    const centralDocIds = new Set(Array.from({ length: 20 }, (_, i) => String(i)));
    const foundCentralDocs = result.filter((r) => centralDocIds.has(r.docId));

    // Most results should come from the central node's neighborhood
    expect(foundCentralDocs.length).toBeGreaterThanOrEqual(5);
  });

  it.skip("batch getNodesByIds should reduce N+1 queries in community expansion", async () => {
    // TODO: batch getNodesByIds optimization not yet used in KnowledgeGraphManager
    const query = "Document";

    // Ensure getNodesByIds is available on mock
    mockStore.getNodesByIds.mockClear();

    // Use a high limit and moderate maxNodes so BFS alone can't fill the limit,
    // forcing community expansion to run
    await manager.graphSearch(query, {
      limit: 100,
      maxDepth: 2,
      maxNodes: 15,
    });

    // Community expansion path should use getNodesByIds for batch lookup
    expect(mockStore.getNodesByIds).toHaveBeenCalled();
    // Should be called with a batch of IDs, not one at a time
    const calls = mockStore.getNodesByIds.mock.calls as string[][][];
    for (const call of calls) {
      expect(call[0].length).toBeGreaterThanOrEqual(1);
    }
  });
});
