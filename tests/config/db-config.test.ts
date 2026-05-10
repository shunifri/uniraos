import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("db-config pool options (P2)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear cached modules to re-evaluate getters
    // Vitest isolates modules but getters are re-evaluated on each access
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
  });

  it("should load default MySQL pool options", async () => {
    delete process.env.MYSQL_ACQUIRE_TIMEOUT;
    delete process.env.MYSQL_CONNECT_TIMEOUT;
    delete process.env.MYSQL_QUEUE_LIMIT;
    delete process.env.MYSQL_KEEP_ALIVE_DELAY;

    const { dbConfig } = await import("../../src/config/db-config.js");
    const cfg = dbConfig.mysql;

    expect(cfg.poolOptions.acquireTimeout).toBe(60000);
    expect(cfg.poolOptions.connectTimeout).toBe(10000);
    expect(cfg.poolOptions.queueLimit).toBe(0);
    expect(cfg.poolOptions.keepAliveInitialDelay).toBe(10000);
  });

  it("should load custom MySQL pool options from env", async () => {
    process.env.MYSQL_ACQUIRE_TIMEOUT = "30000";
    process.env.MYSQL_CONNECT_TIMEOUT = "5000";
    process.env.MYSQL_QUEUE_LIMIT = "100";
    process.env.MYSQL_KEEP_ALIVE_DELAY = "5000";

    const { dbConfig } = await import("../../src/config/db-config.js");
    const cfg = dbConfig.mysql;

    expect(cfg.poolOptions.acquireTimeout).toBe(30000);
    expect(cfg.poolOptions.connectTimeout).toBe(5000);
    expect(cfg.poolOptions.queueLimit).toBe(100);
    expect(cfg.poolOptions.keepAliveInitialDelay).toBe(5000);
  });

  it("should load default SQLite config", async () => {
    delete process.env.SQLITE_CACHE_SIZE;
    delete process.env.SQLITE_BUSY_TIMEOUT;

    const { dbConfig } = await import("../../src/config/db-config.js");
    const cfg = dbConfig.sqlite;

    expect(cfg.cacheSize).toBe(-64000);
    expect(cfg.busyTimeout).toBe(5000);
    expect(cfg.journalMode).toBe("WAL");
    expect(cfg.synchronous).toBe("NORMAL");
  });

  it("should load custom SQLite config from env", async () => {
    process.env.SQLITE_CACHE_SIZE = "-32000";
    process.env.SQLITE_BUSY_TIMEOUT = "10000";
    process.env.SQLITE_JOURNAL_MODE = "DELETE";
    process.env.SQLITE_SYNCHRONOUS = "FULL";

    const { dbConfig } = await import("../../src/config/db-config.js");
    const cfg = dbConfig.sqlite;

    expect(cfg.cacheSize).toBe(-32000);
    expect(cfg.busyTimeout).toBe(10000);
    expect(cfg.journalMode).toBe("DELETE");
    expect(cfg.synchronous).toBe("FULL");
  });
});
