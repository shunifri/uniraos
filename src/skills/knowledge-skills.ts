/**
 * 知识库 Skill 家族
 *
 * 将上传文件自动解析、分块、向量化，形成可检索的知识库。
 * 支持语义搜索 + 关键词搜索混合检索，大批量文件优化。
 *
 * 特性：
 *   - 多租户隔离：每个用户拥有独立知识库（通过 owner_id 隔离）
 *   - 知识更新：同名/同源文档自动替换旧版本，保留版本历史
 *   - 知识共享：用户可将文档标记为共享，其他用户可检索共享知识
 *
 * Skills:
 *   kb_ingest    — 将文件内容导入知识库（自动分块 + 向量化）
 *   kb_search    — 混合检索知识库（语义 + 关键词）
 *   kb_list      — 列出知识库中的文档
 *   kb_delete    — 从知识库中删除文档
 *   kb_update    — 更新已有文档（替换旧版本）
 *   kb_stats     — 知识库统计信息
 *   kb_rebuild   — 重建向量索引
 *   kb_share     — 设置文档共享状态
 *   kb_shared    — 列出/检索所有共享文档
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { UserSessionManager } from "../user/user-session.js";
import type { EmbeddingProvider } from "../memory/embedding-provider.js";
import { LocalEmbeddingProvider, cosineSimilarity } from "../memory/embedding-provider.js";
import type { LLMProvider } from "../llm/types.js";
import { parseDocument, type VisionModelConfig, type PageResult, type OCRBlock } from "../services/doc-parser.js";
import { getMySQLAdapter, type MySQLAdapter } from "../db/mysql-adapter.js";
import * as mysql from 'mysql2/promise';
import { join, resolve, dirname, normalize, sep } from "path";
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { syncSharedKBToGraphs, removeKBFromAllGraphs, getSharedKBTargetUsers } from "../kb-graph-sync.js";
import { configManager } from "../config/config-manager.js";

/** 解析器版本号 — 每次解析逻辑有重大变更时递增，强制已有文档重新入库 */
const PARSER_VERSION = 2;
import { getCurrentUserId } from "../user/request-context.js";

// ===== 类型定义 =====

/** 文档记录 */
interface DocRecord {
  doc_id: string;
  name: string;
  source: string;
  chunk_count: number;
  total_tokens: number;
  ingested_at: number;
  updated_at: number | null;
  version: number;
  tags: string;
  shared: number;
  content_hash: string;
  parsed_content: string;
  layouts_json?: string;
  segments_json?: string;
}

/** 简化文档记录（用于查询） */
interface DocIdRecord {
  doc_id: string;
}

/** 文档版本记录 */
interface DocVersionRecord {
  version: number;
  content_hash: string;
}

/** 文档统计记录 */
interface DocStatsRecord {
  chunk_count: number;
  total_tokens: number;
  content_hash: string;
}

/** 块记录 */
interface ChunkRecord {
  id: number;
  doc_id: string;
  chunk_index: number;
  content: string;
  tokens: number;
  vector: Buffer | null;
  content_type?: string;
  page_number?: number | null;
  bbox_data?: string | null;
}

/** 关键词记录 */
interface KeywordRecord {
  id: number;
  doc_id: string;
  docName: string;
  chunkIndex: number;
  content: string;
  page_number: number | null;
  bbox_data: string | null;
}

/** 计数记录 */
interface CountRecord {
  c: number;
}

/** 标签计数记录 */
interface TagCountRecord {
  tag: string;
  count: number;
}

/** 总和记录 */
interface SumRecord {
  t: number;
}

/** 共享文档记录 */
interface SharedDocRecord {
  doc_id: string;
  name: string;
  shared: number;
}

/** JSON 布局记录 */
interface LayoutRecord {
  layouts_json: string;
}

/** JSON 段落记录 */
interface SegmentRecord {
  segments_json: string;
}

/** 版面布局 */
interface Layout {
  id?: string;
  uniqueId?: string;
  page?: number;
  pageNum?: number;
  type: string;
  subType?: string;
  content?: string;
  text?: string;
}

/** 音视频切片 */
interface Segment {
  index: number;
  startTime: number;
  endTime: number;
  synopsis?: string;
  searchableText?: string;
}

// ===== 查询分类器类型 =====
type QueryType = 'factual' | 'relational' | 'discovery' | 'hybrid';

interface ClassifiedQuery {
  type: QueryType;
  confidence: number;
  keywords: string[];
  entities: string[];
  relations: string[];
}

/** 查询分类器 */
function classifyQuery(query: string): ClassifiedQuery {
  // 规则引擎 + 关键词匹配
  const queryLower = query.toLowerCase();
  const indicators = {
    factual: ['什么是', '定义', '介绍', '说明', 'how to', 'what is'],
    relational: ['关系', '关联', '连接', '从...到', '通过', '路径', '区别', '相同'],
    discovery: ['意外', '没想到', '新发现', '探索', '发现', '有什么', '还有什么'],
  };

  // 匹配和评分
  const scores = {
    factual: indicators.factual.filter(i => queryLower.includes(i)).length,
    relational: indicators.relational.filter(i => queryLower.includes(i)).length,
    discovery: indicators.discovery.filter(i => queryLower.includes(i)).length,
  };

  // 确定主类型
  let type: QueryType = 'hybrid';
  let maxScore = 0;

  for (const [key, score] of Object.entries(scores) as Array<[keyof typeof scores, number]>) {
    if (score > maxScore) {
      maxScore = score;
      type = key as QueryType;
    }
  }

  // 如果所有类型得分相等，归类为 hybrid
  if (Object.values(scores).filter(s => s === maxScore).length > 1) {
    type = 'hybrid';
  }

  // 简单的关键词提取
  const keywords = queryLower.match(/[\u4e00-\u9fff]+|[a-zA-Z]+/g)?.filter(w => w.length >= 2) || [];

  return {
    type,
    confidence: maxScore > 0 ? (maxScore / Math.max(...Object.values(indicators).map(i => i.length))) : 0.5,
    keywords,
    entities: [],
    relations: [],
  };
}

// ===== 知识库核心 =====

export class KnowledgeBase {
  private adapter: MySQLAdapter;
  private embeddingProvider: EmbeddingProvider;
  private vectorCache: Map<number, number[]> = new Map();
  private vectorCacheAccessTime: Map<number, number> = new Map(); // LRU tracking
  private static readonly MAX_VECTOR_CACHE_SIZE = 10000; // 最大缓存向量数（降低到10000约60MB/实例）
  private vectorCacheDirty = true;
  private vectorCacheLock = false;
  private vectorCacheWaiters: (() => void)[] = [];
  readonly owner: string;

  constructor(owner: string, embeddingProvider?: EmbeddingProvider) {
    this.adapter = getMySQLAdapter();
    this.embeddingProvider = embeddingProvider ?? new LocalEmbeddingProvider();
    this.owner = owner;
  }

  /** 创建文档占位记录（用于异步解析，立即在列表中显示） */
  async createPlaceholder(docName: string, opts?: { source?: string; tags?: string[] }): Promise<string> {
    const source = opts?.source ?? "";
    const tags = opts?.tags ?? [];

    const rows = await this.adapter.query<DocIdRecord>(
      "SELECT doc_id FROM kb_documents WHERE name = ? AND owner_id = ?",
      [docName, this.owner]
    );

    if (rows.length > 0) return rows[0].doc_id;

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.adapter.execute(
      "INSERT INTO kb_documents (doc_id, owner_id, name, source, chunk_count, total_tokens, ingested_at, version, tags, shared, content_hash, parsed_content, parsing_status, parsing_progress) VALUES (?, ?, ?, ?, 0, 0, ?, 1, ?, 0, ?, ?, ?, ?)",
      [docId, this.owner, docName, source, Date.now(), JSON.stringify(tags), '', '', 'processing', 0.00]
    );
    return docId;
  }

  /** 导入文档（同名文档自动更新）
   * skipEmbedding=true 时只做分块+关键词，不向量化（快速入库）
   * pages 为 vision OCR 的页面结果（含 blocks + bbox），用于页码感知分块
   */
  async ingest(
    docName: string,
    content: string,
    opts?: { source?: string; tags?: string[]; chunkSize?: number; chunkOverlap?: number; shared?: boolean; skipEmbedding?: boolean; pages?: PageResult[]; fileHash?: string; _placeholderDocId?: string },
  ): Promise<{ docId: string; chunkCount: number; totalTokens: number; updated: boolean; version: number }> {
    const chunkSize = opts?.chunkSize ?? 500;
    const chunkOverlap = opts?.chunkOverlap ?? 50;
    const source = opts?.source ?? "";
    const tags = opts?.tags ?? [];
    const shared = opts?.shared ? 1 : 0;
    const skipEmbedding = opts?.skipEmbedding ?? false;
    // 使用 fileHash+parserVersion 做去重（比解析后内容更可靠，解析器升级时自动重新入库）
    const contentHash = opts?.fileHash
      ? `v${PARSER_VERSION}_${opts.fileHash}`
      : `v${PARSER_VERSION}_${simpleHash(content)}`;

    // 检查是否有占位符 docId
    const placeholderDocId = opts?._placeholderDocId;

    let docId: string;
    let version: number;
    let updated: boolean;

    if (placeholderDocId) {
      // 有占位符 docId，直接使用
      docId = placeholderDocId;
      version = 1;
      updated = false;

      // 检查占位符记录是否已存在
      const placeholderRow = await this.adapter.query<DocRecord>(
        "SELECT doc_id FROM kb_documents WHERE doc_id = ?",
        [docId]
      );
      if (placeholderRow.length > 0) {
        // 占位符记录已存在，标记为更新
        updated = true;
        version = 2; // 占位符记录是 version 1
      }

      // 不检查同名文档，直接使用占位符 docId
    } else {
      // 无占位符 docId，检查同名文档
      const existingRows = await this.adapter.query<DocVersionRecord & DocIdRecord>(
        "SELECT doc_id, version, content_hash FROM kb_documents WHERE name = ? AND owner_id = ?",
        [docName, this.owner]
      );
      const existing = existingRows[0];

      if (existing) {
        // 内容相同则跳过
        if (existing.content_hash === contentHash) {
          return {
            docId: existing.doc_id,
            chunkCount: 0,
            totalTokens: 0,
            updated: false,
            version: existing.version,
          };
        }

        // 内容不同则更新
        docId = existing.doc_id;
        version = existing.version + 1;
        updated = true;

        // 保存旧版本记录
        const oldDocRows = await this.adapter.query<DocStatsRecord>(
          "SELECT chunk_count, total_tokens, content_hash FROM kb_documents WHERE doc_id = ?",
          [docId]
        );
        const oldDoc = oldDocRows[0];

        if (oldDoc) {
          await this.adapter.execute(
            "INSERT INTO kb_versions (doc_id, version, content_hash, chunk_count, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash), chunk_count = VALUES(chunk_count), total_tokens = VALUES(total_tokens), created_at = VALUES(created_at)",
            [docId, existing.version, oldDoc.content_hash, oldDoc.chunk_count, oldDoc.total_tokens, Date.now()]
          );
        }
      } else {
        // 新文档，生成 docId
        docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        version = 1;
        updated = false;
      }
    }

    // 智能分块（有 pages + blocks 时使用页码感知分块）
    const pagesWithBlocks = opts?.pages?.filter((p) => p.blocks && p.blocks.length > 0);
    const chunksWithMeta = pagesWithBlocks && pagesWithBlocks.length > 0
      ? this.splitWithPageTracking(pagesWithBlocks, chunkSize, chunkOverlap)
      : this.splitIntoChunks(content, chunkSize, chunkOverlap).map((c) => ({
          content: c,
          tokens: this.estimateTokens(c),
          pageNumber: null as number | null,
          bboxes: [] as Array<{ page: number; bbox: [number, number, number, number] }>,
        }));
    const chunks = chunksWithMeta.map((c) => c.content);

    // 向量化（可跳过）
    let allVectors: number[][] | null = null;
    if (!skipEmbedding) {
      allVectors = [];
      const batchSize = 50;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await this.embeddingProvider.embed(batch);
        allVectors.push(...vectors);
      }
    }

    // 事务写入（包含删除旧数据、插入新数据，保证原子性）
    let totalTokens = 0;

    await this.adapter.transaction(async (connection) => {
      // 检查是否是占位符文档
      const isPlaceholderDoc = opts?._placeholderDocId !== undefined;

      // 检查文档是否已存在
      const existsResult = await connection.query(
        "SELECT COUNT(*) as count FROM kb_documents WHERE doc_id = ?",
        [docId]
      );
      const docExists = (existsResult as any)[0].count > 0;

      if (docExists) {
        // 文档已存在（占位符或旧文档），先删除旧的 chunks 和 keywords
        await connection.execute(
          "DELETE FROM kb_keywords WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = ?)",
          [docId]
        );
        await connection.execute("DELETE FROM kb_chunks WHERE doc_id = ?", [docId]);
        await connection.execute("DELETE FROM kb_tags WHERE doc_id = ?", [docId]);

        // 更新文档记录
        await connection.execute(
          "UPDATE kb_documents SET chunk_count = ?, total_tokens = 0, updated_at = ?, version = ?, tags = ?, shared = ?, content_hash = ?, source = ?, parsed_content = ? WHERE doc_id = ?",
          [chunks.length, Date.now(), version, JSON.stringify(tags), shared, contentHash, source, content, docId]
        );
      } else {
        // 新文档，插入记录
        await connection.execute(
          "INSERT INTO kb_documents (doc_id, owner_id, name, source, chunk_count, total_tokens, ingested_at, version, tags, shared, content_hash, parsed_content) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
          [docId, this.owner, docName, source, chunks.length, Date.now(), version, JSON.stringify(tags), shared, contentHash, content]
        );
      }

      // 插入标签关联
      for (const tag of tags) {
        await connection.execute(
          "INSERT IGNORE INTO kb_tags (tag, doc_id) VALUES (?, ?)",
          [tag, docId]
        );
      }

      for (let i = 0; i < chunks.length; i++) {
        const meta = chunksWithMeta[i];
        const tokens = this.estimateTokens(chunks[i]);
        totalTokens += tokens;
        const vectorBlob = allVectors
          ? Buffer.from(new Float32Array(allVectors[i]).buffer)
          : null;
        const pageNumber = meta?.pageNumber ?? null;
        const bboxData = meta?.bboxes && meta.bboxes.length > 0 ? JSON.stringify(meta.bboxes) : "[]";

        // 插入 chunk
        await connection.execute(
          "INSERT INTO kb_chunks (doc_id, chunk_index, content, tokens, vector, page_number, bbox_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [docId, i, chunks[i], tokens, vectorBlob, pageNumber, bboxData]
        );

        // 使用 LAST_INSERT_ID() 获取自增ID
        const [idRows] = await connection.query<mysql.RowDataPacket[]>("SELECT LAST_INSERT_ID() as id");
        const chunkId = idRows[0]?.id;

        if (!chunkId) {
          console.warn(`[KnowledgeBase] Failed to get chunkId for chunk ${i}`);
          continue;
        }

        // 插入关键词
        const keywords = this.extractKeywords(chunks[i]);
        for (const [keyword, tf] of keywords) {
          try {
            // 限制关键词长度不超过 100 字符，防止字段长度溢出
            const limitedKeyword = keyword.slice(0, 100);
            await connection.execute(
              "INSERT INTO kb_keywords (keyword, chunk_id, tf) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tf = VALUES(tf)",
              [limitedKeyword, chunkId, tf]
            );
          } catch (e) {
            console.warn(`[KnowledgeBase] Keyword insert failed: ${e}`);
          }
        }
      }

      await connection.execute(
        "UPDATE kb_documents SET total_tokens = ? WHERE doc_id = ?",
        [totalTokens, docId]
      );
    });

    this.vectorCacheDirty = true;

    return { docId, chunkCount: chunks.length, totalTokens, updated, version };
  }

  /** 对指定文档异步向量化（仅处理 vector 为 null 的 chunks） */
  async vectorizeDoc(docId: string): Promise<{ vectorized: number }> {
    const rows = await this.adapter.query<{ id: number; content: string }>(
      "SELECT id, content FROM kb_chunks WHERE doc_id = ? AND vector IS NULL",
      [docId]
    );

    if (rows.length === 0) return { vectorized: 0 };

    const batchSize = 50;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const vectors = await this.embeddingProvider.embed(batch.map((r) => r.content));
      
      await this.adapter.transaction(async (connection) => {
        for (let j = 0; j < batch.length; j++) {
          const vectorBlob = Buffer.from(new Float32Array(vectors[j]).buffer);
          await connection.execute(
            "UPDATE kb_chunks SET vector = ? WHERE id = ?",
            [vectorBlob, batch[j].id]
          );
        }
      });
    }

    this.vectorCacheDirty = true;
    return { vectorized: rows.length };
  }

  /** 获取文档向量化状态 */
  async getDocVectorStatus(docId: string): Promise<{ total: number; vectorized: number }> {
    const totalRows = await this.adapter.query<CountRecord>(
      "SELECT COUNT(*) as c FROM kb_chunks WHERE doc_id = ?",
      [docId]
    );
    const vectorizedRows = await this.adapter.query<CountRecord>(
      "SELECT COUNT(*) as c FROM kb_chunks WHERE doc_id = ? AND vector IS NOT NULL",
      [docId]
    );
    return { total: totalRows[0]?.c ?? 0, vectorized: vectorizedRows[0]?.c ?? 0 };
  }

  /** 混合检索（支持限定范围和共享文档） */
  async search(
    query: string,
    opts?: { limit?: number; threshold?: number; docIds?: string[]; tags?: string[]; includeShared?: boolean },
  ): Promise<Array<{ docId: string; docName: string; chunkIndex: number; content: string; score: number; matchType: string; shared: boolean; pageNumber: number | null; bboxes: Array<{ page: number; bbox: [number, number, number, number] }> | null }>> {
    const limit = opts?.limit ?? 10;
    // threshold 为相对阈值 (0-1)，表示结果至少达到最高分的该比例才保留，默认 0.4
    const threshold = opts?.threshold ?? 0.4;
    const candidateCount = Math.max(limit * 3, 30);

    const keywordResults = await this.keywordSearch(query, candidateCount, opts?.docIds, opts?.tags);
    const semanticResults = await this.semanticSearch(query, candidateCount, opts?.docIds);

    // RRF 混合评分 — k=60，keyword 权重 0.4 / semantic 权重 0.6
    const scoreMap = new Map<number, { score: number; matchType: string; data: any }>();

    for (let i = 0; i < keywordResults.length; i++) {
      const r = keywordResults[i];
      const rrfScore = 0.4 / (60 + i + 1);
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.score += rrfScore;
        existing.matchType = "hybrid";
      } else {
        scoreMap.set(r.id, { score: rrfScore, matchType: "keyword", data: r });
      }
    }

    for (let i = 0; i < semanticResults.length; i++) {
      const r = semanticResults[i];
      const rrfScore = 0.6 / (60 + i + 1);
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.score += rrfScore;
        existing.matchType = "hybrid";
      } else {
        scoreMap.set(r.id, { score: rrfScore, matchType: "semantic", data: r });
      }
    }

    const sorted = [...scoreMap.values()].sort((a, b) => b.score - a.score);
    if (sorted.length === 0) return [];

    const maxScore = sorted[0].score;
    // 双重过滤：相对阈值（结果须达到最高分的该比例）+ 绝对下限（RRF 分数太低的直接丢弃）
    const absMinScore = 0.003; // RRF 绝对下限，低于此的结果基本不相关
    let results = sorted
      .map((r) => ({ ...r, normScore: r.score / maxScore }))
      .filter((r) => r.normScore >= threshold && r.score >= absMinScore)
      .slice(0, limit);

    // tag 过滤（如果 keyword 阶段未预过滤）
    if (opts?.tags && opts.tags.length > 0) {
      const tagSet = new Set(opts.tags);
      results = await Promise.all(results.map(async (r) => {
        const docRows = await this.adapter.query<{ tags: string }>(
          "SELECT tags FROM kb_documents WHERE doc_id = ?",
          [r.data.docId]
        );
        if (docRows.length === 0) return null;
        // 兼容 MySQL JSON 字段可能直接返回数组
        let docTags: string[] = [];
        const tagsRaw = docRows[0].tags;
        if (Array.isArray(tagsRaw)) {
          docTags = tagsRaw as string[];
        } else if (typeof tagsRaw === 'string') {
          try {
            docTags = JSON.parse(tagsRaw);
          } catch { /* ignore */ }
        }
        return docTags.some((t) => tagSet.has(t)) ? r : null;
      })).then(rs => rs.filter((r): r is NonNullable<typeof r> => r !== null));
    }

    return results.map((r) => {
      let bboxes: Array<{ page: number; bbox: [number, number, number, number] }> | null = null;
      try {
        const raw = r.data.bboxData ?? r.data.bbox_data;
        if (raw && typeof raw === "string" && raw !== "[]") {
          bboxes = JSON.parse(raw);
        }
      } catch { /* ignore */ }
      return {
        docId: r.data.docId,
        docName: r.data.docName,
        chunkIndex: r.data.chunkIndex,
        content: r.data.content,
        score: Math.round(r.normScore * 10000) / 10000,
        matchType: r.matchType,
        shared: r.data.shared === 1,
        pageNumber: r.data.pageNumber ?? r.data.page_number ?? null,
        bboxes,
      };
    });
  }

  private async keywordSearch(
    query: string,
    limit: number,
    docIds?: string[],
    tags?: string[],
  ): Promise<Array<{ id: number; docId: string; docName: string; chunkIndex: number; content: string; score: number; shared: number; page_number: number | null; bbox_data: string }>> {
    const queryKeywords = this.extractKeywords(query);
    if (queryKeywords.size === 0) return [];

    const keywords = [...queryKeywords.keys()];
    const placeholders = keywords.map(() => "?").join(",");

    // 使用匹配关键词数 * SUM(tf) 作为排序依据，奖励多关键词命中
    let sql = `
      SELECT c.id, c.doc_id as docId, d.name as docName, c.chunk_index as chunkIndex, c.content,
             d.shared, c.page_number, c.bbox_data, COUNT(DISTINCT k.keyword) as matchCount, SUM(k.tf) as tfSum,
             COUNT(DISTINCT k.keyword) * SUM(k.tf) as score
      FROM kb_keywords k
      JOIN kb_chunks c ON k.chunk_id = c.id
      JOIN kb_documents d ON c.doc_id = d.doc_id
    `;

    const params: unknown[] = [...keywords];

    // 使用标签关联表 JOIN 来高效过滤（利用索引）
    if (tags && tags.length > 0) {
      sql += ` JOIN kb_tags t ON t.doc_id = c.doc_id AND t.tag IN (${tags.map(() => "?").join(",")})`;
      params.push(...tags);
    }

    sql += ` WHERE k.keyword IN (${placeholders})`;

    if (docIds && docIds.length > 0) {
      sql += ` AND c.doc_id IN (${docIds.map(() => "?").join(",")})`;
      params.push(...docIds);
    }
    
    // 添加 owner_id 限制
    sql += ` AND d.owner_id = ?`;
    params.push(this.owner);

    // DISTINCT 因为一个 doc 可能匹配多个标签，会产生重复行
    sql += ` GROUP BY c.id ORDER BY score DESC LIMIT ?`;
    params.push(limit);

    return this.adapter.query(sql, params);
  }

  private async semanticSearch(
    query: string,
    limit: number,
    docIds?: string[],
  ): Promise<Array<{ id: number; docId: string; docName: string; chunkIndex: number; content: string; similarity: number; shared: number; page_number: number | null; bbox_data: string }>> {
    if (this.embeddingProvider.name === "local" && this.vectorCache.size === 0) {
      // local provider 没有预训练语义，跳过全表扫描
      return [];
    }

    const [queryVector] = await this.embeddingProvider.embed([query]);
    await this.ensureVectorCache();

    if (this.vectorCache.size === 0) return [];

    // Top-K 选择：维护一个大小为 limit 的最小堆，避免全量排序
    // 对于万级以下直接线性扫描 + 部分排序已足够高效
    const minSim = 0.3; // 语义相似度绝对下限，低于此的直接跳过
    const topK: Array<{ id: number; similarity: number }> = [];
    let heapMin = minSim;

    for (const [chunkId] of this.vectorCache) {
      const vector = this.getVector(chunkId);
      if (!vector) continue;
      const sim = cosineSimilarity(queryVector, vector);
      if (sim <= heapMin && topK.length >= limit) continue;
      if (sim <= minSim) continue;

      if (topK.length < limit) {
        topK.push({ id: chunkId, similarity: sim });
        if (topK.length === limit) {
          // 建堆：找到当前最小值
          topK.sort((a, b) => a.similarity - b.similarity);
          heapMin = topK[0].similarity;
        }
      } else {
        // 替换堆顶（最小值）
        topK[0] = { id: chunkId, similarity: sim };
        // 重新找最小值（简单实现，limit 通常 < 100）
        let minIdx = 0;
        for (let i = 1; i < topK.length; i++) {
          if (topK[i].similarity < topK[minIdx].similarity) minIdx = i;
        }
        if (minIdx !== 0) {
          [topK[0], topK[minIdx]] = [topK[minIdx], topK[0]];
        }
        heapMin = topK[0].similarity;
      }
    }

    if (topK.length === 0) return [];

    topK.sort((a, b) => b.similarity - a.similarity);

    const ids = topK.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(",");

    let sql = `
      SELECT c.id, c.doc_id as docId, d.name as docName, c.chunk_index as chunkIndex, c.content, d.shared, c.page_number, c.bbox_data
      FROM kb_chunks c
      JOIN kb_documents d ON c.doc_id = d.doc_id
      WHERE c.id IN (${placeholders})
    `;
    const params: unknown[] = [...ids];

    if (docIds && docIds.length > 0) {
      sql += ` AND c.doc_id IN (${docIds.map(() => "?").join(",")})`;
      params.push(...docIds);
    }
    
    // 添加 owner_id 限制
    sql += ` AND d.owner_id = ?`;
    params.push(this.owner);

    interface ChunkRow {
      id: number;
      docId: string;
      docName: string;
      chunkIndex: number;
      content: string;
      shared: number;
      page_number: number | null;
      bbox_data: string;
    }
    const rows = await this.adapter.query<ChunkRow>(sql, params);
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    return topK
      .filter((c) => rowMap.has(c.id))
      .map((c) => ({ ...rowMap.get(c.id)!, similarity: c.similarity }));
  }

  private async ensureVectorCache(): Promise<void> {
    // 快速路径：缓存已是最新
    if (!this.vectorCacheDirty) return;
    
    // 等待锁释放，最多等待 5 分钟，超时强制释放锁避免死锁
    const startTime = Date.now();
    const MAX_WAIT_MS = 5 * 60 * 1000; // 5分钟超时
    while (this.vectorCacheLock) {
      if (Date.now() - startTime > MAX_WAIT_MS) {
        console.warn(`[KnowledgeBase] Vector cache lock wait timeout (${MAX_WAIT_MS}ms), forcing unlock`);
        this.vectorCacheLock = false;
        break;
      }
      await new Promise<void>(resolve => this.vectorCacheWaiters.push(resolve));
    }
    
    // 双重检查：等待期间可能已被其他线程刷新
    if (!this.vectorCacheDirty) return;
    
    // 获取锁
    this.vectorCacheLock = true;
    
    try {
      this.vectorCache.clear();
      this.vectorCacheAccessTime.clear();
      
      const rows = await this.adapter.query<{ id: number; vector: Buffer }>(
        "SELECT c.id, c.vector FROM kb_chunks c JOIN kb_documents d ON c.doc_id = d.doc_id WHERE c.vector IS NOT NULL AND d.owner_id = ?",
        [this.owner]
      );

      for (const row of rows) {
        if (row.vector && row.vector.length > 0) {
          // 确保 Buffer 的字节偏移量是 4 的倍数（Float32 是 4 字节）
          let floats: Float32Array;
          if (row.vector.byteOffset % 4 === 0) {
            // 字节偏移量是 4 的倍数，直接使用
            floats = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.length / 4);
          } else {
            // 字节偏移量不是 4 的倍数，创建新的 Buffer
            const copied = Buffer.alloc(row.vector.length);
            row.vector.copy(copied, 0, 0, row.vector.length);
            floats = new Float32Array(copied.buffer, copied.byteOffset, copied.length / 4);
          }

          this.vectorCache.set(row.id, Array.from(floats));
          this.vectorCacheAccessTime.set(row.id, Date.now());
          
          // LRU 淘汰：如果超过最大限制，移除最久未访问的 10%
          if (this.vectorCache.size > KnowledgeBase.MAX_VECTOR_CACHE_SIZE) {
            this.evictLRU();
          }
        }
      }

      this.vectorCacheDirty = false;
    } finally {
      // 释放锁并通知等待者
      this.vectorCacheLock = false;
      const waiters = this.vectorCacheWaiters.splice(0);
      for (const waiter of waiters) {
        waiter();
      }
    }
  }

  /** LRU 淘汰：移除最久未访问的 10% 缓存 */
  private evictLRU(): void {
    const entries = [...this.vectorCacheAccessTime.entries()]
      .sort((a, b) => a[1] - b[1]);
    
    // 淘汰 10% 最久未访问的
    const evictCount = Math.ceil(KnowledgeBase.MAX_VECTOR_CACHE_SIZE * 0.1);
    const toEvict = entries.slice(0, evictCount);
    
    for (const [id] of toEvict) {
      this.vectorCache.delete(id);
      this.vectorCacheAccessTime.delete(id);
    }
  }

  /** 更新访问时间并获取向量 */
  private getVector(chunkId: number): number[] | undefined {
    const vector = this.vectorCache.get(chunkId);
    if (vector) {
      this.vectorCacheAccessTime.set(chunkId, Date.now());
      
      // 如果因为增量添加超过限制，触发淘汰
      if (this.vectorCache.size > KnowledgeBase.MAX_VECTOR_CACHE_SIZE) {
        this.evictLRU();
      }
    }
    return vector;
  }

  /** 列出文档（增强版筛选） */
  async listDocuments(opts?: { 
    query?: string; 
    tags?: string[]; 
    sharedOnly?: boolean; 
    limit?: number;
    format?: string;  // 文件格式筛选，如 "pdf", "docx", "md"
  }): Promise<Array<{ docId: string; id: string; name: string; source: string; chunkCount: number; totalTokens: number; ingestedAt: number; updatedAt: number | null; version: number; tags: string[]; shared: boolean; vectorized: number; vectorTotal: number; format: string }>> {
    const limit = opts?.limit ?? 100;
    let sql = "SELECT d.* FROM kb_documents d WHERE d.owner_id = ?";
    const params: unknown[] = [this.owner];

    // 使用标签关联表索引筛选
    if (opts?.tags && opts.tags.length > 0) {
      sql += ` AND EXISTS (SELECT 1 FROM kb_tags t WHERE t.doc_id = d.doc_id AND t.tag IN (${opts.tags.map(() => "?").join(",")}))`;
      params.push(...opts.tags);
    }

    if (opts?.query) {
      sql += " AND (d.name LIKE ? OR d.source LIKE ?)";
      params.push(`%${opts.query}%`, `%${opts.query}%`);
    }
    if (opts?.sharedOnly) {
      sql += " AND d.shared = 1";
    }
    if (opts?.format) {
      sql += " AND (d.name LIKE ? OR d.name LIKE ?)";
      params.push(`%.${opts.format}`, `%.${opts.format.toUpperCase()}`);
    }

    sql += " ORDER BY d.ingested_at DESC LIMIT ?";
    params.push(limit);

    const rows = await this.adapter.query<DocRecord>(sql, params);

    return await Promise.all(rows.map(async (r) => {
      const vs = await this.getDocVectorStatus(r.doc_id);
      // MySQL JSON 字段可能直接返回对象/数组，需要兼容处理
      let tags: string[] = [];
      if (r.tags) {
        if (Array.isArray(r.tags)) {
          tags = r.tags as string[];
        } else if (typeof r.tags === 'string') {
          try {
            tags = JSON.parse(r.tags);
          } catch {
            tags = [];
          }
        }
      }
      return {
        docId: r.doc_id,
        id: r.doc_id,
        name: r.name,
        source: r.source,
        chunkCount: r.chunk_count,
        totalTokens: r.total_tokens,
        ingestedAt: r.ingested_at,
        updatedAt: r.updated_at,
        version: r.version,
        tags,
        shared: r.shared === 1,
        vectorized: vs.vectorized,
        vectorTotal: vs.total,
        format: this.getFileFormat(r.name),
      };
    }));
  }

  /** 获取文件格式 */
  private getFileFormat(filename: string): string {
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : "unknown";
  }

  /** 获取所有标签及其使用次数（按次数降序） */
  async getAllTags(): Promise<Array<{ tag: string; count: number }>> {
    // 使用标签关联表统计，更高效准确
    const rows = await this.adapter.query<TagCountRecord>(
      "SELECT tag, COUNT(*) as count FROM kb_tags WHERE doc_id IN (SELECT doc_id FROM kb_documents WHERE owner_id = ?) GROUP BY tag ORDER BY count DESC",
      [this.owner]
    );
    return rows.map(row => ({ tag: row.tag, count: row.count }));
  }

  /** 获取所有文件格式及其数量 */
  async getAllFormats(): Promise<Array<{ format: string; count: number }>> {
    const rows = await this.adapter.query<{ name: string }>(
      "SELECT name FROM kb_documents WHERE owner_id = ?",
      [this.owner]
    );
    const formatCount = new Map<string, number>();
    
    for (const row of rows) {
      const format = this.getFileFormat(row.name);
      formatCount.set(format, (formatCount.get(format) || 0) + 1);
    }

    return Array.from(formatCount.entries())
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** 获取文档解析内容 */
  async getDocumentContent(docId: string): Promise<string | null> {
    const rows = await this.adapter.query<{ parsed_content: string }>(
      "SELECT parsed_content FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
      [docId, this.owner]
    );
    return rows[0]?.parsed_content || null;
  }

  /** 获取文档基本信息 */
  async getDocument(docId: string): Promise<{ doc_id: string; name: string; shared: number } | null> {
    const rows = await this.adapter.query<SharedDocRecord>(
      "SELECT doc_id, name, shared FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
      [docId, this.owner]
    );
    return rows[0] || null;
  }

  /** 设置文档共享状态 */
  async setShared(docId: string, shared: boolean): Promise<boolean> {
    const result = await this.adapter.execute(
      "UPDATE kb_documents SET shared = ? WHERE doc_id = ? AND owner_id = ?",
      [shared ? 1 : 0, docId, this.owner]
    );
    return result.affectedRows > 0;
  }

  /** 获取共享文档列表（用于跨租户检索） */
  async getSharedDocIds(): Promise<string[]> {
    const rows = await this.adapter.query<DocIdRecord>(
      "SELECT doc_id FROM kb_documents WHERE owner_id = ? AND shared = 1",
      [this.owner]
    );
    return rows.map((r) => r.doc_id);
  }

  /** 删除文档 */
  async deleteDocument(docId: string): Promise<boolean> {
    const exists = await this.adapter.query(
      "SELECT 1 FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
      [docId, this.owner]
    );
    if (exists.length === 0) return false;

    // 先删子表（外键依赖），再删父表
    await this.adapter.execute(
      "DELETE FROM kb_keywords WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = ?)",
      [docId]
    );
    await this.adapter.execute("DELETE FROM kb_chunks WHERE doc_id = ?", [docId]);
    await this.adapter.execute("DELETE FROM kb_tags WHERE doc_id = ?", [docId]);
    await this.adapter.execute("DELETE FROM kb_versions WHERE doc_id = ?", [docId]);
    await this.adapter.execute("DELETE FROM kb_documents WHERE doc_id = ?", [docId]);
    
    this.vectorCacheDirty = true;
    return true;
  }

  /** 统计信息 */
  async stats(): Promise<{ owner: string; documentCount: number; sharedCount: number; chunkCount: number; totalTokens: number; vectorCacheSize: number; keywordCount: number; embeddingProvider: string }> {
    const docCountRows = await this.adapter.query<CountRecord>(
      "SELECT COUNT(*) as c FROM kb_documents WHERE owner_id = ?",
      [this.owner]
    );
    const chunkCountRows = await this.adapter.query<CountRecord>(
      "SELECT COUNT(*) as c FROM kb_chunks c JOIN kb_documents d ON c.doc_id = d.doc_id WHERE d.owner_id = ?",
      [this.owner]
    );
    const totalTokensRows = await this.adapter.query<SumRecord>(
      "SELECT COALESCE(SUM(c.tokens), 0) as t FROM kb_chunks c JOIN kb_documents d ON c.doc_id = d.doc_id WHERE d.owner_id = ?",
      [this.owner]
    );
    const keywordCountRows = await this.adapter.query<CountRecord>(
      "SELECT COUNT(DISTINCT k.keyword) as c FROM kb_keywords k JOIN kb_chunks c ON k.chunk_id = c.id JOIN kb_documents d ON c.doc_id = d.doc_id WHERE d.owner_id = ?",
      [this.owner]
    );
    const sharedCountRows = await this.adapter.query<CountRecord>(
      "SELECT COUNT(*) as c FROM kb_documents WHERE owner_id = ? AND shared = 1",
      [this.owner]
    );

    return {
      owner: this.owner,
      documentCount: docCountRows[0]?.c ?? 0,
      sharedCount: sharedCountRows[0]?.c ?? 0,
      chunkCount: chunkCountRows[0]?.c ?? 0,
      totalTokens: Number(totalTokensRows[0]?.t ?? 0),
      vectorCacheSize: this.vectorCache.size,
      keywordCount: keywordCountRows[0]?.c ?? 0,
      embeddingProvider: this.embeddingProvider.name,
    };
  }

  /** 重建向量索引 */
  async rebuildIndex(): Promise<{ chunksProcessed: number }> {
    const rows = await this.adapter.query<{ id: number; content: string }>(
      "SELECT c.id, c.content FROM kb_chunks c JOIN kb_documents d ON c.doc_id = d.doc_id WHERE d.owner_id = ?",
      [this.owner]
    );
    
    const batchSize = 50;
    let processed = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const vectors = await this.embeddingProvider.embed(batch.map((r) => r.content));
      
      await this.adapter.transaction(async (connection) => {
        for (let j = 0; j < batch.length; j++) {
          const vectorBlob = Buffer.from(new Float32Array(vectors[j]).buffer);
          await connection.execute(
            "UPDATE kb_chunks SET vector = ? WHERE id = ?",
            [vectorBlob, batch[j].id]
          );
        }
      });
      
      processed += batch.length;
    }

    this.vectorCacheDirty = true;
    return { chunksProcessed: processed };
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    this.vectorCacheDirty = true;
  }

  /** 获取 embedding provider */
  getEmbeddingProvider(): EmbeddingProvider {
    return this.embeddingProvider;
  }

  /** 图谱检索：根据查询内容查询相关子图，并返回关联的知识库文档 */
  async graphSearch(
    query: string,
    opts?: {
      limit?: number;
      maxDepth?: number;
      maxNodes?: number;
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
    // 目前先返回空结果，等待与 sessionManager 集成
    // 在实际使用中，需要从 session 中获取 graphManager
    return [];
  }

  /** 路径查询：查找两个实体之间的路径 */
  async pathSearch(
    source: string,
    target: string,
    opts?: { maxDepth?: number }
  ): Promise<{
    found: boolean;
    path?: Array<{ node: any; edge?: any }>;
    explanation?: string;
  }> {
    return { found: false };
  }

  /** 混合检索（包含图谱增强） */
  async hybridSearchWithGraph(
    query: string,
    opts?: { limit?: number; threshold?: number }
  ): Promise<Array<{
    docId: string;
    docName: string;
    chunkIndex: number;
    content: string;
    score: number;
    matchType: 'keyword' | 'semantic' | 'graph_subgraph' | 'graph_path' | 'hybrid';
    graphContext?: any;
  }>> {
    const limit = opts?.limit ?? 10;
    const classified = classifyQuery(query);

    // 阶段 1: 基础检索（始终执行）
    const keywordResults = await this.keywordSearch(query, limit * 2);
    const semanticResults = await this.semanticSearch(query, limit * 2);

    // 阶段 2: 图谱检索（根据查询类型）
    let graphResults: any[] = [];
    // 目前先不执行图谱检索，等待与 sessionManager 集成
    // if (classified.type === 'relational' || classified.type === 'discovery' || classified.type === 'hybrid') {
    //   graphResults = await this.graphSearch(query, { limit: limit * 2 });
    // }

    // 阶段 3: RRF 融合 + 图谱增强评分
    const allResults = this.mergeAndRescoreResults(
      keywordResults,
      semanticResults,
      graphResults,
      classified.type
    );

    return allResults.slice(0, limit);
  }

  /** 结果融合与重评分（RRF + 图谱增强） */
  private mergeAndRescoreResults(
    keywordResults: any[],
    semanticResults: any[],
    graphResults: any[],
    queryType: QueryType
  ): any[] {
    const scoreMap = new Map<string, { score: number; sources: Set<string>; item: any }>();

    // 1. RRF 融合
    const k = 60;

    keywordResults.forEach((r, i) => {
      const key = `${r.docId}_${r.chunkIndex}`;
      const rrfScore = 0.4 / (k + i + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add('keyword');
      } else {
        scoreMap.set(key, { score: rrfScore, sources: new Set(['keyword']), item: r });
      }
    });

    semanticResults.forEach((r, i) => {
      const key = `${r.docId}_${r.chunkIndex}`;
      const rrfScore = 0.6 / (k + i + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add('semantic');
      } else {
        scoreMap.set(key, { score: rrfScore, sources: new Set(['semantic']), item: r });
      }
    });

    // 2. 图谱增强（仅当有图谱结果时）
    if (graphResults.length > 0) {
      const graphBoost = queryType === 'relational' ? 1.5 : queryType === 'discovery' ? 1.3 : 1.1;

      graphResults.forEach((r, i) => {
        const key = `${r.docId}_${r.chunkIndex}`;
        const graphScore = (graphBoost * 0.5) / (k + i + 1);
        const existing = scoreMap.get(key);
        if (existing) {
          existing.score += graphScore;
          existing.sources.add('graph');
          existing.item.graphContext = r.graphContext;
        } else {
          scoreMap.set(key, { score: graphScore, sources: new Set(['graph']), item: r });
        }
      });
    }

    // 3. 排序并返回
    return [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .map(({ item, score, sources }) => ({
        ...item,
        score,
        matchType: [...sources].join('+') as any,
      }));
  }

  // ===== Document Mind 相关方法 =====

   /** 更新文档解析状态 */
   async updateParsingStatus(
     docId: string,
     status: {
       parsingStatus?: string;
       parsingProgress?: number;
       docMindTaskId?: string;
       mediaType?: string;
       durationMs?: number;
       chunkCount?: number;
       totalTokens?: number;
       parsedContent?: string;
     }
   ): Promise<void> {
     const fields: string[] = [];
     const values: unknown[] = [];

     if (status.parsingStatus !== undefined) {
       fields.push('parsing_status = ?');
       values.push(status.parsingStatus);
     }
     if (status.parsingProgress !== undefined) {
       fields.push('parsing_progress = ?');
       values.push(status.parsingProgress);
     }
     if (status.docMindTaskId !== undefined) {
       fields.push('doc_mind_task_id = ?');
       values.push(status.docMindTaskId);
     }
     if (status.mediaType !== undefined) {
       fields.push('media_type = ?');
       values.push(status.mediaType);
     }
     if (status.chunkCount !== undefined) {
       fields.push('chunk_count = ?');
       values.push(status.chunkCount);
     }
     if (status.totalTokens !== undefined) {
       fields.push('total_tokens = ?');
       values.push(status.totalTokens);
     }
     if (status.durationMs !== undefined) {
       fields.push('duration_ms = ?');
       values.push(status.durationMs);
     }
     if (status.parsedContent !== undefined) {
       fields.push('parsed_content = ?');
       values.push(status.parsedContent);
     }

     if (fields.length > 0) {
       values.push(docId);
       values.push(this.owner);
       await this.adapter.execute(
         `UPDATE kb_documents SET ${fields.join(', ')} WHERE doc_id = ? AND owner_id = ?`,
         values
       );
     }
  }

  /** 更新文档标签 */
  async updateTags(docId: string, tags: string[]): Promise<void> {
    await this.adapter.execute(
      `UPDATE kb_documents SET tags = ? WHERE doc_id = ? AND owner_id = ?`,
      [JSON.stringify(tags), docId, this.owner]
    );
  }

  /** 获取文档解析状态 */
  async getParsingStatus(docId: string): Promise<{
    parsingStatus: string;
    parsingProgress: number;
    docMindTaskId: string | null;
    mediaType: string;
    durationMs: number | null;
  } | null> {
    const rows = await this.adapter.query<{
      parsing_status: string;
      parsing_progress: number;
      doc_mind_task_id: string;
      media_type: string;
      duration_ms: number;
    }>(
      "SELECT parsing_status, parsing_progress, doc_mind_task_id, media_type, duration_ms FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
      [docId, this.owner]
    );
    
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      parsingStatus: row.parsing_status || 'success',
      parsingProgress: row.parsing_progress || 100,
      docMindTaskId: row.doc_mind_task_id || null,
      mediaType: row.media_type || 'document',
      durationMs: row.duration_ms || null,
    };
  }

  /** 保存版面数据（增量） */
  async saveLayouts(docId: string, layouts: unknown[], append: boolean = false): Promise<void> {
    // 验证 layouts 参数是否有效
    if (!Array.isArray(layouts)) {
      console.warn(`[KnowledgeBase] Invalid layouts parameter (not array) for doc ${docId}:`, typeof layouts);
      return;
    }

    // 清理 layouts 中可能导致 JSON.stringify 失败的字段或 "[object Object]" 的内容
    const safeLayouts = layouts.map(layout => {
      // 确保没有循环引用或不可序列化的对象
      try {
        return JSON.parse(JSON.stringify(layout));
      } catch (error) {
        console.warn(`[KnowledgeBase] Failed to sanitize layout for doc ${docId}:`, error);
        return {};
      }
    });

    if (append) {
      const rows = await this.adapter.query<LayoutRecord>(
        "SELECT layouts_json FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
        [docId, this.owner]
      );
      let existingLayouts: unknown[] = [];
      if (rows.length > 0 && rows[0].layouts_json) {
        try {
          existingLayouts = JSON.parse(rows[0].layouts_json);
          if (!Array.isArray(existingLayouts)) {
            existingLayouts = [];
          }
        } catch (err) {
          console.warn(`[KnowledgeBase] Failed to parse existing layouts_json for doc ${docId}, starting fresh:`, err);
          existingLayouts = [];
        }
      }

      const allLayouts = [...existingLayouts, ...safeLayouts];

      // 验证最终要保存的内容
      let safeJSON: string;
      try {
        safeJSON = JSON.stringify(allLayouts);
      } catch (err) {
        console.warn(`[KnowledgeBase] Failed to stringify layouts for doc ${docId}, using empty array:`, err);
        safeJSON = "[]";
      }

      await this.adapter.execute(
        "UPDATE kb_documents SET layouts_json = ? WHERE doc_id = ? AND owner_id = ?",
        [safeJSON, docId, this.owner]
      );
    } else {
      // 验证最终要保存的内容
      let safeJSON: string;
      try {
        safeJSON = JSON.stringify(safeLayouts);
      } catch (err) {
        console.warn(`[KnowledgeBase] Failed to stringify layouts for doc ${docId}, using empty array:`, err);
        safeJSON = "[]";
      }

      await this.adapter.execute(
        "UPDATE kb_documents SET layouts_json = ? WHERE doc_id = ? AND owner_id = ?",
        [safeJSON, docId, this.owner]
      );
    }
  }

  /** 获取版面数据 */
  async getLayouts(docId: string): Promise<unknown[]> {
    const rows = await this.adapter.query<LayoutRecord>(
      "SELECT layouts_json FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
      [docId, this.owner]
    );
    if (rows.length > 0 && rows[0].layouts_json) {
      try {
        return JSON.parse(rows[0].layouts_json);
      } catch (err) {
        console.warn(`[KnowledgeBase] Failed to parse layouts_json for doc ${docId}, returning empty:`, err);
        return [];
      }
    }
    return [];
  }

  /** 保存音视频切片数据（增量） */
  async saveSegments(docId: string, segments: unknown[], append: boolean = false): Promise<void> {
    if (append) {
      const rows = await this.adapter.query<SegmentRecord>(
        "SELECT segments_json FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
        [docId, this.owner]
      );
      const existingSegments = rows.length > 0 ? JSON.parse(rows[0].segments_json || '[]') : [];
      const allSegments = [...existingSegments, ...segments];
      await this.adapter.execute(
        "UPDATE kb_documents SET segments_json = ? WHERE doc_id = ? AND owner_id = ?",
        [JSON.stringify(allSegments), docId, this.owner]
      );
    } else {
      await this.adapter.execute(
        "UPDATE kb_documents SET segments_json = ? WHERE doc_id = ? AND owner_id = ?",
        [JSON.stringify(segments), docId, this.owner]
      );
    }
  }

  /** 获取音视频切片数据 */
  async getSegments(docId: string): Promise<unknown[]> {
    const rows = await this.adapter.query<SegmentRecord>(
      "SELECT segments_json FROM kb_documents WHERE doc_id = ? AND owner_id = ?",
      [docId, this.owner]
    );
    if (rows.length > 0 && rows[0].segments_json) {
      try {
        return JSON.parse(rows[0].segments_json);
      } catch (err) {
        console.warn(`[KnowledgeBase] Failed to parse segments_json for doc ${docId}, returning empty:`, err);
        return [];
      }
    }
    return [];
  }

  /** 
   * 直接插入 chunk（用于增量索引）
   * 返回插入的 chunk ID
   */
  async insertChunkDirect(
    docId: string,
    chunkIndex: number,
    content: string,
    tokens: number,
    vector: number[] | null,
    pageNumber: number | null,
    bboxData: string
  ): Promise<number> {
    const vectorBlob = vector ? Buffer.from(new Float32Array(vector).buffer) : null;
    
    const result = await this.adapter.execute(
      `INSERT INTO kb_chunks 
       (doc_id, chunk_index, content, tokens, vector, page_number, bbox_data) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [docId, chunkIndex, content, tokens, vectorBlob, pageNumber, bboxData]
    );

    return result.insertId as number;
  }

  /** 
   * 增加文档 chunk 计数和 token 计数
   */
  async incrementChunkCount(docId: string, count: number, tokens: number = 0): Promise<void> {
    await this.adapter.execute(
      "UPDATE kb_documents SET chunk_count = chunk_count + ?, total_tokens = total_tokens + ? WHERE doc_id = ? AND owner_id = ?",
      [count, tokens, docId, this.owner]
    );
  }

  /**
   * 插入关键词（用于增量索引）
   */
  async insertKeyword(keyword: string, chunkId: number, tf: number): Promise<void> {
    // 限制关键词长度不超过 100 字符，防止字段长度溢出
    const limitedKeyword = keyword.slice(0, 100);
    await this.adapter.execute(
      "INSERT INTO kb_keywords (keyword, chunk_id, tf) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tf = VALUES(tf)",
      [limitedKeyword, chunkId, tf]
    );
  }

  /** 保存音视频分块（带 segment 信息） */
  async insertMediaChunk(
    docId: string,
    chunkIndex: number,
    content: string,
    vector: number[] | null,
    metadata: {
      segmentIndex: number;
      timeRange: { start: number; end: number };
      frameUrl?: string;
      asrText?: string;
      contentType?: string;
    }
  ): Promise<number> {
    const vectorBlob = vector ? Buffer.from(new Float32Array(vector).buffer) : null;
    const timeRangeStr = JSON.stringify(metadata.timeRange);
    
    const result = await this.adapter.execute(
      `INSERT INTO kb_chunks 
       (doc_id, chunk_index, content, tokens, vector, segment_index, time_range, frame_url, asr_text, content_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId,
        chunkIndex,
        content,
        this.estimateTokens(content),
        vectorBlob,
        metadata.segmentIndex,
        timeRangeStr,
        metadata.frameUrl || null,
        metadata.asrText || null,
        metadata.contentType || 'video_segment'
      ]
    );
    
    return result.insertId as number;
  }

  // ===== 工具方法 =====

  /** 页码感知分块：遍历每个 page 的 blocks，记录 page + bbox */
  private splitWithPageTracking(
    pages: PageResult[],
    maxTokens: number,
    _overlap: number,
  ): Array<{ content: string; tokens: number; pageNumber: number | null; bboxes: Array<{ page: number; bbox: [number, number, number, number] }> }> {
    const result: Array<{ content: string; tokens: number; pageNumber: number | null; bboxes: Array<{ page: number; bbox: [number, number, number, number] }> }> = [];

    let currentText = "";
    let currentTokens = 0;
    let currentPage: number | null = null;
    let currentBboxes: Array<{ page: number; bbox: [number, number, number, number] }> = [];

    for (const page of pages) {
      const blocks = page.blocks || [];
      for (const block of blocks) {
        const blockTokens = this.estimateTokens(block.text);

        if (currentTokens + blockTokens > maxTokens && currentText.trim()) {
          // 生成当前 chunk
          result.push({
            content: currentText.trim(),
            tokens: currentTokens,
            pageNumber: currentPage,
            bboxes: [...currentBboxes],
          });
          currentText = "";
          currentTokens = 0;
          currentPage = null;
          currentBboxes = [];
        }

        currentText += (currentText ? "\n\n" : "") + block.text;
        currentTokens += blockTokens;
        if (currentPage === null) currentPage = page.page;
        currentBboxes.push({
          page: page.page,
          bbox: block.bbox as [number, number, number, number],
        });
      }
    }

    // 最后一个 chunk
    if (currentText.trim()) {
      result.push({
        content: currentText.trim(),
        tokens: currentTokens,
        pageNumber: currentPage,
        bboxes: [...currentBboxes],
      });
    }

    if (result.length === 0) {
      // 回退：所有 pages 拼接为一个 chunk
      const allContent = pages.map((p) => p.content).join("\n\n");
      result.push({
        content: allContent || "",
        tokens: this.estimateTokens(allContent),
        pageNumber: pages[0]?.page ?? null,
        bboxes: [],
      });
    }

    return result;
  }

  private splitIntoChunks(text: string, maxTokens: number, overlap: number): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    let currentChunk = "";
    let currentTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = this.estimateTokens(para);

      if (paraTokens > maxTokens) {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        const sentences = para.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) ?? [para];
        currentChunk = "";
        currentTokens = 0;

        for (const sentence of sentences) {
          const sentTokens = this.estimateTokens(sentence);
          if (currentTokens + sentTokens > maxTokens && currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            const words = currentChunk.trim().split(/\s+/);
            const overlapText = words.slice(-Math.min(overlap, words.length)).join(" ");
            currentChunk = overlapText + " " + sentence;
            currentTokens = this.estimateTokens(currentChunk);
          } else {
            currentChunk += sentence;
            currentTokens += sentTokens;
          }
        }
      } else if (currentTokens + paraTokens > maxTokens) {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        const words = currentChunk.trim().split(/\s+/);
        const overlapText = words.slice(-Math.min(overlap, words.length)).join(" ");
        currentChunk = overlapText + "\n\n" + para;
        currentTokens = this.estimateTokens(currentChunk);
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + para;
        currentTokens += paraTokens;
      }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    if (chunks.length === 0 && text.trim()) chunks.push(text.trim());

    return chunks;
  }

  private estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const otherWords = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).length;
    return chineseChars + Math.ceil(otherWords * 1.3);
  }

  private extractKeywords(text: string): Map<string, number> {
    const keywords = new Map<string, number>();
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const total = tokens.length || 1;
    for (const token of tokens) {
      keywords.set(token, (keywords.get(token) ?? 0) + 1);
    }
    for (const [k, v] of keywords) {
      keywords.set(k, v / total);
    }
    return keywords;
  }
}

// ===== 多租户知识库管理 =====

const KB_BASE = join(process.cwd(), ".raos", "knowledge");

/** LRU 缓存配置：最大 KB 实例数 */
const MAX_KB_INSTANCES = 10;

/** 
 * KB 实例缓存，记录最后访问时间
 * 使用 LRU 策略淘汰最久未使用的实例以控制内存占用
 */
interface CachedKB {
  kb: KnowledgeBase;
  lastAccessed: number;
}
const kbInstances = new Map<string, CachedKB>();

export function getKnowledgeBase(owner: string): KnowledgeBase {
  // 更新访问时间
  if (kbInstances.has(owner)) {
    const cached = kbInstances.get(owner)!;
    cached.lastAccessed = Date.now();
    return cached.kb;
  }

  // 如果超过最大实例数，淘汰最久未使用的
  if (kbInstances.size >= MAX_KB_INSTANCES) {
    let oldestOwner: string | null = null;
    let oldestTime = Infinity;
    for (const [key, value] of kbInstances.entries()) {
      if (value.lastAccessed < oldestTime) {
        oldestTime = value.lastAccessed;
        oldestOwner = key;
      }
    }
    if (oldestOwner) {
      console.log(`[KnowledgeBase] LRU淘汰最久未使用实例: ${oldestOwner} (LRU cache size: ${kbInstances.size})`);
      kbInstances.delete(oldestOwner);
    }
  }

  // 创建新实例
  const kb = new KnowledgeBase(owner, globalEmbeddingProvider ?? undefined);
  kbInstances.set(owner, { kb, lastAccessed: Date.now() });
  return kb;
}

/** 获取所有租户列表 */
export async function getAllTenants(): Promise<string[]> {
  try {
    const adapter = getMySQLAdapter();
    const rows = await adapter.query<{ owner_id: string }>(
      "SELECT DISTINCT owner_id FROM kb_documents"
    );
    return rows.map((r) => r.owner_id);
  } catch {
    return [];
  }
}

/** 获取知识库文档的页面图片存储目录 */
function getKBImageDir(owner: string, docId: string): string {
  return join(KB_BASE, owner, "page-images", docId);
}

/** 保存知识库文档的页面图片到磁盘 */
function saveKBPageImages(owner: string, docId: string, pages: Array<{ page: number; imageBase64: string }>): void {
  if (pages.length === 0) return;
  const dir = getKBImageDir(owner, docId);
  mkdirSync(dir, { recursive: true });
  for (const p of pages) {
    const buf = Buffer.from(p.imageBase64, "base64");
    writeFileSync(join(dir, `page-${p.page}.png`), buf);
  }
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages.map((p) => p.page)));
}

/** 读取知识库文档的页面图片列表 */
export function getKBPageImageList(owner: string, docId: string): number[] {
  const indexFile = join(getKBImageDir(owner, docId), "pages.json");
  if (!existsSync(indexFile)) return [];
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8"));
  } catch { return []; }
}

/** 获取知识库文档页面图片的绝对路径 */
export function getKBPageImagePath(owner: string, docId: string, page: number): string | null {
  const imgPath = join(getKBImageDir(owner, docId), `page-${page}.png`);
  return existsSync(imgPath) ? imgPath : null;
}

/** 跨租户检索共享文档 */
async function searchShared(
  query: string,
  excludeOwner: string,
  limit: number,
): Promise<Array<{ docId: string; docName: string; chunkIndex: number; content: string; score: number; matchType: string; shared: boolean; owner: string; source: "shared" }>> {
  const tenants = (await getAllTenants()).filter((t) => t !== excludeOwner);
  const allResults: any[] = [];

  for (const tenant of tenants) {
    const kb = getKnowledgeBase(tenant);
    const sharedDocIds = await kb.getSharedDocIds();
    if (sharedDocIds.length === 0) continue;

    const results = await kb.search(query, { limit, docIds: sharedDocIds });
    allResults.push(...results.map((r) => ({ ...r, owner: tenant })));
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, limit);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

// ===== 注册 Skills =====

export function createKnowledgeSkills(registry: SkillRegistry, sessionManager?: UserSessionManager): void {
  const WORKSPACE_BASE = resolve(process.cwd(), ".raos", "workspace");
  mkdirSync(KB_BASE, { recursive: true });

  registry.register(
    defineSystemSkill({
      name: "kb_ingest",
      description:
        "将文件或文本导入知识库（同名文档自动更新）。参数: content?(string), path?(string, workspace路径), name?(string, 文档名), tags?(string[]), shared?(boolean, 是否共享), owner?(string, 所属用户, 默认 default), chunkSize?(number, 默认500), chunkOverlap?(number, 默认50)",
      timeout: 600000,
      paramSchema: {
        properties: {
          content: { type: "string", description: "Text content to ingest directly" },
          path: { type: "string", description: "File path in workspace to ingest" },
          name: { type: "string", description: "Document name (defaults to filename if path is given)" },
          tags: { type: "array", description: "Tags for categorization", items: { type: "string" } },
          shared: { type: "boolean", description: "Whether to share this document with other users" },
          owner: { type: "string", description: "Knowledge base owner (default: current user)" },
          chunkSize: { type: "number", description: "Maximum tokens per chunk (default: 500)" },
          chunkOverlap: { type: "number", description: "Token overlap between chunks (default: 50)" },
          _placeholderDocId: { type: "string", description: "Internal: placeholder document ID for async parsing" },
          _skipQueue: { type: "boolean", description: "Internal: skip Document Mind queue and use local parsing" },
        },
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        let content = params.content as string | undefined;
        let docName = params.name as string | undefined;
        const path = params.path as string | undefined;

        if (!content && !path) {
          return { success: false, error: new Error("需要提供 content 或 path 参数") };
        }

        let docId: string | undefined; // 声明 docId 变量

        if (path && !content) {
          const fullPath = resolve(WORKSPACE_BASE, path);
          // 跨平台安全路径检查：normalize并确保分隔符一致
          const normalizedFullPath = normalize(fullPath).replace(/\\/g, '/');
          const normalizedBase = normalize(WORKSPACE_BASE).replace(/\\/g, '/');
          if (!normalizedFullPath.startsWith(normalizedBase + '/') && normalizedFullPath !== normalizedBase) {
            return { success: false, error: new Error("路径安全违规") };
          }
          if (!existsSync(fullPath)) {
            return { success: false, error: new Error(`文件不存在: ${path}`) };
          }

          // 计算原始文件 hash（用于精确去重）
          const rawFileHash = createHash("md5").update(readFileSync(fullPath)).digest("hex");
          (params as IngestParamsExtension)._fileHash = rawFileHash;

           // 优先尝试使用 Document Mind ParsingQueue（如果已配置）
            const ext = fullPath.substring(fullPath.lastIndexOf(".")).toLowerCase();
            console.log(`[kb_ingest] 开始解析文件: ${path}, 文件类型: ${ext}`);
            const { getParsingQueue } = await import("../services/parsing-queue.js");
            const queue = getParsingQueue();
            const binaryExts = [".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt", ".pdf"];
            const skipQueue = (params as any)._skipQueue;

            // 音视频文档必须启用 Document Mind 解析，不允许直接本地解析
            const mediaExts = [".mp3", ".wav", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4a", ".aac", ".ogg"];
            if (mediaExts.includes(ext) && !skipQueue) {
              console.warn(`[kb_ingest] 音视频文档必须启用 Document Mind: ${path}`);
              return {
                success: false,
                error: new Error('音视频文档解析需要启用 Document Mind'),
                queued: false,
              };
            }

            // 如果 _skipQueue = true（降级解析），强制跳过队列直接本地解析
            // 同时检查 Document Mind 是否已启用配置
            if (!skipQueue && queue && binaryExts.includes(ext) && configManager.isDocMindConfigured()) {
             // 使用 Document Mind 异步解析队列
             console.log(`[kb_ingest] 文件 ${path} 符合二进制文件类型，使用 Document Mind 解析队列`);
             const docNameForQueue = docName || path.split("/").pop() || `doc_${Date.now()}`;
             const tags = (params.tags as string[]) ?? [];

             // 使用占位符 docId（如果传入），避免重复创建文档
             // 如果已经有占位符（异步上传路径），不返回queued，继续本地解析 fallback
             const placeholderDocId = (params as IngestParamsExtension)._placeholderDocId;
             console.log(`[kb_ingest] placeholderDocId: ${placeholderDocId}, params: ${JSON.stringify({ name: params.name, path: params.path, owner: params.owner })}`);
             const taskDocId = placeholderDocId || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
             console.log(`[kb_ingest] taskDocId: ${taskDocId}`);

             try {
               const task = await queue.addTask(
                 taskDocId,
                 docNameForQueue,
                 fullPath,
                 owner,
                 { tags }
               );
               docId = task.docId;

               if (!placeholderDocId) {
                 // 非占位模式（同步上传）才返回queued
                 return {
                   success: true,
                   data: {
                     docId,
                     queued: true,
                     message: "文档已加入 Document Mind 解析队列",
                   },
                 };
               }
               // 如果已有占位符（后台异步上传）
               // 队列已经开始处理，任务会在后台完成，不需要继续本地解析
               // 队列会处理，如果 Document Mind 失败自动降级本地解析
               console.log(`[kb_ingest] Document Mind 解析队列已启动，处理占位文档: ${docId}`);

               // 直接返回，让前端轮询
               return {
                 success: true,
                 data: {
                   docId,
                   queued: true,
                   message: "文档已加入 Document Mind 解析队列",
                 },
               };
             } catch (queueError: any) {
               console.warn(`[kb_ingest] Document Mind 队列处理失败，降级到本地解析: ${queueError.message}`);
               // Fall through to local parsing
             }
           }

          // 本地解析（Fallback）
          // 音视频文档必须启用 Document Mind，不允许本地解析
          const localMediaExts = ['mp3', 'wav', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4a', 'aac', 'ogg'];
          const fileExt = (String(params.name || params.path || '')).split('.').pop()?.toLowerCase() || '';
          if (localMediaExts.includes(fileExt)) {
            console.error(`[kb_ingest] 音视频文档必须启用 Document Mind: ${fileExt}`);
            return {
              success: false,
              error: new Error('音视频文档必须启用 Document Mind 进行解析'),
              queued: false,
            };
          }

          console.log(`[kb_ingest] 开始本地解析文件: ${path}`);

          // 获取已有标签列表，避免 AI 重复生成
          const existingTags = (await kb.getAllTags()).map(t => t.tag);
          console.log(`[kb_ingest] 已存在的标签列表: ${JSON.stringify(existingTags)}`);

          // 使用 parseDocument 统一解析（支持视觉 OCR + 自动标签提取，传入已有标签）
          const parseResult = await parseDocument(fullPath, globalVisionConfig, existingTags);
          if (parseResult.success) {
            console.log(`[kb_ingest] 本地解析成功，内容长度: ${parseResult.content.length}, 页数: ${parseResult.pages?.length}`);
            content = parseResult.content;

            // 保存页面图片（用于双视图查看）
            const pageImages = parseResult.pages?.filter((p) => p.imageBase64).map((p) => ({ page: p.page, imageBase64: p.imageBase64! })) || [];
            if (pageImages.length > 0) {
              console.log(`[kb_ingest] 保存页面图片: ${pageImages.length} 页`);
              // docId 还没生成，先暂存，后面 ingest 成功后再保存
              (params as IngestParamsExtension)._pageImages = pageImages;
            }

            // 暂存 pages（含 blocks + bbox）用于页码感知分块
            if (parseResult.pages && parseResult.pages.length > 0) {
              console.log(`[kb_ingest] 暂存页面数据（页码感知分块）: ${parseResult.pages.length} 页`);
              (params as IngestParamsExtension)._parsePages = parseResult.pages;
            }

            // 合并自动提取的标签和用户标签（去重）
            if (parseResult.tags && parseResult.tags.length > 0) {
              console.log(`[kb_ingest] 自动提取标签: ${JSON.stringify(parseResult.tags)}`);
              const userTags = (params.tags as string[]) ?? [];
              const allTags = [...new Set([...userTags, ...parseResult.tags])];
              params.tags = allTags;
              console.log(`[kb_ingest] 合并后标签: ${JSON.stringify(params.tags)}`);
            }
          } else {
            console.error(`[kb_ingest] 本地解析失败: ${parseResult.error}`);
            // 二进制格式（xlsx/docx/pptx/pdf）解析失败时不回退到纯文本读取（会产生乱码）
            if (binaryExts.includes(ext)) {
              return { success: false, error: new Error(`文件解析失败: ${parseResult.error}`) };
            }
            // 纯文本格式回退
            try {
              console.log(`[kb_ingest] 回退到纯文本读取`);
              content = readFileSync(fullPath, "utf-8");
            } catch {
              return { success: false, error: new Error(`文件解析失败: ${parseResult.error}`) };
            }
          }

          if (!docName) docName = path.split("/").pop() ?? path;
        }

        // 确保内容不为空
        if (!content || content.trim().length === 0) {
          return { success: false, error: new Error("文件内容为空") };
        }
        if (!docName) docName = `doc_${Date.now()}`;

        try {
          console.log(`[kb_ingest] 开始调用知识库 ingest，文档名: ${docName}, 内容长度: ${content.length}`);
          // 传递 pages（含 blocks + bbox）给 ingest 用于页码感知分块
          const parsePages = (params as IngestParamsExtension)._parsePages;
          const fileHash = (params as IngestParamsExtension)._fileHash;
          const _placeholderDocId = (params as IngestParamsExtension)._placeholderDocId;
          console.log(`[kb_ingest] 调用知识库 ingest，标签: ${JSON.stringify(params.tags)}, 页码感知分块页数: ${parsePages?.length}, 占位符 docId: ${_placeholderDocId}`);
          const result = await kb.ingest(docName, content, {
            source: path ?? "direct_input",
            tags: (params.tags as string[]) ?? [],
            chunkSize: (params.chunkSize as number) ?? 500,
            chunkOverlap: (params.chunkOverlap as number) ?? 50,
            shared: params.shared as boolean | undefined,
            pages: parsePages,
            fileHash,
            _placeholderDocId,
          });
          console.log(`[kb_ingest] 知识库 ingest 完成，docId: ${result.docId}, chunkCount: ${result.chunkCount}, totalTokens: ${result.totalTokens}, 是否更新: ${result.updated}`);

          const action = result.updated ? "更新" : "导入";

          // 只有在 path 存在时才处理页面图片（直接 content 参数时没有这个）
          if (path) {
            // 保存页面图片
            const pageImages = (params as IngestParamsExtension)._pageImages;
            if (pageImages && pageImages.length > 0 && result.docId) {
              try { saveKBPageImages(owner, result.docId, pageImages); } catch { /* ignore */ }
            }
          }

          // 将文档同步到知识图谱（非致命）
          if (sessionManager && result.docId) {
            console.log(`[kb_ingest] 开始同步文档到知识图谱，docId: ${result.docId}`);
            try {
              const session = sessionManager.getOrCreate(owner);
              const sessionWithGraph = session as unknown as SessionWithGraphManager;
              const graphManager = sessionWithGraph.graphManager;
              const llmProvider = sessionWithGraph.llmProvider;
              console.log(`[kb_ingest] 知识图谱管理器: ${!!graphManager}, LLM Provider: ${!!llmProvider}`);
              if (graphManager) {
                // 1. 同步文档节点
                console.log(`[kb_ingest] 同步文档节点到知识图谱: ${docName}`);
                await graphManager.onFactStored({
                  id: `kb_doc_${result.docId}`,
                  key: `kb:${docName}`,
                  value: `Knowledge base document: ${docName}`,
                  tags: ['kb_document', (docName!.split('.').pop() || 'doc'), ...(Array.isArray(params.tags) ? params.tags : [])].filter(Boolean),
                });

                // 只有在 path 存在时才处理版面数据和音视频切片
                if (path) {
                  // 2. 同步版面数据（Document Mind）
                  const layouts = await kb.getLayouts(result.docId) as Layout[];
                  console.log(`[kb_ingest] 获取文档版面数据: ${layouts.length} 个`);
                  if (layouts.length > 0) {
                    console.log(`[kb_ingest] 同步版面数据到知识图谱（最多20个版面）`);
                    for (const layout of layouts.slice(0, 20)) {  // 最多同步 20 个版面
                      await graphManager.onFactStored({
                        id: `kb_layout_${layout.id || layout.uniqueId}`,
                        key: `kb:${docName}:p${layout.page || layout.pageNum}:${layout.type}`,
                        value: (layout.content || layout.text || '').slice(0, 200),
                        tags: ['kb_layout', layout.type, layout.subType, ...(Array.isArray(params.tags) ? params.tags : [])].filter(Boolean),
                        relation: `kb:${docName}`,
                      });
                    }
                  }

                  // 3. 同步音视频切片数据
                  const segments = await kb.getSegments(result.docId) as Segment[];
                  console.log(`[kb_ingest] 获取音视频切片数据: ${segments.length} 个`);
                  if (segments.length > 0) {
                    console.log(`[kb_ingest] 同步音视频切片到知识图谱（最多10个切片）`);
                    for (const segment of segments.slice(0, 10)) {  // 最多同步 10 个切片
                      await graphManager.onFactStored({
                        id: `kb_seg_${result.docId}_${segment.index}`,
                        key: `kb:${docName}:t${segment.startTime}-${segment.endTime}`,
                        value: (segment.synopsis || segment.searchableText || '').slice(0, 200),
                        tags: ['kb_segment', params.media_type || 'video', ...(Array.isArray(params.tags) ? params.tags : [])].filter(Boolean),
                        relation: `kb:${docName}`,
                      });
                    }
                  }
                }

                // 4. 本地解析文档内容处理（针对 txt/json/md 等）
                // 如果没有版面数据和切片数据，添加文档内容节点
                const contentForExtraction = await kb.getDocumentContent(result.docId) || content || '';
                const layouts = path ? await kb.getLayouts(result.docId) as Layout[] : [];
                const segments = path ? await kb.getSegments(result.docId) as Segment[] : [];
                if (layouts.length === 0 && segments.length === 0 && contentForExtraction.length > 50) {
                  console.log(`[kb_ingest] 本地解析文档，添加内容节点到知识图谱，内容长度: ${contentForExtraction.length}`);

                  // 优化：智能内容分割与语义标记
                  // 支持标题、段落、代码块、列表等不同内容类型的识别
                  const contentBlocks = parseContentBlocks(contentForExtraction);

                  for (let i = 0; i < contentBlocks.slice(0, 20).length; i++) {  // 增加到 20 个内容块
                    const block = contentBlocks[i];
                    const blockContent = block.content.slice(0, 400);  // 增加长度限制到 400 字符
                    await graphManager.onFactStored({
                      id: `kb_content_${result.docId}_${i}`,
                      key: `kb:${docName}:${block.type}:${i}`,
                      value: blockContent,
                      tags: ['kb_content', block.type, ...(Array.isArray(params.tags) ? params.tags : [])].filter(Boolean),
                      relation: `kb:${docName}`,
                    });
                  }
                }

                // 5. LLM 关系抽取集成 - 从文档内容抽取实体关系并添加到知识图谱（优化版）
                if (llmProvider && contentForExtraction && contentForExtraction.length > 100) {
                  console.log(`[kb_ingest] 开始 LLM 关系抽取，内容长度: ${contentForExtraction.length}`);
                  const { extractRelationships } = await import("../memory/knowledge-graph/relationship-extractor.js");
                  const { KnowledgeGraphManager } = await import("../memory/knowledge-graph/manager.js");

                  // 优化：分批处理长文档，避免单次处理过长
                  const chunkSize = 3000; // 每批次处理 3000 字符
                  const overlap = 500; // 重叠 500 字符保证上下文连贯性
                  const totalChunks = Math.ceil(contentForExtraction.length / (chunkSize - overlap));
                  console.log(`[kb_ingest] 文档分段处理: ${totalChunks} 段`);

                  const store = graphManager.getStore();
                  let totalRelations = 0;
                  let createdCount = 0;

                  // 节点跟踪 - 使用归一化标签避免重复创建
                  const nodeCache = new Map<string, any>();

                  // 先尝试查找或创建文档节点作为锚点
                  const docAnchorId = `kb_doc_${result.docId}`;
                  let docAnchorNode = await store.findNodeByLabel(docName);
                  if (!docAnchorNode) {
                    docAnchorNode = await store.addNode({
                      id: docAnchorId,
                      label: docName,
                      type: "kb_document",
                      tags: ['kb_document', (docName!.split('.').pop() || 'doc'), ...(Array.isArray(params.tags) ? params.tags : [])].filter(Boolean),
                      properties: { sourceDoc: docName, docId: result.docId },
                      createdAt: Date.now(),
                    });
                    nodeCache.set(docName, docAnchorNode);
                  } else {
                    nodeCache.set(docName, docAnchorNode);
                  }

                  // 分批处理文档内容
                  for (let i = 0; i < totalChunks; i++) {
                    const startPos = i * (chunkSize - overlap);
                    const endPos = Math.min(startPos + chunkSize, contentForExtraction.length);
                    const chunkText = contentForExtraction.slice(startPos, endPos);

                    console.log(`[kb_ingest] 处理第 ${i + 1}/${totalChunks} 段 (${startPos}-${endPos})`);

                    // 抽取关系
                    const relations = await extractRelationships(chunkText, llmProvider as LLMProvider);
                    console.log(`[kb_ingest] 第 ${i + 1} 段抽取到 ${relations.length} 个关系`);
                    totalRelations += relations.length;

                    for (const rel of relations.slice(0, 20)) {  // 每段最多 20 个关系
                      // 归一化实体标签
                      const normalizedSource = normalizeEntityLabel(rel.sourceLabel);
                      const normalizedTarget = normalizeEntityLabel(rel.targetLabel);

                      // 获取或创建源节点
                      let sourceNode = nodeCache.get(normalizedSource);
                      if (!sourceNode) {
                        sourceNode = await store.findNodeByLabel(normalizedSource);
                        if (!sourceNode) {
                          sourceNode = await store.addNode({
                            id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            label: normalizedSource,
                            type: inferEntityType(normalizedSource, rel.relation),
                            tags: Array.isArray(params.tags) ? params.tags : [],
                            properties: { sourceDoc: docName, chunkIndex: i },
                            createdAt: Date.now(),
                          });
                          createdCount++;
                        }
                        nodeCache.set(normalizedSource, sourceNode);
                      }

                      // 获取或创建目标节点
                      let targetNode = nodeCache.get(normalizedTarget);
                      if (!targetNode) {
                        targetNode = await store.findNodeByLabel(normalizedTarget);
                        if (!targetNode) {
                          targetNode = await store.addNode({
                            id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            label: normalizedTarget,
                            type: inferEntityType(normalizedTarget, rel.relation),
                            tags: Array.isArray(params.tags) ? params.tags : [],
                            properties: { sourceDoc: docName, chunkIndex: i },
                            createdAt: Date.now(),
                          });
                          createdCount++;
                        }
                        nodeCache.set(normalizedTarget, targetNode);
                      }

                      // 避免重复边 - 检查关系类型和置信度
                      const existingEdges = await store.getEdgesBetween(sourceNode.id, targetNode.id);
                      const hasEdge = existingEdges.some(e =>
                        e.relation === rel.relation ||
                        e.relation === normalizeRelationType(rel.relation)
                      );

                      if (!hasEdge) {
                        await store.addEdge(
                          sourceNode.id,
                          targetNode.id,
                          "LLM_EXTRACTED",
                          normalizeRelationType(rel.relation)
                        );
                      }

                      // 同时连接到文档锚点
                      if (sourceNode.id !== docAnchorNode.id) {
                        const docToSourceEdges = await store.getEdgesBetween(docAnchorNode.id, sourceNode.id);
                        if (docToSourceEdges.length === 0) {
                          await store.addEdge(docAnchorNode.id, sourceNode.id, "CONTAINS", "mentions_in_doc");
                        }
                      }
                      if (targetNode.id !== docAnchorNode.id) {
                        const docToTargetEdges = await store.getEdgesBetween(docAnchorNode.id, targetNode.id);
                        if (docToTargetEdges.length === 0) {
                          await store.addEdge(docAnchorNode.id, targetNode.id, "CONTAINS", "mentions_in_doc");
                        }
                      }
                    }
                  }

                  console.log(`[kb_ingest] LLM 关系抽取完成: 总共抽取 ${totalRelations} 个关系，创建 ${createdCount} 个节点`);
                }
              }
            } catch (err: unknown) {
              console.warn("[kb_ingest] 知识图谱同步/关系抽取失败，忽略:", err);
              /* 图谱同步失败不影响入库结果 */
            }
          }

          // 文档解析完全完成（包括知识图谱同步），更新解析状态为成功
          // 确保在所有处理完全完成后才更新状态
          const placeholderDocId = (params as IngestParamsExtension)._placeholderDocId;
          if (placeholderDocId) {
            console.log(`[kb_ingest] 所有处理完成，更新占位文档状态为成功: ${placeholderDocId}`);
            await kb.updateParsingStatus(placeholderDocId, {
              parsingStatus: 'success',
              parsingProgress: 100,
              chunkCount: result.chunkCount,
              totalTokens: result.totalTokens,
              parsedContent: content?.slice(0, 50000),
            });
          }

          return {
            success: true,
            data: {
              ...result,
              owner,
              docName,
              message: result.chunkCount === 0
                ? `文档 "${docName}" 内容未变化，跳过`
                : `文档 "${docName}" 已${action}（v${result.version}），分为 ${result.chunkCount} 个块，共 ${result.totalTokens} tokens`,
            },
          };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      }
    }),
  );

// 智能内容块解析函数
function parseContentBlocks(content: string): Array<{ type: string; content: string; level?: number }> {
  const blocks: Array<{ type: string; content: string; level?: number }> = [];
  const lines = content.split('\n');
  let currentBlock = '';
  let currentType = 'paragraph';
  let currentLevel = 0;

  // 正则表达式匹配不同内容类型
  const titlePattern = /^(#+)\s+(.+)$/;  // Markdown 标题
  const codePattern = /^```([a-zA-Z]*)/; // Markdown 代码块开始
  const listPattern = /^(\s*)([-*+]|\d+\.)\s/; // 列表项
  const quotePattern = /^>\s*/; // 引用

  let inCodeBlock = false;
  let codeLanguage = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (inCodeBlock) {
      if (line.startsWith('```')) {
        // 代码块结束
        blocks.push({
          type: `code_${codeLanguage}`,
          content: currentBlock.trim(),
        });
        inCodeBlock = false;
        currentBlock = '';
        currentType = 'paragraph';
      } else {
        currentBlock += (currentBlock ? '\n' : '') + line;
      }
      continue;
    }

    // 检查是否开始代码块
    const codeMatch = line.match(codePattern);
    if (codeMatch) {
      inCodeBlock = true;
      codeLanguage = codeMatch[1];
      if (currentBlock) {
        blocks.push({ type: currentType, content: currentBlock.trim(), level: currentLevel });
        currentBlock = '';
      }
      continue;
    }

    // 检查是否是标题
    const titleMatch = line.match(titlePattern);
    if (titleMatch) {
      if (currentBlock) {
        blocks.push({ type: currentType, content: currentBlock.trim(), level: currentLevel });
      }
      currentType = 'heading';
      currentLevel = titleMatch[1].length;
      currentBlock = titleMatch[2].trim();
      blocks.push({ type: currentType, content: currentBlock, level: currentLevel });
      currentBlock = '';
      currentType = 'paragraph';
      currentLevel = 0;
      continue;
    }

    // 检查是否是列表项
    const listMatch = line.match(listPattern);
    if (listMatch) {
      if (currentBlock) {
        blocks.push({ type: currentType, content: currentBlock.trim(), level: currentLevel });
      }
      currentType = 'list';
      currentLevel = listMatch[1].length; // 使用缩进确定列表层级
      currentBlock = line.trimStart();
      continue;
    }

    // 检查是否是引用
    const quoteMatch = line.match(quotePattern);
    if (quoteMatch) {
      if (currentBlock) {
        blocks.push({ type: currentType, content: currentBlock.trim(), level: currentLevel });
      }
      currentType = 'quote';
      currentLevel = 0;
      currentBlock = line.slice(quoteMatch[0].length).trim();
      continue;
    }

    // 处理段落（空行分隔）
    if (line === '') {
      if (currentBlock) {
        blocks.push({ type: currentType, content: currentBlock.trim(), level: currentLevel });
        currentBlock = '';
        currentType = 'paragraph';
        currentLevel = 0;
      }
      continue;
    }

    // 普通文本行
    if (currentBlock) {
      currentBlock += '\n' + line;
    } else {
      currentBlock = line;
    }
  }

  // 处理最后一个块
  if (currentBlock) {
    blocks.push({ type: currentType, content: currentBlock.trim(), level: currentLevel });
  }

  return blocks;
}

/** 归一化实体标签 - 提高匹配准确性 */
function normalizeEntityLabel(label: string): string {
  if (!label) return label;
  return label
    .trim()
    .replace(/\s+/g, ' ')  // 多个空格合并为一个
    .replace(/[^\u4e00-\u9fffa-zA-Z0-9\s]/g, '')  // 移除特殊字符
    .toLowerCase();
}

/** 根据实体名称和关系推断实体类型 */
function inferEntityType(label: string, relation: string): string {
  const lowerLabel = label.toLowerCase();
  const lowerRelation = relation.toLowerCase();

  // 文档相关
  if (lowerLabel.includes('文档') || lowerLabel.includes('文件') || lowerLabel.endsWith('.pdf') || lowerLabel.endsWith('.docx')) {
    return 'kb_document';
  }

  // 概念/术语
  if (lowerRelation.includes('定义') || lowerRelation.includes('是') || lowerLabel.includes('什么')) {
    return 'concept';
  }

  // 人物
  if (lowerLabel.includes('先生') || lowerLabel.includes('女士') || lowerLabel.includes('博士')) {
    return 'person';
  }

  // 组织
  if (lowerLabel.includes('公司') || lowerLabel.includes('部门') || lowerLabel.includes('团队')) {
    return 'organization';
  }

  // 技术/工具
  if (lowerLabel.includes('系统') || lowerLabel.includes('平台') || lowerLabel.includes('工具')) {
    return 'technology';
  }

  // 默认类型
  return 'entity';
}

/** 归一化关系类型 - 统一关系表达方式 */
function normalizeRelationType(relation: string): string {
  const lowerRel = relation.toLowerCase();

  const relationMap: Record<string, string> = {
    '相关': 'related_to',
    '关联': 'related_to',
    '连接': 'related_to',
    '关于': 'about',
    '属于': 'part_of',
    '包含': 'contains',
    '包括': 'contains',
    '使用': 'uses',
    '依赖': 'depends_on',
    '基于': 'based_on',
    '参考': 'references',
    '引用': 'references',
    '创建': 'created_by',
    '是': 'is_a',
    '等于': 'is_a',
    '区别于': 'different_from',
    '不同于': 'different_from',
    '相似于': 'similar_to',
  };

  // 精确匹配
  if (relationMap[lowerRel]) {
    return relationMap[lowerRel];
  }

  // 部分匹配
  for (const [key, value] of Object.entries(relationMap)) {
    if (lowerRel.includes(key)) {
      return value;
    }
  }

  // 默认返回原始关系
  return relation;
}

// 查询类型分类器
type QueryType = 'factual' | 'relational' | 'discovery' | 'hybrid';

interface ClassifiedQuery {
  type: QueryType;
  confidence: number;
  keywords: string[];
  entities: string[];
  relations: string[];
}

  registry.register(
    defineSystemSkill({
      name: "kb_search",
      description:
        "知识图谱原生检索。自动分类查询类型（事实/关系/发现）并选择最优检索策略。参数: query(string), limit?(number, 默认5), threshold?(number, 0-1 相对阈值, 结果须达到最高分的该比例, 默认0.4), tags?(string[]), docIds?(string[]), owner?(string, 默认 default), includeShared?(boolean, 是否包含其他用户共享的知识, 默认 true)",
      timeout: 30000,
      paramSchema: {
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum number of results (default: 5)" },
          threshold: { type: "number", description: "Relative score threshold 0-1 (default: 0.4)" },
          tags: { type: "array", description: "Filter results by tags", items: { type: "string" } },
          docIds: { type: "array", description: "Limit search to specific document IDs", items: { type: "string" } },
          owner: { type: "string", description: "Knowledge base owner (default: current user)" },
          includeShared: { type: "boolean", description: "Include shared knowledge from other users (default: true)" },
        },
        required: ["query"],
      },
      handler: async (params) => {
        const query = params.query as string;
        if (!query) return { success: false, error: new Error("query 参数必填") };

        const owner = (params.owner as string) || getCurrentUserId();
        const limit = (params.limit as number) ?? 5;
        const includeShared = (params.includeShared as boolean) ?? true;
        const kb = getKnowledgeBase(owner);

        try {
          // P3: 查询分类
          const classified = classifyQuery(query);
          console.log(`[kb_search] 查询分类: ${classified.type}, 置信度: ${classified.confidence.toFixed(2)}, 关键词: ${classified.keywords.join(', ')}`);

          let ownResults: any[] = [];
          let graphUsed = false;

          // 获取图谱管理器（如果可用）
          let graphManager: any = null;
          if (sessionManager) {
            const session = sessionManager.getOrCreate(owner);
            const sessionWithGraph = session as unknown as SessionWithGraphManager;
            graphManager = sessionWithGraph.graphManager;
          }

          // 根据查询类型选择检索策略
          if ((classified.type === 'relational' || classified.type === 'discovery') && graphManager) {
            // P3: 关系查询或发现查询 → 使用图谱检索
            console.log(`[kb_search] 使用图谱检索 (${classified.type})`);
            try {
              const subgraphResult = await graphManager.querySubgraph(query, {
                maxDepth: 3,
                maxNodes: 50,
              });

              // 从子图中提取 kb_document 节点
              const docNodes = subgraphResult.nodes.filter((n: any) => n.type === 'kb_document');

              if (docNodes.length > 0) {
                // 从知识库获取完整信息
                const docIds = docNodes.map((n: any) => {
                  // 从节点 id 中提取 docId (格式: kb_doc_${docId})
                  const match = n.id.match(/kb_doc_(.*)/);
                  return match ? match[1] : null;
                }).filter(Boolean);

                console.log(`[kb_search] 从知识图谱找到相关文档: ${docIds.length} 个`);

                // 使用图谱相关的文档 ID 进行知识库检索
                ownResults = await kb.search(query, {
                  limit: limit * 2,
                  docIds: docIds as string[],
                  tags: params.tags as string[]
                });

                // 为结果添加图谱上下文
                ownResults = ownResults.map(result => ({
                  ...result,
                  matchType: `graph_${classified.type}`,
                  graphContext: {
                    subgraphSize: subgraphResult.nodes.length,
                    edgesCount: subgraphResult.edges.length,
                    sourceNode: docNodes.find((d: any) => `kb_doc_${result.docId}` === d.id),
                  }
                }));

                graphUsed = true;
              } else {
                console.log(`[kb_search] 知识图谱未找到直接相关文档，使用混合检索`);
                ownResults = await kb.search(query, {
                  limit: limit,
                  tags: params.tags as string[],
                  docIds: params.docIds as string[]
                });
              }
            } catch (graphErr: unknown) {
              console.warn(`[kb_search] 知识图谱检索失败，降级到混合检索:`, graphErr);
              ownResults = await kb.search(query, {
                limit: limit,
                tags: params.tags as string[],
                docIds: params.docIds as string[]
              });
            }
          } else {
            // 事实查询或混合查询 → 使用混合检索
            console.log(`[kb_search] 使用混合检索 (${classified.type})`);
            ownResults = await kb.search(query, {
              limit: limit,
              tags: params.tags as string[],
              docIds: params.docIds as string[]
            });
          }

          // 处理共享文档（如果需要）
          let sharedResults: any[] = [];
          if (includeShared) {
            try {
              const sharedKB = getKnowledgeBase("shared");
              const rawSharedResults = await sharedKB.search(query, {
                limit: limit * 2,
                tags: params.tags as string[],
                docIds: params.docIds as string[]
              });

              // 去重：排除自己文档
              const ownDocIds = new Set(ownResults.map(r => r.docId));
              sharedResults = rawSharedResults
                .filter(r => !ownDocIds.has(r.docId))
                .slice(0, limit);
            } catch (sharedErr: unknown) {
              console.warn("[kb_search] 共享文档检索失败:", sharedErr);
              sharedResults = [];
            }
          }

          const combined = [...ownResults, ...sharedResults];

          // 图谱同步（非致命）
          if (sessionManager && combined.length > 0) {
            try {
              const session = sessionManager.getOrCreate(owner);
              const sessionWithGraph = session as unknown as SessionWithGraphManager;
              if (sessionWithGraph.graphManager) {
                for (const result of combined.slice(0, 5)) {
                  await sessionWithGraph.graphManager.onFactStored({
                    id: `kb_${result.docId}_${result.chunkIndex}`,
                    key: `kb:${result.docName}:chunk${result.chunkIndex}`,
                    value: result.content.slice(0, 200),
                    tags: ['kb_document', (result.docName.split('.').pop() || 'doc')],
                  });
                }
              }
            } catch { /* 图谱同步失败不影响搜索结果 */ }
          }

          return {
            success: true,
            data: combined.slice(0, limit),
          };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_list",
      description: "列出知识库中的文档。支持多维度筛选：名称模糊查询、标签筛选、文件格式筛选。参数: query?(string, 名称模糊查询), tags?(string[], 标签筛选), format?(string, 文件格式如 pdf/docx/md), owner?(string, 默认 current), sharedOnly?(boolean), limit?(number, 默认100)",
      paramSchema: {
        properties: {
          query: { type: "string", description: "Filter documents by name (fuzzy search)" },
          tags: { type: "array", description: "Filter by tags", items: { type: "string" } },
          format: { type: "string", description: "Filter by file format: pdf, docx, md, txt, etc." },
          owner: { type: "string", description: "Knowledge base owner (default: current user)" },
          sharedOnly: { type: "boolean", description: "If true, return only shared documents" },
          limit: { type: "number", description: "Maximum number of documents to return (default: 100)" },
        },
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        const docs = await kb.listDocuments({
          query: params.query as string | undefined,
          tags: params.tags as string[] | undefined,
          format: params.format as string | undefined,
          sharedOnly: params.sharedOnly as boolean | undefined,
          limit: (params.limit as number) ?? 100,
        });

        return { success: true, data: { owner, documents: docs, total: docs.length } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_tags",
      description: "获取知识库中所有标签及其使用次数，按使用次数降序排列。参数: owner?(string, 默认 current)",
      paramSchema: {
        properties: {
          owner: { type: "string", description: "Knowledge base owner (default: current user)" },
        },
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        const tags = await kb.getAllTags();
        return { success: true, data: { owner, tags, total: tags.length } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_formats",
      description: "获取知识库中所有文件格式及其数量，按数量降序排列。参数: owner?(string, 默认 current)",
      paramSchema: {
        properties: {
          owner: { type: "string", description: "Knowledge base owner (default: current user)" },
        },
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        const formats = await kb.getAllFormats();
        return { success: true, data: { owner, formats, total: formats.length } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_delete",
      description: "从知识库中删除文档。参数: docId(string), owner?(string, 默认 default)",
      paramSchema: {
        properties: {
          docId: { type: "string", description: "Document ID to delete" },
          owner: { type: "string", description: "Knowledge base owner (default: current user)" },
        },
        required: ["docId"],
      },
      handler: async (params) => {
        const docId = params.docId as string;
        if (!docId) return { success: false, error: new Error("docId 参数必填") };

        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        
        // Get document info before deletion for graph sync
        const doc = await kb.getDocument(docId);
        const docName = doc?.name || docId;
        
        const deleted = await kb.deleteDocument(docId);
        
         // Remove from all users' knowledge graphs
         if (deleted && sessionManager) {
           try {
             await removeKBFromAllGraphs(docId, docName, owner, sessionManager);
           } catch (err: any) {
             // Ignore error if knowledge graph tables don't exist
             console.warn(`[kb_delete] Failed to remove from knowledge graph (ignored): ${err.message}`);
           }
         }
        
        return {
          success: deleted,
          data: { deleted, docId, owner },
          error: deleted ? undefined : new Error(`文档不存在: ${docId}`),
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_share",
      description: "设置文档的共享状态。参数: docId(string), shared(boolean), owner?(string, 默认 default)",
      handler: async (params) => {
        const docId = params.docId as string;
        const shared = params.shared as boolean;
        if (!docId || shared === undefined) {
          return { success: false, error: new Error("docId 和 shared 参数必填") };
        }

        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        const updated = await kb.setShared(docId, shared);
        
         // Sync to knowledge graphs when sharing
         if (updated && shared && sessionManager) {
           try {
             const doc = await kb.getDocument(docId);
             if (doc) {
               const targetUsers = await getSharedKBTargetUsers(owner);
               await syncSharedKBToGraphs(docId, doc.name, owner, targetUsers, sessionManager);
             }
           } catch (err: any) {
             // Ignore error if knowledge graph tables don't exist
             console.warn(`[kb_share] Failed to sync to knowledge graph (ignored): ${err.message}`);
           }
         }
        
        return {
          success: updated,
          data: { docId, shared, owner },
          error: updated ? undefined : new Error(`文档不存在: ${docId}`),
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_shared",
      description: "列出所有用户共享的文档或搜索共享知识。参数: query?(string, 搜索查询), limit?(number, 默认20)",
      handler: async (params) => {
        const limit = (params.limit as number) ?? 20;
        const query = params.query as string | undefined;

        if (query) {
          // 搜索所有共享文档
          const results = await searchShared(query, "__none__", limit);
          return { success: true, data: { results, count: results.length, query } };
        }

        // 列出所有共享文档
        const allShared: any[] = [];
        for (const tenant of await getAllTenants()) {
          const kb = getKnowledgeBase(tenant);
          const docs = await kb.listDocuments({ sharedOnly: true });
          allShared.push(...docs.map((d: any) => ({ ...d, owner: tenant })));
        }

        return { success: true, data: { documents: allShared, total: allShared.length } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_vectorize",
      description: "对指定文档执行向量化（处理未向量化的 chunks）。参数: docId(string), owner?(string)",
      timeout: 300000,
      visible: false,
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const docId = params.docId as string;
        if (!docId) return { success: false, error: new Error("docId 参数必填") };
        const kb = getKnowledgeBase(owner);
        try {
          const result = await kb.vectorizeDoc(docId);
          return { success: true, data: { ...result, docId, owner } };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_stats",
      description: "获取知识库统计信息。参数: owner?(string, 默认 default)",
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        return { success: true, data: await kb.stats() };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "kb_rebuild",
      description: "重建知识库向量索引。参数: owner?(string, 默认 default)",
      timeout: 300000,
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        try {
          const result = await kb.rebuildIndex();
          return {
            success: true,
            data: { ...result, owner, message: `已重建 ${result.chunksProcessed} 个块的向量索引` },
          };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  console.log("   Knowledge base skills registered (kb_ingest/kb_search/kb_list/kb_tags/kb_formats/kb_delete/kb_share/kb_shared/kb_stats/kb_rebuild)");
}


/** 为知识库设置 embedding provider */
export function setKBEmbeddingProvider(owner: string, provider: EmbeddingProvider): void {
  const kb = getKnowledgeBase(owner);
  kb.setEmbeddingProvider(provider);
}

/** 全局默认 embedding provider（新创建的 KB 实例会自动使用） */
let globalEmbeddingProvider: EmbeddingProvider | null = null;
/** 全局视觉模型配置（用于文档 OCR） */
let globalVisionConfig: VisionModelConfig | null = null;

export function setGlobalKBEmbeddingProvider(provider: EmbeddingProvider): void {
  globalEmbeddingProvider = provider;
  // 更新所有已有实例
  for (const cached of kbInstances.values()) {
    cached.kb.setEmbeddingProvider(provider);
  }
}

export function setGlobalKBVisionConfig(config: VisionModelConfig | null): void {
  globalVisionConfig = config;
}

// ===== 类型扩展 =====

interface IngestParamsExtension {
  _fileHash?: string;
  _pageImages?: Array<{ page: number; imageBase64: string }>;
  _parsePages?: PageResult[];
  _placeholderDocId?: string;
  _skipQueue?: boolean;
}

interface SessionWithGraphManager {
  graphManager: {
    onFactStored: (fact: {
      id: string;
      key: string;
      value: string;
      tags?: string[];
      relation?: string;
    }) => Promise<void>;
    getStore: () => {
      findNodeByLabel: (label: string) => { id: string } | undefined;
      addNode: (node: {
        id: string;
        label: string;
        type: string;
        tags: string[];
        properties: Record<string, unknown>;
        createdAt: number;
      }) => { id: string };
      getEdgesBetween: (sourceId: string, targetId: string) => Array<{ relation: string }>;
      addEdge: (sourceId: string, targetId: string, type: string, relation: string) => void;
    };
  } | undefined;
  llmProvider: unknown;
}
