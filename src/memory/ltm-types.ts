import type { EmbeddingProvider } from "./embedding-provider.js";

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

export interface LTMStoreOptions {
  tags?: string[];
  source?: string;
  summary?: string;
}

export interface LTMSearchOptions {
  tags?: string[];
  limit?: number;
  includeArchive?: boolean;
  semantic?: boolean;
}

export interface LTMListOptions {
  limit?: number;
  offset?: number;
}

export interface LTMStats {
  total: number;
  archived: number;
  archives: number;
  tags: Record<string, number>;
  scheduledArchive: { running: boolean; lastRunAt: number };
  vectorIndex: { indexed: number; total: number; provider: string | null };
}

export interface LTMArchiveResult {
  archived: number;
  manifest: ArchiveManifest | null;
}

/**
 * LTM 后端接口 - 所有方法返回 Promise<T>，为网络后端预留
 */
export interface LTMBackend {
  /** 存储记忆 */
  store(key: string, value: unknown, options?: LTMStoreOptions): Promise<string>;

  /** 按 key 精确查找 */
  getByKey(key: string): Promise<LTMEntry | undefined>;

  /** 按 ID 查找 */
  getById(id: string): Promise<LTMEntry | undefined>;

  /** 搜索记忆 */
  search(query: string, options?: LTMSearchOptions): Promise<LTMEntry[]>;

  /** 删除记忆 */
  delete(id: string): Promise<boolean>;

  /** 按 key 删除 */
  deleteByKey(key: string): Promise<boolean>;

  /** 列出所有活跃记忆 */
  list(options?: LTMListOptions): Promise<LTMEntry[]>;

  /** 获取统计 */
  stats(): Promise<LTMStats>;

  /** 当前活跃记忆数量 */
  readonly size: number;

  // ===== 归档系统 =====

  /** 手动触发归档 */
  archive(reason?: string): Promise<LTMArchiveResult>;

  /** 获取所有归档清单 */
  getArchiveManifests(): Promise<ArchiveManifest[]>;

  /** 从归档中恢复 */
  restoreFromArchive(archiveId: string, keys?: string[]): Promise<number>;

  /** 启动定时归档 */
  startScheduledArchive(intervalMs: number): void;

  /** 停止定时归档 */
  stopScheduledArchive(): void;

  /** 定时归档是否运行中 */
  isScheduledArchiveRunning(): boolean;

  /** 上次定时归档时间 */
  getLastScheduledArchiveAt(): number;

  /** 销毁实例 */
  destroy(): void;

  // ===== 可选的高级能力 =====

  /** 设置 Embedding Provider */
  setEmbeddingProvider?(provider: EmbeddingProvider): void;

  /** 构建向量索引 */
  buildVectorIndex?(): Promise<{ indexed: number; failed: number }>;
}
