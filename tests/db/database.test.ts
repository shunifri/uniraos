/**
 * Database initialization and schema management tests
 * Focus: SQLite path without external services
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initDatabase,
  getDb,
  isMySQL,
  isSQLite,
  closeDatabase,
  initDatabaseAsync,
  getDatabaseType,
} from "../../src/db/database.js";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

describe("database.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "raos-db-test-"));
    closeDatabase();
    delete process.env.USE_MYSQL;
  });

  afterEach(() => {
    closeDatabase();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  describe("getDatabaseType / isMySQL / isSQLite", () => {
    it("getDatabaseType returns sqlite when USE_MYSQL is not set", () => {
      delete process.env.USE_MYSQL;
      expect(getDatabaseType()).toBe("sqlite");
    });

    it("getDatabaseType returns mysql when USE_MYSQL is true", () => {
      process.env.USE_MYSQL = "true";
      expect(getDatabaseType()).toBe("mysql");
      delete process.env.USE_MYSQL;
    });

    it("isMySQL returns false when USE_MYSQL is not set", () => {
      delete process.env.USE_MYSQL;
      expect(isMySQL()).toBe(false);
    });

    it("isMySQL returns true when USE_MYSQL is true", () => {
      process.env.USE_MYSQL = "true";
      expect(isMySQL()).toBe(true);
      delete process.env.USE_MYSQL;
    });

    it("isSQLite returns true when USE_MYSQL is not set", () => {
      delete process.env.USE_MYSQL;
      expect(isSQLite()).toBe(true);
    });

    it("isSQLite returns false when USE_MYSQL is true", () => {
      process.env.USE_MYSQL = "true";
      expect(isSQLite()).toBe(false);
      delete process.env.USE_MYSQL;
    });
  });

  describe("initDatabase", () => {
    it("creates a database and returns it", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      expect(db).toBeDefined();
      expect(db.name).toBe(dbPath);
    });

    it("returns same instance on multiple calls (singleton)", () => {
      const dbPath = join(tempDir, "test.db");
      const db1 = initDatabase(dbPath);
      const db2 = initDatabase(dbPath);
      expect(db1).toBe(db2);
    });

    it("throws when MySQL mode is active", () => {
      process.env.USE_MYSQL = "true";
      expect(() => initDatabase()).toThrow("MySQL mode is active");
      delete process.env.USE_MYSQL;
    });

    it("creates schema_version table", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
      expect(table!.name).toBe("schema_version");
    });

    it("creates users table", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
      expect(table!.name).toBe("users");
    });

    it("creates sessions table", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
      expect(table!.name).toBe("sessions");
    });

    it("creates departments table", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='departments'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
      expect(table!.name).toBe("departments");
    });

    it("creates roles table", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='roles'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
      expect(table!.name).toBe("roles");
    });

    it("creates conversations table", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
      expect(table!.name).toBe("conversations");
    });

    it("inserts seed data for root department", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const dept = db
        .prepare("SELECT * FROM departments WHERE id = 'dept_root'")
        .get() as { id: string; name: string } | undefined;
      expect(dept).toBeDefined();
      expect(dept!.name).toBe("全体");
    });

    it("inserts seed data for system roles", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const roles = db
        .prepare("SELECT * FROM roles ORDER BY id")
        .all() as Array<{ id: string; name: string }>;
      expect(roles.length).toBeGreaterThanOrEqual(3);
      const roleNames = roles.map((r) => r.name);
      expect(roleNames).toContain("admin");
      expect(roleNames).toContain("user");
    });

    it("inserts seed data for resources and permissions", () => {
      const dbPath = join(tempDir, "test.db");
      const db = initDatabase(dbPath);
      const resources = db
        .prepare("SELECT COUNT(*) as count FROM resources")
        .get() as { count: number };
      expect(resources.count).toBeGreaterThan(0);
      const permissions = db
        .prepare("SELECT COUNT(*) as count FROM permissions")
        .get() as { count: number };
      expect(permissions.count).toBeGreaterThan(0);
    });
  });

  describe("getDb", () => {
    it("returns the initialized database", () => {
      const dbPath = join(tempDir, "test.db");
      initDatabase(dbPath);
      const db = getDb();
      expect(db).toBeDefined();
    });

    it("throws if database not initialized", () => {
      closeDatabase();
      expect(() => getDb()).toThrow("Database not initialized");
    });

    it("throws when MySQL mode is active", () => {
      process.env.USE_MYSQL = "true";
      expect(() => getDb()).toThrow("MySQL mode is active");
      delete process.env.USE_MYSQL;
    });
  });

  describe("closeDatabase", () => {
    it("closes the database and resets singleton", () => {
      const dbPath = join(tempDir, "test.db");
      initDatabase(dbPath);
      expect(getDb()).toBeDefined();
      closeDatabase();
      expect(() => getDb()).toThrow("Database not initialized");
    });

    it("is safe to call multiple times", () => {
      closeDatabase();
      closeDatabase();
      expect(() => getDb()).toThrow("Database not initialized");
    });
  });

  describe("initDatabaseAsync", () => {
    it("initializes SQLite database when not in MySQL mode", async () => {
      const dbPath = join(tempDir, "async.db");
      delete process.env.USE_MYSQL;
      await initDatabaseAsync(dbPath);
      const db = getDb();
      expect(db).toBeDefined();
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        )
        .get() as { name: string } | undefined;
      expect(table).toBeDefined();
    });

    it("initializes MySQL database when MySQL mode is active", async () => {
      process.env.USE_MYSQL = "true";
      // MySQL adapter is available in test environment, so this should not throw
      await expect(initDatabaseAsync()).resolves.not.toThrow();
      delete process.env.USE_MYSQL;
    });
  });
});
