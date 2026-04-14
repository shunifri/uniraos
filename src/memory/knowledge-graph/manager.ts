import { GraphStore } from "./graph-store.js";
import { extractSubgraph, findShortestPath } from "./bfs-extractor.js";
import { detectCommunities } from "./community-detection.js";
import { identifyGodNodes, scoreSurprise } from "./scoring.js";
import { extractRelationships, extractTagRelationships } from "./relationship-extractor.js";
import type { GraphNode, SubgraphResult, NodeType } from "./types.js";
import type { BFSOptions } from "./bfs-extractor.js";
import type { LLMProvider } from "../../llm/types.js";

export class KnowledgeGraphManager {
  private store: any; // 使用 any 类型以兼容不同的存储实现
  private llmProvider?: LLMProvider;
  private backend: string;

  constructor(
    owner: string,
    llmProvider?: LLMProvider,
    backend: string = process.env.GRAPH_STORE_BACKEND || "mysql"
  ) {
    this.backend = backend;
    this.store = this.createStore(owner, backend);
    this.llmProvider = llmProvider;
  }

  private createStore(owner: string, backend: string): any {
    if (backend === "neo4j") {
      const { Neo4jGraphStore } = require("./neo4j-store.js");
      return new Neo4jGraphStore(owner);
    } else {
      return new GraphStore(owner);
    }
  }

  /** Called after ltm_store — auto-creates graph node and edges */
  async onFactStored(entry: {
    id: string; key: string; value: unknown; tags: string[]; relation?: string;
  }): Promise<void> {
    // 1. Create or update node
    let node = await this.store.findNodeByLabel(entry.key);
    if (!node) {
      node = await this.store.addNode({
        id: entry.id,
        label: entry.key,
        type: "ltm" as NodeType,
        tags: entry.tags,
        properties: { value: entry.value },
        createdAt: Date.now(),
      });
    }

    // 2. If relation param provided, create EXTRACTED edge to target
    if (entry.relation) {
      const targetNode = await this.store.findNodeByLabel(entry.relation);
      if (targetNode) {
        // Avoid duplicate edges
        const existing = await this.store.getEdgesBetween(node.id, targetNode.id);
        if (existing.length === 0) {
          await this.store.addEdge(node.id, targetNode.id, "EXTRACTED", "related_to");
        }
      }
    }

    // 3. Tag-based TEMPORAL edges
    const existingNodes = (await this.store.getAllNodes())
      .filter((n: any) => n.id !== node!.id)
      .map((n: any) => ({ id: n.id, label: n.label, tags: n.tags }));
    const tagRelations = extractTagRelationships(entry.tags, existingNodes);
    for (const rel of tagRelations.slice(0, 5)) { // max 5 tag edges per entry
      const existing = await this.store.getEdgesBetween(node.id, rel.targetId);
      if (existing.length === 0) {
        await this.store.addEdge(node.id, rel.targetId, "TEMPORAL", `shared_tags:${rel.sharedTags.join(",")}`);
      }
    }
  }

  /** BFS subgraph query */
  async querySubgraph(query: string, options?: BFSOptions): Promise<SubgraphResult> {
    return extractSubgraph(this.store, query, options);
  }

  /** Shortest path between two node labels */
  async getPath(sourceKey: string, targetKey: string, maxDepth = 10): Promise<{
    path: GraphNode[]; edges: any[];
  } | null> {
    const source = await this.store.findNodeByLabel(sourceKey);
    const target = await this.store.findNodeByLabel(targetKey);
    if (!source || !target) return null;
    return findShortestPath(this.store, source.id, target.id, maxDepth);
  }

  /** Get or rebuild communities */
  async getCommunities(): Promise<{ communities: Map<number, string[]>; stats: { count: number; avgSize: number } }> {
    const communities = await detectCommunities(this.store);
    const count = communities.size;
    const totalNodes = [...communities.values()].reduce((s, ids) => s + ids.length, 0);
    return {
      communities,
      stats: { count, avgSize: count > 0 ? totalNodes / count : 0 },
    };
  }

  async rebuildCommunities(): Promise<Map<number, string[]>> {
    return detectCommunities(this.store);
  }

  /** Graph statistics */
  async getStats(): Promise<{
    nodeCount: number; edgeCount: number;
    godNodes: GraphNode[];
    nodeTypeDistribution: Record<string, number>;
    edgeTypeDistribution: Record<string, number>;
  }> {
    const nodes = await this.store.getAllNodes();
    const edges = await this.store.getAllEdges();
    const nodeTypeDist: Record<string, number> = {};
    const edgeTypeDist: Record<string, number> = {};
    for (const n of nodes) nodeTypeDist[n.type] = (nodeTypeDist[n.type] ?? 0) + 1;
    for (const e of edges) edgeTypeDist[e.type] = (edgeTypeDist[e.type] ?? 0) + 1;

    return {
      nodeCount: await this.store.nodeCount,
      edgeCount: await this.store.edgeCount,
      godNodes: await identifyGodNodes(this.store, 5),
      nodeTypeDistribution: nodeTypeDist,
      edgeTypeDistribution: edgeTypeDist,
    };
  }

  /** Sync all LTM entries into graph */
  async syncFromLTM(ltmEntries: Array<{ id: string; key: string; value: unknown; tags: string[] }>): Promise<{ added: number }> {
    let added = 0;
    for (const entry of ltmEntries) {
      const existingNode = await this.store.findNodeByLabel(entry.key);
      if (!existingNode) {
        await this.store.addNode({
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
    // Create TEMPORAL edges based on tag overlap - 优化版本
    // 使用倒排索引避免 O(n²) 复杂度
    const allNodes = await this.store.getAllNodes();
    if (allNodes.length < 2) return { added };
    
    // 构建 tag -> nodeIds 倒排索引
    const tagIndex = new Map<string, string[]>();
    for (const node of allNodes) {
      for (const tag of node.tags) {
        const normalizedTag = tag.toLowerCase();
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
      const existing = await this.store.getEdgesBetween(edgeData.source, edgeData.target);
      if (existing.length === 0) {
        const uniqueTags = [...new Set(edgeData.sharedTags)];
        await this.store.addEdge(edgeData.source, edgeData.target, "TEMPORAL", `shared_tags:${uniqueTags.join(",")}`);
      }
    }
    
    return { added };
  }

  getStore(): any { return this.store; }
}
