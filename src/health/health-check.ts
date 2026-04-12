import { getMySQLAdapter } from '../db/mysql-adapter.js';
import { getRedisClient } from '../cache/redis-client.js';
import { log } from '../utils/logger.js';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  version: string;
  timestamp: number;
  uptime: number;
  services: {
    mysql: ServiceHealth;
    redis: ServiceHealth;
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
  ]);

  const mysql = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'down' as const, error: (checks[0] as PromiseRejectedResult).reason?.message };
  const redis = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'down' as const, error: (checks[1] as PromiseRejectedResult).reason?.message };

  const allHealthy = mysql.status === 'up' && redis.status === 'up';
  const anyDegraded = mysql.status === 'down' || redis.status === 'down';

  return {
    status: allHealthy ? 'healthy' : anyDegraded ? 'degraded' : 'unhealthy',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: Date.now(),
    uptime: Date.now() - startTime,
    services: { mysql, redis },
  };
}

export async function readinessCheck(): Promise<{ ready: boolean; reason?: string }> {
  try {
    const mysql = getMySQLAdapter();
    await mysql.query('SELECT 1');
    
    const redis = getRedisClient();
    await redis.healthCheck();
    
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
    return {
      status: health.primary ? 'up' : 'down',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const redis = getRedisClient();
    const healthy = await redis.healthCheck();
    return {
      status: healthy ? 'up' : 'down',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

export function resetUptime(): void {
  startTime = Date.now();
}
