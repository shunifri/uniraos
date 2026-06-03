import crypto from "crypto";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "./types.js";
import { getMySQLAdapter, type MySQLAdapter } from "../../db/mysql-adapter.js";
import { LRUCache } from "../../utils/lru-cache.js";

/**
 * P2-7 标定（v3 review）：FULLTEXT relevance 归一化函数的默认 k。
 *
 * 真实数据未到位前用经验值 k=2（跟 commit `127e985` 行为兼容）。
 * 跑 `npx tsx scripts/calibrate-fts-score.ts` 可以选最优 k。
 * 真数据标定后，**改成环境变量**：
 *   export FTS_SCORE_K=1.80
 * 然后 normalizeFtsScore 自动读 env（无需改代码）。
 *
 * 当前 k=2 对应的精确值：
 * - raw=0.5 → ~0.245（噪声，偏低）
 * - raw=1.0 → ~0.462（中等命中）
 * - raw=2.0 → ~0.762（强命中）
 * - raw=4.0 → ~0.964（极强命中）
 * - raw=10  → ~0.9993（强尾部，趋近 1）
 */
const DEFAULT_FTS_K = 2;

/**
 * 从环境变量读 FTS_SCORE_K（生产用）
 */
function getFtsK(): number {
  const envK = process.env.FTS_SCORE_K;
  if (envK) {
    const k = parseFloat(envK);
    if (Number.isFinite(k) && k > 0) return k;
  }
  return DEFAULT_FTS_K;
}

/**
 * P2-7 修复（v3 review）：FULLTEXT relevance 归一化函数。
 *
 * 把 MySQL `MATCH AGAINST` 的原始分数（BOOLEAN MODE 下通常 0-10，IN NATURAL LANGUAGE MODE 0+）
 * 用 `tanh(raw / k)` S 曲线归一化到 0-1。**S 曲线的好处**：
 * - 噪声（raw < 1）压成 0.x
 * - 真实命中（raw 1-3）落在 0.5-0.85 中间
 * - 强命中（raw > 4）趋近 1 但不会爆
 *
 * k 可通过 env `FTS_SCORE_K` 调整（生产标定用），默认 2。
 *
 * @param raw MySQL MATCH AGAINST 原始分数（负数按 0 处理，NaN/Infinity 按 0）
 * @param k tanh 曲线的除数（可选，默认读 env FTS_SCORE_K 或 2）
 * @returns 0-1 之间的归一化分数
 */
export function normalizeFtsScore(raw: number, k?: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const divisor = k ?? getFtsK();
  const normalized = Math.tanh(raw / divisor);
  // 数值安全：tanh 永远 < 1
  return Math.max(0, Math.min(1, normalized));
}

interface NodeRow {
  id: string;
  label: string;
  type: NodeType;
  /**
   * P2-11 修复：mysql2 driver 对 JSON 列自动 parse，
   *   所以 row.tags 可能是 string（raw）也可能是 unknown[]（已解析）。
   *   parseTags 两种都处理。
   */
  tags: string | unknown[] | null;
  properties: string;
  community_id: number | null;
  version: number | null;
  importance: number | null;
  created_at: number;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  type: EdgeType;
  label: string;
  weight: number;
  properties: string | null;
  created_at: number;
}

interface CountRow {
  count: number;
}

/**
 * P2-9 修复（v3 review）：强制刷新 FULLTEXT 索引的 helper。
 *
 * MySQL InnoDB 的 FULLTEXT 索引是**异步**更新的——刚 INSERT 的数据可能不立即可搜。
 * 测试用 `setTimeout(100)` 等待索引刷新是 race condition，应该用 `OPTIMIZE TABLE` 同步刷新。
 *
 * 优化建议（生产用 OPTIMIZE TABLE 会锁表+重建索引，**仅测试用**）：
 * - 测试用：先 `SET GLOBAL innodb_optimize_fulltext_only = ON` 让 OPTIMIZE 只刷 FULLTEXT 缓存，
 *   不重建表。然后 OPTIMIZE TABLE kb_graph_nodes 强制 flush。
 * - 生产用：等 InnoDB 自然 merge（< 1s），不要主动 OPTIMIZE。
 *
 * 容错：
 * - `SET GLOBAL` 需要 SUPER 权限；测试用户可能没有。失败时降级为直接 OPTIMIZE TABLE
 *   （仍能刷 FULLTEXT，只是慢一点）。
 * - 所有失败都被 catch，结果用 console.warn 提示，但不抛错——测试不能因为 OPTIMIZE 失败就死。
 *
 * @param adapter MySQLAdapter 实例
 */
export async function flushFulltextIndex(adapter: MySQLAdapter): Promise<void> {
  let fulltextOnly = false;
  try {
    // 尝试开启 FULLTEXT-only 模式（避免全表重建）
    await adapter.execute(`SET GLOBAL innodb_optimize_fulltext_only = ON`);
    fulltextOnly = true;
  } catch {
    // 没 SUPER 权限或被拒绝——降级模式 OPTIMIZE 会做全表 rebuild，但小表 OK
  }
  try {
    await adapter.execute(`OPTIMIZE TABLE kb_graph_nodes`);
  } catch (err) {
    console.warn(
      `[graph-store] flushFulltextIndex OPTIMIZE TABLE failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    if (fulltextOnly) {
      try {
        await adapter.execute(`SET GLOBAL innodb_optimize_fulltext_only = OFF`);
      } catch {
        // 关闭失败无所谓——下次 OPTIMIZE 会再设
      }
    }
  }
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

  // 辅助方法：解析 tags（兼容旧格式 + mysql2 auto-parse）
  // P2-11 顺带修：mysql2 driver 对 JSON 列**自动 parse**，导致 tagsStr 可能是数组而非字符串。
  //   之前只处理 string 情况，会在 catch 分支里把数组再包一层 → 双重嵌套
  //   修法跟 parseProperties 一样：先 typeof === "object" 直接 return，不走 JSON.parse。
  private parseTags(tagsStr: string | unknown[] | null): string[] {
    if (tagsStr === null || tagsStr === undefined) return [];
    // mysql2 auto-parse：tagsStr 已经是数组
    if (Array.isArray(tagsStr)) {
      return tagsStr
        .flat(Infinity)
        .map((t) => (typeof t === "string" ? t : String(t)))
        .filter(Boolean);
    }
    if (typeof tagsStr === "string") {
      try {
        const parsed = JSON.parse(tagsStr);
        if (Array.isArray(parsed)) {
          return parsed
            .flat(Infinity)
            .map((t) => (typeof t === "string" ? t : String(t)))
            .filter(Boolean);
        }
        return [];
      } catch {
        // 兼容旧格式：逗号分隔
        if (tagsStr.includes(",")) {
          return tagsStr.split(",").map((t) => t.trim()).filter(Boolean);
        }
        return tagsStr ? [tagsStr] : [];
      }
    }
    return [];
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

  /**
   * 从 properties JSON 提升 KG v2 扩展字段到 GraphNode 顶层。
   * 字段语义详见 src/memory/knowledge-graph/types.ts 与 docs/KG_ARCHITECTURE_VISION.md §3.3
   * 注意：parseProperties 已经处理了 JSON parse，所以这里 props 已经是对象。
   */
  private liftExtendedNodeFields(node: GraphNode): GraphNode {
    const props = node.properties;
    if (!props || typeof props !== "object") return node;
    if (node.sourceChunkIds === undefined && Array.isArray((props as any).sourceChunkIds)) {
      node.sourceChunkIds = (props as any).sourceChunkIds as string[];
    }
    if (node.canonicalForm === undefined && typeof (props as any).canonicalForm === "string") {
      node.canonicalForm = (props as any).canonicalForm as string;
    }
    if (node.supersedes === undefined && typeof (props as any).supersedes === "string") {
      node.supersedes = (props as any).supersedes as string;
    }
    if (node.supersedesChain === undefined && Array.isArray((props as any).supersedesChain)) {
      node.supersedesChain = (props as any).supersedesChain as string[];
    }
    if (node.firstSeen === undefined && typeof (props as any).firstSeen === "number") {
      node.firstSeen = (props as any).firstSeen as number;
    }
    if (node.lastUpdated === undefined && typeof (props as any).lastUpdated === "number") {
      node.lastUpdated = (props as any).lastUpdated as number;
    }
    return node;
  }

  /**
   * 从 properties JSON 提升 KG v2 扩展字段到 GraphEdge 顶层。
   * 注意：mysql2 驱动默认会把 JSON 列自动 parse 成对象，所以这里要同时处理 string 和 object 两种入参。
   */
  private liftExtendedEdgeFields(edge: GraphEdge, propsInput: string | Record<string, unknown> | null): GraphEdge {
    if (!propsInput) return edge;
    let props: Record<string, unknown>;
    if (typeof propsInput === "string") {
      try {
        const parsed = JSON.parse(propsInput);
        if (!parsed || typeof parsed !== "object") return edge;
        props = parsed as Record<string, unknown>;
      } catch {
        return edge;
      }
    } else {
      props = propsInput;
    }
    if (edge.sourceChunkId === undefined && typeof props.sourceChunkId === "string") {
      edge.sourceChunkId = props.sourceChunkId as string;
    }
    if (edge.evidence === undefined && typeof props.evidence === "string") {
      edge.evidence = props.evidence as string;
    }
    if (edge.feedbackScore === undefined && typeof props.feedbackScore === "number") {
      edge.feedbackScore = props.feedbackScore as number;
    }
    if (edge.version === undefined && typeof props.version === "number") {
      edge.version = props.version as number;
    }
    if (edge.validFrom === undefined && typeof props.validFrom === "number") {
      edge.validFrom = props.validFrom as number;
    }
    if (edge.validTo === undefined && typeof props.validTo === "number") {
      edge.validTo = props.validTo as number;
    }
    return edge;
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
    // KG v2 扩展字段：version / importance 走专用列，其他走 properties JSON
    if (node.sourceChunkIds !== undefined) {
      properties.sourceChunkIds = node.sourceChunkIds;
    }
    if (node.canonicalForm !== undefined) {
      properties.canonicalForm = node.canonicalForm;
    }
    if (node.supersedes !== undefined) {
      properties.supersedes = node.supersedes;
    }
    if (node.supersedesChain !== undefined) {
      properties.supersedesChain = node.supersedesChain;
    }
    const version = node.version ?? 1;
    const importance = node.importance ?? 0.5;
    const firstSeen = node.firstSeen ?? Date.now();
    const lastUpdated = node.lastUpdated ?? Date.now();
    properties.firstSeen = firstSeen;
    properties.lastUpdated = lastUpdated;

    const full: GraphNode = { ...node, id, tags: filteredTags, createdAt: node.createdAt ?? Date.now(), properties, version, importance, firstSeen, lastUpdated };

    await this.adapter.execute(
      `INSERT INTO kb_graph_nodes (id, owner_id, label, type, tags, properties, created_at, version, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.owner, full.label, full.type, JSON.stringify(full.tags), JSON.stringify(full.properties), full.createdAt, full.version, full.importance]
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
    if (row.version !== null && row.version !== undefined) {
      node.version = row.version;
    }
    if (row.importance !== null && row.importance !== undefined) {
      node.importance = Number(row.importance);
    }
    this.liftExtendedNodeFields(node);
    if (node.communityId === undefined && node.properties?._communityId !== undefined) {
      node.communityId = node.properties._communityId as number;
    }

    this.cache.set(id, node);
    return node;
  }

  /** 更新节点属性（增量更新） */
  async updateNode(id: string, updates: Partial<Pick<GraphNode, 'label' | 'type' | 'tags' | 'properties' | 'communityId' | 'importance' | 'version'>>): Promise<boolean> {
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
    if (updates.importance !== undefined) {
      sets.push('importance = ?');
      values.push(updates.importance);
    }
    if (updates.version !== undefined) {
      sets.push('version = ?');
      values.push(updates.version);
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

  /**
   * 增量更新边（阶段 4 反馈环路）。
   * 写 properties JSON 里相应字段，避免 schema 变更。
   */
  async updateEdge(
    id: string,
    updates: {
      weightDelta?: number;      // 累加：+0.1 / -0.1
      feedbackScoreDelta?: number; // 累加：+1 / -1
      version?: number;          // 覆盖：自增版本
    }
  ): Promise<boolean> {
    // 先读出 edge 拿到当前 weight 和 properties
    const existing = await this.getEdge(id);
    if (!existing) return false;

    // 计算新值
    const newWeight = updates.weightDelta !== undefined
      ? Math.max(0, Math.min(1, existing.weight + updates.weightDelta))
      : existing.weight;
    const currentFeedback = existing.feedbackScore ?? 0;
    const newFeedbackScore = updates.feedbackScoreDelta !== undefined
      ? Math.max(-5, Math.min(5, currentFeedback + updates.feedbackScoreDelta)) // tanh 区间大致 [-5, 5]
      : currentFeedback;
    const newVersion = updates.version !== undefined
      ? updates.version
      : (existing.version ?? 1) + 1;

    // 直接基于 lifted 字段构建 properties JSON（liftExtendedEdgeFields 已把 properties 顶层化）
    const props: Record<string, unknown> = {};
    if (existing.sourceChunkId !== undefined) props.sourceChunkId = existing.sourceChunkId;
    if (existing.evidence !== undefined) props.evidence = existing.evidence;
    if (existing.validFrom !== undefined) props.validFrom = existing.validFrom;
    if (existing.validTo !== undefined) props.validTo = existing.validTo;
    props.feedbackScore = newFeedbackScore;
    props.version = newVersion;

    const result = await this.adapter.execute(
      `UPDATE kb_graph_edges SET weight = ?, properties = ? WHERE id = ? AND owner_id = ?`,
      [newWeight, JSON.stringify(props), id, this.owner]
    );

    if (result.affectedRows > 0) {
      this.cacheEdges.delete(id);
    }
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
    if (row.community_id !== null && row.community_id !== undefined) {
      node.communityId = row.community_id;
    }
    if (row.version !== null && row.version !== undefined) {
      node.version = row.version;
    }
    if (row.importance !== null && row.importance !== undefined) {
      node.importance = Number(row.importance);
    }
    this.liftExtendedNodeFields(node);

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
      if (row.community_id !== null && row.community_id !== undefined) {
        node.communityId = row.community_id;
      }
      if (row.version !== null && row.version !== undefined) {
        node.version = row.version;
      }
      if (row.importance !== null && row.importance !== undefined) {
        node.importance = Number(row.importance);
      }
      this.liftExtendedNodeFields(node);
      this.cache.set(node.id, node);
      return node;
    });
  }

  /**
   * P1-4 修复（v3 review）+ P2-8 增强：用 MySQL FULLTEXT 索引实现
   *   searchNodesByKeywords，让 MySQL 后端也能用原生索引检索（之前是全表扫描）。
   *
   * 实现细节：
   * - 优先用 ngram parser 索引（中文 2-gram，对中文实体友好）— v21 optional migration
   * - 退到默认 FULLTEXT 索引（ft_min_word_len=4，英文长词有效）— v20 必有
   * - 启动时探一下 ngram 索引是否存在，缓存到 `ngramIndexAvailable` 字段
   *   避免每次查询都跑 SHOW INDEX（开销）
   * - 输入 terms 是 canonical form（已小写、去下划线），不是 surface form
   * - 输出兼容 bfs-extractor.scoreNodes 期望的两种格式：{ node, score }[] 或 GraphNode[]
   *
   * @returns Array<{ node: GraphNode; score: number }>
   */
  private ngramIndexAvailable: boolean | null = null;

  /** P2-8：暴露给测试用，重置 ngram probe 缓存以模拟索引被删/重建 */
  _resetNgramProbeForTest(): void {
    this.ngramIndexAvailable = null;
  }

  private async probeNgramIndex(): Promise<boolean> {
    if (this.ngramIndexAvailable !== null) return this.ngramIndexAvailable;
    try {
      const rows = await this.adapter.query<{ Key_name: string }>(
        `SHOW INDEX FROM kb_graph_nodes WHERE Key_name = 'ft_kb_graph_nodes_label_ngram'`
      );
      this.ngramIndexAvailable = rows.length > 0;
    } catch {
      this.ngramIndexAvailable = false;
    }
    return this.ngramIndexAvailable;
  }

  async searchNodesByKeywords(
    terms: string[],
    limit: number = 50
  ): Promise<Array<{ node: GraphNode; score: number }>> {
    const cleaned = (terms ?? [])
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t.length > 0);
    if (cleaned.length === 0 || limit <= 0) return [];

    // P2-8 优雅降级：探一下 ngram 索引可用性
    const useNgram = await this.probeNgramIndex();
    const indexHint = useNgram
      ? "ft_kb_graph_nodes_label_ngram"
      : "ft_kb_graph_nodes_label";

    // MySQL BOOLEAN MODE 语法：每个 term 包 + 必须包含，* 是前缀通配
    // 例：["苹果", "公司"] → "+苹果* +公司*"
    const boolQuery = cleaned.map((t) => `+${t.replace(/[+\-><()~*"@]/g, " ")}*`).join(" ");

    const rows = await this.adapter.query<NodeRow & { score: number }>(
      `SELECT *, MATCH(label) AGAINST (? IN BOOLEAN MODE) AS score
       FROM kb_graph_nodes USE INDEX (${indexHint})
       WHERE owner_id = ?
         AND MATCH(label) AGAINST (? IN BOOLEAN MODE)
       ORDER BY score DESC
       LIMIT ?`,
      [boolQuery, this.owner, boolQuery, limit]
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
      if (row.community_id !== null && row.community_id !== undefined) {
        node.communityId = row.community_id;
      }
      if (row.version !== null && row.version !== undefined) {
        node.version = row.version;
      }
      if (row.importance !== null && row.importance !== undefined) {
        node.importance = Number(row.importance);
      }
      this.liftExtendedNodeFields(node);
      this.cache.set(node.id, node);
      // P2-7 修复（v3 review）：归一化从「除以 5」魔法值改为 tanh S 曲线。
      //   之前 `raw/5` 在长尾场景下要么压成 0.5（真实命中），要么接近 1（噪声），
      //   **斜率是错的**。tanh 在 raw=2 时约 0.76、raw=4 时约 0.99，**S 曲线** 形状
      //   更贴近 LLM 评分实际分布（中位数落中间、尾部不爆炸）。
      //   待真实数据标定后可以替换为拟合系数（CALIBRATION.md 跟踪）。
      const normalized = normalizeFtsScore(Number(row.score));
      return { node, score: normalized };
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
      if (row.community_id !== null && row.community_id !== undefined) {
        node.communityId = row.community_id;
      }
      if (row.version !== null && row.version !== undefined) {
        node.version = row.version;
      }
      if (row.importance !== null && row.importance !== undefined) {
        node.importance = Number(row.importance);
      }
      this.liftExtendedNodeFields(node);
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

    // 把可选扩展字段塞到 properties JSON 落库
    const props: Record<string, unknown> = { version: 1 };
    if (options?.sourceChunkId !== undefined) props.sourceChunkId = options.sourceChunkId;
    if (options?.evidence !== undefined) props.evidence = options.evidence;
    if (options?.feedbackScore !== undefined) props.feedbackScore = options.feedbackScore;
    if (options?.validFrom !== undefined) props.validFrom = options.validFrom;
    if (options?.validTo !== undefined) props.validTo = options.validTo;
    const propsJson = Object.keys(props).length > 0 ? JSON.stringify(props) : null;

    await this.adapter.execute(
      `INSERT INTO kb_graph_edges (id, owner_id, source_id, target_id, type, label, weight, created_at, properties)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.owner, source, target, type, label, weight, edge.createdAt, propsJson]
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
      weight: Number(row.weight),
      createdAt: row.created_at,
    };
    this.liftExtendedEdgeFields(edge, row.properties);

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
        weight: Number(row.weight),
        createdAt: row.created_at,
      };
      this.liftExtendedEdgeFields(edge, row.properties);
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
        weight: Number(row.weight),
        createdAt: row.created_at,
      };
      this.liftExtendedEdgeFields(edge, row.properties);
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
        weight: Number(row.weight),
        createdAt: row.created_at,
      };
      this.liftExtendedEdgeFields(edge, row.properties);
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
      if (row.version !== null && row.version !== undefined) {
        node.version = row.version;
      }
      if (row.importance !== null && row.importance !== undefined) {
        node.importance = Number(row.importance);
      }
      this.liftExtendedNodeFields(node);
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
