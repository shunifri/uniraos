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
  private generateKey(sql: string, params: any[]): string {
    const hash = createHash('md5')
      .update(sql)
      .update(JSON.stringify(params))
      .digest('hex');
    return `query:${hash}`;
  }

  /**
   * Get cached query results
   */
  async get<T>(sql: string, params: any[]): Promise<T[] | null> {
    if (!this.config.enabled) return null;

    const key = this.generateKey(sql, params);
    const cached = await this.redis.get<{ data: T[]; timestamp: number }>(key);

    if (cached) {
      log('Query cache hit', { key: key.slice(0, 20) });
      return cached.data;
    }

    return null;
  }

  /**
   * Set query results in cache
   */
  async set<T>(sql: string, params: any[], data: T[]): Promise<void> {
    if (!this.config.enabled) return;
    if (data.length > this.config.maxResults) {
      log('Query result too large for cache', { 
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

    log('Query cached', { key: key.slice(0, 20), rows: data.length });
  }

  /**
   * Execute query with caching
   */
  async getOrSet<T>(
    sql: string,
    params: any[],
    fetchFn: () => Promise<T[]>
  ): Promise<T[]> {
    // Try cache first
    const cached = await this.get<T>(sql, params);
    if (cached) return cached;

    // Fetch from database
    const data = await fetchFn();

    // Cache the results
    await this.set(sql, params, data);

    return data;
  }

  /**
   * Invalidate cache entries by table name
   */
  async invalidateTable(tableName: string): Promise<void> {
    // Note: This is a simplified implementation
    // In production, you might want to track which queries touch which tables
    log('Cache invalidation requested', { table: tableName });
  }

  /**
   * Clear all query caches
   */
  async clear(): Promise<void> {
    const client = this.redis.getClient();
    const keys = await client.keys('query:*');
    if (keys.length > 0) {
      await client.del(...keys);
      log('Query cache cleared', { keys: keys.length });
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
