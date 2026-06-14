/**
 * 短期记忆 (Short-Term Memory)
 * 会话级键值存储，支持 LRU 淘汰
 */

export interface STMEntry {
  key: string;
  value: unknown;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  source?: string; // 写入来源 Skill
}

export interface STMConfig {
  maxEntries: number;  // 最大条目数
  ttlMs: number;       // 过期时间（ms），0 = 永不过期
}

const DEFAULT_STM_CONFIG: STMConfig = {
  maxEntries: 100,
  ttlMs: 0,
};

export class ShortTermMemory {
  private store = new Map<string, STMEntry>();
  private config: STMConfig;

  constructor(config?: Partial<STMConfig>) {
    this.config = { ...DEFAULT_STM_CONFIG, ...config };
  }

  /** 存储 */
  set(key: string, value: unknown, source?: string): void {
    // LRU 淘汰
    if (this.store.size >= this.config.maxEntries && !this.store.has(key)) {
      this.evict();
    }

    const existing = this.store.get(key);
    if (existing) {
      existing.value = value;
      existing.accessedAt = Date.now();
      existing.accessCount++;
      existing.source = source;
    } else {
      this.store.set(key, {
        key,
        value,
        createdAt: Date.now(),
        accessedAt: Date.now(),
        accessCount: 1,
        source,
      });
    }
  }

  /** 检索 */
  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // TTL 检查
    if (this.config.ttlMs > 0 && Date.now() - entry.accessedAt > this.config.ttlMs) {
      this.store.delete(key);
      return undefined;
    }

    entry.accessedAt = Date.now();
    entry.accessCount++;
    return entry.value;
  }

  /** 删除 */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** 搜索（简单关键词匹配） */
  search(query: string): STMEntry[] {
    const q = query.toLowerCase();
    const results: STMEntry[] = [];
    for (const entry of this.store.values()) {
      const keyMatch = entry.key.toLowerCase().includes(q);
      const valueStr = JSON.stringify(entry.value).toLowerCase();
      const valueMatch = valueStr.includes(q);
      if (keyMatch || valueMatch) {
        entry.accessedAt = Date.now();
        results.push(entry);
      }
    }
    return results;
  }

  /** 列出所有条目 */
  list(): STMEntry[] {
    return [...this.store.values()];
  }

  /** 条目数 */
  get size(): number {
    return this.store.size;
  }

  /** 清空 */
  clear(): void {
    this.store.clear();
  }

  /** LRU 淘汰：移除最久未访问的条目 */
  private evict(): void {
    let oldest: STMEntry | null = null;
    for (const entry of this.store.values()) {
      if (!oldest || entry.accessedAt < oldest.accessedAt) {
        oldest = entry;
      }
    }
    if (oldest) {
      this.store.delete(oldest.key);
    }
  }
}
