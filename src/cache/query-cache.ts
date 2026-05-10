import { createHash } from 'crypto';
import { getRedisClient } from './redis-client.js';
import { log } from '../utils/logger.js';

export interface QueryCacheConfig {
  ttlSeconds: number;
  maxResults: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: QueryCacheConfig = {
  ttlSeconds: 60,
  maxResults: 1000,
  enabled: true,
};

export class QueryCache {
  private redis = getRedisClient();
  private config: QueryCacheConfig;

  constructor(config: Partial<QueryCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate cache key from SQL and params
   */
  private generateKey(sql: string, params: unknown[]): string {
    const hash = createHash('md5')
      .update(sql)
      .update(JSON.stringify(params))
      .digest('hex');
    return `query:${hash}`;
  }

  /**
   * Get cached query results
   */
  async get<T>(sql: string, params: unknown[]): Promise<T[] | null> {
    if (!this.config.enabled) return null;

    const key = this.generateKey(sql, params);
    const cached = await this.redis.get<{ data: T[]; timestamp: number }>(key);

    if (cached) {
      log('info', 'Query cache hit', { key: key.slice(0, 20) });
      return cached.data;
    }

    return null;
  }

  /**
   * Set query results in cache
   */
  async set<T>(sql: string, params: unknown[], data: T[]): Promise<void> {
    if (!this.config.enabled) return;
    if (data.length > this.config.maxResults) {
      log('warn', 'Query result too large for cache', { 
        size: data.length, 
        max: this.config.maxResults 
      });
      return;
    }

    const key = this.generateKey(sql, params);
    await this.redis.set(
      key,
      { data, timestamp: Date.now() },
      this.config.ttlSeconds
    );

    log('info', 'Query cached', { key: key.slice(0, 20), rows: data.length });
  }

  /**
   * P2 修复：缓存击穿/穿透防护
   * - 击穿：热点 key 过期时用分布式锁保证只有一个请求查库
   * - 穿透：空结果也缓存（标记 __EMPTY__，TTL 30s）
   */
  async getOrSet<T>(
    sql: string,
    params: unknown[],
    fetchFn: () => Promise<T[]>,
    emptyTtlSeconds: number = 30
  ): Promise<T[]> {
    const key = this.generateKey(sql, params);

    // 1. Try cache first
    const cached = await this.redis.get<{ data: T[]; empty?: boolean }>(key);
    if (cached) {
      if (cached.empty) return [];
      log('info', 'Query cache hit', { key: key.slice(0, 20) });
      return cached.data;
    }

    // 2. Cache miss — try distributed lock to prevent stampede
    const lockKey = `${key}:lock`;
    const lockToken = `${Date.now()}-${Math.random()}`;
    const lockTtl = 10; // seconds
    const rawRedis = this.redis.getClient();

    const acquired = await rawRedis.set(
      this.redis.getPrefixedKey(lockKey),
      lockToken,
      'EX',
      lockTtl,
      'NX'
    );

    if (acquired === 'OK') {
      try {
        // Double-check after acquiring lock
        const doubleCheck = await this.redis.get<{ data: T[]; empty?: boolean }>(key);
        if (doubleCheck) {
          if (doubleCheck.empty) return [];
          return doubleCheck.data;
        }

        // Fetch from database
        const data = await fetchFn();

        if (data.length === 0) {
          // Cache empty result to prevent penetration
          await this.redis.set(key, { data: [], empty: true }, emptyTtlSeconds);
        } else {
          await this.set(sql, params, data);
        }

        return data;
      } finally {
        // Release lock (best-effort delete only if token matches)
        const current = await rawRedis.get(this.redis.getPrefixedKey(lockKey));
        if (current === lockToken) {
          await rawRedis.del(this.redis.getPrefixedKey(lockKey));
        }
      }
    }

    // 3. Another instance is fetching — wait and retry
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 100));
      const retry = await this.redis.get<{ data: T[]; empty?: boolean }>(key);
      if (retry) {
        if (retry.empty) return [];
        return retry.data;
      }
    }

    // Fallback: fetch directly (lock may have timed out)
    log('warn', 'Cache lock timeout, fetching directly', { key: key.slice(0, 20) });
    return fetchFn();
  }

  /**
   * Invalidate cache entries by table name
   */
  async invalidateTable(tableName: string): Promise<void> {
    // Note: This is a simplified implementation
    // In production, you might want to track which queries touch which tables
    log('info', 'Cache invalidation requested', { table: tableName });
  }

  /**
   * Clear all query caches
   */
  async clear(): Promise<void> {
    const client = this.redis.getClient();
    const keys = await client.keys('query:*');
    if (keys.length > 0) {
      await client.del(...keys);
      log('info', 'Query cache cleared', { keys: keys.length });
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ keys: number; hitRate: number }> {
    const client = this.redis.getClient();
    const keys = await client.keys('query:*');
    return {
      keys: keys.length,
      hitRate: 0, // Would need to track hits/misses
    };
  }
}

let instance: QueryCache | null = null;

export function getQueryCache(): QueryCache {
  if (!instance) {
    instance = new QueryCache();
  }
  return instance;
}

export function configureQueryCache(config: Partial<QueryCacheConfig>): void {
  instance = new QueryCache(config);
}
