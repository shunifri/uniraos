/**
 * Enhanced LTM Backend - 门面类
 * 整合所有增强模块，实现完整的 LTMBackend 接口
 * 自动处理版本链、智能遗忘、搜索增强、用户画像、事实提取、矛盾检测
 */
import { join } from "path";
import type {
  LTMBackend,
  LTMStoreOptions,
  LTMSearchOptions,
  LTMListOptions,
  LTMStats,
  LTMArchiveResult,
} from "../ltm-backend.js";
import { FileLTMBackend, type LTMEntry, type LTMConfig } from "../ltm.js";
import type { EmbeddingProvider } from "../embedding-provider.js";
import type { LLMProvider } from "../../llm/types.js";
import { VersionChain, type EnhancedLTMEntry } from "./version-chain.js";
import { ForgettingManager } from "./forgetting-manager.js";
import { SearchEnhancer, type FilterExpression } from "./search-enhancer.js";
import { ProfileGenerator } from "./profile-generator.js";
import { FactExtractor } from "./fact-extractor.js";
import { ConflictDetector } from "./conflict-detector.js";
import { DataMigrator } from "./data-migrator.js";

export interface EnhancedLTMConfig extends LTMConfig {
  profileRefreshIntervalMs?: number;
  profileStaleThreshold?: number;
  rerankTopN?: number;
  defaultExpiresInSec?: number;
  factExtractionMinConfidence?: number;
}

export class EnhancedLTMBackend implements LTMBackend {
  private fileBackend: FileLTMBackend;
  private versionChain: VersionChain;
  private forgettingManager: ForgettingManager;
  private searchEnhancer: SearchEnhancer;
  private profileGenerator: ProfileGenerator;
  private factExtractor: FactExtractor;
  private conflictDetector: ConflictDetector;
  private dataMigrator: DataMigrator;
  private config: EnhancedLTMConfig;
  private llmProvider?: LLMProvider;

  constructor(config?: Partial<EnhancedLTMConfig>, llmProvider?: LLMProvider) {
    const fullConfig: EnhancedLTMConfig = {
      storePath: ".raos/ltm",
      maxEntries: 10000,
      archiveThreshold: 200,
      coldDays: 30,
      coldAccessCount: 3,
      activeLimit: 150,
      profileRefreshIntervalMs: 3600000,
      profileStaleThreshold: 10,
      rerankTopN: 20,
      defaultExpiresInSec: 0,
      factExtractionMinConfidence: 0.5,
      ...config,
    };

    this.config = fullConfig;
    this.llmProvider = llmProvider;

    // 初始化文件后端
    this.fileBackend = new FileLTMBackend(fullConfig);

    // 初始化各个模块
    this.versionChain = new VersionChain();
    this.forgettingManager = new ForgettingManager();
    this.searchEnhancer = new SearchEnhancer();
    this.profileGenerator = new ProfileGenerator({
      cachePath: join(fullConfig.storePath, "profile-cache.json"),
      cacheTTL: fullConfig.profileRefreshIntervalMs,
      entryThreshold: fullConfig.profileStaleThreshold,
    });
    this.factExtractor = new FactExtractor();
    this.conflictDetector = new ConflictDetector();
    this.dataMigrator = new DataMigrator();

    // 自动执行数据迁移
    if (this.dataMigrator.needsMigration(fullConfig.storePath)) {
      const result = this.dataMigrator.migrate(fullConfig.storePath);
      if (result.migrated > 0) {
        console.log(`LTM数据已迁移: ${result.migrated} 条记忆, 备份路径: ${result.backupPath}`);
      }
    }
  }

  // ===== 核心 CRUD =====

  async store(
    key: string,
    value: unknown,
    options?: LTMStoreOptions & { relation?: string; expiresInSec?: number }
  ): Promise<string> {
    // 获取所有当前条目
    const allEntries = (await this.fileBackend.list({ limit: 1000000 })) as EnhancedLTMEntry[];

    // 创建版本字段
    const versionInfo = this.versionChain.createVersion(
      key,
      value,
      allEntries,
      options?.relation as any,
    );

    // 标记旧版本
    if (versionInfo.deprecatedId) {
      const oldEntry = allEntries.find((e) => e.id === versionInfo.deprecatedId);
      if (oldEntry) {
        oldEntry.isLatest = false;
      }
    }

    // 存储到文件后端
    const id = await this.fileBackend.store(key, value, {
      tags: options?.tags,
      source: options?.source,
      summary: options?.summary,
    });

    // 添加版本字段
    const entry = (await this.fileBackend.getById(id)) as EnhancedLTMEntry;
    if (entry) {
      Object.assign(entry, versionInfo.fields);
      if (options?.expiresInSec && options.expiresInSec > 0) {
        entry.expiresAt = Date.now() + options.expiresInSec * 1000;
      }
    }

    // 过期检查
    const allAfterStore = (await this.fileBackend.list({ limit: 1000000 })) as EnhancedLTMEntry[];
    this.forgettingManager.checkExpired(allAfterStore);

    return id;
  }

  async getByKey(key: string): Promise<LTMEntry | undefined> {
    return this.fileBackend.getByKey(key);
  }

  async getById(id: string): Promise<LTMEntry | undefined> {
    return this.fileBackend.getById(id);
  }

  async search(
    query: string,
    options?: LTMSearchOptions & {
      rerank?: boolean;
      filters?: FilterExpression;
      includeForgotten?: boolean;
    }
  ): Promise<LTMEntry[]> {
    // 基础搜索
    let results = await this.fileBackend.search(query, options);

    // 过期检查
    const allEntries = (await this.fileBackend.list({ limit: 1000000 })) as EnhancedLTMEntry[];
    this.forgettingManager.checkExpired(allEntries);

    // 过滤遗忘
    results = this.forgettingManager.filterForgotten(results as EnhancedLTMEntry[], options?.includeForgotten) as LTMEntry[];

    // 过滤非最新版本
    results = results.filter((r) => !(r as EnhancedLTMEntry).version || (r as EnhancedLTMEntry).isLatest !== false);

    // 元数据过滤
    if (options?.filters) {
      results = this.searchEnhancer.applyMetadataFilters(results as EnhancedLTMEntry[], options.filters) as LTMEntry[];
    }

    // 重排序
    if (options?.rerank && this.llmProvider) {
      results = await this.searchEnhancer.rerank(query, results as EnhancedLTMEntry[], this.llmProvider) as LTMEntry[];
    }

    return results;
  }

  async delete(id: string): Promise<boolean> {
    return this.fileBackend.delete(id);
  }

  async deleteByKey(key: string): Promise<boolean> {
    return this.fileBackend.deleteByKey(key);
  }

  async list(options?: LTMListOptions): Promise<LTMEntry[]> {
    return this.fileBackend.list(options);
  }

  async stats(): Promise<LTMStats> {
    const baseStats = await this.fileBackend.stats();
    const allEntries = (await this.fileBackend.list({ limit: 1000000 })) as EnhancedLTMEntry[];

    const versionCount = new Set(allEntries.map((e) => e.rootId)).size;
    const forgottenCount = allEntries.filter((e) => e.forgotten).length;

    return {
      ...baseStats,
      tags: {
        ...baseStats.tags,
        _version_chains: versionCount,
        _forgotten: forgottenCount,
      },
    };
  }

  get size(): number {
    return this.fileBackend.size;
  }

  // ===== 归档系统 =====

  async archive(reason?: string): Promise<LTMArchiveResult> {
    return this.fileBackend.archive(reason);
  }

  async getArchiveManifests() {
    return this.fileBackend.getArchiveManifests();
  }

  async restoreFromArchive(archiveId: string, keys?: string[]): Promise<number> {
    return this.fileBackend.restoreFromArchive(archiveId, keys);
  }

  startScheduledArchive(intervalMs: number): void {
    this.fileBackend.startScheduledArchive(intervalMs);
  }

  stopScheduledArchive(): void {
    this.fileBackend.stopScheduledArchive();
  }

  isScheduledArchiveRunning(): boolean {
    return this.fileBackend.isScheduledArchiveRunning();
  }

  getLastScheduledArchiveAt(): number {
    return this.fileBackend.getLastScheduledArchiveAt();
  }

  destroy(): void {
    this.fileBackend.destroy();
  }

  // ===== 可选能力 =====

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.fileBackend.setEmbeddingProvider(provider);
  }

  async buildVectorIndex(): Promise<{ indexed: number; failed: number }> {
    return this.fileBackend.buildVectorIndex?.() ?? { indexed: 0, failed: 0 };
  }

  // ===== 增强能力 =====

  /** 获取用户画像 */
  async getProfile(userId: string): Promise<{ static: string[]; dynamic: string[] }> {
    const entries = await this.fileBackend.list({ limit: 1000000 });
    return this.profileGenerator.generate(entries as EnhancedLTMEntry[], this.llmProvider, userId);
  }

  /** 带原因的遗忘 */
  async forgetWithReason(id: string, reason: string): Promise<boolean> {
    const entry = await this.fileBackend.getById(id);
    if (!entry) return false;
    const allEntries = (await this.fileBackend.list({ limit: 1000000 })) as EnhancedLTMEntry[];
    this.forgettingManager.forget(id, allEntries, reason);
    return true;
  }

  /** 从文本提取事实 */
  async extractFacts(text: string, entityContext?: string) {
    return this.factExtractor.extract(text, this.llmProvider, entityContext);
  }

  /** 检测矛盾 */
  async checkConflicts(key: string, newValue: unknown) {
    return this.conflictDetector.detectForKey(key, newValue, this.fileBackend, this.llmProvider);
  }
}
