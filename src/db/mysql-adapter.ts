/**
 * MySQL Adapter with Read-Write Splitting
 * Supports connection pooling for primary (write) and replicas (read)
 */

import mysql from 'mysql2/promise';
import { dbConfig } from '../config/db-config.js';
import { log } from '../utils/logger.js';

export interface QueryResult<T = any> {
  rows: T[];
  fields: mysql.FieldPacket[];
}

export class MySQLAdapter {
  private primaryPool: mysql.Pool;
  private replicaPools: mysql.Pool[];
  private replicaIndex = 0;

  constructor() {
    const config = dbConfig.mysql;

    // Primary pool for writes
    this.primaryPool = mysql.createPool({
      host: config.primary.host,
      port: config.primary.port,
      user: config.primary.user,
      password: config.primary.password,
      database: config.primary.database,
      connectionLimit: config.primary.connectionLimit,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
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
        waitForConnections: true,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      });
    });

    if (this.replicaPools.length === 0) {
      log('warn', 'mysql_adapter_no_replicas_configured', {
        message: 'No replicas configured, all queries will be routed to primary',
      });
    }
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE) on the primary
   * Returns ResultSetHeader with affectedRows, insertId, etc.
   */
  async execute<T = any>(
    sql: string,
    params?: any[]
  ): Promise<mysql.ResultSetHeader> {
    try {
      log('debug', 'mysql_adapter_execute', {
        sql: sql.substring(0, 100),
        params: params?.length,
      });

      const [result] = await this.primaryPool.execute<mysql.ResultSetHeader>(
        sql,
        params
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

    try {
      log('debug', 'mysql_adapter_query', {
        sql: sql.substring(0, 100),
        params: params?.length,
        target: pool === this.primaryPool ? 'primary' : 'replica',
      });

      const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params);

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

      const [rows] = await this.primaryPool.execute<mysql.RowDataPacket[]>(sql, params);

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

    const pool = this.replicaPools[this.replicaIndex];
    this.replicaIndex = (this.replicaIndex + 1) % this.replicaPools.length;

    return pool;
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
