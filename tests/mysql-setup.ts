import { beforeAll } from "vitest";
import { initMySQLDatabase } from "../src/db/mysql-database.js";

beforeAll(async () => {
  try {
    await initMySQLDatabase();
  } catch (err) {
    // MySQL 可能不可用，忽略
    console.warn("[Test Setup] MySQL init skipped:", (err as Error).message);
  }
}, 30000);
