import type { GraphNode, GraphEdge, SubgraphResult } from "./types.js";
import type { GraphStore } from "./graph-store.js";
import type { GraphStoreLike } from "./extraction-pipeline.js";

export interface BFSOptions {
  maxSeeds?: number;   // default 3
  maxDepth?: number;   // default 3
  maxNodes?: number;   // default 50
  allowedDocIds?: string[]; // 允许访问的知识库文档 ID 列表
  /** KG v2 阶段 3: 显式指定 seed 节点 ID，绕过 query 字符串匹配 */
  seedNodeIds?: string[];
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

/** Match query terms against node labels, tags, and value content
 * KG v2 阶段 5: 优先用 backend 原生 searchNodesByKeywords（如 Neo4j fulltext index），
 * 没有该方法时降级到 getAllNodes + 内存字符串匹配
 */
async function scoreNodes(store: GraphStoreLike, queryTerms: string[]): Promise<Array<{ node: GraphNode; score: number }>> {
  // 展开中文查询词为英文 tag
  const expandedTerms = [...queryTerms];
  for (const term of queryTerms) {
    for (const [zh, enTags] of Object.entries(ZH_TAG_MAP)) {
      if (term.includes(zh) || zh.includes(term)) {
        expandedTerms.push(...enTags);
      }
    }
  }

  // KG v2 阶段 5: 优先用 backend 原生检索（如 Neo4j fulltext index）
  // P2-12：用类型守卫代替 as any（searchNodesByKeywords 在 GraphStoreLike 是可选方法）
  if (store.searchNodesByKeywords) {
    try {
      const rawHits = await store.searchNodesByKeywords(expandedTerms, 50);
      // 兼容两种返回格式：
      //   - { node, score }[]（Neo4j fulltext 风格）
      //   - GraphNode[]（简化 mock 风格）
      const hits: Array<{ node: GraphNode; score: number }> = [];
      for (const item of rawHits ?? []) {
        if (item && typeof item === "object" && "node" in item) {
          hits.push({ node: item.node, score: item.score ?? 0 });
        } else if (item && typeof item === "object" && "id" in item) {
          // 简化格式：直接是 GraphNode
          hits.push({ node: item as GraphNode, score: 0 });
        }
      }
      if (hits.length > 0) {
        // 命中：直接返回原生索引结果（按 score 降序）
        return hits.sort((a, b) => b.score - a.score);
      }
      // rawHits 为空（FULLTEXT 索引 lag / min word length / tag-only match 等情况），
      // 降级到内存匹配。注：之前是"rawHits 为空就返回空"，导致纯 tag 匹配场景全部丢失。
      // 现在显式 fall through 到下面的内存匹配逻辑。
    } catch (err) {
      // 索引未建/查询语法问题等，降级到内存匹配
      console.warn("[scoreNodes] backend search failed, falling back:", err);
    }
  }

  // Fallback: 内存字符串匹配
  const scored: Array<{ node: GraphNode; score: number }> = [];
  // P2-12：getAllNodes 在 GraphStoreLike 是可选方法（Neo4j 没实现），用类型守卫
  if (!store.getAllNodes) {
    return scored; // 真没结果：返回空
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
      if (node.tags.some(t => {
        const tagStr = typeof t === 'string' ? t : String(t);
        return tagStr.toLowerCase().includes(term);
      })) score += 2;
      // value 内容匹配
      if (valueLower.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ node, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** 检查节点是否是允许访问的知识库相关节点 */
function isAllowedKbNode(node: GraphNode, allowedDocIds?: string[]): boolean {
  // 如果不是知识库相关节点，直接允许
  if (!node.tags.some((t: string) => t === 'kb_document')) {
    return true;
  }

  // 如果没有提供允许的文档 ID 列表，默认允许访问（用于直接 API 调用或用户自己的图谱）
  if (!allowedDocIds || allowedDocIds.length === 0) {
    return true;
  }

  // 检查节点是否匹配某个有权限的文档 ID
  // P2-11 安全修复：用 === 精确等值（之前 startsWith + includes 有"doc_abc" 误中
  //   "kb_doc_doc_abc_v2" 的边角问题）
  const nodeId = node.id;
  return allowedDocIds.some((docId) => {
    if (nodeId === `kb_doc_${docId}`) return true;             // doc anchor：精确等值
    if (nodeId.startsWith("kb_layout_") && nodeId.includes(docId)) return true;
    if (nodeId.startsWith(`kb_seg_${docId}_`)) return true;     // seg/chunk 节点：用 _ 分隔避免误中
    if (nodeId.startsWith(`kb_content_${docId}_`)) return true;
    if (nodeId.includes(`kb_shared_${docId}`)) return true;
    return false;
  });
}

/** BFS subgraph extraction from seed nodes
 *
 * P2-CRITICAL-FIX（v1 P0-2 部分修）：
 *   优先用 `extractSubgraphCTE` 一次 SQL 拉完（MySQL 8.0+ WITH RECURSIVE）
 *   fallback 旧 N+1 模式（Neo4j / 旧 MySQL 没 CTE 的场景）
 */
export async function extractSubgraph(store: GraphStoreLike, query: string, options?: BFSOptions): Promise<SubgraphResult> {
  const maxSeeds = options?.maxSeeds ?? 3;
  const maxDepth = options?.maxDepth ?? 3;
  const maxNodes = options?.maxNodes ?? 50;
  const allowedDocIds = options?.allowedDocIds;
  const seedNodeIds = options?.seedNodeIds;

  // 1. Tokenize query and match to nodes (KG v2 阶段 3: 如果提供了 seedNodeIds 则跳过)
  let seeds: GraphNode[] = [];
  if (seedNodeIds && seedNodeIds.length > 0) {
    for (const id of seedNodeIds.slice(0, maxSeeds)) {
      const n = await store.getNode(id);
      if (n) seeds.push(n);
    }
  } else {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (terms.length === 0) return { nodes: [], edges: [], seedNodes: [] };
    const scored = await scoreNodes(store, terms);
    seeds = scored.slice(0, maxSeeds).map(s => s.node);
  }
  if (seeds.length === 0) return { nodes: [], edges: [], seedNodes: [] };

  // 2. 优先用 MySQL recursive CTE 一次拉完（P2-CRITICAL-FIX）
  if (store.extractSubgraphCTE) {
    try {
      const cteResult = await store.extractSubgraphCTE(
        seeds.map((s) => s.id),
        maxDepth,
        maxNodes
      );
      // 拉这些节点的对象（CTE 只返回 id + edges，需要 getNode 拿完整对象）
      const nodeMap = new Map<string, GraphNode>();
      for (const id of cteResult.nodeIds) {
        const n = await store.getNode(id);
        if (n) nodeMap.set(id, n);
      }

      // 应用 ACL 过滤
      const resultNodes: GraphNode[] = [];
      for (const id of cteResult.nodeIds) {
        const n = nodeMap.get(id);
        if (!n) continue;
        if (!isAllowedKbNode(n, allowedDocIds)) continue;
        resultNodes.push(n);
      }

      // 边：CTE 给了 id + source + target + type + label，但需要完整 GraphEdge
      //   简化：返回只有 {id, source, target, type, label} 字段——caller (recall.ts) 只用这些
      const resultEdges: GraphEdge[] = cteResult.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type as GraphEdge["type"],
        label: e.label,
        weight: 1.0,
        createdAt: Date.now(),
      }));

      return {
        nodes: resultNodes,
        edges: resultEdges,
        seedNodes: seeds.map((s) => s.id),
      };
    } catch (err) {
      console.warn("[extractSubgraph] CTE path failed, falling back to N+1:", err);
      // fall through to legacy
    }
  }

  // 3. Legacy: N+1 BFS（fallback 给 Neo4j / 旧 MySQL）
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

    // 检查是否允许访问该节点
    if (!isAllowedKbNode(node, allowedDocIds)) continue;

    resultNodes.push(node);

    if (depth < maxDepth) {
      for (const neighbor of await store.getNeighbors(nodeId)) {
        if (!visited.has(neighbor.id)) {
          queue.push({ nodeId: neighbor.id, depth: depth + 1 });
        }
      }
    }
  }

  // 4. Collect edges between visited nodes
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
  store: GraphStoreLike, sourceId: string, targetId: string, maxDepth = 10,
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
