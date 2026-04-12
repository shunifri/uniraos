/**
 * 长期记忆 (Long-Term Memory) - MySQL 后端实现
 * 支持：持久化、搜索、归档（冷记忆拆分备份）、向量语义搜索
 */
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { cosineSimilarity } from "./embedding-provider.js";
import type {
  LTMBackend,
  LTMStoreOptions,
  LTMSearchOptions,
  LTMListOptions,
  LTMStats,
  LTMArchiveResult,
} from "./ltm-backend.js";
import { getMySQLAdapter, type MySQLAdapter } from "../db/mysql-adapter.js";

export interface LTMEntry {
  id: string;
  key: string;
  value: unknown;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  source?: string;
  summary?: string;
  /** 最后一次被访问的时间（区别于 updatedAt 可能是写入更新） */
  lastAccessedAt: number;
}

export interface LTMConfig {
  storePath: string;
  maxEntries: number;
  /** 归档阈值：活跃记忆超过此数量时触发归档检查 */
  archiveThreshold: number;
  /** 冷记忆判定：超过此天数未访问视为冷记忆 */
  coldDays: number;
  /** 冷记忆判定：访问次数低于此值视为低频 */
  coldAccessCount: number;
  /** 归档后活跃记忆保留数量上限 */
  activeLimit: number;
  /** 定时归档间隔（毫秒），0 或 undefined 表示不启用定时归档 */
  archiveIntervalMs?: number;
  /** 可选的 Embedding Provider，启用后支持语义搜索 */
  embeddingProvider?: EmbeddingProvider;
}

/** 归档文件元信息 */
export interface ArchiveManifest {
  id: string;
  createdAt: number;
  reason: string;
  entryCount: number;
  fileName: string;
  /** 归档中包含的 key 摘要，便于快速判断是否需要回溯 */
  keySummary: string[];
  tagSummary: string[];
}

const DEFAULT_LTM_CONFIG: LTMConfig = {
  storePath: ".raos/ltm",
  maxEntries: 10000,
  archiveThreshold: 200,
  coldDays: 30,
  coldAccessCount: 3,
  activeLimit: 150,
};

/**
 * MySQL 长期记忆后端实现
 */
export class MySQLLTMBackend implements LTMBackend {
  private adapter: MySQLAdapter;
  private config: LTMConfig;
  private owner: string;
  private archiveTimer: ReturnType<typeof setInterval> | null = null;
  private lastScheduledArchiveAt: number = 0;

  constructor(owner: string, config?: Partial<LTMConfig>) {
    this.config = { ...DEFAULT_LTM_CONFIG, ...config };
    this.owner = owner;
    this.adapter = getMySQLAdapter();

    // 如果配置了定时归档，自动启动
    if (this.config.archiveIntervalMs && this.config.archiveIntervalMs > 0) {
      this.startScheduledArchive(this.config.archiveIntervalMs);
    }
  }

  /** 存储记忆 */
  async store(key: string, value: unknown, options?: LTMStoreOptions): Promise<string> {
    const now = Date.now();

    // 检查是否已存在相同 key 的记忆
    const existing = await this.getByKey(key);
    if (existing) {
      // 更新现有记忆
      await this.adapter.execute(
        `UPDATE kb_ltm_entries 
         SET value = ?, updated_at = ?, last_accessed_at = ?, access_count = access_count + 1,
             tags = ?, source = ?, summary = ?
         WHERE id = ? AND owner_id = ?`,
        [
          JSON.stringify(value),
          now,
          now,
          JSON.stringify(options?.tags ?? existing.tags),
          options?.source ?? existing.source ?? '',
          options?.summary ?? existing.summary ?? '',
          existing.id,
          this.owner,
        ]
      );
      return existing.id;
    }

    // 创建新记忆
    const id = `ltm_${Date.now()}_${randomBytes(4).toString("hex")}`;

    // 计算向量（如果有 embedding provider）
    let vector: Buffer | null = null;
    if (this.config.embeddingProvider) {
      try {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        const [vectorArray] = await this.config.embeddingProvider.embed([text]);
        vector = Buffer.from(new Float32Array(vectorArray).buffer);
      } catch (e) {
        console.warn('[MySQLLTMBackend] Failed to generate embedding:', e);
      }
    }

    await this.adapter.execute(
      `INSERT INTO kb_ltm_entries 
       (id, owner_id, entry_key, value, tags, source, summary, created_at, updated_at, last_accessed_at, access_count, vector, is_archived) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        this.owner,
        key,
        JSON.stringify(value),
        JSON.stringify(options?.tags ?? []),
        options?.source ?? '',
        options?.summary ?? '',
        now,
        now,
        now,
        1,
        vector,
      ]
    );

    // 检查是否需要归档
    await this.checkArchive();

    return id;
  }

  /** 按 key 精确查找 */
  async getByKey(key: string): Promise<LTMEntry | undefined> {
    const rows = await this.adapter.query(
      `SELECT * FROM kb_ltm_entries 
       WHERE owner_id = ? AND entry_key = ? AND is_archived = 0
       ORDER BY updated_at DESC LIMIT 1`,
      [this.owner, key]
    );

    if (rows.length === 0) return undefined;

    const row = rows[0];

    // 更新访问时间和次数
    await this.adapter.execute(
      `UPDATE kb_ltm_entries 
       SET access_count = access_count + 1, last_accessed_at = ? 
       WHERE id = ?`,
      [Date.now(), row.id]
    );

    return this.rowToEntry(row);
  }

  /** 按 ID 查找 */
  async getById(id: string): Promise<LTMEntry | undefined> {
    const rows = await this.adapter.query(
      `SELECT * FROM kb_ltm_entries WHERE id = ? AND owner_id = ? AND is_archived = 0`,
      [id, this.owner]
    );

    if (rows.length === 0) return undefined;

    return this.rowToEntry(rows[0]);
  }

  /** 搜索记忆 */
  async search(query: string, options?: LTMSearchOptions): Promise<LTMEntry[]> {
    const limit = options?.limit ?? 10;
    const includeArchive = options?.includeArchive ?? false;

    // 语义搜索
    if (options?.semantic && this.config.embeddingProvider) {
      const queryVector = (await this.config.embeddingProvider.embed([query]))[0];

      // 获取所有符合条件的条目
      let sql = `SELECT * FROM kb_ltm_entries WHERE owner_id = ?`;
      const params: any[] = [this.owner];

      if (!includeArchive) {
        sql += ` AND is_archived = 0`;
      }

      if (options?.tags && options.tags.length > 0) {
        // JSON 包含查询 - 使用 JSON_CONTAINS
        sql += ` AND (${options.tags.map(() => `JSON_CONTAINS(tags, ?)`).join(' OR ')})`;
        params.push(...options.tags.map(t => JSON.stringify(t)));
      }

      const rows = await this.adapter.query(sql, params);

      // 计算相似度并排序
      const scored = rows
        .filter((row: any) => row.vector !== null)
        .map((row: any) => {
          const entryVector = Array.from(new Float32Array(row.vector));
          const score = cosineSimilarity(queryVector, entryVector);
          return { row, score };
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit);

      return scored.map(({ row }: { row: any }) => this.rowToEntry(row));
    }

    // 关键词搜索
    let sql = `SELECT * FROM kb_ltm_entries WHERE owner_id = ?`;
    const params: any[] = [this.owner];

    if (!includeArchive) {
      sql += ` AND is_archived = 0`;
    }

    if (options?.tags && options.tags.length > 0) {
      sql += ` AND (${options.tags.map(() => `JSON_CONTAINS(tags, ?)`).join(' OR ')})`;
      params.push(...options.tags.map(t => JSON.stringify(t)));
    }

    sql += ` AND (entry_key LIKE ? OR value LIKE ? OR summary LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);

    sql += ` ORDER BY last_accessed_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.adapter.query(sql, params);
    return rows.map((row: any) => this.rowToEntry(row));
  }

  /** 删除记忆 */
  async delete(id: string): Promise<boolean> {
    const result = await this.adapter.execute(
      `DELETE FROM kb_ltm_entries WHERE id = ? AND owner_id = ?`,
      [id, this.owner]
    );
    return result.affectedRows > 0;
  }

  /** 按 key 删除 */
  async deleteByKey(key: string): Promise<boolean> {
    const result = await this.adapter.execute(
      `DELETE FROM kb_ltm_entries WHERE entry_key = ? AND owner_id = ?`,
      [key, this.owner]
    );
    return result.affectedRows > 0;
  }

  /** 列出所有活跃记忆 */
  async list(options?: LTMListOptions): Promise<LTMEntry[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = await this.adapter.query(
      `SELECT * FROM kb_ltm_entries 
       WHERE owner_id = ? AND is_archived = 0
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [this.owner, limit, offset]
    );

    return rows.map((row: any) => this.rowToEntry(row));
  }

  /** 获取统计 */
  async stats(): Promise<LTMStats> {
    const [activeResult, archivedResult, tagsResult] = await Promise.all([
      this.adapter.query(
        `SELECT COUNT(*) as count FROM kb_ltm_entries WHERE owner_id = ? AND is_archived = 0`,
        [this.owner]
      ),
      this.adapter.query(
        `SELECT COUNT(*) as count FROM kb_ltm_entries WHERE owner_id = ? AND is_archived = 1`,
        [this.owner]
      ),
      this.adapter.query(
        `SELECT tags FROM kb_ltm_entries WHERE owner_id = ?`,
        [this.owner]
      ),
    ]);

    const active = (activeResult[0]?.count as number) || 0;
    const archived = (archivedResult[0]?.count as number) || 0;
    const total = active + archived;

    // 统计标签
    const tagCounts: Record<string, number> = {};
    for (const row of tagsResult as any[]) {
      const tags = JSON.parse(row.tags || '[]');
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    return {
      total: active,
      archived,
      archives: 0, // MySQL 版本不单独存储归档清单
      tags: tagCounts,
      scheduledArchive: {
        running: this.isScheduledArchiveRunning(),
        lastRunAt: this.lastScheduledArchiveAt,
      },
      vectorIndex: {
        indexed: 0, // MySQL 版本中向量存储在表中
        total: active,
        provider: this.config.embeddingProvider ? 'embedding' : null,
      },
    };
  }

  get size(): number {
    // 注意：这是一个同步 getter，但实际需要异步查询
    // 调用者应该使用 stats() 获取准确的数量
    return 0;
  }

  // ===== 归档系统 =====

  /** 手动触发归档 */
  async archive(reason?: string): Promise<LTMArchiveResult> {
    const config = this.config;
    const now = Date.now();

    // 找出冷记忆（超过冷判定天数且访问次数低）
    const coldThreshold = now - config.coldDays * 24 * 60 * 60 * 1000;

    const rows = await this.adapter.query(
      `SELECT * FROM kb_ltm_entries 
       WHERE owner_id = ? AND is_archived = 0
       AND last_accessed_at < ? AND access_count <= ?
       ORDER BY last_accessed_at ASC`,
      [this.owner, coldThreshold, config.coldAccessCount]
    );

    const coldEntries = rows as any[];

    if (coldEntries.length === 0) {
      return { archived: 0, manifest: null };
    }

    // 归档这些条目
    const ids = coldEntries.map((e: any) => e.id);
    const placeholders = ids.map(() => '?').join(',');

    await this.adapter.execute(
      `UPDATE kb_ltm_entries SET is_archived = 1 WHERE id IN (${placeholders})`,
      ids
    );

    // 生成归档清单
    const manifest: ArchiveManifest = {
      id: `archive_${Date.now()}`,
      createdAt: now,
      reason: reason || 'cold_memory',
      entryCount: coldEntries.length,
      fileName: '', // MySQL 版本不使用文件
      keySummary: coldEntries.map((e: any) => e.entry_key).slice(0, 100),
      tagSummary: [...new Set(coldEntries.flatMap((e: any) => JSON.parse(e.tags || '[]')))],
    };

    return { archived: coldEntries.length, manifest };
  }

  /** 获取所有归档清单 */
  async getArchiveManifests(): Promise<ArchiveManifest[]> {
    // MySQL 版本返回空数组（归档信息存储在表中的 is_archived 字段）
    return [];
  }

  /** 从归档中恢复 */
  async restoreFromArchive(_archiveId: string, keys?: string[]): Promise<number> {
    if (keys && keys.length > 0) {
      // 恢复指定键
      const placeholders = keys.map(() => '?').join(',');
      const result = await this.adapter.execute(
        `UPDATE kb_ltm_entries SET is_archived = 0 
         WHERE owner_id = ? AND entry_key IN (${placeholders})`,
        [this.owner, ...keys]
      );
      return result.affectedRows || 0;
    }

    // 恢复所有归档
    const result = await this.adapter.execute(
      `UPDATE kb_ltm_entries SET is_archived = 0 WHERE owner_id = ? AND is_archived = 1`,
      [this.owner]
    );
    return result.affectedRows || 0;
  }

  // ===== 定时归档调度 =====

  /** 启动定时归档 */
  startScheduledArchive(intervalMs: number): void {
    this.stopScheduledArchive();
    this.archiveTimer = setInterval(() => {
      this.runScheduledArchive().catch(console.error);
    }, intervalMs);
    // 不阻止进程退出
    if (this.archiveTimer && typeof this.archiveTimer === "object" && "unref" in this.archiveTimer) {
      this.archiveTimer.unref();
    }
  }

  /** 停止定时归档 */
  stopScheduledArchive(): void {
    if (this.archiveTimer) {
      clearInterval(this.archiveTimer);
      this.archiveTimer = null;
    }
  }

  /** 定时归档是否运行中 */
  isScheduledArchiveRunning(): boolean {
    return this.archiveTimer !== null;
  }

  /** 上次定时归档时间 */
  getLastScheduledArchiveAt(): number {
    return this.lastScheduledArchiveAt;
  }

  /** 销毁实例 */
  destroy(): void {
    this.stopScheduledArchive();
  }

  // ===== 可选的高级能力 =====

  /** 设置 Embedding Provider */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.config.embeddingProvider = provider;
  }

  /** 构建向量索引（MySQL 版本：为所有缺少向量的条目生成向量） */
  async buildVectorIndex(): Promise<{ indexed: number; failed: number }> {
    if (!this.config.embeddingProvider) return { indexed: 0, failed: 0 };

    // 获取所有没有向量的条目
    const rows = await this.adapter.query(
      `SELECT id, entry_key, value, summary, tags FROM kb_ltm_entries 
       WHERE owner_id = ? AND vector IS NULL AND is_archived = 0`,
      [this.owner]
    );

    if (rows.length === 0) return { indexed: 0, failed: 0 };

    let indexed = 0;
    let failed = 0;

    // 分批处理
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = (rows as any[]).slice(i, i + batchSize);
      const texts = batch.map((row: any) => this.entryToText(row));

      try {
        const embeddings = await this.config.embeddingProvider.embed(texts);
        for (let j = 0; j < batch.length; j++) {
          const vector = Buffer.from(new Float32Array(embeddings[j]).buffer);
          await this.adapter.execute(
            `UPDATE kb_ltm_entries SET vector = ? WHERE id = ?`,
            [vector, batch[j].id]
          );
          indexed++;
        }
      } catch {
        failed += batch.length;
      }
    }

    return { indexed, failed };
  }

  // ===== 私有方法 =====

  private rowToEntry(row: any): LTMEntry {
    return {
      id: row.id,
      key: row.entry_key,
      value: JSON.parse(row.value),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      source: row.source,
      summary: row.summary,
    };
  }

  private entryToText(row: any): string {
    const parts = [row.entry_key];
    if (row.summary) parts.push(row.summary);
    const tags = JSON.parse(row.tags || '[]');
    if (tags.length > 0) parts.push(tags.join(" "));
    const valueStr = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
    parts.push(valueStr.substring(0, 1000));
    return parts.join(" ");
  }

  private async checkArchive(): Promise<void> {
    // 检查活跃记忆数量是否超过阈值
    const result = await this.adapter.query(
      `SELECT COUNT(*) as count FROM kb_ltm_entries WHERE owner_id = ? AND is_archived = 0`,
      [this.owner]
    );

    const count = (result[0] as any)?.count || 0;

    if (count >= this.config.archiveThreshold) {
      await this.archive("auto:threshold_exceeded");
    }
  }

  private async runScheduledArchive(): Promise<{ archived: number; manifest: ArchiveManifest | null }> {
    this.lastScheduledArchiveAt = Date.now();
    return this.archive("scheduled");
  }
}

/**
 * 文件存储长期记忆后端（保留以向后兼容）
 * @deprecated 请使用 MySQLLTMBackend
 */
export class FileLTMBackend implements LTMBackend {
  private entries = new Map<string, LTMEntry>();
  private config: LTMConfig;
  private indexPath: string;
  private archiveDir: string;
  private manifestPath: string;
  private manifests: ArchiveManifest[] = [];
  private archiveTimer: ReturnType<typeof setInterval> | null = null;
  private lastScheduledArchiveAt: number = 0;
  /** 向量索引：entryId -> embedding */
  private vectors = new Map<string, number[]>();
  private vectorIndexPath: string;

  constructor(config?: Partial<LTMConfig>) {
    this.config = { ...DEFAULT_LTM_CONFIG, ...config };
    
    if (!existsSync(this.config.storePath)) {
      mkdirSync(this.config.storePath, { recursive: true });
    }
    this.indexPath = join(this.config.storePath, "index.json");
    this.archiveDir = join(this.config.storePath, "archives");
    this.manifestPath = join(this.config.storePath, "archive-manifest.json");
    this.vectorIndexPath = join(this.config.storePath, "vectors.json");
    if (!existsSync(this.archiveDir)) {
      mkdirSync(this.archiveDir, { recursive: true });
    }
    this.load();
    this.loadManifests();
    this.loadVectors();

    // 如果配置了定时归档，自动启动
    if (this.config.archiveIntervalMs && this.config.archiveIntervalMs > 0) {
      this.startScheduledArchive(this.config.archiveIntervalMs);
    }
  }

  /** 存储记忆 */
  async store(key: string, value: unknown, options?: LTMStoreOptions): Promise<string> {
    const existing = this.findByKey(key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = Date.now();
      existing.lastAccessedAt = Date.now();
      existing.accessCount++;
      if (options?.tags) existing.tags = options.tags;
      if (options?.source) existing.source = options.source;
      if (options?.summary) existing.summary = options.summary;
      this.save();
      return existing.id;
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const entry: LTMEntry = {
      id,
      key,
      value,
      tags: options?.tags ?? [],
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      source: options?.source,
      summary: options?.summary,
    };
    this.entries.set(id, entry);
    this.save();

    // 异步生成 embedding（不阻塞存储）
    this.embedEntry(entry).catch(() => {});

    // 检查是否需要归档
    this.checkArchive();

    return id;
  }

  /** 为单个记忆生成向量 embedding */
  private async embedEntry(entry: LTMEntry): Promise<void> {
    if (!this.config.embeddingProvider) return;
    try {
      const text = this.entryToTextForEmbed(entry);
      const [vector] = await this.config.embeddingProvider.embed([text]);
      this.vectors.set(entry.id, vector);
      this.saveVectors();
    } catch {
      // embedding 失败不影响核心功能
    }
  }

  /** 将记忆条目转为可向量化的文本 */
  private entryToTextForEmbed(entry: LTMEntry): string {
    const parts = [entry.key];
    if (entry.summary) parts.push(entry.summary);
    if (entry.tags.length > 0) parts.push(entry.tags.join(" "));
    const valueStr = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
    parts.push(valueStr.substring(0, 1000));
    return parts.join(" ");
  }

  /** 为所有缺少 embedding 的记忆生成向量（批量） */
  async buildVectorIndex(): Promise<{ indexed: number; failed: number }> {
    if (!this.config.embeddingProvider) return { indexed: 0, failed: 0 };

    const toEmbed: LTMEntry[] = [];
    for (const entry of this.entries.values()) {
      if (!this.vectors.has(entry.id)) {
        toEmbed.push(entry);
      }
    }

    if (toEmbed.length === 0) return { indexed: 0, failed: 0 };

    let indexed = 0;
    let failed = 0;

    // 分批处理（每批最多 50 条）
    const batchSize = 50;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const texts = batch.map((e) => this.entryToTextForEmbed(e));

      try {
        const embeddings = await this.config.embeddingProvider.embed(texts);
        for (let j = 0; j < batch.length; j++) {
          this.vectors.set(batch[j].id, embeddings[j]);
          indexed++;
        }
      } catch {
        failed += batch.length;
      }
    }

    this.saveVectors();
    return { indexed, failed };
  }

  /** 设置或更换 Embedding Provider */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.config.embeddingProvider = provider;
  }

  /** 按 key 精确查找 */
  async getByKey(key: string): Promise<LTMEntry | undefined> {
    const entry = this.findByKey(key);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessedAt = Date.now();
    }
    return entry;
  }

  /** 按 ID 查找 */
  async getById(id: string): Promise<LTMEntry | undefined> {
    return this.entries.get(id);
  }

  /** 搜索（先搜活跃区，可选搜归档，支持语义搜索） */
  async search(query: string, options?: LTMSearchOptions): Promise<LTMEntry[]> {
    const useSemantic = options?.semantic !== false && this.config.embeddingProvider && this.vectors.size > 0;
    const results = useSemantic
      ? this.searchHybrid(query, options)
      : this.searchActive(query, options);

    // 活跃区结果不够且允许搜归档时，搜索归档
    const limit = options?.limit ?? 10;
    if (options?.includeArchive && results.length < limit) {
      const archiveResults = this.searchArchives(query, limit - results.length);
      results.push(...archiveResults);
    }

    return results;
  }

  /** 混合搜索：关键词 + 语义向量（需要 embedding provider） */
  private searchHybrid(query: string, options?: { tags?: string[]; limit?: number }): LTMEntry[] {
    const limit = options?.limit ?? 10;
    const requiredTags = options?.tags ?? [];

    // 1. 关键词评分
    const keywordScores = new Map<string, number>();
    const q = query.toLowerCase();

    for (const entry of this.entries.values()) {
      if (requiredTags.length > 0) {
        const hasAllTags = requiredTags.every((t) => entry.tags.includes(t));
        if (!hasAllTags) continue;
      }

      let score = 0;
      if (entry.key.toLowerCase().includes(q)) score += 10;
      const valueStr = JSON.stringify(entry.value).toLowerCase();
      if (valueStr.includes(q)) score += 5;
      if (entry.summary?.toLowerCase().includes(q)) score += 8;
      for (const tag of entry.tags) {
        if (tag.toLowerCase().includes(q)) score += 3;
      }
      score += Math.min(entry.accessCount * 0.1, 2);

      keywordScores.set(entry.id, score);
    }

    // 2. 语义评分（同步使用已缓存的向量）
    const semanticScores = new Map<string, number>();

    // 查找关键词最匹配的条目作为查询锚点
    const topKeywordEntry = [...keywordScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .find(([id]) => this.vectors.has(id));

    if (topKeywordEntry) {
      const anchorVector = this.vectors.get(topKeywordEntry[0])!;
      for (const [id, vector] of this.vectors) {
        if (keywordScores.has(id) || requiredTags.length === 0) {
          const similarity = cosineSimilarity(anchorVector, vector);
          semanticScores.set(id, similarity * 15); // 语义最高权重 15
        }
      }
    }

    // 3. 混合评分
    const candidates = new Set([...keywordScores.keys(), ...semanticScores.keys()]);
    const scored: { entry: LTMEntry; score: number }[] = [];

    for (const id of candidates) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      const kwScore = keywordScores.get(id) ?? 0;
      const semScore = semanticScores.get(id) ?? 0;
      const hybridScore = kwScore * 0.6 + semScore * 0.4;

      if (hybridScore > 0) {
        scored.push({ entry, score: hybridScore });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => {
        s.entry.accessCount++;
        s.entry.lastAccessedAt = Date.now();
        return s.entry;
      });
  }

  /** 删除记忆 */
  async delete(id: string): Promise<boolean> {
    const result = this.entries.delete(id);
    if (result) this.save();
    return result;
  }

  /** 按 key 删除 */
  async deleteByKey(key: string): Promise<boolean> {
    const entry = this.findByKey(key);
    if (entry) {
      this.entries.delete(entry.id);
      this.save();
      return true;
    }
    return false;
  }

  /** 列出所有活跃记忆 */
  async list(options?: LTMListOptions): Promise<LTMEntry[]> {
    const all = [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return all.slice(offset, offset + limit);
  }

  /** 获取统计 */
  async stats(): Promise<LTMStats> {
    const tags: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      for (const tag of entry.tags) {
        tags[tag] = (tags[tag] ?? 0) + 1;
      }
    }
    const archivedCount = this.manifests.reduce((sum, m) => sum + m.entryCount, 0);
    return {
      total: this.entries.size,
      archived: archivedCount,
      archives: this.manifests.length,
      tags,
      scheduledArchive: {
        running: this.isScheduledArchiveRunning(),
        lastRunAt: this.lastScheduledArchiveAt,
      },
      vectorIndex: {
        indexed: this.vectors.size,
        total: this.entries.size,
        provider: this.config.embeddingProvider?.name ?? null,
      },
    };
  }

  get size(): number {
    return this.entries.size;
  }

  // ===== 归档系统 =====

  /**
   * 手动触发归档：将冷记忆归档到独立文件
   */
  async archive(reason?: string): Promise<LTMArchiveResult> {
    const coldEntries = this.identifyColdEntries();
    if (coldEntries.length === 0) {
      return { archived: 0, manifest: null };
    }

    const manifest = this.archiveEntries(coldEntries, reason ?? "manual");
    return { archived: coldEntries.length, manifest };
  }

  // ===== 定时归档调度 =====

  /** 启动定时归档 */
  startScheduledArchive(intervalMs: number): void {
    this.stopScheduledArchive();
    this.archiveTimer = setInterval(() => {
      this.runScheduledArchive();
    }, intervalMs);
    // 不阻止进程退出
    if (this.archiveTimer && typeof this.archiveTimer === "object" && "unref" in this.archiveTimer) {
      this.archiveTimer.unref();
    }
  }

  /** 停止定时归档 */
  stopScheduledArchive(): void {
    if (this.archiveTimer) {
      clearInterval(this.archiveTimer);
      this.archiveTimer = null;
    }
  }

  /** 定时归档是否运行中 */
  isScheduledArchiveRunning(): boolean {
    return this.archiveTimer !== null;
  }

  /** 上次定时归档的时间戳（0 表示从未执行） */
  getLastScheduledArchiveAt(): number {
    return this.lastScheduledArchiveAt;
  }

  /** 执行一次定时归档 */
  private runScheduledArchive(): { archived: number; manifest: ArchiveManifest | null } {
    this.lastScheduledArchiveAt = Date.now();
    const cold = this.identifyColdEntries();
    if (cold.length === 0) {
      return { archived: 0, manifest: null };
    }
    const manifest = this.archiveEntries(cold, "scheduled");
    return { archived: cold.length, manifest };
  }

  /** 销毁实例（停止定时器） */
  destroy(): void {
    this.stopScheduledArchive();
  }

  /** 获取所有归档清单 */
  async getArchiveManifests(): Promise<ArchiveManifest[]> {
    return [...this.manifests];
  }

  /** 从归档中恢复特定记忆回到活跃区 */
  async restoreFromArchive(archiveId: string, keys?: string[]): Promise<number> {
    const manifest = this.manifests.find((m) => m.id === archiveId);
    if (!manifest) return 0;

    const archivePath = join(this.archiveDir, manifest.fileName);
    if (!existsSync(archivePath)) return 0;

    try {
      const raw = readFileSync(archivePath, "utf-8");
      const entries = JSON.parse(raw) as LTMEntry[];
      let restored = 0;

      for (const entry of entries) {
        // 如果指定了 keys，只恢复指定的
        if (keys && keys.length > 0 && !keys.includes(entry.key)) continue;
        // 不覆盖活跃区中已有的同 key 条目
        if (this.findByKey(entry.key)) continue;

        entry.lastAccessedAt = Date.now();
        this.entries.set(entry.id, entry);
        restored++;
      }

      if (restored > 0) this.save();
      return restored;
    } catch {
      return 0;
    }
  }

  /** 搜索归档（通过 manifest 快速判断 + 按需加载归档文件） */
  private searchArchives(query: string, limit: number): LTMEntry[] {
    const q = query.toLowerCase();
    const results: LTMEntry[] = [];

    for (const manifest of this.manifests) {
      // 快速判断：该归档的 key/tag 摘要中是否可能包含匹配项
      const mayMatch =
        manifest.keySummary.some((k) => k.toLowerCase().includes(q)) ||
        manifest.tagSummary.some((t) => t.toLowerCase().includes(q));
      if (!mayMatch) continue;

      // 加载归档文件搜索
      const archivePath = join(this.archiveDir, manifest.fileName);
      if (!existsSync(archivePath)) continue;

      try {
        const raw = readFileSync(archivePath, "utf-8");
        const entries = JSON.parse(raw) as LTMEntry[];
        for (const entry of entries) {
          if (results.length >= limit) break;
          const keyMatch = entry.key.toLowerCase().includes(q);
          const valMatch = JSON.stringify(entry.value).toLowerCase().includes(q);
          const sumMatch = entry.summary?.toLowerCase().includes(q);
          if (keyMatch || valMatch || sumMatch) {
            results.push(entry);
          }
        }
      } catch {
        continue;
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  /** 识别冷记忆 */
  private identifyColdEntries(): LTMEntry[] {
    const now = Date.now();
    const coldThresholdMs = this.config.coldDays * 24 * 60 * 60 * 1000;

    const scored: { entry: LTMEntry; coldScore: number }[] = [];

    for (const entry of this.entries.values()) {
      const daysSinceAccess = (now - entry.lastAccessedAt) / (24 * 60 * 60 * 1000);
      const isOld = (now - entry.lastAccessedAt) > coldThresholdMs;
      const isLowFreq = entry.accessCount <= this.config.coldAccessCount;

      if (isOld || isLowFreq) {
        // 冷度评分：越久没访问 + 访问次数越少 = 越冷
        const coldScore = daysSinceAccess * 10 + (1 / (entry.accessCount + 1)) * 100;
        scored.push({ entry, coldScore });
      }
    }

    // 按冷度排序，取需要归档的数量
    scored.sort((a, b) => b.coldScore - a.coldScore);

    // 至少保留 activeLimit 条活跃记忆
    const toArchiveCount = Math.max(0, this.entries.size - this.config.activeLimit);
    return scored.slice(0, toArchiveCount).map((s) => s.entry);
  }

  /** 执行归档 */
  private archiveEntries(entries: LTMEntry[], reason: string): ArchiveManifest {
    const id = crypto.randomUUID().slice(0, 8);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `archive-${timestamp}-${id}.json`;
    const archivePath = join(this.archiveDir, fileName);

    // 写归档文件
    writeFileSync(archivePath, JSON.stringify(entries, null, 2), "utf-8");

    // 从活跃区删除
    for (const entry of entries) {
      this.entries.delete(entry.id);
    }
    this.save();

    // 更新 manifest
    const manifest: ArchiveManifest = {
      id,
      createdAt: Date.now(),
      reason,
      entryCount: entries.length,
      fileName,
      keySummary: entries.map((e) => e.key),
      tagSummary: [...new Set(entries.flatMap((e) => e.tags))],
    };
    this.manifests.push(manifest);
    this.saveManifests();

    return manifest;
  }

  /** 自动检查是否需要归档 */
  private checkArchive(): void {
    if (this.entries.size >= this.config.archiveThreshold) {
      const cold = this.identifyColdEntries();
      if (cold.length > 0) {
        this.archiveEntries(cold, "auto:threshold_exceeded");
      }
    }
  }

  // ===== 活跃区搜索 =====

  private searchActive(query: string, options?: { tags?: string[]; limit?: number }): LTMEntry[] {
    const q = query.toLowerCase();
    const limit = options?.limit ?? 10;
    const requiredTags = options?.tags ?? [];

    const scored: { entry: LTMEntry; score: number }[] = [];

    for (const entry of this.entries.values()) {
      let score = 0;

      if (requiredTags.length > 0) {
        const hasAllTags = requiredTags.every((t) => entry.tags.includes(t));
        if (!hasAllTags) continue;
      }

      if (entry.key.toLowerCase().includes(q)) score += 10;

      const valueStr = JSON.stringify(entry.value).toLowerCase();
      if (valueStr.includes(q)) score += 5;

      if (entry.summary?.toLowerCase().includes(q)) score += 8;

      for (const tag of entry.tags) {
        if (tag.toLowerCase().includes(q)) score += 3;
      }

      score += Math.min(entry.accessCount * 0.1, 2);

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => {
        s.entry.accessCount++;
        s.entry.lastAccessedAt = Date.now();
        return s.entry;
      });
  }

  // ===== 持久化 =====

  private findByKey(key: string): LTMEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.key === key) return entry;
    }
    return undefined;
  }

  private load(): void {
    try {
      if (existsSync(this.indexPath)) {
        const raw = readFileSync(this.indexPath, "utf-8");
        const entries = JSON.parse(raw) as LTMEntry[];
        for (const entry of entries) {
          // 兼容旧数据：补充 lastAccessedAt
          if (!entry.lastAccessedAt) {
            entry.lastAccessedAt = entry.updatedAt;
          }
          this.entries.set(entry.id, entry);
        }
      }
    } catch {
      // 文件损坏则从空开始
    }
  }

  private save(): void {
    try {
      const data = [...this.entries.values()];
      writeFileSync(this.indexPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save LTM:", err);
    }
  }

  private loadManifests(): void {
    try {
      if (existsSync(this.manifestPath)) {
        const raw = readFileSync(this.manifestPath, "utf-8");
        this.manifests = JSON.parse(raw) as ArchiveManifest[];
      }
    } catch {
      this.manifests = [];
    }
  }

  private saveManifests(): void {
    try {
      writeFileSync(this.manifestPath, JSON.stringify(this.manifests, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save archive manifests:", err);
    }
  }

  private loadVectors(): void {
    try {
      if (existsSync(this.vectorIndexPath)) {
        const raw = readFileSync(this.vectorIndexPath, "utf-8");
        const data = JSON.parse(raw) as Array<{ id: string; vector: number[] }>;
        for (const item of data) {
          // 只加载仍然存在的条目的向量
          if (this.entries.has(item.id)) {
            this.vectors.set(item.id, item.vector);
          }
        }
      }
    } catch {
      // 向量索引损坏不影响核心功能
    }
  }

  private saveVectors(): void {
    try {
      const data = [...this.vectors.entries()].map(([id, vector]) => ({ id, vector }));
      writeFileSync(this.vectorIndexPath, JSON.stringify(data), "utf-8");
    } catch {
      // 向量保存失败不影响核心功能
    }
  }
}

/** 向后兼容别名 - 现在使用 MySQL 实现 */
export const LongTermMemory = MySQLLTMBackend;
export type LongTermMemory = MySQLLTMBackend;
