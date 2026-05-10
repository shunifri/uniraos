/**
 * MySQL Adapter Tests
 * Tests for connection pooling, read-write splitting, transactions, and health checks
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  MySQLAdapter,
  getMySQLAdapter,
  resetMySQLAdapter,
} from "../../src/db/mysql-adapter.js";

// Test configuration
const TEST_DB = "raos_test";
const TEST_TABLE = "test_users";

// Helper to create a direct connection for test setup
async function createDirectConnection(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.MYSQL_PRIMARY_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PRIMARY_PORT || "3306"),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "root",
    database: TEST_DB,
  });
}

// Helper to setup test table
async function setupTestTable(connection: mysql.Connection): Promise<void> {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Helper to cleanup test table
async function cleanupTestTable(connection: mysql.Connection): Promise<void> {
  await connection.execute(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
}

describe("MySQLAdapter", () => {
  let adapter: MySQLAdapter;
  let directConnection: mysql.Connection;

  beforeAll(async () => {
    // Check if MySQL is available
    try {
      directConnection = await createDirectConnection();
      await directConnection.ping();
    } catch (error) {
      console.warn("MySQL not available, skipping tests. Error:", error);
      // Mark all tests to skip
      return;
    }

    // Setup test table
    await setupTestTable(directConnection);
  });

  afterAll(async () => {
    if (directConnection) {
      await cleanupTestTable(directConnection);
      await directConnection.end();
    }
    if (adapter) {
      await adapter.close();
    }
    resetMySQLAdapter();
  });

  beforeEach(async () => {
    resetMySQLAdapter();
    adapter = getMySQLAdapter();

    // Clear test data before each test
    if (directConnection) {
      await directConnection.execute(`TRUNCATE TABLE ${TEST_TABLE}`);
    }
  });

  describe("execute() - Write Operations", () => {
    it("should return affected rows for INSERT", async () => {
      // This test will be skipped if MySQL is not available
      if (!directConnection) {
        return;
      }

      const result = await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["John Doe", "john@example.com"]
      );

      expect(result.affectedRows).toBe(1);
      expect(result.insertId).toBeGreaterThan(0);
    });

    it("should return affected rows for multiple INSERTs", async () => {
      if (!directConnection) {
        return;
      }

      const users = [
        ["Alice", "alice@example.com"],
        ["Bob", "bob@example.com"],
        ["Charlie", "charlie@example.com"],
      ];

      for (const [name, email] of users) {
        const result = await adapter.execute(
          `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
          [name, email]
        );
        expect(result.affectedRows).toBe(1);
      }

      // Verify all inserted
      const rows = await adapter.queryPrimary(
        `SELECT COUNT(*) as count FROM ${TEST_TABLE}`
      );
      expect(rows[0].count).toBe(3);
    });

    it("should return affected rows for UPDATE", async () => {
      if (!directConnection) {
        return;
      }

      // Insert a user first
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Test User", "test@example.com"]
      );

      // Update the user
      const result = await adapter.execute(
        `UPDATE ${TEST_TABLE} SET name = ? WHERE email = ?`,
        ["Updated Name", "test@example.com"]
      );

      expect(result.affectedRows).toBe(1);
    });

    it("should return affected rows for DELETE", async () => {
      if (!directConnection) {
        return;
      }

      // Insert a user first
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Delete Me", "delete@example.com"]
      );

      // Delete the user
      const result = await adapter.execute(
        `DELETE FROM ${TEST_TABLE} WHERE email = ?`,
        ["delete@example.com"]
      );

      expect(result.affectedRows).toBe(1);
    });
  });

  describe("query() - Read Operations", () => {
    it("should return rows for SELECT query", async () => {
      if (!directConnection) {
        return;
      }

      // Insert test data
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Query Test", "query@example.com"]
      );

      // Query the data
      const rows = await adapter.query(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["query@example.com"]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Query Test");
      expect(rows[0].email).toBe("query@example.com");
    });

    it("should return empty array for no results", async () => {
      if (!directConnection) {
        return;
      }

      const rows = await adapter.query(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["nonexistent@example.com"]
      );

      expect(rows).toHaveLength(0);
    });

    it("should route queries to available pool (replica or primary)", async () => {
      if (!directConnection) {
        return;
      }

      // Insert data via primary
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Routing Test", "routing@example.com"]
      );

      // Query should work (routes to replica if available, otherwise primary)
      const rows = await adapter.query(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["routing@example.com"]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Routing Test");
    });
  });

  describe("queryPrimary() - Primary Read Operations", () => {
    it("should read from primary for read-after-write consistency", async () => {
      if (!directConnection) {
        return;
      }

      // Insert data
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Primary Read Test", "primary-read@example.com"]
      );

      // Read from primary (ensures immediate consistency)
      const rows = await adapter.queryPrimary(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["primary-read@example.com"]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Primary Read Test");
    });
  });

  describe("transaction() - Transaction Support", () => {
    it("should commit transaction on success", async () => {
      if (!directConnection) {
        return;
      }

      const result = await adapter.transaction(async (connection) => {
        // Insert first user
        await connection.execute(
          `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
          ["Tx User 1", "tx1@example.com"]
        );

        // Insert second user
        await connection.execute(
          `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
          ["Tx User 2", "tx2@example.com"]
        );

        return { success: true, count: 2 };
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);

      // Verify both users were inserted
      const rows = await adapter.queryPrimary(
        `SELECT * FROM ${TEST_TABLE} WHERE email LIKE 'tx%@example.com'`
      );
      expect(rows).toHaveLength(2);
    });

    it("should rollback transaction on error", async () => {
      if (!directConnection) {
        return;
      }

      // First insert a user that will cause a conflict
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Existing User", "conflict@example.com"]
      );

      // Try to insert users with a conflict (duplicate email)
      let errorThrown = false;
      try {
        await adapter.transaction(async (connection) => {
          // Insert first user
          await connection.execute(
            `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
            ["Rollback Test 1", "rollback1@example.com"]
          );

          // Try to insert duplicate (will fail)
          await connection.execute(
            `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
            ["Rollback Test 2", "conflict@example.com"] // Duplicate email
          );

          return { success: true };
        });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (__error) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);

      // Verify first user was NOT inserted (transaction rolled back)
      const rows = await adapter.queryPrimary(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["rollback1@example.com"]
      );
      expect(rows).toHaveLength(0);
    });

    it("should rollback on explicit throw", async () => {
      if (!directConnection) {
        return;
      }

      let errorThrown = false;
      try {
        await adapter.transaction(async (connection) => {
          await connection.execute(
            `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
            ["Will Rollback", "rollback@example.com"]
          );

          throw new Error("Intentional error for rollback test");
        });
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toBe(
          "Intentional error for rollback test"
        );
      }

      expect(errorThrown).toBe(true);

      // Verify no data was inserted
      const rows = await adapter.queryPrimary(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["rollback@example.com"]
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("healthCheck() - Health Check", () => {
    it("should return health status for primary and replicas", async () => {
      if (!directConnection) {
        return;
      }

      const health = await adapter.healthCheck();

      expect(health).toHaveProperty("primary");
      expect(health).toHaveProperty("replicas");
      expect(typeof health.primary).toBe("boolean");
      expect(Array.isArray(health.replicas)).toBe(true);

      // Primary should be healthy
      expect(health.primary).toBe(true);
    });
  });

  describe("queryWithFields() - Advanced Query", () => {
    it("should return rows and field metadata", async () => {
      if (!directConnection) {
        return;
      }

      // Insert test data
      await adapter.execute(
        `INSERT INTO ${TEST_TABLE} (name, email) VALUES (?, ?)`,
        ["Fields Test", "fields@example.com"]
      );

      // Query with fields
      const result = await adapter.queryWithFields(
        `SELECT * FROM ${TEST_TABLE} WHERE email = ?`,
        ["fields@example.com"],
        true // use primary
      );

      expect(result.rows).toHaveLength(1);
      expect(result.fields).toBeDefined();
      expect(Array.isArray(result.fields)).toBe(true);
      expect(result.fields.length).toBeGreaterThan(0);

      // Check field metadata
      const fieldNames = result.fields.map((f: any) => f.name);
      expect(fieldNames).toContain("id");
      expect(fieldNames).toContain("name");
      expect(fieldNames).toContain("email");
    });
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance from getMySQLAdapter", () => {
      resetMySQLAdapter();
      const adapter1 = getMySQLAdapter();
      const adapter2 = getMySQLAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it("should create new instance after reset", () => {
      resetMySQLAdapter();
      const adapter1 = getMySQLAdapter();
      resetMySQLAdapter();
      const adapter2 = getMySQLAdapter();
      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe("Error Handling", () => {
    it("should throw error for invalid SQL", async () => {
      if (!directConnection) {
        return;
      }

      await expect(
        adapter.execute("INVALID SQL SYNTAX", [])
      ).rejects.toThrow();
    });

    it("should throw error for missing table", async () => {
      if (!directConnection) {
        return;
      }

      await expect(
        adapter.query("SELECT * FROM nonexistent_table_xyz")
      ).rejects.toThrow();
    });
  });
});
