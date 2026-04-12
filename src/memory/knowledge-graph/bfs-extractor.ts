import type { GraphNode, GraphEdge, SubgraphResult } from "./types.js";
import type { GraphStore } from "./graph-store.js";

export interface BFSOptions {
  maxSeeds?: number;   // default 3
  maxDepth?: number;   // default 3
  maxNodes?: number;   // default 50
}

/** 中文→英文 tag 映射，用于跨语言检索 */
const ZH_TAG_MAP: Record<string, string[]> = {
  "健康": ["health", "fitness", "medical"],
  "家庭": ["family", "son", "children", "parenting"],
  "偏好": ["preference", "hobby", "interest"],
  "技术": ["technical", "skill", "programming", "technology"],
  "项目": ["project", "work"],
  "职业": ["career", "work", "job"],
  "学习": ["learning", "education"],
  "个人": ["personal", "identity", "personal_info"],
};

/** Match query terms against node labels, tags, and value content */
async function scoreNodes(store: GraphStore, queryTerms: string[]): Promise<Array<{ node: GraphNode; score: number }>> {
  const scored: Array<{ node: GraphNode; score: number }> = [];

  // 展开中文查询词为英文 tag
  const expandedTerms = [...queryTerms];
  for (const term of queryTerms) {
    for (const [zh, enTags] of Object.entries(ZH_TAG_MAP)) {
      if (term.includes(zh) || zh.includes(term)) {
        expandedTerms.push(...enTags);
      }
    }
  }

  const allNodes = await store.getAllNodes();
  for (const node of allNodes) {
    let score = 0;
    const labelLower = node.label.toLowerCase();

    // 构建 value 文本用于匹配
    const valueStr = node.properties?.value
      ? (typeof node.properties.value === "string" ? node.properties.value : JSON.stringify(node.properties.value))
      : "";
    const valueLower = valueStr.toLowerCase();

    for (const term of expandedTerms) {
      // label 匹配（权重最高）
      if (labelLower.includes(term)) score += 3;
      // tag 匹配
      if (node.tags.some(t => t.toLowerCase().includes(term))) score += 2;
      // value 内容匹配
      if (valueLower.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ node, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** BFS subgraph extraction from seed nodes */
export async function extractSubgraph(store: GraphStore, query: string, options?: BFSOptions): Promise<SubgraphResult> {
  const maxSeeds = options?.maxSeeds ?? 3;
  const maxDepth = options?.maxDepth ?? 3;
  const maxNodes = options?.maxNodes ?? 50;

  // 1. Tokenize query and match to nodes
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return { nodes: [], edges: [], seedNodes: [] };

  const scored = await scoreNodes(store, terms);
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

    const node = await store.getNode(nodeId);
    if (!node) continue;
    resultNodes.push(node);

    if (depth < maxDepth) {
      for (const neighbor of await store.getNeighbors(nodeId)) {
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
    for (const edge of await store.getEdgesOf(node.id)) {
      if (!seenEdges.has(edge.id) && visitedSet.has(edge.source) && visitedSet.has(edge.target)) {
        resultEdges.push(edge);
        seenEdges.add(edge.id);
      }
    }
  }

  return { nodes: resultNodes, edges: resultEdges, seedNodes: seeds.map(s => s.id) };
}

/** BFS shortest path between two nodes */
export async function findShortestPath(
  store: GraphStore, sourceId: string, targetId: string, maxDepth = 10,
): Promise<{ path: GraphNode[]; edges: GraphEdge[] } | null> {
  const [sourceNode, targetNode] = await Promise.all([
    store.getNode(sourceId),
    store.getNode(targetId),
  ]);
  
  if (!sourceNode || !targetNode) return null;
  if (sourceId === targetId) {
    return { path: [sourceNode], edges: [] };
  }

  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, { nodeId: string; edgeId: string }>();
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const edge of await store.getEdgesOf(nodeId)) {
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
          const node = await store.getNode(cur);
          if (node) path.unshift(node);
          const p = parent.get(cur)!;
          const edge = await store.getEdge(p.edgeId);
          if (edge) edges.unshift(edge);
          cur = p.nodeId;
        }
        path.unshift(sourceNode);
        return { path, edges };
      }

      queue.push({ nodeId: neighborId, depth: depth + 1 });
    }
  }

  return null; // No path found
}
