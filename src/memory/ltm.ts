/**
 * 长期记忆 (Long-Term Memory) - 文件后端实现
 * 支持：持久化、搜索、归档（冷记忆拆分备份）、向量语义搜索
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
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
      const text = this.entryToText(entry);
      const [vector] = await this.config.embeddingProvider.embed([text]);
      this.vectors.set(entry.id, vector);
      this.saveVectors();
    } catch {
      // embedding 失败不影响核心功能
    }
  }

  /** 将记忆条目转为可向量化的文本 */
  private entryToText(entry: LTMEntry): string {
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
      const texts = batch.map((e) => this.entryToText(e));

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

/** 向后兼容别名 */
export const LongTermMemory = FileLTMBackend;
export type LongTermMemory = FileLTMBackend;
