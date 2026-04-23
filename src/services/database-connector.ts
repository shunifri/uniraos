import { getDb } from '../db/database.js';

export interface DBConnectionConfig {
  id?: string;
  name: string;
  type: 'mysql' | 'postgresql' | 'sqlite' | 'mssql' | 'mongodb';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  charset?: string;
  options?: Record<string, any>;
}

// 连接池（简单实现：每个 connectionId 维护一个连接）
const connectionPools = new Map<string, any>();

/** 仅用于测试：清空连接池 */
export function clearConnectionPool(): void {
  connectionPools.clear();
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${context} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

// 获取数据库连接
export async function getConnection(connectionId: string): Promise<any> {
  // 1. 如果连接池中有，返回已有连接
  if (connectionPools.has(connectionId)) {
    return connectionPools.get(connectionId);
  }

  // 2. 从 connections 表读取配置
  const mainDb = getDb();
  const row = mainDb.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as any;
  if (!row) {
    throw new Error(`Connection "${connectionId}" not found`);
  }

  // 3. 解析 db_config
  const dbConfig: DBConnectionConfig =
    typeof row.db_config === 'string' ? JSON.parse(row.db_config) : row.db_config;

  if (!dbConfig) {
    throw new Error(`Connection "${connectionId}" has no database config`);
  }

  // 4. 根据类型创建连接
  let connection: any;
  switch (dbConfig.type) {
    case 'mysql':
      connection = await createMySQLConnection(dbConfig);
      break;
    case 'postgresql':
      connection = await createPostgreSQLConnection(dbConfig);
      break;
    case 'sqlite':
      connection = createSQLiteConnection(dbConfig);
      break;
    default:
      throw new Error(`Unsupported database type: ${dbConfig.type}`);
  }

  // 5. 存入连接池
  connectionPools.set(connectionId, connection);
  return connection;
}

// MySQL 连接
async function createMySQLConnection(config: DBConnectionConfig): Promise<any> {
  try {
    const mysql = await import(String('mysql2/promise'));
    const conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl,
      charset: config.charset || 'utf8mb4',
      connectTimeout: 5000,
    });
    return conn;
  } catch (error) {
    throw new Error(
      `Failed to connect to MySQL: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// PostgreSQL 连接
async function createPostgreSQLConnection(config: DBConnectionConfig): Promise<any> {
  try {
    const pg = await import(String('pg'));
    const { Client } = pg;
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    return client;
  } catch (error) {
    throw new Error(
      `Failed to connect to PostgreSQL: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// SQLite 连接
function createSQLiteConnection(config: DBConnectionConfig): any {
  try {
    // better-sqlite3 是 C++ 扩展，已被项目依赖，使用 require
    const Database = require('better-sqlite3');
    return new Database(config.database);
  } catch (error) {
    throw new Error(
      `Failed to connect to SQLite: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// 执行参数化查询
export async function executeQuery(
  connectionId: string,
  query: string,
  params: any[] = [],
  timeout = 5000
): Promise<any[]> {
  const connection = await getConnection(connectionId);

  // 获取连接类型
  const mainDb = getDb();
  const row = mainDb.prepare('SELECT db_config FROM connections WHERE id = ?').get(connectionId) as any;
  const dbConfig: DBConnectionConfig =
    typeof row.db_config === 'string' ? JSON.parse(row.db_config) : row.db_config;

  switch (dbConfig.type) {
    case 'mysql': {
      const mysqlResult = (await withTimeout(connection.execute(query, params), timeout, 'MySQL query')) as [any, any];
      const [rows] = mysqlResult;
      return Array.isArray(rows) ? rows : [];
    }

    case 'postgresql': {
      const pgResult = (await withTimeout(connection.query(query, params), timeout, 'PostgreSQL query')) as { rows: any[] };
      return pgResult.rows || [];
    }

    case 'sqlite': {
      const stmt = connection.prepare(query);
      return Promise.resolve(stmt.all(...params));
    }

    default:
      throw new Error(`Query execution not supported for type: ${dbConfig.type}`);
  }
}

// 关闭连接
export async function closeConnection(connectionId: string): Promise<void> {
  const connection = connectionPools.get(connectionId);
  if (!connection) return;

  const mainDb = getDb();
  const row = mainDb.prepare('SELECT db_config FROM connections WHERE id = ?').get(connectionId) as any;
  const dbConfig: DBConnectionConfig =
    typeof row.db_config === 'string' ? JSON.parse(row.db_config) : row.db_config;

  try {
    switch (dbConfig?.type) {
      case 'mysql':
        await connection.end();
        break;
      case 'postgresql':
        await connection.end();
        break;
      case 'sqlite':
        connection.close();
        break;
    }
  } catch (error) {
    console.error(`Error closing connection ${connectionId}:`, error);
  }

  connectionPools.delete(connectionId);
}

// 测试连接
export async function testConnection(
  connectionId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const connection = await getConnection(connectionId);

    // 执行测试查询
    const mainDb = getDb();
    const row = mainDb.prepare('SELECT test_query FROM connections WHERE id = ?').get(connectionId) as any;
    const testQuery = row?.test_query || 'SELECT 1';

    await executeQuery(connectionId, testQuery);

    return { success: true, message: 'Connection successful' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 测试内联连接配置
export async function testConnectionConfig(
  config: DBConnectionConfig
): Promise<{ success: boolean; message: string }> {
  try {
    switch (config.type) {
      case 'mysql': {
        const mysql = await import(String('mysql2/promise'));
        const connection = await mysql.createConnection({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.username,
          password: config.password,
          ssl: config.ssl,
          connectTimeout: 5000,
        });
        await connection.execute('SELECT 1');
        await connection.end();
        break;
      }
      case 'postgresql': {
        const pg = await import(String('pg'));
        const { Client } = pg;
        const client = new Client({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.username,
          password: config.password,
          ssl: config.ssl,
          connectionTimeoutMillis: 5000,
        });
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        break;
      }
      case 'sqlite': {
        const Database = require('better-sqlite3');
        const sqliteDb = new Database(config.database);
        sqliteDb.prepare('SELECT 1').get();
        sqliteDb.close();
        break;
      }
      default:
        return { success: false, message: `Unsupported type: ${config.type}` };
    }
    return { success: true, message: 'Connection successful' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}
