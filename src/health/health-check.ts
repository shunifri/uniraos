import { getMySQLAdapter } from '../db/mysql-adapter.js';
import { getRedisClient } from '../cache/redis-client.js';
import { getQdrantClient } from '../vector/qdrant-client.js';
import { getRabbitMQClient } from '../queue/rabbitmq-client.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { log } from '../utils/logger.js';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  version: string;
  timestamp: number;
  uptime: number;
  services: {
    mysql: ServiceHealth;
    redis: ServiceHealth;
    qdrant: ServiceHealth;
    rabbitmq: ServiceHealth;
    neo4j: ServiceHealth;
    minio: ServiceHealth;
  };
}

export interface ServiceHealth {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

let startTime = Date.now();

export async function healthCheck(): Promise<HealthStatus> {
  const checks = await Promise.allSettled([
    checkMySQL(),
    checkRedis(),
    checkQdrant(),
    checkRabbitMQ(),
    checkNeo4j(),
    checkMinIO(),
  ]);

  const mysql = unwrap(checks, 0, 'mysql');
  const redis = unwrap(checks, 1, 'redis');
  const qdrant = unwrap(checks, 2, 'qdrant');
  const rabbitmq = unwrap(checks, 3, 'rabbitmq');
  const neo4j = unwrap(checks, 4, 'neo4j');
  const minio = unwrap(checks, 5, 'minio');

  const allHealthy = [mysql, redis, qdrant, rabbitmq, neo4j, minio].every(s => s.status === 'up');
  const anyDown = [mysql, redis, qdrant, rabbitmq, neo4j, minio].some(s => s.status === 'down');

  return {
    status: allHealthy ? 'healthy' : anyDown ? 'degraded' : 'unhealthy',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: Date.now(),
    uptime: Date.now() - startTime,
    services: { mysql, redis, qdrant, rabbitmq, neo4j, minio },
  };
}

function unwrap(checks: PromiseSettledResult<ServiceHealth>[], index: number, name: string): ServiceHealth {
  const check = checks[index];
  if (check.status === 'fulfilled') return check.value;
  return { status: 'down', error: (check as PromiseRejectedResult).reason?.message || `${name} check failed` };
}

export async function readinessCheck(): Promise<{ ready: boolean; reason?: string }> {
  try {
    const mysql = getMySQLAdapter();
    await mysql.query('SELECT 1');
    
    const redis = getRedisClient();
    await redis.healthCheck();
    
    // P1 修复：readiness 也检查 Qdrant 和 RabbitMQ
    try {
      const qdrant = getQdrantClient();
      await qdrant.healthCheck();
    } catch (err) {
      return { ready: false, reason: `Qdrant not ready: ${(err as Error).message}` };
    }

    try {
      const rabbitmq = getRabbitMQClient();
      if (rabbitmq['state'] !== 'connected') {
        return { ready: false, reason: 'RabbitMQ not connected' };
      }
    } catch {
      // RabbitMQ optional
    }
    
    return { ready: true };
  } catch (error) {
    const reason = (error as Error).message;
    log('error', 'Readiness check failed', { reason });
    return { ready: false, reason };
  }
}

async function checkMySQL(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const mysql = getMySQLAdapter();
    const health = await mysql.healthCheck();
    return { status: health.primary ? 'up' : 'down', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: (error as Error).message };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const redis = getRedisClient();
    const healthy = await redis.healthCheck();
    return { status: healthy ? 'up' : 'down', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: (error as Error).message };
  }
}

async function checkQdrant(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const qdrant = getQdrantClient();
    const healthy = await qdrant.healthCheck();
    return { status: healthy ? 'up' : 'down', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: (error as Error).message };
  }
}

async function checkRabbitMQ(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const rabbitmq = getRabbitMQClient();
    const state = (rabbitmq as any).state;
    return { status: state === 'connected' ? 'up' : 'down', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: (error as Error).message };
  }
}

async function checkNeo4j(): Promise<ServiceHealth> {
  const start = Date.now();
  if (!process.env.NEO4J_URI) {
    return { status: 'up', latencyMs: 0 }; // Not configured, skip
  }
  try {
    const neo4j = await import('neo4j-driver');
    const driver = neo4j.default.driver(
      process.env.NEO4J_URI,
      neo4j.default.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || '')
    );
    await driver.verifyConnectivity();
    await driver.close();
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: (error as Error).message };
  }
}

async function checkMinIO(): Promise<ServiceHealth> {
  const start = Date.now();
  if (!process.env.MINIO_ENDPOINT) {
    return { status: 'up', latencyMs: 0 }; // Not configured, skip
  }
  try {
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const url = `${protocol}://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT || 9000}/minio/health/live`;
    await fetchWithTimeout(url, { timeoutMs: 5_000 });
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: (error as Error).message };
  }
}

export function resetUptime(): void {
  startTime = Date.now();
}
