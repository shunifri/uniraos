/**
 * Redis client wrapper
 * Supports both Cluster and Standalone modes
 */

import { Redis, Cluster, RedisOptions } from 'ioredis';
import { dbConfig } from '../config/db-config.js';
import { log } from '../utils/logger.js';

export type RedisClientType = Redis | Cluster;

export class RedisClient {
  private client: RedisClientType;
  private isCluster: boolean;
  private keyPrefix: string;

  constructor() {
    this.keyPrefix = dbConfig.redis.keyPrefix;
    const nodes = dbConfig.redis.nodes;
    const password = dbConfig.redis.password;

    // Determine if we should use cluster mode (multiple nodes)
    this.isCluster = nodes.length > 1;

    if (this.isCluster) {
      log('info', 'redis_client_initializing_cluster', { nodes: nodes.length });
      this.client = new Cluster(nodes, {
        redisOptions: {
          password,
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
        },
        slotsRefreshTimeout: 2000,
        slotsRefreshInterval: 5000,
      });
    } else {
      log('info', 'redis_client_initializing_standalone', { host: nodes[0].host, port: nodes[0].port });
      const options: RedisOptions = {
        host: nodes[0].host,
        port: nodes[0].port,
        password,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        maxRetriesPerRequest: 3,
      };
      this.client = new Redis(options);
    }

    // Setup event handlers
    this.client.on('connect', () => {
      log('info', 'redis_client_connected');
    });

    this.client.on('error', (err: Error) => {
      log('error', 'redis_client_error', { error: (err as Error).message });
    });

    this.client.on('ready', () => {
      log('info', 'redis_client_ready');
    });
  }

  /**
   * Get the full key with prefix
   */
  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Expose prefixed key for external lock usage
   */
  getPrefixedKey(key: string): string {
    return this.getKey(key);
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const fullKey = this.getKey(key);
      const value = await this.client.get(fullKey);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      log('error', 'redis_get_error', { key, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const fullKey = this.getKey(key);
      const serializedValue = JSON.stringify(value);
      
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await this.client.setex(fullKey, ttlSeconds, serializedValue);
      } else {
        await this.client.set(fullKey, serializedValue);
      }
    } catch (error) {
      log('error', 'redis_set_error', { key, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<void> {
    try {
      const fullKey = this.getKey(key);
      await this.client.del(fullKey);
    } catch (error) {
      log('error', 'redis_delete_error', { key, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Delete multiple keys from cache
   */
  async deleteMany(keys: string[]): Promise<void> {
    try {
      if (keys.length === 0) return;
      const fullKeys = keys.map(k => this.getKey(k));
      await this.client.del(...fullKeys);
    } catch (error) {
      log('error', 'redis_delete_many_error', { keys: keys.length, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Increment a counter
   */
  async increment(key: string, amount: number = 1): Promise<number> {
    try {
      const fullKey = this.getKey(key);
      const result = await this.client.incrby(fullKey, amount);
      return result;
    } catch (error) {
      log('error', 'redis_increment_error', { key, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Set expiration on a key
   */
  async expire(key: string, seconds: number): Promise<void> {
    try {
      const fullKey = this.getKey(key);
      await this.client.expire(fullKey, seconds);
    } catch (error) {
      log('error', 'redis_expire_error', { key, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get TTL of a key
   */
  async ttl(key: string): Promise<number> {
    try {
      const fullKey = this.getKey(key);
      return await this.client.ttl(fullKey);
    } catch (error) {
      log('error', 'redis_ttl_error', { key, error: (error as Error).message });
      return -1;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const fullKey = this.getKey(key);
      const result = await this.client.exists(fullKey);
      return result === 1;
    } catch (error) {
      log('error', 'redis_exists_error', { key, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      log('error', 'redis_health_check_error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get all keys matching a pattern (use with caution in production)
   */
  async keys(pattern: string): Promise<string[]> {
    try {
      const fullPattern = this.getKey(pattern);
      const keys = await this.client.keys(fullPattern);
      // Remove prefix from results
      return keys.map((k: string) => k.startsWith(this.keyPrefix) ? k.slice(this.keyPrefix.length) : k);
    } catch (error) {
      log('error', 'redis_keys_error', { pattern, error: (error as Error).message });
      return [];
    }
  }

  /**
   * Flush all keys with the configured prefix (use with caution)
   */
  async flushPrefix(): Promise<void> {
    try {
      const keys = await this.keys('*');
      if (keys.length > 0) {
        await this.deleteMany(keys);
        log('info', 'redis_flush_prefix', { keysDeleted: keys.length });
      }
    } catch (error) {
      log('error', 'redis_flush_prefix_error', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    log('info', 'redis_client_closing');
    await this.client.quit();
  }

  /**
   * Access the raw Redis client
   */
  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Check if using cluster mode
   */
  isClusterMode(): boolean {
    return this.isCluster;
  }
}

// Singleton instance
let redisClientInstance: RedisClient | null = null;

/**
 * Get the singleton Redis client instance
 */
export function getRedisClient(): RedisClient {
  if (!redisClientInstance) {
    redisClientInstance = new RedisClient();
  }
  return redisClientInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetRedisClient(): void {
  redisClientInstance = null;
}
