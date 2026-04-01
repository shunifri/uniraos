/**
 * LTM 后端抽象接口
 * 所有长期记忆后端（文件、Supermemory 等）都实现此接口
 */
import type { LTMEntry, LTMConfig, ArchiveManifest } from "./ltm.js";

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
  setEmbeddingProvider?(provider: import("./embedding-provider.js").EmbeddingProvider): void;

  /** 构建向量索引 */
  buildVectorIndex?(): Promise<{ indexed: number; failed: number }>;
}
