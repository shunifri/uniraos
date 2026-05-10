/**
 * Database Skills tests
 * Tests db_query, db_execute, db_batch, db_schema, db_connections
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { createDatabaseSkills } from "../../src/skills/db-skills.js";
import { join, resolve } from "path";
import { existsSync, rmSync } from "fs";

describe("db-skills.ts", () => {
  let registry: SkillRegistry;
  const dummyContext = { traceId: "t1", callStack: [], depth: 0, maxDepth: 10, callBudget: { remaining: 100 }, trace: [] } as any;
  const DB_BASE = resolve(process.cwd(), ".raos", "workspace");

  beforeEach(async () => {
    registry = new SkillRegistry();
    await createDatabaseSkills(registry);
  });

  afterEach(() => {
    // Clean up any databases created inside .raos/workspace during tests
    const testDbs = ["test_query.db", "test_exec.db", "test_batch.db", "test_schema.db", "test_conn.db", "data.db"];
    for (const dbName of testDbs) {
      try {
        const dbPath = join(DB_BASE, dbName);
        if (existsSync(dbPath)) {
          rmSync(dbPath);
        }
      } catch {
        /* ignore */
      }
    }
  });

  describe("skill registration", () => {
    it("registers SQLite database skills", () => {
      expect(registry.lookup("db_query")).toBeDefined();
      expect(registry.lookup("db_execute")).toBeDefined();
      expect(registry.lookup("db_batch")).toBeDefined();
      expect(registry.lookup("db_schema")).toBeDefined();
      expect(registry.lookup("db_connections")).toBeDefined();
    });

    it("registers skills as system skills", () => {
      const skill = registry.get("db_query");
      expect(skill.isSystem).toBe(true);
    });
  });

  describe("db_query", () => {
    it("executes a read-only SQL query", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler(
        { sql: "SELECT 1 as num, 'hello' as msg", db: "test_query.db" },
        dummyContext
      );
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as any;
      expect(data.rows).toEqual([{ num: 1, msg: "hello" }]);
      expect(data.rowCount).toBe(1);
      expect(data.columns).toContain("num");
      expect(data.columns).toContain("msg");
    });

    it("supports bind parameters", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler(
        { sql: "SELECT ? as a, ? as b", params: ["x", "y"], db: "test_query.db" },
        dummyContext
      );
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.rows).toEqual([{ a: "x", b: "y" }]);
    });

    it("rejects write operations", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler(
        { sql: "INSERT INTO test VALUES (1)", db: "test_query.db" },
        dummyContext
      );
      expect(result.success).toBe(false);
      expect((result.error as Error).message).toContain("仅允许只读查询");
    });

    it("rejects DELETE in query", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler(
        { sql: "DELETE FROM users WHERE id = 1", db: "test_query.db" },
        dummyContext
      );
      expect(result.success).toBe(false);
    });

    it("rejects multi-statement queries", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler(
        { sql: "SELECT 1; DELETE FROM users;", db: "test_query.db" },
        dummyContext
      );
      expect(result.success).toBe(false);
    });

    it("requires sql parameter", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler({}, dummyContext);
      expect(result.success).toBe(false);
      expect((result.error as Error).message).toContain("sql");
    });

    it("uses default db path when not specified", async () => {
      const skill = registry.get("db_query");
      const result = await skill.handler(
        { sql: "SELECT 1 as num" },
        dummyContext
      );
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.rows).toEqual([{ num: 1 }]);
    });
  });

  describe("db_execute", () => {
    it("runs CREATE TABLE", async () => {
      const skill = registry.get("db_execute");
      const result = await skill.handler(
        {
          sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)",
          db: "test_exec.db",
        },
        dummyContext
      );
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.changes).toBe(0);
    });

    it("runs INSERT and returns lastInsertRowid", async () => {
      const skill = registry.get("db_execute");
      const dbPath = "test_exec.db";
      await skill.handler(
        { sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)", db: dbPath },
        dummyContext
      );
      const result = await skill.handler(
        { sql: "INSERT INTO test_table (name) VALUES ('alice')", db: dbPath },
        dummyContext
      );
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.changes).toBe(1);
      expect(data.lastInsertRowid).toBe(1);
    });

    it("supports bind parameters", async () => {
      const skill = registry.get("db_execute");
      const dbPath = "test_exec.db";
      await skill.handler(
        { sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)", db: dbPath },
        dummyContext
      );
      const result = await skill.handler(
        { sql: "INSERT INTO t (v) VALUES (?)", params: ["val"], db: dbPath },
        dummyContext
      );
      expect(result.success).toBe(true);
      expect((result.data as any).changes).toBe(1);
    });

    it("requires sql parameter", async () => {
      const skill = registry.get("db_execute");
      const result = await skill.handler({}, dummyContext);
      expect(result.success).toBe(false);
      expect((result.error as Error).message).toContain("sql");
    });
  });

  describe("db_batch", () => {
    it("executes multiple statements in a transaction", async () => {
      const skill = registry.get("db_batch");
      const dbPath = "test_batch.db";
      const result = await skill.handler(
        {
          statements: [
            { sql: "CREATE TABLE batch_t (id INTEGER PRIMARY KEY, v TEXT)" },
            { sql: "INSERT INTO batch_t (v) VALUES ('a')" },
            { sql: "INSERT INTO batch_t (v) VALUES ('b')" },
          ],
          db: dbPath,
        },
        dummyContext
      );
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.executed).toBe(3);
      expect(data.totalChanges).toBe(2);
      expect(data.results).toHaveLength(3);
    });

    it("requires statements parameter", async () => {
      const skill = registry.get("db_batch");
      const result = await skill.handler({}, dummyContext);
      expect(result.success).toBe(false);
      expect((result.error as Error).message).toContain("statements");
    });

    it("rejects empty statements array", async () => {
      const skill = registry.get("db_batch");
      const result = await skill.handler({ statements: [] }, dummyContext);
      expect(result.success).toBe(false);
    });

    it("rolls back on error", async () => {
      const skill = registry.get("db_batch");
      const dbPath = "test_batch.db";
      // First create a table
      await registry.get("db_execute").handler(
        { sql: "CREATE TABLE rollback_t (id INTEGER PRIMARY KEY)", db: dbPath },
        dummyContext
      );
      // Then try a batch with an invalid statement
      const result = await skill.handler(
        {
          statements: [
            { sql: "INSERT INTO rollback_t DEFAULT VALUES" },
            { sql: "INVALID SQL HERE" },
          ],
          db: dbPath,
        },
        dummyContext
      );
      expect(result.success).toBe(false);
    });
  });

  describe("db_schema", () => {
    it("returns all tables when no table specified", async () => {
      const skill = registry.get("db_schema");
      const dbPath = "test_schema.db";
      await registry.get("db_execute").handler(
        { sql: "CREATE TABLE foo (id INTEGER)", db: dbPath },
        dummyContext
      );
      const result = await skill.handler({ db: dbPath }, dummyContext);
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.tables).toBeDefined();
      expect(data.tableCount).toBeGreaterThanOrEqual(1);
      const tableNames = data.tables.map((t: any) => t.name);
      expect(tableNames).toContain("foo");
    });

    it("returns specific table info when table is specified", async () => {
      const skill = registry.get("db_schema");
      const dbPath = "test_schema.db";
      await registry.get("db_execute").handler(
        { sql: "CREATE TABLE bar (id INTEGER PRIMARY KEY, name TEXT)", db: dbPath },
        dummyContext
      );
      const result = await skill.handler({ db: dbPath, table: "bar" }, dummyContext);
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.table).toBe("bar");
      expect(data.columns).toBeDefined();
      expect(data.columns.length).toBe(2);
      const colNames = data.columns.map((c: any) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("name");
    });
  });

  describe("db_connections", () => {
    it("lists connections", async () => {
      const skill = registry.get("db_connections");
      const result = await skill.handler({ action: "list" }, dummyContext);
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.connections).toBeDefined();
      expect(typeof data.total).toBe("number");
      expect(data.maxConnections).toBeGreaterThan(0);
    });

    it("closes a specific connection", async () => {
      const skill = registry.get("db_connections");
      // First open a connection via query
      await registry.get("db_query").handler(
        { sql: "SELECT 1", db: "test_conn.db" },
        dummyContext
      );
      const result = await skill.handler(
        { action: "close", db: "test_conn.db" },
        dummyContext
      );
      expect(result.success).toBe(true);
      expect((result.data as any).closed).toBe(true);
    });

    it("closes all connections", async () => {
      const skill = registry.get("db_connections");
      const result = await skill.handler({ action: "close_all" }, dummyContext);
      expect(result.success).toBe(true);
      expect((result.data as any).closed).toBeGreaterThanOrEqual(0);
    });

    it("requires db parameter for close action", async () => {
      const skill = registry.get("db_connections");
      const result = await skill.handler({ action: "close" }, dummyContext);
      expect(result.success).toBe(false);
      expect((result.error as Error).message).toContain("db");
    });
  });
});
