import { GraphStore } from "./graph-store.js";
import { extractSubgraph, findShortestPath } from "./bfs-extractor.js";
import { detectCommunities } from "./community-detection.js";
import { identifyGodNodes, scoreSurprise } from "./scoring.js";
import { extractRelationships, extractTagRelationships } from "./relationship-extractor.js";
import type { GraphNode, SubgraphResult, NodeType } from "./types.js";
import type { BFSOptions } from "./bfs-extractor.js";
import type { LLMProvider } from "../../llm/types.js";

export class KnowledgeGraphManager {
  private store: GraphStore;
  private llmProvider?: LLMProvider;

  constructor(storePath: string, llmProvider?: LLMProvider) {
    this.store = new GraphStore(storePath);
    this.llmProvider = llmProvider;
  }

  /** Called after ltm_store — auto-creates graph node and edges */
  async onFactStored(entry: {
    id: string; key: string; value: unknown; tags: string[]; relation?: string;
  }): Promise<void> {
    // 1. Create or update node
    let node = this.store.findNodeByLabel(entry.key);
    if (!node) {
      node = this.store.addNode({
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
      const targetNode = this.store.findNodeByLabel(entry.relation);
      if (targetNode) {
        // Avoid duplicate edges
        const existing = this.store.getEdgesBetween(node.id, targetNode.id);
        if (existing.length === 0) {
          this.store.addEdge(node.id, targetNode.id, "EXTRACTED", "related_to");
        }
      }
    }

    // 3. Tag-based TEMPORAL edges
    const existingNodes = this.store.getAllNodes()
      .filter(n => n.id !== node!.id)
      .map(n => ({ id: n.id, label: n.label, tags: n.tags }));
    const tagRelations = extractTagRelationships(entry.tags, existingNodes);
    for (const rel of tagRelations.slice(0, 5)) { // max 5 tag edges per entry
      const existing = this.store.getEdgesBetween(node.id, rel.targetId);
      if (existing.length === 0) {
        this.store.addEdge(node.id, rel.targetId, "TEMPORAL", `shared_tags:${rel.sharedTags.join(",")}`);
      }
    }
  }

  /** BFS subgraph query */
  querySubgraph(query: string, options?: BFSOptions): SubgraphResult {
    return extractSubgraph(this.store, query, options);
  }

  /** Shortest path between two node labels */
  getPath(sourceKey: string, targetKey: string, maxDepth = 10): {
    path: GraphNode[]; edges: any[];
  } | null {
    const source = this.store.findNodeByLabel(sourceKey);
    const target = this.store.findNodeByLabel(targetKey);
    if (!source || !target) return null;
    return findShortestPath(this.store, source.id, target.id, maxDepth);
  }

  /** Get or rebuild communities */
  getCommunities(): { communities: Map<number, string[]>; stats: { count: number; avgSize: number } } {
    const communities = detectCommunities(this.store);
    const count = communities.size;
    const totalNodes = [...communities.values()].reduce((s, ids) => s + ids.length, 0);
    return {
      communities,
      stats: { count, avgSize: count > 0 ? totalNodes / count : 0 },
    };
  }

  rebuildCommunities(): Map<number, string[]> {
    return detectCommunities(this.store);
  }

  /** Graph statistics */
  getStats(): {
    nodeCount: number; edgeCount: number;
    godNodes: GraphNode[];
    nodeTypeDistribution: Record<string, number>;
    edgeTypeDistribution: Record<string, number>;
  } {
    const nodes = this.store.getAllNodes();
    const edges = this.store.getAllEdges();
    const nodeTypeDist: Record<string, number> = {};
    const edgeTypeDist: Record<string, number> = {};
    for (const n of nodes) nodeTypeDist[n.type] = (nodeTypeDist[n.type] ?? 0) + 1;
    for (const e of edges) edgeTypeDist[e.type] = (edgeTypeDist[e.type] ?? 0) + 1;

    return {
      nodeCount: this.store.nodeCount,
      edgeCount: this.store.edgeCount,
      godNodes: identifyGodNodes(this.store, 5),
      nodeTypeDistribution: nodeTypeDist,
      edgeTypeDistribution: edgeTypeDist,
    };
  }

  /** Sync all LTM entries into graph */
  async syncFromLTM(ltmEntries: Array<{ id: string; key: string; value: unknown; tags: string[] }>): Promise<{ added: number }> {
    let added = 0;
    for (const entry of ltmEntries) {
      if (!this.store.findNodeByLabel(entry.key)) {
        this.store.addNode({
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
    // Create TEMPORAL edges based on tag overlap
    const allNodes = this.store.getAllNodes();
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const shared = allNodes[i].tags.filter(t => allNodes[j].tags.includes(t));
        if (shared.length > 0 && this.store.getEdgesBetween(allNodes[i].id, allNodes[j].id).length === 0) {
          this.store.addEdge(allNodes[i].id, allNodes[j].id, "TEMPORAL", `shared_tags:${shared.join(",")}`);
        }
      }
    }
    return { added };
  }

  getStore(): GraphStore { return this.store; }
}
