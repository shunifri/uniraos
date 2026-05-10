import { config } from "dotenv";
import { initMySQLDatabase } from "../src/db/mysql-database.js";

export default async function setup(): Promise<() => Promise<void>> {
  // Load environment variables from .env files
  config({ path: ".env.local" });
  config({ path: ".env" });

  // Force MySQL backend for tests (override .env.local which may set neo4j)
  process.env.GRAPH_STORE_BACKEND = "mysql";

  // Set test-specific defaults if not already set
  process.env.MYSQL_PRIMARY_HOST = process.env.MYSQL_PRIMARY_HOST || "localhost";
  process.env.MYSQL_PRIMARY_PORT = process.env.MYSQL_PRIMARY_PORT || "3307";
  process.env.MYSQL_USER = process.env.MYSQL_USER || "raos";
  process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "raospassword";
  process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || "raos";

  try {
    await initMySQLDatabase();
  } catch (err: any) {
    // MySQL may not be available in all test environments
    console.log("[globalSetup] MySQL init skipped:", err.message);
  }

  // Return teardown function to close connection pools after all tests
  return async () => {
    try {
      const { closeMySQLAdapter } = await import("../src/db/mysql-adapter.js");
      await closeMySQLAdapter();
      console.log("[globalTeardown] MySQL pools closed");
    } catch (err: any) {
      // Adapter may not have been initialized
      console.log("[globalTeardown] MySQL close skipped:", err.message);
    }
  };
}
