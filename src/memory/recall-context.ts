/**
 * RecallContextSkill — 元记忆技能
 * 在 Skill 执行前自动从 LTM 检索相关记忆并注入 STM，
 * 避免重复搜索（TTL 缓存），支持最大条目数限制。
 */
import type { ShortTermMemory } from "./stm.js";

export interface LTMSearchable {
  search(query: string, options?: { limit?: number }): Promise<Array<{ key: string; value: unknown; tags: string[] }>>;
}

export interface RecallContextConfig {
  /** 单次 recall 最多注入的 LTM 条目数（默认 5） */
  maxRecallEntries?: number;
  /** 同一上下文键的 recall 结果缓存时长（ms），默认 5 分钟 */
  recallTtlMs?: number;
}

export interface RecallResult {
  memories: Array<{ key: string; value: unknown; tags: string[] }>;
  /** true 表示本次命中了 TTL 缓存，未发起 LTM 搜索 */
  cached: boolean;
}

/** 内部缓存条目 */
interface CacheEntry {
  memories: Array<{ key: string; value: unknown; tags: string[] }>;
  expiresAt: number;
}

const DEFAULT_MAX_RECALL_ENTRIES = 5;
const DEFAULT_RECALL_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class RecallContextSkill {
  private stm: ShortTermMemory;
  private ltm: LTMSearchable;
  private maxRecallEntries: number;
  private recallTtlMs: number;
  /** 按缓存键存储上次 recall 结果，防止在同一 TTL 窗口内重复搜索 */
  private cache = new Map<string, CacheEntry>();

  constructor(stm: ShortTermMemory, ltm: LTMSearchable, config?: RecallContextConfig) {
    this.stm = stm;
    this.ltm = ltm;
    this.maxRecallEntries = config?.maxRecallEntries ?? DEFAULT_MAX_RECALL_ENTRIES;
    this.recallTtlMs = config?.recallTtlMs ?? DEFAULT_RECALL_TTL_MS;
  }

  /**
   * 为指定 skill 检索相关 LTM 记忆并注入 STM。
   * @param skillName  正在执行的 Skill 名称（用于构造搜索查询）
   * @param params     Skill 的调用参数（字符串值会拼入查询）
   */
  async recall(skillName: string, params: Record<string, unknown>): Promise<RecallResult> {
    const cacheKey = this.buildCacheKey(skillName, params);

    // TTL 缓存命中检查
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return { memories: cached.memories, cached: true };
    }

    // 构造 LTM 搜索查询：skillName + 所有字符串参数值
    const query = this.buildQuery(skillName, params);

    // 搜索 LTM
    const raw = await this.ltm.search(query, { limit: this.maxRecallEntries });
    const memories = raw.slice(0, this.maxRecallEntries);

    // 逐条注入 STM（key 格式：recall:<ltm_key>）
    for (const mem of memories) {
      this.stm.set(`recall:${mem.key}`, mem.value, "recall_context");
    }

    // 更新缓存
    this.cache.set(cacheKey, {
      memories,
      expiresAt: Date.now() + this.recallTtlMs,
    });

    return { memories, cached: false };
  }

  // ===== 私有辅助 =====

  private buildCacheKey(skillName: string, params: Record<string, unknown>): string {
    // 只取字符串类型的参数值参与 cache key，保证稳定性
    const paramPart = Object.entries(params)
      .filter(([, v]) => typeof v === "string")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${skillName}:${paramPart}`;
  }

  private buildQuery(skillName: string, params: Record<string, unknown>): string {
    const stringValues = Object.values(params)
      .filter((v) => typeof v === "string")
      .join(" ");
    return stringValues ? `${skillName} ${stringValues}` : skillName;
  }
}
