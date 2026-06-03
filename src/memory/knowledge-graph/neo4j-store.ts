import crypto from "crypto";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "./types.js";
import neo4j, { Driver, Session } from "neo4j-driver";
import { GraphStore } from "./graph-store.js";
import { LRUCache } from "../../utils/lru-cache.js";

/** 兼容属性字段可能为 string 或 object */
function safeJsonParse(s: any): Record<string, unknown> {
  if (s == null) return {};
  if (typeof s === "object") return s;
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export class Neo4jGraphStore {
  private driver: Driver;
  private owner: string;
  private database: string;

  // 内存缓存 — P1 修复：LRU + TTL 防止 OOM
  private cache: LRUCache<GraphNode>;
  private cacheEdges: LRUCache<GraphEdge>;

  /**
   * 从 Neo4j record 提取 KG v2 扩展字段到 GraphEdge 顶层。
   */
  private applyEdgeExtendedFields(edge: GraphEdge, record: any): GraphEdge {
    const sourceChunkId = record.get("sourceChunkId");
    const evidence = record.get("evidence");
    const feedbackScore = record.get("feedbackScore");
    const version = record.get("version");
    const validFrom = record.get("validFrom");
    const validTo = record.get("validTo");
    if (edge.sourceChunkId === undefined && sourceChunkId != null) edge.sourceChunkId = String(sourceChunkId);
    if (edge.evidence === undefined && evidence != null) edge.evidence = String(evidence);
    if (edge.feedbackScore === undefined && feedbackScore != null) edge.feedbackScore = Number(feedbackScore);
    if (edge.version === undefined && version != null) edge.version = Number(version);
    if (edge.validFrom === undefined && validFrom != null) edge.validFrom = Number(validFrom);
    if (edge.validTo === undefined && validTo != null) edge.validTo = Number(validTo);
    return edge;
  }

  constructor(
    owner: string,
    uri: string = process.env.NEO4J_URI || "bolt://localhost:7687",
    user: string = process.env.NEO4J_USER || "neo4j",
    password: string = process.env.NEO4J_PASSWORD || "",
    database: string = process.env.NEO4J_DATABASE || "raos",
    options?: {
      maxConnectionPoolSize?: number;
      connectionAcquisitionTimeout?: number;
      maxTransactionRetryTime?: number;
      /** 测试用：注入一个预构建的 driver (跳过真实连接)，仅供 mock 单测 */
      injectedDriver?: Driver;
    }
  ) {
    this.owner = owner;
    this.database = database;
    // KG v2 阶段 5: 连接池配置
    // 默认 maxConnectionPoolSize=50, 原来 driver 创建时无配置，默认 100，但未设置获取超时
    const driverConfig: any = {
      maxConnectionPoolSize: options?.maxConnectionPoolSize ?? 50,
      connectionAcquisitionTimeout: options?.connectionAcquisitionTimeout ?? 30_000,
      maxTransactionRetryTime: options?.maxTransactionRetryTime ?? 15_000,
      // 禁用未加密警告（生产应配 encrypted=true）
      disableLosslessIntegers: true,
    };
    // 测试注入 driver 时不校验 password (单测用 mock)
    if (options?.injectedDriver) {
      this.driver = options.injectedDriver;
    } else {
      if (!password) {
        throw new Error("Neo4j password is required. Set NEO4J_PASSWORD environment variable.");
      }
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), driverConfig);
    }
    this.cache = new LRUCache<GraphNode>(10_000, 5 * 60 * 1000);
    this.cacheEdges = new LRUCache<GraphEdge>(10_000, 5 * 60 * 1000);

    // 阶段 5: 启动时确保 fulltext index 存在（异步、不阻塞构造）
    this.ensureFulltextIndex().catch((err) => {
      console.warn(`[Neo4jGraphStore] Failed to ensure fulltext index: ${(err as Error).message}`);
    });
  }

  /**
   * KG v2 阶段 5: 一次性创建/确保 fulltext 索引存在。
   *
   * P1-2 修复（v3 review）：索引只覆盖 label / tags，不再覆盖 n.properties.value。
   * 原因：properties 是 JSON 字符串（如 `{"sourceDoc":"foo.md"}`），fulltext 索引
   *       把整个 JSON 当字符串建索引，搜中文/英文实体时**完全搜不到**——是死索引。
   *       真正有内容语义的字段应该提到节点顶级属性，而不是塞进 properties JSON。
   */
  private async ensureFulltextIndex(): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.run(
        `CREATE FULLTEXT INDEX node_search IF NOT EXISTS FOR (n:KBNode) ON EACH [n.label, n.tags]`
      );
    } finally {
      await session.close();
    }
  }

  /**
   * KG v2 阶段 5: 用 Neo4j fulltext 索引搜索节点（替代 scoreNodes 的 getAllNodes 全量扫描）。
   * 返回按 score 降序的节点列表。
   */
  async searchNodesByKeywords(terms: string[], limit = 50): Promise<Array<{ node: GraphNode; score: number }>> {
    if (terms.length === 0) return [];
    // Lucene 全文查询语法：term 之间用 AND
    const luceneQuery = terms
      .filter((t) => t.length > 1)
      .map((t) => {
        // 转义 Lucene 特殊字符
        const escaped = t.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, " ");
        return `(${escaped})`;
      })
      .join(" AND ");

    if (!luceneQuery) return [];

    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `CALL db.index.fulltext.queryNodes('node_search', $query) YIELD node, score
         WHERE node.ownerId = $ownerId
         RETURN node.id as id, node.label as label, node.type as type, node.tags as tags,
                node.properties as properties, node.createdAt as createdAt,
                node.version as version, node.importance as importance,
                score
         ORDER BY score DESC
         LIMIT $limit`,
        { query: luceneQuery, ownerId: this.owner, limit }
      );

      const scored: Array<{ node: GraphNode; score: number }> = [];
      for (const record of result.records) {
        const propsStr = record.get("properties");
        const properties = typeof propsStr === "string" ? safeJsonParse(propsStr) : (propsStr || {});
        const node: GraphNode = {
          id: record.get("id"),
          label: record.get("label"),
          type: record.get("type") as NodeType,
          tags: record.get("tags") || [],
          properties,
          createdAt: record.get("createdAt"),
          version: record.get("version") != null ? Number(record.get("version")) : undefined,
          importance: record.get("importance") != null ? Number(record.get("importance")) : undefined,
        };
        scored.push({ node, score: record.get("score") });
      }
      return scored;
    } finally {
      await session.close();
    }
  }

  /**
   * KG v2 阶段 5: 通用 session helper。
   * 把 try/finally 模式统一起来，减少每个方法里的 boilerplate。
   */
  private async withSession<T>(mode: "READ" | "WRITE", fn: (session: Session) => Promise<T>): Promise<T> {
    const session = this.driver.session({
      database: this.database,
      defaultAccessMode: mode === "WRITE" ? neo4j.session.WRITE : neo4j.session.READ,
    });
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
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
    weight = 1.0,
    options?: {
      sourceChunkId?: string;
      evidence?: string;
      feedbackScore?: number;
      validFrom?: number;
      validTo?: number;
    }
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
      sourceChunkId: options?.sourceChunkId,
      evidence: options?.evidence,
      feedbackScore: options?.feedbackScore,
      version: 1,
      validFrom: options?.validFrom,
      validTo: options?.validTo,
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
           createdAt: $createdAt,
           version: $version,
           sourceChunkId: $sourceChunkId,
           evidence: $evidence,
           feedbackScore: $feedbackScore,
           validFrom: $validFrom,
           validTo: $validTo
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
          createdAt: edge.createdAt,
          version: edge.version ?? 1,
          sourceChunkId: edge.sourceChunkId ?? null,
          evidence: edge.evidence ?? null,
          feedbackScore: edge.feedbackScore ?? null,
          validFrom: edge.validFrom ?? null,
          validTo: edge.validTo ?? null,
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
      // v2 review §2: 必须限定 ownerId，避免跨用户误删（虽然 edge id 撞库概率极低）
      // 通过端点节点的 ownerId 限定：MATCH (a:KBNode {ownerId: $ownerId})-[r {id: $id}]-(b:KBNode)
      const result = await session.run(
        `MATCH (a:KBNode {ownerId: $ownerId})-[r {id: $id}]-(b:KBNode)
         DELETE r
         RETURN count(r) as deletedCount`,
        { id, ownerId: this.owner }
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
                r.type as type, r.label as label, r.weight as weight, r.version as version, r.sourceChunkId as sourceChunkId, r.evidence as evidence, r.feedbackScore as feedbackScore, r.validFrom as validFrom, r.validTo as validTo,
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
      this.applyEdgeExtendedFields(edge, record);
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
                r.type as type, r.label as label, r.weight as weight, r.version as version, r.sourceChunkId as sourceChunkId, r.evidence as evidence, r.feedbackScore as feedbackScore, r.validFrom as validFrom, r.validTo as validTo,
                r.createdAt as createdAt
         UNION
         MATCH (a:KBNode)-[r]->(b:KBNode {id: $nodeId, ownerId: $ownerId})
         RETURN r.id as id, a.id as source, b.id as target,
                r.type as type, r.label as label, r.weight as weight, r.version as version, r.sourceChunkId as sourceChunkId, r.evidence as evidence, r.feedbackScore as feedbackScore, r.validFrom as validFrom, r.validTo as validTo,
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
        this.applyEdgeExtendedFields(edge, record);
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
                r.type as type, r.label as label, r.weight as weight, r.version as version, r.sourceChunkId as sourceChunkId, r.evidence as evidence, r.feedbackScore as feedbackScore, r.validFrom as validFrom, r.validTo as validTo,
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
        this.applyEdgeExtendedFields(edge, record);
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
                r.type as type, r.label as label, r.weight as weight, r.version as version, r.sourceChunkId as sourceChunkId, r.evidence as evidence, r.feedbackScore as feedbackScore, r.validFrom as validFrom, r.validTo as validTo,
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
        this.applyEdgeExtendedFields(edge, record);
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

  /**
   * P2-12 (#8 Neo4j APOC path): MySQL recursive CTE 在 Neo4j 上的等价物
   *
   * 优先用 `apoc.path.subgraphAll()`（BFS-native，O(1) round-trip）
   * fallback 到 Cypher variable-length path（无 APOC 环境）
   *
   * 返回 shape 必须跟 GraphStore.extractSubgraphCTE 完全一致：
   *   { nodeIds: string[]; edges: [{id, source, target, type, label}] }
   * bfs-extractor.ts 用 `if (store.extractSubgraphCTE)` 判定调用
   */
  async extractSubgraphCTE(
    seedNodeIds: string[],
    maxDepth: number = 3,
    maxNodes: number = 50
  ): Promise<{ nodeIds: string[]; edges: Array<{ id: string; source: string; target: string; type: string; label: string }> }> {
    if (seedNodeIds.length === 0) return { nodeIds: [], edges: [] };

    const session = this.driver.session({ database: this.database });
    try {
      // ===== 路径 1: APOC subgraphAll (BFS, 推荐) =====
      try {
        const apocResult = await session.run(
          `MATCH (seed:KBNode)
           WHERE seed.id IN $seedIds AND seed.ownerId = $ownerId
           CALL apoc.path.subgraphAll(seed, {
             relationshipFilter: '',
             maxLevel: $maxDepth,
             limit: $maxNodes,
             bfs: true
           }) YIELD nodes, relationships
           WITH [n IN nodes | n.id] AS nodeIds,
                collect({
                  id: toString(id(rel)),
                  source: coalesce(startNode(rel).id, ''),
                  target: coalesce(endNode(rel).id, ''),
                  type: coalesce(type(rel), ''),
                  label: coalesce(rel.label, '')
                }) AS relData
           UNWIND relData AS r
           WITH nodeIds, collect(r) AS edges
           RETURN nodeIds, edges`,
          { seedIds: seedNodeIds, ownerId: this.owner, maxDepth, maxNodes }
        );

        if (apocResult.records.length > 0) {
          const record = apocResult.records[0];
          return {
            nodeIds: record.get("nodeIds") as string[],
            edges: record.get("edges") as Array<{ id: string; source: string; target: string; type: string; label: string }>,
          };
        }
        // 走到这里说明 APOC 返回空（seed 全不在）—— 试 fallback
      } catch (err: any) {
        // APOC 没装（Neo4j Community / 没装插件）→ fallback
        if (err?.code === "Neo.ClientError.Procedure.ProcedureNotFound" || /apoc/i.test(err?.message || "")) {
          // fall through
        } else {
          throw err; // 别的错误不吞
        }
      }

      // ===== 路径 2: Cypher variable-length path fallback =====
      // 不依赖 APOC；用 -[*..maxDepth]- 无向遍历
      // 两段：先拉 nodes，再拉 edges（避免单 query 太大）
      const nodeResult = await session.run(
        `MATCH (seed:KBNode) WHERE seed.id IN $seedIds AND seed.ownerId = $ownerId
         MATCH path = (seed)-[*0..${maxDepth}]-(related:KBNode)
         WHERE related.ownerId = $ownerId
         WITH collect(DISTINCT related) + collect(DISTINCT seed) AS allNodes
         UNWIND allNodes AS n
         WITH collect(DISTINCT n.id) AS nodeIds
         RETURN nodeIds[..${maxNodes}] AS nodeIds`,
        { seedIds: seedNodeIds, ownerId: this.owner }
      );

      if (nodeResult.records.length === 0) {
        return { nodeIds: [], edges: [] };
      }
      const nodeIds: string[] = nodeResult.records[0].get("nodeIds") as string[];

      // 拉 edges
      const edgeResult = await session.run(
        `MATCH (a:KBNode)-[r]->(b:KBNode)
         WHERE a.ownerId = $ownerId AND b.ownerId = $ownerId
           AND a.id IN $nodeIds AND b.id IN $nodeIds
         RETURN toString(id(r)) AS id, a.id AS source, b.id AS target,
                type(r) AS type, coalesce(r.label, '') AS label
         LIMIT ${maxNodes * 2}`,
        { ownerId: this.owner, nodeIds }
      );

      const edges = edgeResult.records.map((record) => ({
        id: record.get("id"),
        source: record.get("source"),
        target: record.get("target"),
        type: record.get("type"),
        label: record.get("label"),
      }));

      return { nodeIds, edges };
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
