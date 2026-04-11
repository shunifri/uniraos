/**
 * 数据库 Skill 家族
 *
 * 统一的数据库操作 Skill，让智能体能够查询和操作数据库。
 * 当前支持 SQLite（使用已有的 better-sqlite3 依赖），
 * 可扩展 MySQL/PostgreSQL/Redis。
 *
 * 所有数据库操作都注册为标准 Skill，可被 Agent 自主调用。
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { mkdirSync, existsSync } from "fs";
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";

// ===== 连接池管理 =====

const DB_BASE = resolve(process.cwd(), ".raos", "workspace");

/** SQLite 连接缓存 */
const connectionCache = new Map<string, { db: Database.Database; lastUsed: number }>();

/** 最大缓存连接数 */
const MAX_CONNECTIONS = 10;

/** 连接空闲超时（5分钟） */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function ensureSafeDbPath(path: string): string {
  const resolved = resolve(DB_BASE, path);
  if (!resolved.startsWith(DB_BASE)) {
    throw new Error(`路径安全违规: 不允许访问 workspace 外的数据库 (${path})`);
  }
  return resolved;
}

function getConnection(dbPath: string): Database.Database {
  const resolved = ensureSafeDbPath(dbPath);

  const cached = connectionCache.get(resolved);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.db;
  }

  // 淘汰超时连接
  evictIdle();

  // 如果缓存已满，关闭最久未使用的
  if (connectionCache.size >= MAX_CONNECTIONS) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [key, val] of connectionCache) {
      if (val.lastUsed < oldestTime) {
        oldestTime = val.lastUsed;
        oldest = key;
      }
    }
    if (oldest) {
      connectionCache.get(oldest)?.db.close();
      connectionCache.delete(oldest);
    }
  }

  // 确保目录存在
  mkdirSync(dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  connectionCache.set(resolved, { db, lastUsed: Date.now() });
  return db;
}

function evictIdle(): void {
  const now = Date.now();
  for (const [key, val] of connectionCache) {
    if (now - val.lastUsed > IDLE_TIMEOUT_MS) {
      val.db.close();
      connectionCache.delete(key);
    }
  }
}

function closeConnection(dbPath: string): boolean {
  const resolved = ensureSafeDbPath(dbPath);
  const cached = connectionCache.get(resolved);
  if (cached) {
    cached.db.close();
    connectionCache.delete(resolved);
    return true;
  }
  return false;
}

function closeAll(): void {
  for (const [, val] of connectionCache) {
    val.db.close();
  }
  connectionCache.clear();
}

// ===== 安全检查 =====

/** 检测危险的 SQL 写操作（用于 db_query 只读模式） */
function isReadOnlySQL(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  const writeKeywords = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "REPLACE", "TRUNCATE", "ATTACH", "DETACH"];
  for (const kw of writeKeywords) {
    if (normalized.startsWith(kw)) return false;
  }
  return true;
}

// ===== SQLite Skills =====

function createSQLiteSkills(registry: SkillRegistry): void {
  mkdirSync(DB_BASE, { recursive: true });

  registry.register(
    defineSystemSkill({
      name: "db_query",
      description:
        "执行只读 SQL 查询。参数: sql(string), params?(array, 绑定参数), db?(string, 数据库文件路径，相对于 workspace，默认 data.db)",
      paramSchema: {
        properties: {
          sql: { type: "string", description: "Read-only SQL query to execute (SELECT only)" },
          params: { type: "array", description: "Bind parameters for the SQL query", items: { type: "string" } },
          db: { type: "string", description: "Database file path relative to workspace (default: data.db)" },
        },
        required: ["sql"],
      },
      handler: async (params) => {
        const sql = params.sql as string;
        if (!sql) {
          return { success: false, error: new Error("sql 参数必填") };
        }
        if (!isReadOnlySQL(sql)) {
          return { success: false, error: new Error("db_query 仅允许只读查询，写操作请使用 db_execute") };
        }

        const dbPath = (params.db as string) ?? "data.db";
        const bindParams = (params.params as unknown[]) ?? [];

        try {
          const db = getConnection(dbPath);
          const stmt = db.prepare(sql);
          const rows = stmt.all(...bindParams);
          return {
            success: true,
            data: {
              rows,
              rowCount: rows.length,
              columns: rows.length > 0 ? Object.keys(rows[0] as object) : [],
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "db_execute",
      description:
        "执行 SQL 写操作（INSERT/UPDATE/DELETE/CREATE 等）。参数: sql(string), params?(array), db?(string, 默认 data.db)",
      paramSchema: {
        properties: {
          sql: { type: "string", description: "SQL write statement to execute (INSERT/UPDATE/DELETE/CREATE etc.)" },
          params: { type: "array", description: "Bind parameters for the SQL statement", items: { type: "string" } },
          db: { type: "string", description: "Database file path relative to workspace (default: data.db)" },
        },
        required: ["sql"],
      },
      handler: async (params) => {
        const sql = params.sql as string;
        if (!sql) {
          return { success: false, error: new Error("sql 参数必填") };
        }

        const dbPath = (params.db as string) ?? "data.db";
        const bindParams = (params.params as unknown[]) ?? [];

        try {
          const db = getConnection(dbPath);
          const stmt = db.prepare(sql);
          const result = stmt.run(...bindParams);
          return {
            success: true,
            data: {
              changes: result.changes,
              lastInsertRowid: Number(result.lastInsertRowid),
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "db_batch",
      description:
        "在事务中批量执行多条 SQL 语句。参数: statements(array of {sql, params?}), db?(string, 默认 data.db)",
      handler: async (params) => {
        const statements = params.statements as Array<{ sql: string; params?: unknown[] }>;
        if (!statements || !Array.isArray(statements) || statements.length === 0) {
          return { success: false, error: new Error("statements 参数必填且不能为空") };
        }

        const dbPath = (params.db as string) ?? "data.db";

        try {
          const db = getConnection(dbPath);
          const results: Array<{ changes: number; lastInsertRowid: number }> = [];

          const transaction = db.transaction(() => {
            for (const stmt of statements) {
              const prepared = db.prepare(stmt.sql);
              const result = prepared.run(...(stmt.params ?? []));
              results.push({
                changes: result.changes,
                lastInsertRowid: Number(result.lastInsertRowid),
              });
            }
          });

          transaction();

          return {
            success: true,
            data: {
              executed: results.length,
              results,
              totalChanges: results.reduce((sum, r) => sum + r.changes, 0),
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "db_schema",
      description:
        "查看数据库的表结构信息。参数: db?(string, 默认 data.db), table?(string, 指定表名则只返回该表)",
      paramSchema: {
        properties: {
          db: { type: "string", description: "Database file path relative to workspace (default: data.db)" },
          table: { type: "string", description: "Optional table name to get schema for a specific table only" },
        },
      },
      handler: async (params) => {
        const dbPath = (params.db as string) ?? "data.db";
        const tableName = params.table as string | undefined;

        try {
          const db = getConnection(dbPath);

          if (tableName) {
            // 单表详情
            const columns = db.prepare(`PRAGMA table_info('${tableName.replace(/'/g, "''")}')`).all();
            const indexes = db.prepare(`PRAGMA index_list('${tableName.replace(/'/g, "''")}')`).all();
            const rowCount = (db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as any)?.count ?? 0;

            return {
              success: true,
              data: { table: tableName, columns, indexes, rowCount },
            };
          }

          // 所有表
          const tables = db.prepare(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
          ).all() as Array<{ name: string; type: string }>;

          const schema = tables.map((t) => {
            const columns = db.prepare(`PRAGMA table_info('${t.name.replace(/'/g, "''")}')`).all();
            const rowCount = (db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as any)?.count ?? 0;
            return { name: t.name, type: t.type, columns, rowCount };
          });

          return {
            success: true,
            data: { tables: schema, tableCount: schema.length },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "db_connections",
      description: "查看数据库连接池状态，可选关闭指定连接。参数: action?('list'|'close'|'close_all'), db?(string, close 时指定)",
      handler: async (params) => {
        const action = (params.action as string) ?? "list";

        if (action === "close_all") {
          const count = connectionCache.size;
          closeAll();
          return { success: true, data: { closed: count, message: "所有连接已关闭" } };
        }

        if (action === "close") {
          const dbPath = params.db as string;
          if (!dbPath) {
            return { success: false, error: new Error("close 操作需要指定 db 参数") };
          }
          const closed = closeConnection(dbPath);
          return { success: true, data: { closed, db: dbPath } };
        }

        // list
        const now = Date.now();
        const connections = [...connectionCache.entries()].map(([path, val]) => ({
          path: path.replace(DB_BASE + "/", ""),
          idleMs: now - val.lastUsed,
          open: val.db.open,
        }));

        return {
          success: true,
          data: {
            connections,
            total: connections.length,
            maxConnections: MAX_CONNECTIONS,
          },
        };
      },
    }),
  );
}

// ===== 可选：MySQL Skill（动态加载） =====

async function createMySQLSkills(registry: SkillRegistry): Promise<boolean> {
  try {
    // @ts-ignore — 可选依赖，运行时动态检测
    const mysql = await import("mysql2/promise");

    const pools = new Map<string, any>();

    function getPool(config: { host: string; port?: number; user: string; password: string; database: string }) {
      const key = `${config.host}:${config.port ?? 3306}/${config.database}`;
      if (pools.has(key)) return pools.get(key)!;

      const pool = mysql.createPool({
        host: config.host,
        port: config.port ?? 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
      pools.set(key, pool);
      return pool;
    }

    registry.register(
      defineSystemSkill({
        name: "mysql_query",
        description:
          "执行 MySQL 查询。参数: sql(string), params?(array), connection({host,user,password,database,port?})",
        timeout: 30000,
        paramSchema: {
          properties: {
            sql: { type: "string", description: "SQL query to execute" },
            params: { type: "array", description: "Bind parameters for the SQL query", items: { type: "string" } },
            connection: { type: "object", description: "MySQL connection config: {host, user, password, database, port?}" },
          },
          required: ["sql", "connection"],
        },
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as { host: string; user: string; password: string; database: string; port?: number };
          if (!sql || !conn) {
            return { success: false, error: new Error("sql 和 connection 参数必填") };
          }

          try {
            const pool = getPool(conn);
            const [rows, fields] = await pool.execute(sql, (params.params as unknown[]) ?? []);
            return {
              success: true,
              data: {
                rows,
                rowCount: Array.isArray(rows) ? rows.length : 0,
                columns: Array.isArray(fields) ? fields.map((f: { name: string }) => f.name) : [],
              },
            };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "mysql_execute",
        description:
          "执行 MySQL 写操作。参数: sql(string), params?(array), connection({host,user,password,database,port?})",
        timeout: 30000,
        paramSchema: {
          properties: {
            sql: { type: "string", description: "SQL write statement to execute" },
            params: { type: "array", description: "Bind parameters for the SQL statement", items: { type: "string" } },
            connection: { type: "object", description: "MySQL connection config: {host, user, password, database, port?}" },
          },
          required: ["sql", "connection"],
        },
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as { host: string; user: string; password: string; database: string; port?: number };
          if (!sql || !conn) {
            return { success: false, error: new Error("sql 和 connection 参数必填") };
          }

          try {
            const pool = getPool(conn);
            const [result] = await pool.execute(sql, (params.params as unknown[]) ?? []);
            return {
              success: true,
              data: {
                affectedRows: (result as any).affectedRows ?? 0,
                insertId: (result as any).insertId ?? null,
              },
            };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    return true;
  } catch {
    return false;
  }
}

// ===== 可选：PostgreSQL Skill（动态加载） =====

async function createPostgresSkills(registry: SkillRegistry): Promise<boolean> {
  try {
    // @ts-ignore — 可选依赖
    const pg = await import("pg");

    const pools = new Map<string, InstanceType<typeof pg.Pool>>();

    function getPool(config: { host: string; port?: number; user: string; password: string; database: string }) {
      const key = `${config.host}:${config.port ?? 5432}/${config.database}`;
      if (pools.has(key)) return pools.get(key)!;

      const pool = new pg.Pool({
        host: config.host,
        port: config.port ?? 5432,
        user: config.user,
        password: config.password,
        database: config.database,
        max: 10,
      });
      pools.set(key, pool);
      return pool;
    }

    registry.register(
      defineSystemSkill({
        name: "pg_query",
        description:
          "执行 PostgreSQL 查询。参数: sql(string), params?(array), connection({host,user,password,database,port?})",
        timeout: 30000,
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as { host: string; user: string; password: string; database: string; port?: number };
          if (!sql || !conn) {
            return { success: false, error: new Error("sql 和 connection 参数必填") };
          }

          try {
            const pool = getPool(conn);
            const result = await pool.query(sql, (params.params as unknown[]) ?? []);
            return {
              success: true,
              data: {
                rows: result.rows,
                rowCount: result.rowCount ?? result.rows.length,
                columns: result.fields.map((f: any) => f.name),
              },
            };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "pg_execute",
        description:
          "执行 PostgreSQL 写操作。参数: sql(string), params?(array), connection({host,user,password,database,port?})",
        timeout: 30000,
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as { host: string; user: string; password: string; database: string; port?: number };
          if (!sql || !conn) {
            return { success: false, error: new Error("sql 和 connection 参数必填") };
          }

          try {
            const pool = getPool(conn);
            const result = await pool.query(sql, (params.params as unknown[]) ?? []);
            return {
              success: true,
              data: {
                affectedRows: result.rowCount ?? 0,
              },
            };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    return true;
  } catch {
    return false;
  }
}

// ===== 可选：Redis Skill（动态加载） =====

async function createRedisSkills(registry: SkillRegistry): Promise<boolean> {
  try {
    // @ts-ignore — 可选依赖
    const Redis = (await import("ioredis")).default;

    const clients = new Map<string, InstanceType<typeof Redis>>();

    function getClient(config: { host?: string; port?: number; password?: string; db?: number }) {
      const key = `${config.host ?? "localhost"}:${config.port ?? 6379}/${config.db ?? 0}`;
      if (clients.has(key)) return clients.get(key)!;

      const client = new Redis({
        host: config.host ?? "localhost",
        port: config.port ?? 6379,
        password: config.password,
        db: config.db ?? 0,
        lazyConnect: true,
      });
      clients.set(key, client);
      return client;
    }

    registry.register(
      defineSystemSkill({
        name: "redis_get",
        description: "获取 Redis 键值。参数: key(string), connection?({host?,port?,password?,db?})",
        timeout: 10000,
        handler: async (params) => {
          const key = params.key as string;
          if (!key) return { success: false, error: new Error("key 参数必填") };

          try {
            const client = getClient((params.connection as any) ?? {});
            await client.connect().catch(() => {});
            const value = await client.get(key);
            return { success: true, data: { key, value, exists: value !== null } };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "redis_set",
        description: "设置 Redis 键值。参数: key(string), value(string), ttl?(number, 秒), connection?({host?,port?,password?,db?})",
        timeout: 10000,
        handler: async (params) => {
          const key = params.key as string;
          const value = params.value as string;
          if (!key || value === undefined) return { success: false, error: new Error("key 和 value 参数必填") };

          try {
            const client = getClient((params.connection as any) ?? {});
            await client.connect().catch(() => {});
            if (params.ttl) {
              await client.set(key, value, "EX", params.ttl as number);
            } else {
              await client.set(key, value);
            }
            return { success: true, data: { key, set: true } };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "redis_del",
        description: "删除 Redis 键。参数: keys(string|string[]), connection?({host?,port?,password?,db?})",
        timeout: 10000,
        handler: async (params) => {
          const keys = Array.isArray(params.keys) ? params.keys : [params.keys as string];
          if (!keys.length) return { success: false, error: new Error("keys 参数必填") };

          try {
            const client = getClient((params.connection as any) ?? {});
            await client.connect().catch(() => {});
            const deleted = await client.del(...keys);
            return { success: true, data: { deleted, keys } };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "redis_keys",
        description: "搜索 Redis 键。参数: pattern(string, 如 'user:*'), connection?({host?,port?,password?,db?})",
        timeout: 10000,
        handler: async (params) => {
          const pattern = (params.pattern as string) ?? "*";

          try {
            const client = getClient((params.connection as any) ?? {});
            await client.connect().catch(() => {});
            const keys = await client.keys(pattern);
            return { success: true, data: { keys, count: keys.length } };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    return true;
  } catch {
    return false;
  }
}

// ===== 可选：MSSQL Skill（动态加载） =====

async function createMSSQLSkills(registry: SkillRegistry): Promise<boolean> {
  try {
    // @ts-ignore — 可选依赖
    const mssql = await import("mssql");

    const pools = new Map<string, InstanceType<typeof mssql.ConnectionPool>>();

    async function getPool(config: { server: string; port?: number; user: string; password: string; database: string; encrypt?: boolean }) {
      const key = `${config.server}:${config.port ?? 1433}/${config.database}`;
      if (pools.has(key)) return pools.get(key)!;

      const pool = new mssql.ConnectionPool({
        server: config.server,
        port: config.port ?? 1433,
        user: config.user,
        password: config.password,
        database: config.database,
        options: {
          encrypt: config.encrypt ?? false,
          trustServerCertificate: true,
        },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      });
      await pool.connect();
      pools.set(key, pool);
      return pool;
    }

    registry.register(
      defineSystemSkill({
        name: "mssql_query",
        description:
          "执行 MSSQL 查询。参数: sql(string), params?(object, 命名参数如 {id: 1}), connection({server,user,password,database,port?,encrypt?})",
        timeout: 30000,
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as any;
          if (!sql || !conn) return { success: false, error: new Error("sql 和 connection 参数必填") };

          try {
            const pool = await getPool(conn);
            const request = pool.request();
            const namedParams = (params.params as Record<string, unknown>) ?? {};
            for (const [k, v] of Object.entries(namedParams)) {
              request.input(k, v);
            }
            const result = await request.query(sql);
            return {
              success: true,
              data: {
                rows: result.recordset ?? [],
                rowCount: result.recordset?.length ?? 0,
                rowsAffected: result.rowsAffected,
              },
            };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "mssql_execute",
        description:
          "执行 MSSQL 写操作。参数: sql(string), params?(object), connection({server,user,password,database,port?,encrypt?})",
        timeout: 30000,
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as any;
          if (!sql || !conn) return { success: false, error: new Error("sql 和 connection 参数必填") };

          try {
            const pool = await getPool(conn);
            const request = pool.request();
            const namedParams = (params.params as Record<string, unknown>) ?? {};
            for (const [k, v] of Object.entries(namedParams)) {
              request.input(k, v);
            }
            const result = await request.query(sql);
            return {
              success: true,
              data: { rowsAffected: result.rowsAffected },
            };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    return true;
  } catch {
    return false;
  }
}

// ===== 可选：Oracle Skill（动态加载） =====

async function createOracleSkills(registry: SkillRegistry): Promise<boolean> {
  try {
    // @ts-ignore — 可选依赖
    const oracledb = await import("oracledb");

    let pool: any = null;

    async function getPool(config: { user: string; password: string; connectString: string; poolMin?: number; poolMax?: number }) {
      if (pool) return pool;

      pool = await oracledb.default.createPool({
        user: config.user,
        password: config.password,
        connectString: config.connectString,
        poolMin: config.poolMin ?? 0,
        poolMax: config.poolMax ?? 10,
      });
      return pool;
    }

    registry.register(
      defineSystemSkill({
        name: "oracle_query",
        description:
          "执行 Oracle 查询。参数: sql(string), params?(array|object, 绑定参数), connection({user,password,connectString})",
        timeout: 30000,
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as any;
          if (!sql || !conn) return { success: false, error: new Error("sql 和 connection 参数必填") };

          try {
            const p = await getPool(conn);
            const connection = await p.getConnection();
            try {
              const bindParams = (params.params as unknown[]) ?? [];
              const result = await connection.execute(sql, bindParams, { outFormat: oracledb.default.OUT_FORMAT_OBJECT });
              return {
                success: true,
                data: {
                  rows: result.rows ?? [],
                  rowCount: result.rows?.length ?? 0,
                  metaData: result.metaData?.map((m: any) => m.name) ?? [],
                },
              };
            } finally {
              await connection.close();
            }
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "oracle_execute",
        description:
          "执行 Oracle 写操作。参数: sql(string), params?(array|object), connection({user,password,connectString}), autoCommit?(boolean, 默认 true)",
        timeout: 30000,
        handler: async (params) => {
          const sql = params.sql as string;
          const conn = params.connection as any;
          if (!sql || !conn) return { success: false, error: new Error("sql 和 connection 参数必填") };

          try {
            const p = await getPool(conn);
            const connection = await p.getConnection();
            try {
              const bindParams = (params.params as unknown[]) ?? [];
              const autoCommit = params.autoCommit !== false;
              const result = await connection.execute(sql, bindParams, { autoCommit });
              return {
                success: true,
                data: { rowsAffected: result.rowsAffected ?? 0 },
              };
            } finally {
              await connection.close();
            }
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    return true;
  } catch {
    return false;
  }
}

// ===== 注册所有数据库 Skills =====

export async function createDatabaseSkills(registry: SkillRegistry): Promise<void> {
  // SQLite 始终可用（better-sqlite3 已是项目依赖）
  createSQLiteSkills(registry);
  console.log("   Database skills registered (SQLite: db_query/db_execute/db_batch/db_schema/db_connections)");

  // 可选数据库（依赖是否安装对应 npm 包）
  const mysql = await createMySQLSkills(registry);
  if (mysql) console.log("   MySQL skills registered (mysql_query/mysql_execute)");

  const pg = await createPostgresSkills(registry);
  if (pg) console.log("   PostgreSQL skills registered (pg_query/pg_execute)");

  const redis = await createRedisSkills(registry);
  if (redis) console.log("   Redis skills registered (redis_get/redis_set/redis_del/redis_keys)");

  const mssql = await createMSSQLSkills(registry);
  if (mssql) console.log("   MSSQL skills registered (mssql_query/mssql_execute)");

  const oracle = await createOracleSkills(registry);
  if (oracle) console.log("   Oracle skills registered (oracle_query/oracle_execute)");
}
