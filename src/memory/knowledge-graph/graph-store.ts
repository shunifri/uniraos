import crypto from "crypto";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "./types.js";
import { getMySQLAdapter, type MySQLAdapter } from "../../db/mysql-adapter.js";
import { LRUCache } from "../../utils/lru-cache.js";

interface NodeRow {
  id: string;
  label: string;
  type: NodeType;
  tags: string;
  properties: string;
  community_id: number | null;
  created_at: number;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  type: EdgeType;
  label: string;
  weight: number;
  created_at: number;
}

interface CountRow {
  count: number;
}

export class GraphStore {
  private adapter: MySQLAdapter;
  private owner: string;
  // 内存缓存 — P1 修复：LRU + TTL 防止 OOM
  private cache: LRUCache<GraphNode>;
  private cacheEdges: LRUCache<GraphEdge>;

  constructor(owner: string) {
    this.adapter = getMySQLAdapter();
    this.owner = owner;
    // P1 修复：LRU 缓存上限 10000 + TTL 5 分钟，防止 OOM
    this.cache = new LRUCache<GraphNode>(10_000, 5 * 60 * 1000);
    this.cacheEdges = new LRUCache<GraphEdge>(10_000, 5 * 60 * 1000);
  }

  // 辅助方法：解析 tags（兼容旧格式）
  private parseTags(tagsStr: string | null): string[] {
    if (!tagsStr) return [];
    try {
      // 尝试 JSON 解析
      const parsed = JSON.parse(tagsStr);
      if (Array.isArray(parsed)) {
        // 深度扁平化处理嵌套数组，并确保都是字符串
        const flatten = (arr: any[]): any[] => arr.reduce((acc, val) => acc.concat(Array.isArray(val) ? flatten(val) : val), []);
        const flatTags = flatten(parsed).map((t: any) => typeof t === 'string' ? t : String(t)).filter(Boolean);
        // 如果扁平化后，我们仍然有嵌套数组，强制展开
        return flatTags.flat(Infinity).map((t: any) => typeof t === 'string' ? t : String(t)).filter(Boolean);
      }
      return [];
    } catch {
      // 兼容旧格式：逗号分隔的字符串
      if (tagsStr.includes(',')) {
        return tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      }
      // 单个值
      return tagsStr ? [tagsStr] : [];
    }
  }

  // 辅助方法：解析 properties（兼容旧格式）
  private parseProperties(propsStr: string | null | Record<string, unknown>): Record<string, unknown> {
    if (!propsStr) return {};
    if (typeof propsStr === 'object') return propsStr;
    try {
      return JSON.parse(propsStr);
    } catch {
      return { value: propsStr };
    }
  }

  // Node operations (优化版)
  async addNode(node: Omit<GraphNode, "id"> & { id?: string }): Promise<GraphNode> {
    const id = node.id ?? crypto.randomUUID().slice(0, 12);

    // 确保 tags 是数组格式，并且扁平化（移除嵌套数组）
    const nodeTags = (node as any).tags;
    const tags = Array.isArray(nodeTags) ?
      nodeTags.flat().map((t: any) => typeof t === 'string' ? t : String(t)).filter(Boolean) :
      typeof nodeTags === 'string' ? nodeTags.split(',').map((t: string) => t.trim()).filter(Boolean) :
      [];

    // 进一步过滤掉空字符串
    const filteredTags = tags.map((t: string) => t.trim()).filter(Boolean);

    const properties = { ...(node.properties ?? {}) };
    if (node.communityId !== undefined) {
      properties._communityId = node.communityId;
    }
    const full: GraphNode = { ...node, id, tags: filteredTags, createdAt: node.createdAt ?? Date.now(), properties };

    await this.adapter.execute(
      `INSERT INTO kb_graph_nodes (id, owner_id, label, type, tags, properties, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, this.owner, full.label, full.type, JSON.stringify(full.tags), JSON.stringify(full.properties), full.createdAt]
    );

    this.cache.set(id, full);
    return full;
  }

  async removeNode(id: string): Promise<boolean> {
    // 先删除关联的边
    await this.adapter.execute(
      `DELETE FROM kb_graph_edges WHERE owner_id = ? AND (source_id = ? OR target_id = ?)`,
      [this.owner, id, id]
    );

    // 删除节点
    const result = await this.adapter.execute(
      `DELETE FROM kb_graph_nodes WHERE id = ? AND owner_id = ?`,
      [id, this.owner]
    );

    this.cache.delete(id);
    // 清除关联边的缓存
    for (const [edgeId, edge] of this.cacheEdges.entries()) {
      if (edge.source === id || edge.target === id) {
        this.cacheEdges.delete(edgeId);
      }
    }

    return result.affectedRows > 0;
  }

  async getNode(id: string): Promise<GraphNode | undefined> {
    // 先查缓存
    if (this.cache.has(id)) return this.cache.get(id);

    const rows = await this.adapter.query<NodeRow>(
      `SELECT * FROM kb_graph_nodes WHERE id = ? AND owner_id = ?`,
      [id, this.owner]
    );

    if (rows.length === 0) return undefined;

    const row = rows[0];
    const node: GraphNode = {
      id: row.id,
      label: row.label,
      type: row.type,
      tags: this.parseTags(row.tags),
      properties: this.parseProperties(row.properties),
      createdAt: row.created_at,
    };
    if (row.community_id !== null && row.community_id !== undefined) {
      node.communityId = row.community_id;
    }
    if (node.communityId === undefined && node.properties?._communityId !== undefined) {
      node.communityId = node.properties._communityId as number;
    }

    this.cache.set(id, node);
    return node;
  }

  /** 更新节点属性（增量更新） */
  async updateNode(id: string, updates: Partial<Pick<GraphNode, 'label' | 'type' | 'tags' | 'properties' | 'communityId'>>): Promise<boolean> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.label !== undefined) {
      sets.push('label = ?');
      values.push(updates.label);
    }
    if (updates.type !== undefined) {
      sets.push('type = ?');
      values.push(updates.type);
    }
    if (updates.tags !== undefined) {
      sets.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.properties !== undefined) {
      sets.push('properties = ?');
      values.push(JSON.stringify(updates.properties));
    }
    if (updates.communityId !== undefined) {
      sets.push('community_id = ?');
      values.push(updates.communityId);
    }

    if (sets.length === 0) return false;

    values.push(id, this.owner);
    const result = await this.adapter.execute(
      `UPDATE kb_graph_nodes SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`,
      values
    );

    // 清除缓存，下次读取时重新加载
    this.cache.delete(id);
    return result.affectedRows > 0;
  }

  async findNodeByLabel(label: string): Promise<GraphNode | undefined> {
    // 先查缓存
    for (const node of this.cache.values()) {
      if (node.label === label) return node;
    }

    const rows = await this.adapter.query<NodeRow>(
      `SELECT * FROM kb_graph_nodes WHERE owner_id = ? AND label = ?`,
      [this.owner, label]
    );

    if (rows.length === 0) return undefined;

    const row = rows[0];
    const node: GraphNode = {
      id: row.id,
      label: row.label,
      type: row.type,
      tags: this.parseTags(row.tags),
      properties: this.parseProperties(row.properties),
      createdAt: row.created_at,
    };

    this.cache.set(node.id, node);
    return node;
  }

  async findNodesByType(type: NodeType): Promise<GraphNode[]> {
    const rows = await this.adapter.query<NodeRow>(
      `SELECT * FROM kb_graph_nodes WHERE owner_id = ? AND type = ?`,
      [this.owner, type]
    );

    return rows.map((row) => {
      const node: GraphNode = {
        id: row.id,
        label: row.label,
        type: row.type,
        tags: this.parseTags(row.tags),
        properties: this.parseProperties(row.properties),
        createdAt: row.created_at,
      };
      this.cache.set(node.id, node);
      return node;
    });
  }

  async getAllNodes(): Promise<GraphNode[]> {
    const rows = await this.adapter.query<NodeRow>(
      `SELECT * FROM kb_graph_nodes WHERE owner_id = ?`,
      [this.owner]
    );

    return rows.map((row) => {
      const node: GraphNode = {
        id: row.id,
        label: row.label,
        type: row.type,
        tags: this.parseTags(row.tags),
        properties: this.parseProperties(row.properties),
        createdAt: row.created_at,
      };
      this.cache.set(node.id, node);
      return node;
    });
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

    await this.adapter.execute(
      `INSERT INTO kb_graph_edges (id, owner_id, source_id, target_id, type, label, weight, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.owner, source, target, type, label, weight, edge.createdAt]
    );

    this.cacheEdges.set(id, edge);
    return edge;
  }

  async removeEdge(id: string): Promise<boolean> {
    const result = await this.adapter.execute(
      `DELETE FROM kb_graph_edges WHERE id = ? AND owner_id = ?`,
      [id, this.owner]
    );

    this.cacheEdges.delete(id);
    return result.affectedRows > 0;
  }

  async getEdge(id: string): Promise<GraphEdge | undefined> {
    if (this.cacheEdges.has(id)) return this.cacheEdges.get(id);

    const rows = await this.adapter.query<EdgeRow>(
      `SELECT * FROM kb_graph_edges WHERE id = ? AND owner_id = ?`,
      [id, this.owner]
    );

    if (rows.length === 0) return undefined;

    const row = rows[0];
    const edge: GraphEdge = {
      id: row.id,
      source: row.source_id,
      target: row.target_id,
      type: row.type,
      label: row.label,
      weight: row.weight,
      createdAt: row.created_at,
    };

    this.cacheEdges.set(id, edge);
    return edge;
  }

  async getEdgesOf(nodeId: string): Promise<GraphEdge[]> {
    // 优化：使用覆盖索引查询，减少回表操作
    const rows = await this.adapter.query<EdgeRow>(
      `SELECT * FROM kb_graph_edges WHERE owner_id = ? AND (source_id = ? OR target_id = ?)`,
      [this.owner, nodeId, nodeId]
    );

    const edges: GraphEdge[] = [];
    for (const row of rows) {
      const edge: GraphEdge = {
        id: row.id,
        source: row.source_id,
        target: row.target_id,
        type: row.type,
        label: row.label,
        weight: row.weight,
        createdAt: row.created_at,
      };
      this.cacheEdges.set(edge.id, edge);
      edges.push(edge);
    }

    return edges;
  }

  async getEdgesBetween(a: string, b: string): Promise<GraphEdge[]> {
    const rows = await this.adapter.query<EdgeRow>(
      `SELECT * FROM kb_graph_edges 
       WHERE owner_id = ? AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))`,
      [this.owner, a, b, b, a]
    );

    return rows.map((row) => {
      const edge: GraphEdge = {
        id: row.id,
        source: row.source_id,
        target: row.target_id,
        type: row.type,
        label: row.label,
        weight: row.weight,
        createdAt: row.created_at,
      };
      this.cacheEdges.set(edge.id, edge);
      return edge;
    });
  }

  async getAllEdges(): Promise<GraphEdge[]> {
    const rows = await this.adapter.query<EdgeRow>(
      `SELECT * FROM kb_graph_edges WHERE owner_id = ?`,
      [this.owner]
    );

    return rows.map((row) => {
      const edge: GraphEdge = {
        id: row.id,
        source: row.source_id,
        target: row.target_id,
        type: row.type,
        label: row.label,
        weight: row.weight,
        createdAt: row.created_at,
      };
      this.cacheEdges.set(edge.id, edge);
      return edge;
    });
  }

  // Graph queries (优化版)
  async getNeighbors(nodeId: string): Promise<GraphNode[]> {
    // 优化：批量查询所有邻居，而不是逐个查询
    const edges = await this.getEdgesOf(nodeId);
    const neighborIds = new Set<string>();
    for (const e of edges) {
      if (e.source !== nodeId) neighborIds.add(e.source);
      if (e.target !== nodeId) neighborIds.add(e.target);
    }

    if (neighborIds.size === 0) return [];

    // 批量查询所有邻居节点（利用索引）
    const neighborIdsArray = Array.from(neighborIds);
    const placeholders = neighborIdsArray.map(() => '?').join(',');

    const rows = await this.adapter.query<NodeRow>(
      `SELECT * FROM kb_graph_nodes WHERE owner_id = ? AND id IN (${placeholders})`,
      [this.owner, ...neighborIdsArray]
    );

    const neighbors: GraphNode[] = [];
    for (const row of rows) {
      const node: GraphNode = {
        id: row.id,
        label: row.label,
        type: row.type,
        tags: this.parseTags(row.tags),
        properties: this.parseProperties(row.properties),
        createdAt: row.created_at,
      };
      if (row.community_id !== null && row.community_id !== undefined) {
        node.communityId = row.community_id;
      }
      if (node.communityId === undefined && node.properties?._communityId !== undefined) {
        node.communityId = node.properties._communityId as number;
      }
      this.cache.set(node.id, node);
      neighbors.push(node);
    }

    return neighbors;
  }

  async getDegree(nodeId: string): Promise<number> {
    const result = await this.adapter.query<CountRow>(
      `SELECT COUNT(*) as count FROM kb_graph_edges 
       WHERE owner_id = ? AND (source_id = ? OR target_id = ?)`,
      [this.owner, nodeId, nodeId]
    );

    return result[0]?.count ?? 0;
  }

  // Note: These are methods, not getters, because they are async
  async countNodes(): Promise<number> {
    const result = await this.adapter.query<CountRow>(
      `SELECT COUNT(*) as count FROM kb_graph_nodes WHERE owner_id = ?`,
      [this.owner]
    );

    return result[0]?.count ?? 0;
  }

  async countEdges(): Promise<number> {
    const result = await this.adapter.query<CountRow>(
      `SELECT COUNT(*) as count FROM kb_graph_edges WHERE owner_id = ?`,
      [this.owner]
    );

    return result[0]?.count ?? 0;
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
   *  - 完全匹配：标签完全相同直接合并
   *  - 近似匹配：大小写/空格/标点标准化后相同合并
   *  - 合并策略：保留较早节点，将所有边转移到保留节点
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
      // 先收集所有需要处理的边，避免在遍历过程中修改数据结构
      const edgesToRemove: string[] = [];
      const edgesToAdd: Array<{
        source: string;
        target: string;
        type: EdgeType;
        label: string;
        weight: number;
      }> = [];

      for (const removeId of nodeIds) {
        if (removeId === keepId) continue;

        // 收集需要转移的边
        const edgesToTransfer = (await this.getAllEdges()).filter(
          (e) => e.source === removeId || e.target === removeId
        );

        for (const edge of edgesToTransfer) {
          const otherEnd = edge.source === removeId ? edge.target : edge.source;
          const otherNode = await this.getNode(otherEnd);
          if (!otherNode) {
            edgesToRemove.push(edge.id);
            continue;
          }

          // 检查是否已有相同关系的边，避免重复
          const existingEdges = await this.getEdgesBetween(keepId, otherEnd);
          const hasSameRelation = existingEdges.some((e) => e.label === edge.label);

          if (!hasSameRelation) {
            edgesToAdd.push({
              source: edge.source === removeId ? keepId : otherEnd,
              target: edge.target === removeId ? keepId : otherEnd,
              type: edge.type,
              label: edge.label,
              weight: edge.weight,
            });
          }

          edgesToRemove.push(edge.id);
        }
      }

      // 批量添加新边
      for (const edgeData of edgesToAdd) {
        await this.addEdge(
          edgeData.source,
          edgeData.target,
          edgeData.type,
          edgeData.label,
          edgeData.weight
        );
      }

      // 批量删除旧边
      for (const edgeId of edgesToRemove) {
        await this.removeEdge(edgeId);
      }

      // 批量删除重复节点
      for (const removeId of nodeIds) {
        if (removeId === keepId) continue;
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
    // 获取要删除的节点和边的数量
    const [nodeResult, edgeResult] = await Promise.all([
      this.adapter.query(
        `SELECT COUNT(*) as count FROM kb_graph_nodes WHERE owner_id = ?`,
        [this.owner]
      ),
      this.adapter.query(
        `SELECT COUNT(*) as count FROM kb_graph_edges WHERE owner_id = ?`,
        [this.owner]
      )
    ]);

    const nodeCount = (nodeResult[0] as any)?.count || 0;
    const edgeCount = (edgeResult[0] as any)?.count || 0;

    // 删除所有边和节点（串行执行避免外键死锁）
    await this.adapter.execute(`DELETE FROM kb_graph_edges WHERE owner_id = ?`, [this.owner]);
    await this.adapter.execute(`DELETE FROM kb_graph_nodes WHERE owner_id = ?`, [this.owner]);

    // 清除内存缓存
    this.clearCache();

    return { nodesRemoved: nodeCount, edgesRemoved: edgeCount };
  }
}
