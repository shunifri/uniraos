/**
 * 数据库配置管理
 * 支持 MySQL 主从、Qdrant、Redis 集群配置
 * P2 修复：支持 Docker Secrets (_FILE 后缀环境变量)
 */

import { readFileSync } from "fs";

function getSecret(key: string): string | undefined {
  const fileKey = `${key}_FILE`;
  if (process.env[fileKey]) {
    try {
      return readFileSync(process.env[fileKey]!, 'utf8').trim();
    } catch {
      // fall through to env var
    }
  }
  return process.env[key];
}

export interface MySQLPoolOptions {
  connectionLimit: number;
  acquireTimeout: number;
  connectTimeout: number;
  queueLimit: number;
  keepAliveInitialDelay: number;
}

export interface MySQLConfig {
  primary: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
  };
  replicas: Array<{
    host: string;
    port: number;
    connectionLimit: number;
  }>;
  ssl?: boolean | Record<string, unknown>;
  poolOptions: MySQLPoolOptions;
}

export interface SQLiteConfig {
  cacheSize: number;
  busyTimeout: number;
  journalMode: string;
  synchronous: string;
}

export interface QdrantConfig {
  host: string;
  port: number;
  grpcPort: number;
  apiKey?: string;
  https?: boolean;
}

export interface RedisConfig {
  nodes: Array<{ host: string; port: number }>;
  password?: string;
  keyPrefix: string;
}

function parseMySQLSSL(value: string | undefined): boolean | Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  try {
    return JSON.parse(value);
  } catch {
    return true;
  }
}

function loadMySQLConfig(): MySQLConfig {
  return {
    primary: {
      host: getSecret('MYSQL_PRIMARY_HOST') || 'localhost',
      port: parseInt(getSecret('MYSQL_PRIMARY_PORT') || '3306'),
      user: getSecret('MYSQL_USER') || 'raos',
      password: getSecret('MYSQL_PASSWORD') || 'password',
      database: getSecret('MYSQL_DATABASE') || 'raos',
      connectionLimit: parseInt(getSecret('MYSQL_CONN_LIMIT') || '20'),
    },
    replicas: (getSecret('MYSQL_REPLICA_HOSTS') || '').split(',').map((host) => ({
      host: host.trim(),
      port: parseInt(getSecret('MYSQL_REPLICA_PORT') || '3306'),
      connectionLimit: parseInt(getSecret('MYSQL_REPLICA_CONN_LIMIT') || '30'),
    })).filter(r => r.host),
    ssl: parseMySQLSSL(getSecret('MYSQL_SSL')),
    poolOptions: {
      connectionLimit: parseInt(getSecret('MYSQL_CONN_LIMIT') || '20'),
      acquireTimeout: parseInt(getSecret('MYSQL_ACQUIRE_TIMEOUT') || '60000'),
      connectTimeout: parseInt(getSecret('MYSQL_CONNECT_TIMEOUT') || '10000'),
      queueLimit: parseInt(getSecret('MYSQL_QUEUE_LIMIT') || '0'),
      keepAliveInitialDelay: parseInt(getSecret('MYSQL_KEEP_ALIVE_DELAY') || '10000'),
    },
  };
}

function loadSQLiteConfig(): SQLiteConfig {
  return {
    cacheSize: parseInt(getSecret('SQLITE_CACHE_SIZE') || '-64000'),
    busyTimeout: parseInt(getSecret('SQLITE_BUSY_TIMEOUT') || '5000'),
    journalMode: getSecret('SQLITE_JOURNAL_MODE') || 'WAL',
    synchronous: getSecret('SQLITE_SYNCHRONOUS') || 'NORMAL',
  };
}

function loadQdrantConfig(): QdrantConfig {
  return {
    host: getSecret('QDRANT_HOST') || 'localhost',
    port: parseInt(getSecret('QDRANT_PORT') || '6333'),
    grpcPort: parseInt(getSecret('QDRANT_GRPC_PORT') || '6334'),
    apiKey: getSecret('QDRANT_API_KEY'),
  };
}

function loadRedisConfig(): RedisConfig {
  return {
    nodes: (getSecret('REDIS_HOSTS') || 'localhost:6379').split(',').map(h => {
      const [host, port] = h.trim().split(':');
      return { host, port: parseInt(port || '6379') };
    }),
    password: getSecret('REDIS_PASSWORD'),
    keyPrefix: getSecret('REDIS_KEY_PREFIX') || 'raos:',
  };
}

export const dbConfig = {
  get mysql() { return loadMySQLConfig(); },
  get sqlite() { return loadSQLiteConfig(); },
  get qdrant() { return loadQdrantConfig(); },
  get redis() { return loadRedisConfig(); },
};
