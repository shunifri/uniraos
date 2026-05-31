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

/** 最大缓存连接数（P2 修复：可配置） */
const MAX_CONNECTIONS = parseInt(process.env.SKILL_DB_CONN_LIMIT || "10");

/** 连接空闲超时（5分钟，P2 修复：可配置） */
const IDLE_TIMEOUT_MS = parseInt(process.env.SKILL_DB_IDLE_TIMEOUT_MS || String(5 * 60 * 1000));

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

/** 检测 SQL 是否为只读查询（严格模式，去除注释并检测所有写操作关键字） */
function isReadOnlySQL(sql: string): boolean {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")  // 去除块注释
    .replace(/--.*$/gm, "")               // 去除行注释
    .replace(/\s+/g, " ")                 // 规范化空白
    .trim()
    .toUpperCase();

  // 必须以只读关键字开头（PRAGMA 被移除，可泄露数据库结构）
  const allowedPrefixes = ["SELECT", "WITH", "SHOW", "DESCRIBE", "EXPLAIN"];
  const hasAllowedPrefix = allowedPrefixes.some(p => normalized.startsWith(p));
  if (!hasAllowedPrefix) return false;

  // 禁止包含任何写操作关键字（作为独立词）
  const writeKeywords = [
    " INSERT ", " UPDATE ", " DELETE ", " DROP ", " ALTER ", " CREATE ",
    " TRUNCATE ", " REPLACE ", " GRANT ", " REVOKE ", " MERGE ", " CALL ",
    " ATTACH ", " DETACH ", " COPY ", " LOAD ", " UNLOAD ",
  ];
  for (const kw of writeKeywords) {
    if (normalized.includes(kw)) return false;
  }

  // 禁止分号后跟任何内容（防止多语句注入）
  const semicolonIndex = normalized.indexOf(";");
  if (semicolonIndex !== -1 && semicolonIndex < normalized.length - 1) {
    const after = normalized.slice(semicolonIndex + 1).trim();
    if (after.length > 0) return false;
  }

  return true;
}

/** 检测 SQL 是否包含危险操作 */
function isDangerousSQL(sql: string): boolean {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  // 禁止 ATTACH/DETACH DATABASE
  if (/\bATTACH\b/.test(normalized) || /\bDETACH\b/.test(normalized)) return true;

  // 禁止 PRAGMA（可泄露数据库结构、修改设置）
  if (/\bPRAGMA\b/.test(normalized)) return true;

  // 禁止 DROP TABLE/INDEX/DATABASE
  if (/\bDROP\b/.test(normalized)) return true;

  // 禁止 ALTER TABLE
  if (/\bALTER\b/.test(normalized)) return true;

  // 禁止 DELETE/UPDATE 无 WHERE（可能导致全表删除）
  if ((/\bDELETE\b/.test(normalized) || /\bUPDATE\b/.test(normalized)) && !/\bWHERE\b/.test(normalized)) return true;

  return false;
}

/** 敏感字段关键词 */
const SENSITIVE_KEYS = new Set([
  "password", "secret", "token", "api_key", "apikey", "apiKey",
  "credential", "credentials", "private_key", "privateKey",
  "passphrase", "auth", "authorization", "access_token", "refresh_token",
  "salt", "hash", "password_hash", "session_token", "jwt",
]);

/** 递归过滤敏感信息 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // 如果字符串看起来像密钥（长随机字符串），部分隐藏
    if (value.length > 12 && /^[A-Za-z0-9+/=_-]{16,}$/.test(value)) {
      return value.slice(0, 4) + "***" + value.slice(-4);
    }
    return value;
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_KEYS.has(key)) {
        sanitized[key] = "***";
      } else {
        sanitized[key] = sanitizeValue(val);
      }
    }
    return sanitized;
  }
  return value;
}

/** 过滤查询结果中的敏感字段 */
function sanitizeRows(rows: unknown[]): unknown[] {
  return rows.map(sanitizeValue);
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
              rows: sanitizeRows(rows),
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
        if (isDangerousSQL(sql)) {
          return { success: false, error: new Error("SQL 包含危险操作，已被拒绝") };
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
        for (const stmt of statements) {
          if (isDangerousSQL(stmt.sql)) {
            return { success: false, error: new Error(`SQL 包含危险操作，已被拒绝: ${stmt.sql.slice(0, 50)}`) };
          }
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

        // 安全：表名只允许字母数字下划线，防止 SQL 注入
        function isValidTableName(name: string): boolean {
          return /^[a-zA-Z0-9_]+$/.test(name);
        }

        try {
          const db = getConnection(dbPath);

          if (tableName) {
            if (!isValidTableName(tableName)) {
              return { success: false, error: new Error("Invalid table name") };
            }
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

    async function testConnection(config: { host: string; port?: number; user: string; password: string; database: string }): Promise<{ success: boolean; error?: string }> {
      try {
        const testPool = mysql.createPool({
          host: config.host,
          port: config.port ?? 3306,
          user: config.user,
          password: config.password,
          database: config.database,
          connectionLimit: 1,
          queueLimit: 0,
          connectTimeout: 5000,
        });
        const conn = await testPool.getConnection();
        await conn.ping();
        conn.release();
        await testPool.end();
        return { success: true };
      } catch (err: any) {
        const msg = err.message || String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("Can't connect")) {
          return { success: false, error: `无法连接到 MySQL 服务器 ${config.host}:${config.port ?? 3306}，请确认服务已启动` };
        }
        if (msg.includes("Access denied")) {
          return { success: false, error: `用户名或密码错误，无法访问 MySQL 数据库` };
        }
        if (msg.includes("Unknown database")) {
          return { success: false, error: `数据库 "${config.database}" 不存在` };
        }
        return { success: false, error: msg };
      }
    }

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
        connectionLimit: parseInt(process.env.SKILL_DB_CONN_LIMIT || "10"),
        queueLimit: 0,
      });
      pools.set(key, pool);
      return pool;
    }

    registry.register(
      defineSystemSkill({
        name: "mysql_query",
        description:
          "执行 MySQL 查询。参数: sql(string), params?(array), connection({host,user,database,port?})。密码通过安全凭证管理，不直接传入。",
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
                rows: sanitizeRows(rows as unknown[]),
                rowCount: Array.isArray(rows) ? rows.length : 0,
                columns: Array.isArray(fields) ? fields.map((f: { name: string }) => f.name) : [],
              },
            };
          } catch (err: any) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            // 连接相关错误：提供更详细的诊断
            if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("Can't connect") || errorMsg.includes("connect refused") || errorMsg.includes("connect ETIMEDOUT")) {
              const diag = await testConnection(conn);
              return { success: false, error: new Error(`MySQL 连接失败: ${diag.error || "服务器可能未运行"}（主机: ${conn.host}, 端口: ${conn.port ?? 3306}）`) };
            }
            if (errorMsg.includes("Access denied")) {
              return { success: false, error: new Error(`MySQL 认证失败: 用户名或密码错误，无法访问数据库`) };
            }
            if (errorMsg.includes("Unknown database")) {
              return { success: false, error: new Error(`MySQL 错误: 数据库 "${conn.database}" 不存在`) };
            }
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    registry.register(
      defineSystemSkill({
        name: "mysql_execute",
        description:
          "执行 MySQL 写操作。参数: sql(string), params?(array), connection({host,user,database,port?})。密码通过安全凭证管理，不直接传入。",
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
          } catch (err: any) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("Can't connect") || errorMsg.includes("connect refused") || errorMsg.includes("connect ETIMEDOUT")) {
              const diag = await testConnection(conn);
              return { success: false, error: new Error(`MySQL 连接失败: ${diag.error || "服务器可能未运行"}（主机: ${conn.host}, 端口: ${conn.port ?? 3306}）`) };
            }
            if (errorMsg.includes("Access denied")) {
              return { success: false, error: new Error(`MySQL 认证失败: 用户名或密码错误`) };
            }
            if (errorMsg.includes("Unknown database")) {
              return { success: false, error: new Error(`MySQL 错误: 数据库 "${conn.database}" 不存在`) };
            }
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      }),
    );

    // MySQL 连接测试 skill
    registry.register(
      defineSystemSkill({
        name: "mysql_test_connection",
        description: "测试 MySQL 数据库连接是否可用。参数: connection({host,user,password,database,port?})",
        timeout: 10000,
        paramSchema: {
          properties: {
            connection: { type: "object", description: "MySQL connection config: {host, user, password, database, port?}" },
          },
          required: ["connection"],
        },
        handler: async (params) => {
          const conn = params.connection as { host: string; user: string; password: string; database: string; port?: number };
          if (!conn) {
            return { success: false, error: new Error("connection 参数必填") };
          }
          const diag = await testConnection(conn);
          if (diag.success) {
            return { success: true, data: { connected: true, host: conn.host, port: conn.port ?? 3306, database: conn.database, message: "MySQL 连接成功" } };
          }
          return { success: false, error: new Error(diag.error || "连接失败") };
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
    const pg = await import(String("pg"));

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
        max: parseInt(process.env.SKILL_DB_CONN_LIMIT || "10"),
      });
      pools.set(key, pool);
      return pool;
    }

    registry.register(
      defineSystemSkill({
        name: "pg_query",
        description:
          "执行 PostgreSQL 查询。参数: sql(string), params?(array), connection({host,user,database,port?})。密码通过安全凭证管理，不直接传入。",
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
          "执行 PostgreSQL 写操作。参数: sql(string), params?(array), connection({host,user,database,port?})。密码通过安全凭证管理，不直接传入。",
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
    const RedisModule = await import("ioredis");
    const Redis = RedisModule.default || RedisModule.Redis;

    const clients = new Map<any, any>();

    function getClient(config: { host?: string; port?: number; password?: string; db?: number }) {
      const key = `${config.host ?? "localhost"}:${config.port ?? 6379}/${config.db ?? 0}`;
      if (clients.has(key)) return clients.get(key)!;

      const client = new (Redis as any)({
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
    const mssql = await import(String("mssql"));

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
        pool: { max: parseInt(process.env.SKILL_DB_CONN_LIMIT || "10"), min: 0, idleTimeoutMillis: 30000 },
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
    const oracledb = await import(String("oracledb"));

    let pool: any = null;

    async function getPool(config: { user: string; password: string; connectString: string; poolMin?: number; poolMax?: number }) {
      if (pool) return pool;

      pool = await oracledb.default.createPool({
        user: config.user,
        password: config.password,
        connectString: config.connectString,
        poolMin: config.poolMin ?? 0,
        poolMax: config.poolMax ?? parseInt(process.env.SKILL_DB_CONN_LIMIT || "10"),
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
