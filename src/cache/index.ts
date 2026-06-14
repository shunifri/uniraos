/**
 * Cache module exports
 * Provides Redis client and session store for distributed caching
 */

export {
  RedisClient,
  type RedisClientType,
  getRedisClient,
  resetRedisClient,
} from './redis-client.js';

export {
  RedisSessionStore,
  type SessionData,
  type SessionCreateData,
  getSessionStore,
  resetSessionStore,
} from './session-store.js';
