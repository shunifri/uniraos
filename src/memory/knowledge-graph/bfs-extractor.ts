import type { GraphNode, GraphEdge, SubgraphResult } from "./types.js";
import type { GraphStore } from "./graph-store.js";

export interface BFSOptions {
  maxSeeds?: number;   // default 3
  maxDepth?: number;   // default 3
  maxNodes?: number;   // default 50
}

/** Match query terms against node labels and tags, return scored nodes */
function scoreNodes(store: GraphStore, queryTerms: string[]): Array<{ node: GraphNode; score: number }> {
  const scored: Array<{ node: GraphNode; score: number }> = [];
  for (const node of store.getAllNodes()) {
    let score = 0;
    const labelLower = node.label.toLowerCase();
    for (const term of queryTerms) {
      if (labelLower.includes(term)) score += 2;
      if (node.tags.some(t => t.toLowerCase().includes(term))) score += 1;
    }
    if (score > 0) scored.push({ node, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** BFS subgraph extraction from seed nodes */
export function extractSubgraph(store: GraphStore, query: string, options?: BFSOptions): SubgraphResult {
  const maxSeeds = options?.maxSeeds ?? 3;
  const maxDepth = options?.maxDepth ?? 3;
  const maxNodes = options?.maxNodes ?? 50;

  // 1. Tokenize query and match to nodes
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return { nodes: [], edges: [], seedNodes: [] };

  const scored = scoreNodes(store, terms);
  const seeds = scored.slice(0, maxSeeds).map(s => s.node);
  if (seeds.length === 0) return { nodes: [], edges: [], seedNodes: [] };

  // 2. BFS from seeds
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; depth: number }> = [];
  for (const seed of seeds) {
    queue.push({ nodeId: seed.id, depth: 0 });
  }

  const resultNodes: GraphNode[] = [];

  while (queue.length > 0 && resultNodes.length < maxNodes) {
    const { nodeId, depth } = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = store.getNode(nodeId);
    if (!node) continue;
    resultNodes.push(node);

    if (depth < maxDepth) {
      for (const neighbor of store.getNeighbors(nodeId)) {
        if (!visited.has(neighbor.id)) {
          queue.push({ nodeId: neighbor.id, depth: depth + 1 });
        }
      }
    }
  }

  // 3. Collect edges between visited nodes
  const visitedSet = new Set(resultNodes.map(n => n.id));
  const resultEdges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const node of resultNodes) {
    for (const edge of store.getEdgesOf(node.id)) {
      if (!seenEdges.has(edge.id) && visitedSet.has(edge.source) && visitedSet.has(edge.target)) {
        resultEdges.push(edge);
        seenEdges.add(edge.id);
      }
    }
  }

  return { nodes: resultNodes, edges: resultEdges, seedNodes: seeds.map(s => s.id) };
}

/** BFS shortest path between two nodes */
export function findShortestPath(
  store: GraphStore, sourceId: string, targetId: string, maxDepth = 10,
): { path: GraphNode[]; edges: GraphEdge[] } | null {
  if (!store.getNode(sourceId) || !store.getNode(targetId)) return null;
  if (sourceId === targetId) {
    return { path: [store.getNode(sourceId)!], edges: [] };
  }

  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, { nodeId: string; edgeId: string }>();
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const edge of store.getEdgesOf(nodeId)) {
      const neighborId = edge.source === nodeId ? edge.target : edge.source;
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      parent.set(neighborId, { nodeId, edgeId: edge.id });

      if (neighborId === targetId) {
        // Reconstruct path
        const path: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        let cur = targetId;
        while (cur !== sourceId) {
          path.unshift(store.getNode(cur)!);
          const p = parent.get(cur)!;
          edges.unshift(store.getEdge(p.edgeId)!);
          cur = p.nodeId;
        }
        path.unshift(store.getNode(sourceId)!);
        return { path, edges };
      }

      queue.push({ nodeId: neighborId, depth: depth + 1 });
    }
  }

  return null; // No path found
}
