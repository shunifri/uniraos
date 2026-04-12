/**
 * 数据库配置管理
 * 支持 MySQL 主从、Qdrant、Redis 集群配置
 */

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

function loadMySQLConfig(): MySQLConfig {
  return {
    primary: {
      host: process.env.MYSQL_PRIMARY_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
      user: process.env.MYSQL_USER || 'raos',
      password: process.env.MYSQL_PASSWORD || 'password',
      database: process.env.MYSQL_DATABASE || 'raos',
      connectionLimit: parseInt(process.env.MYSQL_CONN_LIMIT || '20'),
    },
    replicas: (process.env.MYSQL_REPLICA_HOSTS || '').split(',').map((host) => ({
      host: host.trim(),
      port: parseInt(process.env.MYSQL_REPLICA_PORT || '3306'),
      connectionLimit: 30,
    })).filter(r => r.host),
  };
}

function loadQdrantConfig(): QdrantConfig {
  return {
    host: process.env.QDRANT_HOST || 'localhost',
    port: parseInt(process.env.QDRANT_PORT || '6333'),
    grpcPort: parseInt(process.env.QDRANT_GRPC_PORT || '6334'),
    apiKey: process.env.QDRANT_API_KEY,
  };
}

function loadRedisConfig(): RedisConfig {
  return {
    nodes: (process.env.REDIS_HOSTS || 'localhost:6379').split(',').map(h => {
      const [host, port] = h.trim().split(':');
      return { host, port: parseInt(port || '6379') };
    }),
    password: process.env.REDIS_PASSWORD,
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'raos:',
  };
}

export const dbConfig = {
  get mysql() { return loadMySQLConfig(); },
  get qdrant() { return loadQdrantConfig(); },
  get redis() { return loadRedisConfig(); },
};
