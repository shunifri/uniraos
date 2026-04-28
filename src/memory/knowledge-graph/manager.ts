import { GraphStore } from "./graph-store.js";
import { extractSubgraph, findShortestPath } from "./bfs-extractor.js";
import { detectCommunities } from "./community-detection.js";
import { identifyGodNodes, scoreSurprise } from "./scoring.js";
import { extractRelationships, extractTagRelationships } from "./relationship-extractor.js";
import type { GraphNode, GraphEdge, SubgraphResult, NodeType } from "./types.js";
import type { BFSOptions } from "./bfs-extractor.js";
import type { LLMProvider } from "../../llm/types.js";

export class KnowledgeGraphManager {
  private storePromise: Promise<any>;
  private store: any | null = null;
  private llmProvider?: LLMProvider;
  private backend: string;

  // ===== 阶段 5: 预计算缓存 =====
  private precomputed: {
    communities: Map<number, string[]> | null;
    godNodes: GraphNode[] | null;
    lastComputed: number;
  } = {
    communities: null,
    godNodes: null,
    lastComputed: 0,
  };
  private precomputeLock = false;

  constructor(
    owner: string,
    llmProvider?: LLMProvider,
    backend: string = process.env.GRAPH_STORE_BACKEND || "mysql"
  ) {
    this.backend = backend;
    this.storePromise = this.createStore(owner, backend);
    this.llmProvider = llmProvider;
    // 异步初始化 store
    this.storePromise.then((store) => {
      this.store = store;
    }).catch((err) => {
      console.error("[KnowledgeGraphManager] Failed to initialize store:", err);
    });
  }

  /** 获取已初始化的 store（内部使用） */
  private async ensureStore(): Promise<any> {
    if (this.store) return this.store;
    return this.storePromise;
  }

  /** 公共接口：获取 store 实例（异步，确保已初始化） */
  async getStore(): Promise<any> {
    return this.ensureStore();
  }

  private async createStore(owner: string, backend: string): Promise<any> {
    if (backend === "neo4j") {
      try {
        const { Neo4jGraphStore } = await import("./neo4j-store.js");
        const store = new Neo4jGraphStore(owner);
        // 验证 Neo4j 连接
        const connectionValid = await store.verifyConnection();
        if (!connectionValid) {
          console.error("Neo4j 连接验证失败，将使用 MySQL 存储作为备用方案");
          return new GraphStore(owner);
        }
        return store;
      } catch (error) {
        console.error("Neo4j 存储创建失败，将使用 MySQL 存储作为备用方案:", error);
        return new GraphStore(owner);
      }
    } else {
      return new GraphStore(owner);
    }
  }

  /** Called after ltm_store — auto-creates graph node and edges */
  async onFactStored(entry: {
    id: string; key: string; value: unknown; tags: string[]; relation?: string; type?: NodeType;
  }): Promise<void> {
    const store = await this.ensureStore();

    // 自动推断节点类型（未显式传入时根据 tags 推断）
    const inferNodeType = (): NodeType => {
      const t = entry.type;
      if (t) return t;
      const tags = entry.tags.map(tag => tag.toLowerCase());
      if (tags.some(tag => tag.includes("kb_document"))) return "kb_document";
      if (tags.some(tag => tag.includes("kb_layout") || tag.includes("kb_segment") || tag.includes("kb_content"))) return "entity";
      if (tags.some(tag => tag.includes("entity") || tag.includes("kb_relation"))) return "entity";
      if (tags.some(tag => tag.includes("concept"))) return "concept";
      return "ltm";
    };
    const nodeType = inferNodeType();

    // 1. 处理个人信息节点关联（优化核心逻辑）
    let corePersonNode: any = null;

    // 如果是个人标识信息，尝试找到或创建核心人物节点
    if (entry.key.startsWith("user_") || entry.tags.some(tag =>
        ["personal", "identity", "contact", "职业信息", "技术", "背景"].includes(tag)
    )) {
      // 查找核心人物节点（优先找姓名节点）
      corePersonNode = await store.findNodeByLabel("user_name");

      // 如果找不到姓名节点，尝试从其他个人信息中推断
      if (!corePersonNode) {
        const personalNodes = await store.findNodesByType("ltm");
        corePersonNode = personalNodes.find((n: any) =>
            n.tags.some((t: string) => ["personal", "identity"].includes(t)) &&
            !n.label.startsWith("user_")
        );
      }
    }

    // 2. Create or update node
    let node = await store.findNodeByLabel(entry.key);
    if (!node) {
      node = await store.addNode({
        id: entry.id,
        label: entry.key,
        type: nodeType,
        tags: entry.tags,
        properties: { value: entry.value },
        createdAt: Date.now(),
      });
    }

    // 3. 建立个人信息节点与核心人物节点的关联
    if (corePersonNode && corePersonNode.id !== node.id) {
      const existingEdge = await store.getEdgesBetween(corePersonNode.id, node.id);
      if (existingEdge.length === 0) {
        // 根据属性类型创建语义化的边
        let edgeLabel = "has_property";
        if (entry.key.startsWith("user_name")) {
          edgeLabel = "identity";
        } else if (entry.key.startsWith("user_phone") || entry.key.startsWith("user_email")) {
          edgeLabel = "contact";
        } else if (entry.key.startsWith("user_company") || entry.key.startsWith("user_job")) {
          edgeLabel = "employment";
        } else if (entry.key.startsWith("user_")) {
          edgeLabel = "attribute";
        } else if (entry.tags.includes("技术") || entry.tags.includes("背景")) {
          edgeLabel = "background";
        } else if (entry.tags.includes("职业信息")) {
          edgeLabel = "professional";
        }

        await store.addEdge(corePersonNode.id, node.id, "PERSONAL", edgeLabel);
      }
    }

    // 4. If relation param provided, create EXTRACTED edge to target
    if (entry.relation) {
      const targetNode = await store.findNodeByLabel(entry.relation);
      if (targetNode) {
        // Avoid duplicate edges
        const existing = await store.getEdgesBetween(node.id, targetNode.id);
        if (existing.length === 0) {
          await store.addEdge(node.id, targetNode.id, "EXTRACTED", "related_to");
        }
      }
    }

    // 5. Tag-based TEMPORAL edges
    const existingNodes = (await store.getAllNodes())
      .filter((n: any) => n.id !== node!.id)
      .map((n: any) => ({ id: n.id, label: n.label, tags: n.tags }));
    const tagRelations = extractTagRelationships(entry.tags, existingNodes);
    for (const rel of tagRelations.slice(0, 5)) { // max 5 tag edges per entry
      const existing = await store.getEdgesBetween(node.id, rel.targetId);
      if (existing.length === 0) {
        await store.addEdge(node.id, rel.targetId, "TEMPORAL", `shared_tags:${rel.sharedTags.join(",")}`);
      }
    }
  }

  /** 确保预计算数据可用（社区 + 中心节点） */
  async ensurePrecomputed(force = false): Promise<void> {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!force && this.precomputed.communities && (now - this.precomputed.lastComputed) < ONE_HOUR) {
      return;
    }

    // 防止并发重复计算
    if (this.precomputeLock) return;
    this.precomputeLock = true;

    try {
      const store = await this.ensureStore();

      // 1. 检测社区
      const communities = await detectCommunities(store);
      this.precomputed.communities = communities;

      // 2. 识别中心节点（top 10）
      this.precomputed.godNodes = await identifyGodNodes(store, 10);

      // 3. 将社区信息写回节点（便于后续查询直接使用）
      for (const [communityId, nodeIds] of communities) {
        for (const nodeId of nodeIds) {
          if (store.updateNode) {
            try {
              await store.updateNode(nodeId, { communityId });
            } catch {
              // 忽略更新失败
            }
          }
        }
      }

      this.precomputed.lastComputed = now;
      console.log(
        `[KnowledgeGraphManager] 预计算完成: ${communities.size} 个社区, ` +
        `${this.precomputed.godNodes.length} 个中心节点`
      );
    } catch (err) {
      console.warn("[KnowledgeGraphManager] 预计算失败:", err);
    } finally {
      this.precomputeLock = false;
    }
  }

  /** 获取当前预计算状态（调试用） */
  getPrecomputedStatus(): { hasCommunities: boolean; hasGodNodes: boolean; lastComputed: number } {
    return {
      hasCommunities: this.precomputed.communities !== null,
      hasGodNodes: this.precomputed.godNodes !== null,
      lastComputed: this.precomputed.lastComputed,
    };
  }

  /** BFS subgraph query */
  async querySubgraph(query: string, options?: BFSOptions): Promise<SubgraphResult> {
    const store = await this.ensureStore();
    // 自动触发预计算（非阻塞，已有缓存时直接返回）
    await this.ensurePrecomputed();
    return extractSubgraph(store, query, options);
  }

  /** 知识库文档图谱检索（P3 核心方法） */
  async graphSearch(
    query: string,
    opts?: {
      limit?: number;
      maxDepth?: number;
      maxNodes?: number;
      allowedDocIds?: string[];
    }
  ): Promise<Array<{
    docId: string;
    docName: string;
    chunkIndex: number;
    content: string;
    score: number;
    matchType: 'graph_subgraph' | 'graph_path' | 'graph_community';
    graphContext?: {
      path?: any[];
      subgraph?: { nodes: any[]; edges: any[] };
      community?: number;
    };
  }>> {
    await this.ensurePrecomputed();
    const store = await this.ensureStore();

    const limit = opts?.limit ?? 10;
    const allowedDocIds = opts?.allowedDocIds;

    // 阶段 1: 使用 BFS 子图查询获取相关节点
    const subgraphResult = await extractSubgraph(store, query, {
      maxSeeds: 3,
      maxDepth: opts?.maxDepth ?? 3,
      maxNodes: opts?.maxNodes ?? 50,
      allowedDocIds,
    });

    // 阶段 2: 提取 kb_document 节点
    let docNodes = subgraphResult.nodes.filter((n: any) => n.type === 'kb_document');

    // 阶段 3: 如果直接匹配的文档不足，利用中心节点补充
    if (docNodes.length < limit && this.precomputed.godNodes && this.precomputed.godNodes.length > 0) {
      const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
      const existingDocIds = new Set(docNodes.map((n: any) => n.id));

      for (const godNode of this.precomputed.godNodes) {
        if (docNodes.length >= limit) break;
        const godLabel = godNode.label.toLowerCase();
        // 中心节点标签与查询相关时，扩展其邻居
        if (terms.some(t => godLabel.includes(t) || t.includes(godLabel))) {
          const neighbors = await store.getNeighbors(godNode.id);
          for (const neighbor of neighbors) {
            if (neighbor.type === 'kb_document' && !existingDocIds.has(neighbor.id)) {
              // 权限检查
              if (!allowedDocIds || allowedDocIds.some(id => neighbor.id.includes(id))) {
                docNodes.push(neighbor);
                existingDocIds.add(neighbor.id);
              }
            }
          }
        }
      }
    }

    // 阶段 4: 利用社区信息进一步补充（发现查询类型）
    if (docNodes.length < limit && this.precomputed.communities) {
      const existingDocIds = new Set(docNodes.map((n: any) => n.id));
      for (const docNode of [...docNodes]) {
        if (docNodes.length >= limit) break;
        if (docNode.communityId !== undefined) {
          const communityNodeIds = this.precomputed.communities.get(docNode.communityId) ?? [];
          for (const nodeId of communityNodeIds) {
            if (existingDocIds.has(nodeId)) continue;
            const node = await store.getNode(nodeId);
            if (node && node.type === 'kb_document') {
              if (!allowedDocIds || allowedDocIds.some(id => node.id.includes(id))) {
                docNodes.push(node);
                existingDocIds.add(node.id);
              }
            }
          }
        }
      }
    }

    // 阶段 5: 映射为知识库检索结果格式
    const results: Array<{
      docId: string;
      docName: string;
      chunkIndex: number;
      content: string;
      score: number;
      matchType: 'graph_subgraph' | 'graph_path' | 'graph_community';
      graphContext?: any;
    }> = [];

    for (const docNode of docNodes.slice(0, limit)) {
      const match = docNode.id.match(/kb_doc_(.*)/);
      const docId = match ? match[1] : docNode.id;

      // 计算图谱评分：种子距离 + 社区归属 + 中心节点关联
      let score = 0.7;
      if (subgraphResult.seedNodes.includes(docNode.id)) {
        score += 0.15; // 种子节点加分
      }
      if (this.precomputed.godNodes?.some(g => g.id === docNode.id)) {
        score += 0.1; // 中心节点加分
      }
      if (docNode.communityId !== undefined && this.precomputed.communities) {
        const commSize = this.precomputed.communities.get(docNode.communityId)?.length ?? 0;
        score += Math.min(commSize * 0.005, 0.05); // 大社区微微加分
      }

      results.push({
        docId,
        docName: docNode.label.replace(/^kb:/, ''),
        chunkIndex: 0,
        content: (docNode.properties?.contentPreview as string) || (docNode.properties?.value as string) || '',
        score: Math.min(score, 1.0),
        matchType: 'graph_subgraph',
        graphContext: {
          subgraphSize: subgraphResult.nodes.length,
          edgesCount: subgraphResult.edges.length,
          community: docNode.communityId,
          sourceNode: docNode,
        },
      });
    }

    return results;
  }

  /** 路径查询：查找两个实体之间的路径（P3） */
  async pathSearch(
    source: string,
    target: string,
    opts?: { maxDepth?: number }
  ): Promise<{
    found: boolean;
    path?: Array<{ node: GraphNode; edge?: GraphEdge }>;
    explanation?: string;
  }> {
    const store = await this.ensureStore();

    // 查找源节点和目标节点（支持标签模糊匹配）
    let sourceNode = await store.findNodeByLabel(source);
    let targetNode = await store.findNodeByLabel(target);

    // 模糊匹配 fallback
    if (!sourceNode || !targetNode) {
      const allNodes = await store.getAllNodes();
      const sourceLower = source.toLowerCase();
      const targetLower = target.toLowerCase();
      for (const node of allNodes) {
        if (!sourceNode && node.label.toLowerCase().includes(sourceLower)) {
          sourceNode = node;
        }
        if (!targetNode && node.label.toLowerCase().includes(targetLower)) {
          targetNode = node;
        }
        if (sourceNode && targetNode) break;
      }
    }

    if (!sourceNode || !targetNode) {
      return {
        found: false,
        explanation: `未找到节点: ${!sourceNode ? source : ''} ${!targetNode ? target : ''}`,
      };
    }

    // 查找最短路径
    const pathResult = await findShortestPath(store, sourceNode.id, targetNode.id, opts?.maxDepth ?? 10);

    if (!pathResult) {
      return {
        found: false,
        explanation: `${source} 和 ${target} 之间未找到路径（可能在 maxDepth 范围内不连通）`,
      };
    }

    // 构建路径详情
    const path: Array<{ node: GraphNode; edge?: GraphEdge }> = [];
    for (let i = 0; i < pathResult.path.length; i++) {
      const node = pathResult.path[i];
      const edge = i < pathResult.edges.length ? pathResult.edges[i] : undefined;
      path.push({ node, edge });
    }

    // 生成解释文本
    const nodeLabels = pathResult.path.map(n => n.label);
    const explanation = `${source} → ${target} 的路径: ${nodeLabels.join(' → ')}（共 ${pathResult.path.length} 个节点, ${pathResult.edges.length} 条边）`;

    return { found: true, path, explanation };
  }

  /** Shortest path between two node labels */
  async getPath(sourceKey: string, targetKey: string, maxDepth = 10): Promise<{
    path: GraphNode[]; edges: any[];
  } | null> {
    const store = await this.ensureStore();
    const source = await store.findNodeByLabel(sourceKey);
    const target = await store.findNodeByLabel(targetKey);
    if (!source || !target) return null;
    return findShortestPath(store, source.id, target.id, maxDepth);
  }

  /** Get or rebuild communities */
  async getCommunities(): Promise<{ communities: Map<number, string[]>; stats: { count: number; avgSize: number } }> {
    const store = await this.ensureStore();
    const communities = await detectCommunities(store);
    const count = communities.size;
    const totalNodes = [...communities.values()].reduce((s, ids) => s + ids.length, 0);
    return {
      communities,
      stats: { count, avgSize: count > 0 ? totalNodes / count : 0 },
    };
  }

  async rebuildCommunities(): Promise<Map<number, string[]>> {
    const store = await this.ensureStore();
    return detectCommunities(store);
  }

  /** Graph statistics */
  async getStats(): Promise<{
    nodeCount: number; edgeCount: number;
    communityCount: number;
    godNodeCount: number;
    godNodes: GraphNode[];
    nodeTypeDistribution: Record<string, number>;
    edgeTypeDistribution: Record<string, number>;
  }> {
    const store = await this.ensureStore();
    let nodes = await store.getAllNodes();
    const edges = await store.getAllEdges();

    // Ensure communities are computed so stats reflect reality
    let communityCount = 0;
    if (nodes.length > 0 && !nodes.some((n: any) => n.communityId !== undefined)) {
      const communities = await this.getCommunities();
      communityCount = communities.stats.count;
      nodes = await Promise.all(nodes.map((n: any) => store.getNode(n.id))).then((arr: any[]) => arr.filter(Boolean));
    } else {
      const communities = await this.getCommunities();
      communityCount = communities.stats.count;
    }

    const nodeTypeDist: Record<string, number> = {};
    const edgeTypeDist: Record<string, number> = {};
    for (const n of nodes) nodeTypeDist[n.type] = (nodeTypeDist[n.type] ?? 0) + 1;
    for (const e of edges) edgeTypeDist[e.type] = (edgeTypeDist[e.type] ?? 0) + 1;

    const nodeCount = store.countNodes ? await store.countNodes() : nodes.length;
    const edgeCount = store.countEdges ? await store.countEdges() : edges.length;
    const godNodes = await identifyGodNodes(store, 5);

    return {
      nodeCount,
      edgeCount,
      communityCount,
      godNodeCount: godNodes.length,
      godNodes,
      nodeTypeDistribution: nodeTypeDist,
      edgeTypeDistribution: edgeTypeDist,
    };
  }

  /** Clear entire graph */
  async clearGraph(): Promise<{ nodesRemoved: number; edgesRemoved: number }> {
    const store = await this.ensureStore();
    if (store.clearGraph) {
      return await store.clearGraph();
    } else {
      // 兼容没有 clearGraph 方法的旧版本存储
      const nodes = await store.getAllNodes();
      const edges = await store.getAllEdges();
      for (const node of nodes) {
        await store.removeNode(node.id);
      }
      return { nodesRemoved: nodes.length, edgesRemoved: edges.length };
    }
  }

  /** Sync all LTM entries into graph */
  async syncFromLTM(ltmEntries: Array<{ id: string; key: string; value: unknown; tags: string[] }>): Promise<{ added: number }> {
    const store = await this.ensureStore();
    let added = 0;
    for (const entry of ltmEntries) {
      const existingNode = await store.findNodeByLabel(entry.key);
      if (!existingNode) {
        await store.addNode({
          id: entry.id,
          label: entry.key,
          type: "ltm",
          tags: entry.tags,
          properties: { value: entry.value },
          createdAt: Date.now(),
        });
        added++;
      }
    }

    // 优化：同步后建立个人信息节点之间的关联
    const allNodes = await store.getAllNodes();
    const corePersonNode = allNodes.find((n: any) => n.label === "user_name");

    if (corePersonNode) {
      // 找出所有个人信息相关的节点
      const personalNodes = allNodes.filter((n: any) => {
        return (
          n.id !== corePersonNode.id &&
          (n.label.startsWith("user_") || n.tags.some((tag: string) =>
            ["personal", "identity", "contact", "职业信息", "技术", "背景"].includes(tag)
          ))
        );
      });

      // 建立关联
      for (const personalNode of personalNodes) {
        const existingEdge = await store.getEdgesBetween(corePersonNode.id, personalNode.id);
        if (existingEdge.length === 0) {
          // 根据属性类型创建语义化的边
          let edgeLabel = "has_property";
          if (personalNode.label.startsWith("user_name")) {
            edgeLabel = "identity";
          } else if (personalNode.label.startsWith("user_phone") || personalNode.label.startsWith("user_email")) {
            edgeLabel = "contact";
          } else if (personalNode.label.startsWith("user_company") || personalNode.label.startsWith("user_job")) {
            edgeLabel = "employment";
          } else if (personalNode.label.startsWith("user_")) {
            edgeLabel = "attribute";
          } else if (personalNode.tags.includes("技术") || personalNode.tags.includes("背景")) {
            edgeLabel = "background";
          } else if (personalNode.tags.includes("职业信息")) {
            edgeLabel = "professional";
          }

          await store.addEdge(corePersonNode.id, personalNode.id, "PERSONAL", edgeLabel);
        }
      }
    }

    // Create TEMPORAL edges based on tag overlap - 优化版本
    // 使用倒排索引避免 O(n²) 复杂度
    if (allNodes.length < 2) return { added };

    // 构建 tag -> nodeIds 倒排索引
    const tagIndex = new Map<string, string[]>();
    for (const node of allNodes) {
      for (const tag of node.tags) {
        // 确保 tag 是字符串类型
        const tagStr = typeof tag === 'string' ? tag : String(tag || '');
        const normalizedTag = tagStr.toLowerCase();
        if (!tagIndex.has(normalizedTag)) {
          tagIndex.set(normalizedTag, []);
        }
        tagIndex.get(normalizedTag)!.push(node.id);
      }
    }

    // 收集需要创建的边（去重）
    const edgesToCreate = new Map<string, { source: string; target: string; sharedTags: string[] }>();
    for (const [tag, nodeIds] of tagIndex) {
      // 只处理有多个节点的 tag
      if (nodeIds.length < 2) continue;

      // 为共享该 tag 的所有节点对创建边
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const nodeId1 = nodeIds[i];
          const nodeId2 = nodeIds[j];
          // 确保边 ID 一致性（小的在前）
          const edgeKey = nodeId1 < nodeId2 ? `${nodeId1}-${nodeId2}` : `${nodeId2}-${nodeId1}`;

          if (!edgesToCreate.has(edgeKey)) {
            edgesToCreate.set(edgeKey, {
              source: nodeId1,
              target: nodeId2,
              sharedTags: [tag]
            });
          } else {
            // 累积共享标签
            edgesToCreate.get(edgeKey)!.sharedTags.push(tag);
          }
        }
      }
    }

    // 批量添加边（跳过已存在的）
    for (const [, edgeData] of edgesToCreate) {
      // 检查是否已存在边
      const existing = await store.getEdgesBetween(edgeData.source, edgeData.target);
      if (existing.length === 0) {
        const uniqueTags = [...new Set(edgeData.sharedTags)];
        await store.addEdge(edgeData.source, edgeData.target, "TEMPORAL", `shared_tags:${uniqueTags.join(",")}`);
      }
    }

    return { added };
  }
}
