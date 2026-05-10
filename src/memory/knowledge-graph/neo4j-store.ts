import crypto from "crypto";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "./types.js";
import neo4j, { Driver, Session } from "neo4j-driver";
import { GraphStore } from "./graph-store.js";
import { LRUCache } from "../../utils/lru-cache.js";

export class Neo4jGraphStore {
  private driver: Driver;
  private owner: string;
  private database: string;

  // 内存缓存 — P1 修复：LRU + TTL 防止 OOM
  private cache: LRUCache<GraphNode>;
  private cacheEdges: LRUCache<GraphEdge>;

  constructor(
    owner: string,
    uri: string = process.env.NEO4J_URI || "bolt://localhost:7687",
    user: string = process.env.NEO4J_USER || "neo4j",
    password: string = process.env.NEO4J_PASSWORD || "raospassword",
    database: string = process.env.NEO4J_DATABASE || "raos"
  ) {
    this.owner = owner;
    this.database = database;
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    this.cache = new LRUCache<GraphNode>(10_000, 5 * 60 * 1000);
    this.cacheEdges = new LRUCache<GraphEdge>(10_000, 5 * 60 * 1000);
  }

  // 关闭连接
  async close(): Promise<void> {
    await this.driver.close();
  }

  // 验证连接
  async verifyConnection(): Promise<boolean> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run("RETURN 1 AS alive");
      return result.records.length > 0;
    } catch (error) {
      console.error("Neo4j connection verification failed:", error);
      return false;
    } finally {
      await session.close();
    }
  }

  // Node operations
  async addNode(node: Omit<GraphNode, "id"> & { id?: string }): Promise<GraphNode> {
    const id = node.id ?? crypto.randomUUID().slice(0, 12);

    // 确保 tags 是数组格式
    const nodeTags = (node as any).tags;
    const tags = Array.isArray(nodeTags) ? nodeTags :
                 typeof nodeTags === 'string' ? nodeTags.split(',').map((t: string) => t.trim()).filter(Boolean) :
                 [];

    const full: GraphNode = { ...node, id, tags, createdAt: node.createdAt ?? Date.now() };

    const session = this.driver.session({ database: this.database });
    try {
      // Neo4j 不支持直接存储 Map/Object，需要序列化为 JSON 字符串
      const propertiesJson = JSON.stringify(full.properties || {});

      await session.run(
        `CREATE (n:KBNode:${full.type} {
          id: $id,
          ownerId: $ownerId,
          label: $label,
          type: $type,
          tags: $tags,
          properties: $properties,
          createdAt: $createdAt
        }) RETURN n`,
        {
          id: full.id,
          ownerId: this.owner,
          label: full.label,
          type: full.type,
          tags: full.tags,
          properties: propertiesJson,
          createdAt: full.createdAt
        }
      );

      this.cache.set(id, full);
      return full;
    } finally {
      await session.close();
    }
  }

  async removeNode(id: string): Promise<boolean> {
    const session = this.driver.session({ database: this.database });
    try {
      // 删除节点及其关联的边
      const result = await session.run(
        `MATCH (n:KBNode {id: $id, ownerId: $ownerId})
         DETACH DELETE n
         RETURN count(n) as deletedCount`,
        { id, ownerId: this.owner }
      );

      const deletedCount = result.records[0]?.get("deletedCount")?.toNumber() || 0;
      this.cache.delete(id);

      // 清除关联边的缓存
      for (const [edgeId, edge] of this.cacheEdges.entries()) {
        if (edge.source === id || edge.target === id) {
          this.cacheEdges.delete(edgeId);
        }
      }

      return deletedCount > 0;
    } finally {
      await session.close();
    }
  }

  async getNode(id: string): Promise<GraphNode | undefined> {
    // 先查缓存
    if (this.cache.has(id)) return this.cache.get(id);

    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (n:KBNode {id: $id, ownerId: $ownerId})
         RETURN n.id as id, n.label as label, n.type as type, n.tags as tags,
                n.properties as properties, n.createdAt as createdAt`,
        { id, ownerId: this.owner }
      );

      if (result.records.length === 0) return undefined;

      const record = result.records[0];
      const propertiesStr = record.get("properties");
      let properties = {};
      if (propertiesStr) {
        try {
          properties = typeof propertiesStr === 'string' ? JSON.parse(propertiesStr) : propertiesStr;
        } catch {
          properties = {};
        }
      }
      const node: GraphNode = {
        id: record.get("id"),
        label: record.get("label"),
        type: record.get("type") as NodeType,
        tags: record.get("tags") || [],
        properties,
        createdAt: record.get("createdAt")
      };

      this.cache.set(id, node);
      return node;
    } finally {
      await session.close();
    }
  }

  async findNodeByLabel(label: string): Promise<GraphNode | undefined> {
    // 先查缓存，但随后要验证数据库中是否真的存在
    let cachedNode: GraphNode | undefined;
    for (const node of this.cache.values()) {
      if (node.label === label) {
        cachedNode = node;
        break;
      }
    }

    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (n:KBNode {label: $label, ownerId: $ownerId})
         RETURN n.id as id, n.label as label, n.type as type, n.tags as tags,
                n.properties as properties, n.createdAt as createdAt`,
        { label, ownerId: this.owner }
      );

      if (result.records.length === 0) {
        // 数据库中不存在，如果缓存中有也清除掉
        if (cachedNode) {
          this.cache.delete(cachedNode.id);
        }
        return undefined;
      }

      const record = result.records[0];
      const propertiesStr = record.get("properties");
      let properties = {};
      if (propertiesStr) {
        try {
          properties = typeof propertiesStr === 'string' ? JSON.parse(propertiesStr) : propertiesStr;
        } catch {
          properties = {};
        }
      }
      const node: GraphNode = {
        id: record.get("id"),
        label: record.get("label"),
        type: record.get("type") as NodeType,
        tags: record.get("tags") || [],
        properties,
        createdAt: record.get("createdAt")
      };

      this.cache.set(node.id, node);
      return node;
    } finally {
      await session.close();
    }
  }

  async findNodesByType(type: NodeType): Promise<GraphNode[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (n:KBNode {type: $type, ownerId: $ownerId})
         RETURN n.id as id, n.label as label, n.type as type, n.tags as tags,
                n.properties as properties, n.createdAt as createdAt`,
        { type, ownerId: this.owner }
      );

      const nodes: GraphNode[] = [];
      for (const record of result.records) {
        const propertiesStr = record.get("properties");
        let properties = {};
        if (propertiesStr) {
          try {
            properties = typeof propertiesStr === 'string' ? JSON.parse(propertiesStr) : propertiesStr;
          } catch {
            properties = {};
          }
        }
        const node: GraphNode = {
          id: record.get("id"),
          label: record.get("label"),
          type: record.get("type") as NodeType,
          tags: record.get("tags") || [],
          properties,
          createdAt: record.get("createdAt")
        };
        this.cache.set(node.id, node);
        nodes.push(node);
      }

      return nodes;
    } finally {
      await session.close();
    }
  }

  async getAllNodes(): Promise<GraphNode[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (n:KBNode {ownerId: $ownerId})
         RETURN n.id as id, n.label as label, n.type as type, n.tags as tags,
                n.properties as properties, n.createdAt as createdAt`,
        { ownerId: this.owner }
      );

      const nodes: GraphNode[] = [];
      for (const record of result.records) {
        const propertiesStr = record.get("properties");
        let properties = {};
        if (propertiesStr) {
          try {
            properties = typeof propertiesStr === 'string' ? JSON.parse(propertiesStr) : propertiesStr;
          } catch {
            properties = {};
          }
        }
        const node: GraphNode = {
          id: record.get("id"),
          label: record.get("label"),
          type: record.get("type") as NodeType,
          tags: record.get("tags") || [],
          properties,
          createdAt: record.get("createdAt")
        };
        this.cache.set(node.id, node);
        nodes.push(node);
      }

      return nodes;
    } finally {
      await session.close();
    }
  }

  // Edge operations
  async addEdge(
    source: string,
    target: string,
    type: EdgeType,
    label: string,
    weight = 1.0
  ): Promise<GraphEdge> {
    // 验证节点存在
    const [sourceNode, targetNode] = await Promise.all([
      this.getNode(source),
      this.getNode(target),
    ]);

    if (!sourceNode || !targetNode) {
      throw new Error(
        `Cannot add edge: node(s) not found (${source} -> ${target})`
      );
    }

    const id = crypto.randomUUID().slice(0, 12);
    const edge: GraphEdge = {
      id,
      source,
      target,
      type,
      label,
      weight,
      createdAt: Date.now(),
    };

    const session = this.driver.session({ database: this.database });
    try {
      // 验证关系类型的安全性
      const safeEdgeType = edge.type.replace(/[^a-zA-Z0-9_]/g, '_');
      await session.run(
        `MATCH (a:KBNode {id: $source, ownerId: $ownerId}),
               (b:KBNode {id: $target, ownerId: $ownerId})
         CREATE (a)-[r:${safeEdgeType} {
           id: $id,
           label: $label,
           type: $type,
           weight: $weight,
           createdAt: $createdAt
         }]->(b)
         RETURN r`,
        {
          source,
          target,
          ownerId: this.owner,
          id: edge.id,
          label: edge.label,
          type: edge.type,
          weight: edge.weight,
          createdAt: edge.createdAt
        }
      );

      this.cacheEdges.set(id, edge);
      return edge;
    } finally {
      await session.close();
    }
  }

  async removeEdge(id: string): Promise<boolean> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH ()-[r {id: $id}]-()
         DELETE r
         RETURN count(r) as deletedCount`,
        { id }
      );

      const deletedCount = result.records[0]?.get("deletedCount")?.toNumber() || 0;
      this.cacheEdges.delete(id);
      return deletedCount > 0;
    } finally {
      await session.close();
    }
  }

  async getEdge(id: string): Promise<GraphEdge | undefined> {
    if (this.cacheEdges.has(id)) return this.cacheEdges.get(id);

    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH ()-[r {id: $id}]-()
         RETURN r.id as id, startNode(r).id as source, endNode(r).id as target,
                r.type as type, r.label as label, r.weight as weight,
                r.createdAt as createdAt`,
        { id }
      );

      if (result.records.length === 0) return undefined;

      const record = result.records[0];
      const edge: GraphEdge = {
        id: record.get("id"),
        source: record.get("source"),
        target: record.get("target"),
        type: record.get("type") as EdgeType,
        label: record.get("label"),
        weight: record.get("weight"),
        createdAt: record.get("createdAt")
      };

      this.cacheEdges.set(id, edge);
      return edge;
    } finally {
      await session.close();
    }
  }

  async getEdgesOf(nodeId: string): Promise<GraphEdge[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (a:KBNode {id: $nodeId, ownerId: $ownerId})-[r]->(b:KBNode)
         RETURN r.id as id, a.id as source, b.id as target,
                r.type as type, r.label as label, r.weight as weight,
                r.createdAt as createdAt
         UNION
         MATCH (a:KBNode)-[r]->(b:KBNode {id: $nodeId, ownerId: $ownerId})
         RETURN r.id as id, a.id as source, b.id as target,
                r.type as type, r.label as label, r.weight as weight,
                r.createdAt as createdAt`,
        { nodeId, ownerId: this.owner }
      );

      const edges: GraphEdge[] = [];
      for (const record of result.records) {
        const edge: GraphEdge = {
          id: record.get("id"),
          source: record.get("source"),
          target: record.get("target"),
          type: record.get("type") as EdgeType,
          label: record.get("label"),
          weight: record.get("weight"),
          createdAt: record.get("createdAt")
        };
        this.cacheEdges.set(edge.id, edge);
        edges.push(edge);
      }

      return edges;
    } finally {
      await session.close();
    }
  }

  async getEdgesBetween(a: string, b: string): Promise<GraphEdge[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (a:KBNode)-[r]-(b:KBNode)
         WHERE a.id IN [$a, $b] AND b.id IN [$a, $b] AND a.id <> b.id
         RETURN r.id as id, startNode(r).id as source, endNode(r).id as target,
                r.type as type, r.label as label, r.weight as weight,
                r.createdAt as createdAt`,
        { a, b }
      );

      return result.records.map(record => {
        const edge: GraphEdge = {
          id: record.get("id"),
          source: record.get("source"),
          target: record.get("target"),
          type: record.get("type") as EdgeType,
          label: record.get("label"),
          weight: record.get("weight"),
          createdAt: record.get("createdAt")
        };
        this.cacheEdges.set(edge.id, edge);
        return edge;
      });
    } finally {
      await session.close();
    }
  }

  async getAllEdges(): Promise<GraphEdge[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (a:KBNode {ownerId: $ownerId})-[r]-(b:KBNode)
         RETURN r.id as id, startNode(r).id as source, endNode(r).id as target,
                r.type as type, r.label as label, r.weight as weight,
                r.createdAt as createdAt`,
        { ownerId: this.owner }
      );

      return result.records.map(record => {
        const edge: GraphEdge = {
          id: record.get("id"),
          source: record.get("source"),
          target: record.get("target"),
          type: record.get("type") as EdgeType,
          label: record.get("label"),
          weight: record.get("weight"),
          createdAt: record.get("createdAt")
        };
        this.cacheEdges.set(edge.id, edge);
        return edge;
      });
    } finally {
      await session.close();
    }
  }

  // Graph queries
  async getNeighbors(nodeId: string): Promise<GraphNode[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (a:KBNode {id: $nodeId, ownerId: $ownerId})-[r]-(b:KBNode)
         RETURN b.id as id, b.label as label, b.type as type, b.tags as tags,
                b.properties as properties, b.createdAt as createdAt`,
        { nodeId, ownerId: this.owner }
      );

      const neighbors: GraphNode[] = [];
      for (const record of result.records) {
        const node: GraphNode = {
          id: record.get("id"),
          label: record.get("label"),
          type: record.get("type") as NodeType,
          tags: record.get("tags") || [],
          properties: record.get("properties") || {},
          createdAt: record.get("createdAt")
        };
        this.cache.set(node.id, node);
        neighbors.push(node);
      }

      return neighbors;
    } finally {
      await session.close();
    }
  }

  async getDegree(nodeId: string): Promise<number> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (a:KBNode {id: $nodeId, ownerId: $ownerId})-[r]-()
         RETURN count(r) as degree`,
        { nodeId, ownerId: this.owner }
      );

      return result.records[0]?.get("degree")?.toNumber() || 0;
    } finally {
      await session.close();
    }
  }

  async countNodes(): Promise<number> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (n:KBNode {ownerId: $ownerId})
         RETURN count(n) as count`,
        { ownerId: this.owner }
      );

      return result.records[0]?.get("count")?.toNumber() || 0;
    } finally {
      await session.close();
    }
  }

  async countEdges(): Promise<number> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (a:KBNode {ownerId: $ownerId})-[r]-(b:KBNode)
         RETURN count(r) as count`,
        { ownerId: this.owner }
      );

      return result.records[0]?.get("count")?.toNumber() || 0;
    } finally {
      await session.close();
    }
  }

  // Getter versions for backward compatibility (returns Promise)
  get nodeCount(): Promise<number> {
    return this.countNodes();
  }

  get edgeCount(): Promise<number> {
    return this.countEdges();
  }

  /**
   * 知识图谱节点去重
   * - 完全匹配：标签完全相同直接合并
   * - 近似匹配：大小写/空格/标点标准化后相同合并
   * - 合并策略：保留较早节点，将所有边转移到保留节点
   */
  async deduplicateNodes(): Promise<{ merged: number; removed: number }> {
    let mergedCount = 0;
    let removedCount = 0;

    // 1. 按标准化标签分组
    const allNodes = await this.getAllNodes();
    const labelGroups = new Map<string, string[]>();

    for (const node of allNodes) {
      const normalized = this.normalizeLabel(node.label);
      const group = labelGroups.get(normalized);
      if (!group) {
        labelGroups.set(normalized, [node.id]);
      } else {
        group.push(node.id);
      }
    }

    // 2. 处理每组重复/相似节点
    for (const [, nodeIds] of labelGroups.entries()) {
      if (nodeIds.length <= 1) continue;

      // 保留创建时间最早的节点
      let keepId = nodeIds[0];
      let keepNode = await this.getNode(keepId);

      for (const nodeId of nodeIds) {
        const node = await this.getNode(nodeId);
        if (node && keepNode && node.createdAt < keepNode.createdAt) {
          keepId = nodeId;
          keepNode = node;
        }
      }

      if (!keepNode) continue;

      // 合并其他节点到保留节点
      for (const removeId of nodeIds) {
        if (removeId === keepId) continue;

        // 获取所有需要转移的边
        const edgesToTransfer = (await this.getAllEdges()).filter(
          (e) => e.source === removeId || e.target === removeId
        );

        // 先添加新边，再删除旧边
        for (const edge of edgesToTransfer) {
          const otherEnd = edge.source === removeId ? edge.target : edge.source;
          const otherNode = await this.getNode(otherEnd);
          if (!otherNode) continue;

          // 检查是否已有相同关系的边，避免重复
          const existingEdges = await this.getEdgesBetween(keepId, otherEnd);
          const hasSameRelation = existingEdges.some((e) => e.label === edge.label);

          if (!hasSameRelation) {
            try {
              await this.addEdge(
                edge.source === removeId ? keepId : otherEnd,
                edge.target === removeId ? keepId : otherEnd,
                edge.type,
                edge.label,
                edge.weight
              );
            } catch {
              // 忽略错误，继续处理
            }
          }
        }

        // 删除旧节点（会自动删除关联边）
        await this.removeNode(removeId);
        mergedCount++;
        removedCount++;
      }
    }

    return { merged: mergedCount, removed: removedCount };
  }

  /**
   * 标准化标签用于去重
   * - 小写
   * - 移除多余空格、标点
   * - 统一分隔符
   */
  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[_\-\s]+/g, "_")
      .replace(/[^a-z0-9\u4e00-\u9fff_]/g, "")
      .replace(/^_+|_+$/g, "")
      .trim();
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheEdges.clear();
  }

  /**
   * 清除所有节点和边（清空整个图谱）
   */
  async clearGraph(): Promise<{ nodesRemoved: number; edgesRemoved: number }> {
    const session = this.driver.session({ database: this.database });
    try {
      // 获取要删除的节点和边的数量
      const countResult = await session.run(
        `MATCH (n:KBNode {ownerId: $ownerId})
         OPTIONAL MATCH (n)-[r]-()
         RETURN count(n) as nodeCount, count(r) as edgeCount`,
        { ownerId: this.owner }
      );

      const nodeCount = countResult.records[0]?.get("nodeCount")?.toNumber() || 0;
      const edgeCount = countResult.records[0]?.get("edgeCount")?.toNumber() || 0;

      // 删除所有节点（会自动删除关联的边）
      await session.run(
        `MATCH (n:KBNode {ownerId: $ownerId})
         DETACH DELETE n`,
        { ownerId: this.owner }
      );

      // 清除内存缓存
      this.clearCache();

      return { nodesRemoved: nodeCount, edgesRemoved: edgeCount };
    } finally {
      await session.close();
    }
  }
}

// 工厂方法
export function getGraphStore(
  owner: string,
  backend: string = process.env.GRAPH_STORE_BACKEND || "mysql"
): unknown {
  if (backend === "neo4j") {
    return new Neo4jGraphStore(owner);
  } else {
    // 默认使用 MySQL 版本
    return new GraphStore(owner);
  }
}
