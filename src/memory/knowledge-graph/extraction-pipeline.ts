/**
 * 知识图谱 LLM 抽取统一 Pipeline（KG v2 阶段 1+2 重构）
 *
 * 阶段 1：替换 v1 review §3 中识别的 3 处重复实现
 *   - src/skills/knowledge-skills.ts:2507-2630（kb_ingest）
 *   - src/services/parsing-queue.ts:599-635（Document Mind 解析完成）
 *   - src/services/parsing-queue.ts:1266-1302（本地解析完成）
 *
 * 阶段 2：新增离线管线 extractFromChunk / extractFromDocument，
 *   支持跨 chunk entity linking（详见 docs/KG_ARCHITECTURE_VISION.md §3.2）
 *
 * 详见 docs/KNOWLEDGE_GRAPH_REVIEW_v2.md §3 与 docs/KG_ARCHITECTURE_VISION.md §3.2。
 */
import type { LLMProvider } from "../../llm/types.js";
import { extractRelationships } from "./relationship-extractor.js";
import type { GraphNode, GraphStore, GraphEdge } from "./index.js";
import { defaultEntityLinker, surfaceToCanonical, type EntityLinker } from "./entity-linker.js";

/**
 * 最小可用的图谱存储接口（duck typing）。
 * 兼容 GraphStore / Neo4jGraphStore / SessionWithGraphManager["getStore"]() 等多种形状。
 *
 * type 字段用 string 而非 NodeType 联合，是因为有些 caller 用了更细的 entity 子类型
 * （如 "person" / "organization"）尚未在 types.ts 的 NodeType 联合里声明。
 * 等阶段 2 收敛实体类型时再统一收紧。
 */
export interface GraphStoreLike {
  // ===== 节点操作 =====
  findNodeByLabel(label: string): Promise<GraphNode | undefined>;
  findNodesByType?(type: string): Promise<GraphNode[]>;
  getAllNodes?(): Promise<GraphNode[]>;
  /** P2-12：getNode 改为必选，因为 BFS / 路径 / 反馈管道都依赖它，调用方本来就要保证 */
  getNode(id: string): Promise<GraphNode | undefined>;
  /** KG v2 阶段 5: backend 原生全文检索（Neo4j fulltext / MySQL FULLTEXT） */
  searchNodesByKeywords?(terms: string[], limit?: number): Promise<Array<{ node: GraphNode; score: number }>>;
  addNode(node: Omit<GraphNode, "id"> & { id?: string; type: string }): Promise<GraphNode>;
  updateNode?(id: string, updates: Partial<GraphNode>): Promise<boolean>;
  removeNode?(id: string): Promise<boolean>;
  countNodes?(): Promise<number>;
  // ===== 边操作 =====
  getEdgesBetween(a: string, b: string): Promise<GraphEdge[]>;
  /** P2-12：getEdgesOf 改为必选，BFS 收集边依赖 */
  getEdgesOf(nodeId: string): Promise<GraphEdge[]>;
  /** P2-12：getEdge 改为必选，BFS 路径 / 反馈管道都依赖 */
  getEdge(id: string): Promise<GraphEdge | undefined>;
  /** P2-12：getNeighbors 改为必选，BFS 扩展邻居依赖 */
  getNeighbors(nodeId: string): Promise<GraphNode[]>;
  getDegree?(nodeId: string): Promise<number>;
  /**
   * P2-CRITICAL-FIX：MySQL recursive CTE 一次查询拉完 BFS 子图（替代 N+1 模式）
   * 可选——MySQL 8.0+ 必有；Neo4j 暂未实现
   */
  extractSubgraphCTE?(
    seedNodeIds: string[],
    maxDepth: number,
    maxNodes: number
  ): Promise<{
    nodeIds: string[];
    edges: Array<{ id: string; source: string; target: string; type: string; label: string }>;
  }>;
  updateEdge?(id: string, updates: {
    weightDelta?: number;
    feedbackScoreDelta?: number;
    version?: number;
  }): Promise<boolean>;
  addEdge(
    source: string,
    target: string,
    type: GraphEdge["type"] | string,
    label: string,
    weight?: number,
    options?: {
      sourceChunkId?: string;
      evidence?: string;
      feedbackScore?: number;
      validFrom?: number;
      validTo?: number;
    }
  ): Promise<GraphEdge>;
}

export interface ExtractToGraphOptions {
  /** 分块大小（字符数），默认 3000 */
  chunkSize?: number;
  /** 分块重叠（字符数），默认 500 */
  overlap?: number;
  /** 每段最多处理的关系数，默认 20 */
  maxRelationsPerChunk?: number;
  /** 是否创建文档锚点节点（kb_doc_<docId>）并把所有 entity 节点 CONTAINS 过去，默认 true */
  createDocAnchor?: boolean;
  /** 实体类型推断函数（可选）。返回 string 而非 NodeType 是为了兼容 caller 用的细粒度子类型 */
  inferEntityType?: (label: string, relation: string) => string;
  /** 日志标签 */
  callerTag?: string;
}

export interface ExtractToGraphParams {
  docId: string;
  docName: string;
  content: string;
  tags?: string[];
}

export interface ExtractToGraphResult {
  totalRelations: number;
  createdNodes: number;
  chunksProcessed: number;
  docAnchorCreated: boolean;
}

/**
 * 抽取文档内容中的实体关系，写入知识图谱。
 *
 * 设计要点（KG v2）：
 * 1. **幂等性**：同 (sourceLabel, targetLabel, normalizedRelation) 只写一条边；
 *    用 nodeCache + store.findNodeByLabel 双重去重。
 * 2. **chunkId 反向链接**：每个 entity 节点带 sourceChunkIds，关系边带 sourceChunkId。
 *    这是后续 KG-first 检索的物理基础（详见 Vision §3.3）。
 * 3. **单次 LLM 调用同时抽 entities 和 relations**：通过 extractRelationships
 *    返回的 {sourceLabel, targetLabel} 隐式建立 entity。
 *    真实 entities 抽取在阶段 2 通过 extractFromChunk 增强。
 * 4. **不依赖 doc anchor**：createDocAnchor=false 时跳过锚点创建，
 *    适用于 ParsingQueue 的两个历史路径。
 */
export async function extractRelationsToGraph(
  store: GraphStoreLike,
  params: ExtractToGraphParams,
  llmProvider: LLMProvider | null | undefined,
  options: ExtractToGraphOptions = {}
): Promise<ExtractToGraphResult> {
  const {
    chunkSize = 3000,
    overlap = 500,
    maxRelationsPerChunk = 20,
    createDocAnchor = true,
    inferEntityType,
    callerTag = "extract",
  } = options;

  const { docId, docName, content, tags = [] } = params;

  if (!llmProvider || !content || content.trim().length === 0) {
    return { totalRelations: 0, createdNodes: 0, chunksProcessed: 0, docAnchorCreated: false };
  }

  // 1. 创建文档锚点（可选）
  let docAnchorNode: GraphNode | undefined;
  let docAnchorCreated = false;
  if (createDocAnchor) {
    const docAnchorId = `kb_doc_${docId}`;
    docAnchorNode = await store.findNodeByLabel(docName);
    if (!docAnchorNode) {
      docAnchorNode = await store.addNode({
        id: docAnchorId,
        label: docName,
        type: "kb_document",
        tags: ["kb_document", docName.split(".").pop() || "doc", ...tags].filter(Boolean) as string[],
        properties: { sourceDoc: docName, docId },
        createdAt: Date.now(),
        sourceChunkIds: [],
        canonicalForm: docName,
        version: 1,
        importance: 0.5,
      });
      docAnchorCreated = true;
    }
  }

  // 2. 分块处理
  const totalChunks = Math.max(1, Math.ceil(content.length / (chunkSize - overlap)));
  let totalRelations = 0;
  let createdCount = 0;
  const nodeCache = new Map<string, GraphNode>();

  // P0-2 修复：修 3 闭环——让 extractRelationsToGraph 真正调用 entities 抽取
  // P1-6 优化：合并为单次 LLM 调用（extractEntitiesAndRelationships）
  //   生产路径之前是 2 次独立 LLM 调用（extractEntities + extractRelationships 并行），
  //   现在改用合并调用，**成本 -50%**、**延迟 -50%**。
  //   extractEntitiesAndRelationships 返回 { entities, relations }，等价于之前两次的合并。
  const { extractEntitiesAndRelationships } = await import("./relationship-extractor.js");

  for (let i = 0; i < totalChunks; i++) {
    const startPos = i * (chunkSize - overlap);
    const endPos = Math.min(startPos + chunkSize, content.length);
    const chunkText = content.slice(startPos, endPos);
    const chunkId = `${docId}_chunk_${i}`;

    // P0-2 + P1-6: 单次 LLM 调用同时拿到 entities + relations
    const { entities: pureEntities, relations } = await extractEntitiesAndRelationships(
      chunkText,
      llmProvider
    );

    // 2a. 先把"独立出现的纯 entity"写进图谱
    // 重要：纯 entity 走 getOrCreateEntity，relation 传空字符串（用 entity type 推断）
    for (const pe of pureEntities) {
      if (!pe.label) continue;
      const canonical = surfaceToCanonical(pe.label);
      if (!canonical) continue;
      const node = await getOrCreateEntity(
        store, nodeCache, canonical, "", docName, i, tags, inferEntityType, chunkId
      );
      if (node) {
        // 更新 importance（LLM 给的）
        if (typeof pe.importance === "number" && pe.importance > 0 && pe.importance <= 1) {
          await store.updateNode?.(node.id, { importance: pe.importance });
        }
      }
    }

    totalRelations += relations.length;
    const rels = relations.slice(0, maxRelationsPerChunk);

    for (const rel of rels) {
      if (!rel.sourceLabel || !rel.targetLabel || !rel.relation) continue;
      if (typeof rel.confidence !== "number" || rel.confidence < 0.3) continue;

      const normalizedSource = normalizeEntityLabel(rel.sourceLabel);
      const normalizedTarget = normalizeEntityLabel(rel.targetLabel);
      if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) continue;

      // 3. 实体去重 + 创建
      const sourceNode = await getOrCreateEntity(
        store, nodeCache, normalizedSource, rel.relation, docName, i, tags, inferEntityType, chunkId
      );
      const targetNode = await getOrCreateEntity(
        store, nodeCache, normalizedTarget, rel.relation, docName, i, tags, inferEntityType, chunkId
      );
      if (sourceNode.id === targetNode.id) continue;

      // 4. 边去重（v2 §2.1 修复：用 e.label 比较，不依赖不存在的 e.relation）
      const normalizedRel = normalizeRelationType(rel.relation);
      const existingEdges = await store.getEdgesBetween(sourceNode.id, targetNode.id);
      const hasEdge = existingEdges.some((e) => e.label === normalizedRel);
      if (!hasEdge) {
        await store.addEdge(
          sourceNode.id,
          targetNode.id,
          "LLM_EXTRACTED",
          normalizedRel,
          rel.confidence,
          { sourceChunkId: chunkId }
        );
      }

      // 5. 文档锚点 CONTAINS 边（可选）
      if (docAnchorNode) {
        await ensureContainsEdge(store, docAnchorNode.id, sourceNode.id);
        await ensureContainsEdge(store, docAnchorNode.id, targetNode.id);
      }
    }
  }

  if (totalRelations > 0) {
    console.log(
      `[${callerTag}] LLM relation extraction: ${totalRelations} relations, ${createdCount} new nodes from "${docName}"`
    );
  }

  return { totalRelations, createdNodes: createdCount, chunksProcessed: totalChunks, docAnchorCreated };
}

// ===== 内部辅助 =====

async function getOrCreateEntity(
  store: GraphStoreLike,
  nodeCache: Map<string, GraphNode>,
  normalizedLabel: string,
  relation: string,
  docName: string,
  chunkIndex: number,
  tags: string[],
  inferEntityType: ((label: string, relation: string) => string) | undefined,
  chunkId: string
): Promise<GraphNode> {
  const cached = nodeCache.get(normalizedLabel);
  if (cached) return cached;

  const existing = await store.findNodeByLabel(normalizedLabel);
  if (existing) {
    nodeCache.set(normalizedLabel, existing);
    return existing;
  }

  const inferredType: string = inferEntityType
    ? inferEntityType(normalizedLabel, relation)
    : "entity";

  const created = await store.addNode({
    id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: normalizedLabel,
    type: inferredType as any,
    tags: tags.filter(Boolean) as string[],
    properties: { sourceDoc: docName, chunkIndex },
    createdAt: Date.now(),
    canonicalForm: normalizedLabel,
    sourceChunkIds: [chunkId],
    version: 1,
    importance: 0.5,
  });
  nodeCache.set(normalizedLabel, created);
  return created;
}

async function ensureContainsEdge(
  store: GraphStoreLike,
  anchorId: string,
  entityId: string
): Promise<void> {
  if (anchorId === entityId) return;
  const existing = await store.getEdgesBetween(anchorId, entityId);
  if (existing.length === 0) {
    await store.addEdge(anchorId, entityId, "CONTAINS", "mentions_in_doc");
  }
}

// ===== 关系归一化（与 relationship-extractor.ts 保持一致） =====

function normalizeRelationType(relation: string): string {
  const relationMap: Record<string, string> = {
    "相关": "related_to",
    "关联": "related_to",
    "连接": "related_to",
    "关于": "about",
    "属于": "part_of",
    "包含": "contains",
    "包括": "contains",
    "使用": "uses",
    "依赖": "depends_on",
    "基于": "based_on",
    "参考": "references",
    "引用": "references",
    "创建": "created_by",
    "是": "is_a",
    "等于": "is_a",
    "区别于": "different_from",
    "不同于": "different_from",
    "相似于": "similar_to",
  };
  const lower = relation.toLowerCase();
  if (relationMap[lower]) return relationMap[lower];
  for (const [key, value] of Object.entries(relationMap)) {
    if (lower.includes(key)) return value;
  }
  return relation;
}

function normalizeEntityLabel(label: string): string {
  return label.trim().slice(0, 50);
}

// ===== 阶段 2: 离线 chunk/document 级别抽取 =====

export interface ChunkInput {
  /** KB chunk 唯一 ID（用于反查） */
  chunkId: string;
  /** 文本内容 */
  text: string;
}

export interface ExtractedEntity {
  /** 原始 surface form（来自 LLM 输出） */
  surfaceForm: string;
  /** 归一化 + alias 后的 canonical form */
  canonicalForm: string;
  /** 实体类型字符串（person / org / concept / ...） */
  entityType: string;
  /** 来源 chunk 列表 */
  sourceChunkIds: string[];
}

export interface ExtractedRelationV2 {
  sourceCanonical: string;
  targetCanonical: string;
  relation: string;
  confidence: number;
  sourceChunkId: string;
  evidence?: string;
}

export interface ExtractFromChunkResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelationV2[];
}

export interface ExtractFromDocumentOptions {
  llmProvider: LLMProvider;
  entityLinker?: EntityLinker;
  /** 每批 LLM 调用最多处理多少个关系，默认 20 */
  maxRelationsPerChunk?: number;
}

export interface ExtractFromDocumentResult {
  totalEntities: number;
  totalRelations: number;
  chunksProcessed: number;
}

/**
 * 阶段 2 新增：单 chunk 抽取
 * - 调用 LLM **两次**（一次抽 entities，一次抽 relations），独立报告
 *   - KG v2 修 3：entities 不再是 relations 的副产物
 * - 走 entity linker 归一化 surface form
 * - 返回结构化结果，不直接写图谱（让 caller 决定持久化策略）
 */
export async function extractFromChunk(
  chunk: ChunkInput,
  options: { llmProvider: LLMProvider; entityLinker?: EntityLinker }
): Promise<ExtractFromChunkResult> {
  const linker = options.entityLinker ?? defaultEntityLinker;

  // P1-6 修复：合并为单次 LLM 调用（之前是 2 次并行调用，成本 -50%）
  const { extractEntitiesAndRelationships } = await import("./relationship-extractor.js");
  const { entities: extractedEntities, relations } = await extractEntitiesAndRelationships(
    chunk.text,
    options.llmProvider
  );

  const entitiesMap = new Map<string, ExtractedEntity>();
  const relationsOut: ExtractedRelationV2[] = [];

  // 1) 先把所有抽取的 entity 写进 map（用 linker 归一化）
  for (const e of extractedEntities) {
    const canonical = linker.toCanonical(e.label);
    if (!canonical) continue;
    const existing = entitiesMap.get(canonical);
    if (existing) {
      // 累加 chunk 引用
      if (!existing.sourceChunkIds.includes(chunk.chunkId)) {
        existing.sourceChunkIds.push(chunk.chunkId);
      }
    } else {
      entitiesMap.set(canonical, {
        surfaceForm: e.label,
        canonicalForm: canonical,
        entityType: e.type || "entity",
        sourceChunkIds: [chunk.chunkId],
      });
    }
  }

  // 2) 处理 relations：source/target 补全 entity map
  for (const rel of relations) {
    if (!rel.sourceLabel || !rel.targetLabel || !rel.relation) continue;
    if (typeof rel.confidence !== "number" || rel.confidence < 0.3) continue;

    const srcCanonical = linker.toCanonical(rel.sourceLabel);
    const tgtCanonical = linker.toCanonical(rel.targetLabel);
    if (!srcCanonical || !tgtCanonical || srcCanonical === tgtCanonical) continue;

    // 关系两端的 entity 如果不在 extractEntities 的结果里，relation 阶段补上（这样不丢覆盖率）
    if (!entitiesMap.has(srcCanonical)) {
      entitiesMap.set(srcCanonical, {
        surfaceForm: rel.sourceLabel,
        canonicalForm: srcCanonical,
        entityType: "entity",
        sourceChunkIds: [chunk.chunkId],
      });
    } else {
      const e = entitiesMap.get(srcCanonical)!;
      if (!e.sourceChunkIds.includes(chunk.chunkId)) e.sourceChunkIds.push(chunk.chunkId);
    }

    if (!entitiesMap.has(tgtCanonical)) {
      entitiesMap.set(tgtCanonical, {
        surfaceForm: rel.targetLabel,
        canonicalForm: tgtCanonical,
        entityType: "entity",
        sourceChunkIds: [chunk.chunkId],
      });
    } else {
      const e = entitiesMap.get(tgtCanonical)!;
      if (!e.sourceChunkIds.includes(chunk.chunkId)) e.sourceChunkIds.push(chunk.chunkId);
    }

    relationsOut.push({
      sourceCanonical: srcCanonical,
      targetCanonical: tgtCanonical,
      relation: normalizeRelationType(rel.relation),
      confidence: rel.confidence,
      sourceChunkId: chunk.chunkId,
    });
  }

  return { entities: Array.from(entitiesMap.values()), relations: relationsOut };
}

/**
 * 阶段 2 新增：跨 chunk 抽取
 * - 顺序处理 chunks（避免 LLM 限流）
 * - 跨 chunk 复用 entities（用 linker.toCanonical 合并同义 entity）
 * - 返回合并后的全局视图，由 caller 决定如何写入图谱
 */
export async function extractFromDocument(
  chunks: ChunkInput[],
  options: ExtractFromDocumentOptions
): Promise<ExtractFromDocumentResult> {
  const linker = options.entityLinker ?? defaultEntityLinker;
  const maxRelations = options.maxRelationsPerChunk ?? 20;

  // 全局 entity 池：canonical → 累计的 ExtractedEntity
  const globalEntities = new Map<string, ExtractedEntity>();
  // 全局 relations：按 (source, target, rel) 去重
  const globalRelations = new Map<string, ExtractedRelationV2>();

  for (const chunk of chunks) {
    const result = await extractFromChunk(chunk, {
      llmProvider: options.llmProvider,
      entityLinker: linker,
    });

    // 截断：防止单 chunk 的 LLM 关系数过多
    const rels = result.relations.slice(0, maxRelations);

    for (const e of result.entities) {
      const existing = globalEntities.get(e.canonicalForm);
      if (!existing) {
        globalEntities.set(e.canonicalForm, { ...e, sourceChunkIds: [...e.sourceChunkIds] });
      } else {
        for (const cid of e.sourceChunkIds) {
          if (!existing.sourceChunkIds.includes(cid)) existing.sourceChunkIds.push(cid);
        }
      }
    }

    for (const r of rels) {
      const key = `${r.sourceCanonical}::${r.relation}::${r.targetCanonical}`;
      if (!globalRelations.has(key)) {
        globalRelations.set(key, r);
      }
    }
  }

  return {
    totalEntities: globalEntities.size,
    totalRelations: globalRelations.size,
    chunksProcessed: chunks.length,
  };
}
