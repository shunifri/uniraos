/**
 * MySQL Adapter with Read-Write Splitting
 * Supports connection pooling for primary (write) and replicas (read)
 */

import * as mysql from 'mysql2/promise';
import { dbConfig } from '../config/db-config.js';
import { log } from '../utils/logger.js';

export interface QueryResult<T = unknown> {
  rows: T[];
  fields: mysql.FieldPacket[];
}

export class MySQLAdapter {
  private primaryPool: mysql.Pool;
  private replicaPools: mysql.Pool[];
  private replicaIndex = 0;
  private readonly RETRYABLE_ERRORS = ['ECONNREFUSED', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST'];
  private readonly RETRY_DELAYS = [100, 500, 2000];
  private readonly MAX_RETRIES = 3;

  constructor() {
    const config = dbConfig.mysql;
    const sslConfig = config.ssl === true ? {} : config.ssl || undefined;
    const poolOpts = config.poolOptions;
    const basePoolConfig = {
      waitForConnections: true,
      queueLimit: poolOpts.queueLimit,
      enableKeepAlive: true,
      keepAliveInitialDelay: poolOpts.keepAliveInitialDelay,
      // mysql2 v3 警告: 'Ignoring invalid configuration option passed to Connection: acquireTimeout'
      // mysql2 v3 移除了 acquireTimeout, 改用 enableKeepAlive + 客户端 connectTimeout 控制
      // (server-side wait_timeout 默认 8h, 跟 v2 行为接近; 客户端 connectTimeout 在下面保留)
      connectTimeout: poolOpts.connectTimeout,
      ...(sslConfig ? { ssl: sslConfig as mysql.SslOptions } : {}),
    };

    // Primary pool for writes
    this.primaryPool = mysql.createPool({
      host: config.primary.host,
      port: config.primary.port,
      user: config.primary.user,
      password: config.primary.password,
      database: config.primary.database,
      connectionLimit: config.primary.connectionLimit,
      ...basePoolConfig,
    });

    log('info', 'mysql_adapter_primary_pool_created', {
      host: config.primary.host,
      port: config.primary.port,
      database: config.primary.database,
    });

    // Replica pools for reads
    this.replicaPools = config.replicas.map((replica, index) => {
      log('info', 'mysql_adapter_replica_pool_created', {
        index,
        host: replica.host,
        port: replica.port,
      });
      return mysql.createPool({
        host: replica.host,
        port: replica.port,
        user: config.primary.user,
        password: config.primary.password,
        database: config.primary.database,
        connectionLimit: replica.connectionLimit,
        ...basePoolConfig,
      });
    });

    if (this.replicaPools.length === 0) {
      log('warn', 'mysql_adapter_no_replicas_configured', {
        message: 'No replicas configured, all queries will be routed to primary',
      });
    }
  }

  /**
   * Retry an operation with exponential backoff on transient connection errors.
   */
  private async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const err = error as { code?: string };
        if (attempt < this.MAX_RETRIES && this.RETRYABLE_ERRORS.includes(err.code || '')) {
          log('warn', `mysql_adapter_${context}_retry`, {
            attempt: attempt + 1,
            maxRetries: this.MAX_RETRIES,
            delayMs: this.RETRY_DELAYS[attempt],
            error: err.code,
          });
          await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAYS[attempt]));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE) on the primary
   * Returns ResultSetHeader with affectedRows, insertId, etc.
   */
  async execute<T = unknown>(
    sql: string,
    params?: any[]
  ): Promise<mysql.ResultSetHeader> {
    log('debug', 'mysql_adapter_execute', {
      sql: sql.substring(0, 100),
      params: params?.length,
    });

    try {
      const [result] = await this.withRetry(
        () => this.primaryPool.execute<mysql.ResultSetHeader>(sql, params),
        'execute'
      );

      log('debug', 'mysql_adapter_execute_success', {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
      });

      return result;
    } catch (error) {
      log('error', 'mysql_adapter_execute_error', {
        sql: sql.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a read query (SELECT) on a replica using round-robin
   * Falls back to primary if no replicas are configured
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const pool = this.getReplicaPool();

    log('debug', 'mysql_adapter_query', {
      sql: sql.substring(0, 100),
      params: params?.length,
      target: pool === this.primaryPool ? 'primary' : 'replica',
    });

    try {
      const [rows] = await this.withRetry(
        () => pool.query<mysql.RowDataPacket[]>(sql, params),
        'query'
      );

      log('debug', 'mysql_adapter_query_success', {
        rowCount: Array.isArray(rows) ? rows.length : 0,
      });

      return rows as T[];
    } catch (error) {
      log('error', 'mysql_adapter_query_error', {
        sql: sql.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a read query on the primary (for cases requiring read-after-write consistency)
   */
  async queryPrimary<T = any>(sql: string, params?: any[]): Promise<T[]> {
    try {
      log('debug', 'mysql_adapter_query_primary', {
        sql: sql.substring(0, 100),
        params: params?.length,
      });

      const [rows] = await this.primaryPool.query<mysql.RowDataPacket[]>(sql, params);

      log('debug', 'mysql_adapter_query_primary_success', {
        rowCount: Array.isArray(rows) ? rows.length : 0,
      });

      return rows as T[];
    } catch (error) {
      log('error', 'mysql_adapter_query_primary_error', {
        sql: sql.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a transaction on the primary
   * Automatically commits if the function succeeds, rolls back on error
   */
  async transaction<T>(
    fn: (connection: mysql.PoolConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.primaryPool.getConnection();

    try {
      log('debug', 'mysql_adapter_transaction_start');

      await connection.beginTransaction();

      const result = await fn(connection);

      await connection.commit();

      log('debug', 'mysql_adapter_transaction_committed');

      return result;
    } catch (error) {
      log('error', 'mysql_adapter_transaction_error', {
        error: error instanceof Error ? error.message : String(error),
      });

      await connection.rollback();

      log('debug', 'mysql_adapter_transaction_rolled_back');

      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Health check for primary and all replicas
   */
  async healthCheck(): Promise<{ primary: boolean; replicas: boolean[] }> {
    const checkPool = async (pool: mysql.Pool, name: string): Promise<boolean> => {
      try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        return true;
      } catch (error) {
        log('error', 'mysql_adapter_health_check_failed', {
          pool: name,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    };

    const [primaryHealth, ...replicaHealths] = await Promise.all([
      checkPool(this.primaryPool, 'primary'),
      ...this.replicaPools.map((pool, index) =>
        checkPool(pool, `replica_${index}`)
      ),
    ]);

    return {
      primary: primaryHealth,
      replicas: replicaHealths,
    };
  }

  /**
   * Close all connection pools
   */
  async close(): Promise<void> {
    log('info', 'mysql_adapter_closing_pools');

    await Promise.all([
      this.primaryPool.end(),
      ...this.replicaPools.map((pool) => pool.end()),
    ]);

    log('info', 'mysql_adapter_pools_closed');
  }

  /**
   * Get a replica pool using round-robin selection
   * Falls back to primary if no replicas are configured
   */
  private getReplicaPool(): mysql.Pool {
    if (this.replicaPools.length === 0) {
      return this.primaryPool;
    }

    // Atomic increment with modulo for thread-safe round-robin selection
    const index = (this.replicaIndex++) % this.replicaPools.length;
    return this.replicaPools[index];
  }

  /**
   * Get raw query result with fields (for advanced use cases)
   */
  async queryWithFields<T = any>(
    sql: string,
    params?: any[],
    usePrimary = false
  ): Promise<QueryResult<T>> {
    const pool = usePrimary ? this.primaryPool : this.getReplicaPool();

    try {
      log('debug', 'mysql_adapter_query_with_fields', {
        sql: sql.substring(0, 100),
        usePrimary,
      });

      const [rows, fields] = await pool.execute<mysql.RowDataPacket[]>(sql, params);

      return { rows: rows as T[], fields };
    } catch (error) {
      log('error', 'mysql_adapter_query_with_fields_error', {
        sql: sql.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Singleton instance
let adapterInstance: MySQLAdapter | null = null;

/**
 * Get the singleton MySQL adapter instance
 */
export function getMySQLAdapter(): MySQLAdapter {
  if (!adapterInstance) {
    adapterInstance = new MySQLAdapter();
  }
  return adapterInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetMySQLAdapter(): void {
  adapterInstance = null;
}
