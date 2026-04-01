/**
 * 知识库 Skill 家族
 *
 * 将上传文件自动解析、分块、向量化，形成可检索的知识库。
 * 支持语义搜索 + 关键词搜索混合检索，大批量文件优化。
 *
 * 特性：
 *   - 多租户隔离：每个用户拥有独立知识库（独立 SQLite 文件）
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
import { defineSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { EmbeddingProvider } from "../memory/embedding-provider.js";
import { LocalEmbeddingProvider, cosineSimilarity } from "../memory/embedding-provider.js";
import { parseDocument, type VisionModelConfig, type PageResult, type OCRBlock } from "../services/doc-parser.js";
import Database from "better-sqlite3";
import { join, resolve, dirname } from "path";
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";

/** 解析器版本号 — 每次解析逻辑有重大变更时递增，强制已有文档重新入库 */
const PARSER_VERSION = 2;
import { getCurrentUserId } from "../user/request-context.js";

// ===== 知识库核心 =====

class KnowledgeBase {
  private db: Database.Database;
  private embeddingProvider: EmbeddingProvider;
  private vectorCache: Map<number, number[]> = new Map();
  private vectorCacheDirty = true;
  readonly owner: string;

  constructor(dbPath: string, owner: string, embeddingProvider?: EmbeddingProvider) {
    mkdirSync(resolve(dbPath, ".."), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.embeddingProvider = embeddingProvider ?? new LocalEmbeddingProvider();
    this.owner = owner;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kb_documents (
        doc_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT DEFAULT '',
        chunk_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        ingested_at INTEGER NOT NULL,
        updated_at INTEGER,
        version INTEGER DEFAULT 1,
        tags TEXT DEFAULT '[]',
        shared INTEGER DEFAULT 0,
        content_hash TEXT DEFAULT '',
        parsed_content TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS kb_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER DEFAULT 0,
        vector BLOB,
        FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON kb_chunks(doc_id);

      CREATE TABLE IF NOT EXISTS kb_keywords (
        keyword TEXT NOT NULL,
        chunk_id INTEGER NOT NULL,
        tf REAL DEFAULT 0,
        PRIMARY KEY (keyword, chunk_id),
        FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON kb_keywords(keyword);

      CREATE TABLE IF NOT EXISTS kb_versions (
        doc_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (doc_id, version)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_name ON kb_documents(name);
    `);

    // 迁移：为旧库添加 parsed_content 列
    try {
      this.db.exec("ALTER TABLE kb_documents ADD COLUMN parsed_content TEXT DEFAULT ''");
    } catch {
      // 列已存在，忽略
    }

    // 迁移：为 kb_chunks 添加 page_number 和 bbox_data 列
    try {
      this.db.exec("ALTER TABLE kb_chunks ADD COLUMN page_number INTEGER");
    } catch { /* 列已存在 */ }
    try {
      this.db.exec("ALTER TABLE kb_chunks ADD COLUMN bbox_data TEXT DEFAULT '[]'");
    } catch { /* 列已存在 */ }
  }

  /** 创建文档占位记录（用于异步解析，立即在列表中显示） */
  createPlaceholder(docName: string, opts?: { source?: string; tags?: string[] }): string {
    const source = opts?.source ?? "";
    const tags = opts?.tags ?? [];
    const existing = this.db.prepare("SELECT doc_id FROM kb_documents WHERE name = ?").get(docName) as any;
    if (existing) return existing.doc_id;

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      "INSERT INTO kb_documents (doc_id, name, source, chunk_count, total_tokens, ingested_at, version, tags, shared, content_hash, parsed_content) VALUES (?, ?, ?, 0, 0, ?, 1, ?, 0, '', '解析中...')",
    ).run(docId, docName, source, Date.now(), JSON.stringify(tags));
    return docId;
  }

  /** 导入文档（同名文档自动更新）
   * skipEmbedding=true 时只做分块+关键词，不向量化（快速入库）
   * pages 为 vision OCR 的页面结果（含 blocks + bbox），用于页码感知分块
   */
  async ingest(
    docName: string,
    content: string,
    opts?: { source?: string; tags?: string[]; chunkSize?: number; chunkOverlap?: number; shared?: boolean; skipEmbedding?: boolean; pages?: PageResult[]; fileHash?: string },
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

    // 检查同名文档是否存在
    const existing = this.db.prepare("SELECT doc_id, version, content_hash FROM kb_documents WHERE name = ?").get(docName) as any;

    let docId: string;
    let version = 1;
    let updated = false;

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
      const oldDoc = this.db.prepare("SELECT chunk_count, total_tokens, content_hash FROM kb_documents WHERE doc_id = ?").get(docId) as any;
      this.db.prepare(
        "INSERT OR REPLACE INTO kb_versions (doc_id, version, content_hash, chunk_count, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(docId, existing.version, oldDoc.content_hash, oldDoc.chunk_count, oldDoc.total_tokens, Date.now());

      // 删除旧的 chunks 和 keywords
      this.db.prepare("DELETE FROM kb_keywords WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = ?)").run(docId);
      this.db.prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(docId);
    } else {
      docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

    // 事务写入
    let totalTokens = 0;
    const transaction = this.db.transaction(() => {
      if (updated) {
        this.db.prepare(
          "UPDATE kb_documents SET chunk_count = ?, total_tokens = 0, updated_at = ?, version = ?, tags = ?, shared = ?, content_hash = ?, source = ?, parsed_content = ? WHERE doc_id = ?",
        ).run(chunks.length, Date.now(), version, JSON.stringify(tags), shared, contentHash, source, content, docId);
      } else {
        this.db.prepare(
          "INSERT INTO kb_documents (doc_id, name, source, chunk_count, total_tokens, ingested_at, version, tags, shared, content_hash, parsed_content) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
        ).run(docId, docName, source, chunks.length, Date.now(), version, JSON.stringify(tags), shared, contentHash, content);
      }

      const insertChunk = this.db.prepare(
        "INSERT INTO kb_chunks (doc_id, chunk_index, content, tokens, vector, page_number, bbox_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const insertKeyword = this.db.prepare(
        "INSERT OR REPLACE INTO kb_keywords (keyword, chunk_id, tf) VALUES (?, ?, ?)",
      );

      for (let i = 0; i < chunks.length; i++) {
        const meta = chunksWithMeta[i];
        const tokens = this.estimateTokens(chunks[i]);
        totalTokens += tokens;
        const vectorBlob = allVectors
          ? Buffer.from(new Float32Array(allVectors[i]).buffer)
          : null;
        const pageNumber = meta?.pageNumber ?? null;
        const bboxData = meta?.bboxes && meta.bboxes.length > 0 ? JSON.stringify(meta.bboxes) : "[]";
        const result = insertChunk.run(docId, i, chunks[i], tokens, vectorBlob, pageNumber, bboxData);
        const chunkId = result.lastInsertRowid as number;

        const keywords = this.extractKeywords(chunks[i]);
        for (const [keyword, tf] of keywords) {
          insertKeyword.run(keyword, chunkId, tf);
        }
      }

      this.db.prepare("UPDATE kb_documents SET total_tokens = ? WHERE doc_id = ?").run(totalTokens, docId);
    });

    transaction();
    this.vectorCacheDirty = true;

    return { docId, chunkCount: chunks.length, totalTokens, updated, version };
  }

  /** 对指定文档异步向量化（仅处理 vector 为 null 的 chunks） */
  async vectorizeDoc(docId: string): Promise<{ vectorized: number }> {
    const rows = this.db.prepare(
      "SELECT id, content FROM kb_chunks WHERE doc_id = ? AND vector IS NULL",
    ).all() as Array<{ id: number; content: string }>;

    if (rows.length === 0) return { vectorized: 0 };

    const batchSize = 50;
    const updateStmt = this.db.prepare("UPDATE kb_chunks SET vector = ? WHERE id = ?");

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const vectors = await this.embeddingProvider.embed(batch.map((r) => r.content));
      const txn = this.db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const vectorBlob = Buffer.from(new Float32Array(vectors[j]).buffer);
          updateStmt.run(vectorBlob, batch[j].id);
        }
      });
      txn();
    }

    this.vectorCacheDirty = true;
    return { vectorized: rows.length };
  }

  /** 获取文档向量化状态 */
  getDocVectorStatus(docId: string): { total: number; vectorized: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM kb_chunks WHERE doc_id = ?").get(docId) as any).c;
    const vectorized = (this.db.prepare("SELECT COUNT(*) as c FROM kb_chunks WHERE doc_id = ? AND vector IS NOT NULL").get(docId) as any).c;
    return { total, vectorized };
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

    const keywordResults = this.keywordSearch(query, candidateCount, opts?.docIds, opts?.tags);
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
      results = results.filter((r) => {
        const doc = this.db.prepare("SELECT tags FROM kb_documents WHERE doc_id = ?").get(r.data.docId) as any;
        if (!doc) return false;
        const docTags = JSON.parse(doc.tags ?? "[]") as string[];
        return docTags.some((t) => tagSet.has(t));
      });
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

  private keywordSearch(
    query: string,
    limit: number,
    docIds?: string[],
    tags?: string[],
  ): Array<{ id: number; docId: string; docName: string; chunkIndex: number; content: string; score: number; shared: number; page_number: number | null; bbox_data: string }> {
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
      WHERE k.keyword IN (${placeholders})
    `;

    const params: any[] = [...keywords];

    if (docIds && docIds.length > 0) {
      sql += ` AND c.doc_id IN (${docIds.map(() => "?").join(",")})`;
      params.push(...docIds);
    }

    if (tags && tags.length > 0) {
      // JSON tag 过滤下推到 SQL 层
      const tagConditions = tags.map(() => "d.tags LIKE ?");
      sql += ` AND (${tagConditions.join(" OR ")})`;
      params.push(...tags.map((t) => `%"${t}"%`));
    }

    sql += ` GROUP BY c.id ORDER BY score DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as any[];
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
    this.ensureVectorCache();

    if (this.vectorCache.size === 0) return [];

    // Top-K 选择：维护一个大小为 limit 的最小堆，避免全量排序
    // 对于万级以下直接线性扫描 + 部分排序已足够高效
    const minSim = 0.3; // 语义相似度绝对下限，低于此的直接跳过
    const topK: Array<{ id: number; similarity: number }> = [];
    let heapMin = minSim;

    for (const [chunkId, vector] of this.vectorCache) {
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
    const params: any[] = [...ids];

    if (docIds && docIds.length > 0) {
      sql += ` AND c.doc_id IN (${docIds.map(() => "?").join(",")})`;
      params.push(...docIds);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const rowMap = new Map(rows.map((r: any) => [r.id, r]));

    return topK
      .filter((c) => rowMap.has(c.id))
      .map((c) => ({ ...rowMap.get(c.id)!, similarity: c.similarity }));
  }

  private ensureVectorCache(): void {
    if (!this.vectorCacheDirty) return;

    this.vectorCache.clear();
    const rows = this.db.prepare("SELECT id, vector FROM kb_chunks WHERE vector IS NOT NULL").all() as Array<{ id: number; vector: Buffer }>;

    for (const row of rows) {
      if (row.vector && row.vector.length > 0) {
        const floats = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.length / 4);
        this.vectorCache.set(row.id, Array.from(floats));
      }
    }

    this.vectorCacheDirty = false;
  }

  /** 列出文档 */
  listDocuments(opts?: { query?: string; tags?: string[]; sharedOnly?: boolean; limit?: number }): any[] {
    const limit = opts?.limit ?? 100;
    let sql = "SELECT * FROM kb_documents";
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts?.query) {
      conditions.push("(name LIKE ? OR source LIKE ?)");
      params.push(`%${opts.query}%`, `%${opts.query}%`);
    }
    if (opts?.sharedOnly) {
      conditions.push("shared = 1");
    }

    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY ingested_at DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows
      .map((r: any) => {
        const vs = this.getDocVectorStatus(r.doc_id);
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
          tags: JSON.parse(r.tags ?? "[]"),
          shared: r.shared === 1,
          vectorized: vs.vectorized,
          vectorTotal: vs.total,
        };
      })
      .filter((doc: any) => {
        if (!opts?.tags || opts.tags.length === 0) return true;
        return opts.tags.some((t) => doc.tags.includes(t));
      });
  }

  /** 获取文档解析内容 */
  getDocumentContent(docId: string): string | null {
    const row = this.db.prepare("SELECT parsed_content FROM kb_documents WHERE doc_id = ?").get(docId) as any;
    return row?.parsed_content || null;
  }

  /** 设置文档共享状态 */
  setShared(docId: string, shared: boolean): boolean {
    const result = this.db.prepare("UPDATE kb_documents SET shared = ? WHERE doc_id = ?").run(shared ? 1 : 0, docId);
    return result.changes > 0;
  }

  /** 获取共享文档列表（用于跨租户检索） */
  getSharedDocIds(): string[] {
    const rows = this.db.prepare("SELECT doc_id FROM kb_documents WHERE shared = 1").all() as any[];
    return rows.map((r: any) => r.doc_id);
  }

  /** 删除文档 */
  deleteDocument(docId: string): boolean {
    const exists = this.db.prepare("SELECT 1 FROM kb_documents WHERE doc_id = ?").get(docId);
    if (!exists) return false;

    // 先删子表（外键依赖），再删父表
    this.db.prepare("DELETE FROM kb_keywords WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = ?)").run(docId);
    this.db.prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(docId);
    this.db.prepare("DELETE FROM kb_versions WHERE doc_id = ?").run(docId);
    this.db.prepare("DELETE FROM kb_documents WHERE doc_id = ?").run(docId);
    this.vectorCacheDirty = true;
    return true;
  }

  /** 统计信息 */
  stats(): any {
    const docCount = (this.db.prepare("SELECT COUNT(*) as c FROM kb_documents").get() as any).c;
    const chunkCount = (this.db.prepare("SELECT COUNT(*) as c FROM kb_chunks").get() as any).c;
    const totalTokens = (this.db.prepare("SELECT COALESCE(SUM(total_tokens), 0) as t FROM kb_documents").get() as any).t;
    const keywordCount = (this.db.prepare("SELECT COUNT(DISTINCT keyword) as c FROM kb_keywords").get() as any).c;
    const sharedCount = (this.db.prepare("SELECT COUNT(*) as c FROM kb_documents WHERE shared = 1").get() as any).c;

    return {
      owner: this.owner,
      documentCount: docCount,
      sharedCount,
      chunkCount,
      totalTokens,
      vectorCacheSize: this.vectorCache.size,
      keywordCount,
      embeddingProvider: this.embeddingProvider.name,
    };
  }

  /** 重建向量索引 */
  async rebuildIndex(): Promise<{ chunksProcessed: number }> {
    const rows = this.db.prepare("SELECT id, content FROM kb_chunks").all() as Array<{ id: number; content: string }>;
    const batchSize = 50;
    let processed = 0;
    const updateStmt = this.db.prepare("UPDATE kb_chunks SET vector = ? WHERE id = ?");

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const vectors = await this.embeddingProvider.embed(batch.map((r) => r.content));
      const transaction = this.db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const vectorBlob = Buffer.from(new Float32Array(vectors[j]).buffer);
          updateStmt.run(vectorBlob, batch[j].id);
        }
      });
      transaction();
      processed += batch.length;
    }

    this.vectorCacheDirty = true;
    return { chunksProcessed: processed };
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    this.vectorCacheDirty = true;
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
const kbInstances = new Map<string, KnowledgeBase>();

export function getKnowledgeBase(owner: string): KnowledgeBase {
  if (!kbInstances.has(owner)) {
    const dbPath = join(KB_BASE, owner, "knowledge.db");
    const kb = new KnowledgeBase(dbPath, owner, globalEmbeddingProvider ?? undefined);
    kbInstances.set(owner, kb);
  }
  return kbInstances.get(owner)!;
}

/** 获取所有租户列表 */
function getAllTenants(): string[] {
  mkdirSync(KB_BASE, { recursive: true });
  try {
    return readdirSync(KB_BASE).filter((name) => {
      return existsSync(join(KB_BASE, name, "knowledge.db"));
    });
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
): Promise<Array<{ docId: string; docName: string; chunkIndex: number; content: string; score: number; matchType: string; shared: boolean; owner: string }>> {
  const tenants = getAllTenants().filter((t) => t !== excludeOwner);
  const allResults: any[] = [];

  for (const tenant of tenants) {
    const kb = getKnowledgeBase(tenant);
    const sharedDocIds = kb.getSharedDocIds();
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

export function createKnowledgeSkills(registry: SkillRegistry): void {
  const WORKSPACE_BASE = resolve(process.cwd(), ".raos", "workspace");
  mkdirSync(KB_BASE, { recursive: true });

  registry.register(
    defineSkill({
      name: "kb_ingest",
      description:
        "将文件或文本导入知识库（同名文档自动更新）。参数: content?(string), path?(string, workspace路径), name?(string, 文档名), tags?(string[]), shared?(boolean, 是否共享), owner?(string, 所属用户, 默认 default), chunkSize?(number, 默认500), chunkOverlap?(number, 默认50)",
      timeout: 120000,
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        let content = params.content as string | undefined;
        let docName = params.name as string | undefined;
        const path = params.path as string | undefined;

        if (!content && !path) {
          return { success: false, error: new Error("需要提供 content 或 path 参数") };
        }

        if (path && !content) {
          const fullPath = resolve(WORKSPACE_BASE, path);
          if (!fullPath.startsWith(WORKSPACE_BASE)) {
            return { success: false, error: new Error("路径安全违规") };
          }
          if (!existsSync(fullPath)) {
            return { success: false, error: new Error(`文件不存在: ${path}`) };
          }

          // 计算原始文件 hash（用于精确去重）
          const rawFileHash = createHash("md5").update(readFileSync(fullPath)).digest("hex");
          (params as any)._fileHash = rawFileHash;

          // 使用 parseDocument 统一解析（支持视觉 OCR + 自动标签提取）
          const parseResult = await parseDocument(fullPath, globalVisionConfig);
          if (parseResult.success) {
            content = parseResult.content;
            // 保存页面图片（用于双视图查看）
            const pageImages = parseResult.pages?.filter((p) => p.imageBase64).map((p) => ({ page: p.page, imageBase64: p.imageBase64! })) || [];
            if (pageImages.length > 0) {
              // docId 还没生成，先暂存，后面 ingest 成功后再保存
              (params as any)._pageImages = pageImages;
            }
            // 暂存 pages（含 blocks + bbox）用于页码感知分块
            if (parseResult.pages && parseResult.pages.length > 0) {
              (params as any)._parsePages = parseResult.pages;
            }
            // 合并自动提取的标签和用户标签（去重）
            if (parseResult.tags && parseResult.tags.length > 0) {
              const userTags = (params.tags as string[]) ?? [];
              const allTags = [...new Set([...userTags, ...parseResult.tags])];
              params.tags = allTags;
            }
          } else {
            // 二进制格式（xlsx/docx/pptx/pdf）解析失败时不回退到纯文本读取（会产生乱码）
            const binaryExts = [".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt", ".pdf"];
            const ext = fullPath.substring(fullPath.lastIndexOf(".")).toLowerCase();
            if (binaryExts.includes(ext)) {
              return { success: false, error: new Error(`文件解析失败: ${parseResult.error}`) };
            }
            // 纯文本格式回退
            try {
              content = readFileSync(fullPath, "utf-8");
            } catch {
              return { success: false, error: new Error(`文件解析失败: ${parseResult.error}`) };
            }
          }

          if (!docName) docName = path.split("/").pop() ?? path;
        }

        if (!content || content.trim().length === 0) {
          return { success: false, error: new Error("文件内容为空") };
        }
        if (!docName) docName = `doc_${Date.now()}`;

        try {
          // 传递 pages（含 blocks + bbox）给 ingest 用于页码感知分块
          const parsePages = (params as any)._parsePages as PageResult[] | undefined;
          const fileHash = (params as any)._fileHash as string | undefined;
          const result = await kb.ingest(docName, content, {
            source: path ?? "direct_input",
            tags: (params.tags as string[]) ?? [],
            chunkSize: (params.chunkSize as number) ?? 500,
            chunkOverlap: (params.chunkOverlap as number) ?? 50,
            shared: params.shared as boolean | undefined,
            pages: parsePages,
            fileHash,
          });

          const action = result.updated ? "更新" : "导入";
          // 保存页面图片
          const pageImages = (params as any)._pageImages as Array<{ page: number; imageBase64: string }> | undefined;
          if (pageImages && pageImages.length > 0 && result.docId) {
            try { saveKBPageImages(owner, result.docId, pageImages); } catch { /* ignore */ }
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
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "kb_search",
      description:
        "在知识库中检索。参数: query(string), limit?(number, 默认5), threshold?(number, 0-1 相对阈值, 结果须达到最高分的该比例, 默认0.4), tags?(string[]), docIds?(string[]), owner?(string, 默认 default), includeShared?(boolean, 是否包含其他用户共享的知识, 默认 true)",
      timeout: 30000,
      handler: async (params) => {
        const query = params.query as string;
        if (!query) return { success: false, error: new Error("query 参数必填") };

        const owner = (params.owner as string) || getCurrentUserId();
        const limit = (params.limit as number) ?? 5;
        const includeShared = (params.includeShared as boolean) ?? true;
        const kb = getKnowledgeBase(owner);

        try {
          // 搜索自己的知识库
          const ownResults = await kb.search(query, {
            limit,
            threshold: (params.threshold as number) ?? 0.4,
            tags: params.tags as string[] | undefined,
            docIds: params.docIds as string[] | undefined,
          });

          let sharedResults: any[] = [];
          if (includeShared) {
            sharedResults = await searchShared(query, owner, Math.ceil(limit / 2));
          }

          // 合并结果，自己的优先
          const combined = [
            ...ownResults.map((r) => ({ ...r, owner })),
            ...sharedResults,
          ]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

          return {
            success: true,
            data: {
              results: combined,
              count: combined.length,
              ownCount: ownResults.length,
              sharedCount: sharedResults.length,
              query,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "kb_list",
      description: "列出知识库中的文档。参数: query?(string), tags?(string[]), owner?(string, 默认 default), sharedOnly?(boolean), limit?(number, 默认100)",
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        const docs = kb.listDocuments({
          query: params.query as string | undefined,
          tags: params.tags as string[] | undefined,
          sharedOnly: params.sharedOnly as boolean | undefined,
          limit: (params.limit as number) ?? 100,
        });

        return { success: true, data: { owner, documents: docs, total: docs.length } };
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "kb_delete",
      description: "从知识库中删除文档。参数: docId(string), owner?(string, 默认 default)",
      handler: async (params) => {
        const docId = params.docId as string;
        if (!docId) return { success: false, error: new Error("docId 参数必填") };

        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        const deleted = kb.deleteDocument(docId);
        return {
          success: deleted,
          data: { deleted, docId, owner },
          error: deleted ? undefined : new Error(`文档不存在: ${docId}`),
        };
      },
    }),
  );

  registry.register(
    defineSkill({
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
        const updated = kb.setShared(docId, shared);
        return {
          success: updated,
          data: { docId, shared, owner },
          error: updated ? undefined : new Error(`文档不存在: ${docId}`),
        };
      },
    }),
  );

  registry.register(
    defineSkill({
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
        for (const tenant of getAllTenants()) {
          const kb = getKnowledgeBase(tenant);
          const docs = kb.listDocuments({ sharedOnly: true });
          allShared.push(...docs.map((d: any) => ({ ...d, owner: tenant })));
        }

        return { success: true, data: { documents: allShared, total: allShared.length } };
      },
    }),
  );

  registry.register(
    defineSkill({
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
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "kb_stats",
      description: "获取知识库统计信息。参数: owner?(string, 默认 default)",
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const kb = getKnowledgeBase(owner);
        return { success: true, data: kb.stats() };
      },
    }),
  );

  registry.register(
    defineSkill({
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
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  console.log("   Knowledge base skills registered (kb_ingest/kb_search/kb_list/kb_delete/kb_share/kb_shared/kb_stats/kb_rebuild)");
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
  for (const kb of kbInstances.values()) {
    kb.setEmbeddingProvider(provider);
  }
}

export function setGlobalKBVisionConfig(config: VisionModelConfig | null): void {
  globalVisionConfig = config;
}
