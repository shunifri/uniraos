import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataMigrator } from "../../../src/memory/enhanced/data-migrator.js";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

describe("DataMigrator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(process.cwd(), "test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should detect migration need", () => {
    const migrator = new DataMigrator();
    expect(migrator.needsMigration(tempDir)).toBe(true);
  });

  it("should migrate data", () => {
    const migrator = new DataMigrator();

    // Write old format data
    const oldData = [
      {
        id: "1",
        key: "test",
        value: "value",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 1,
        lastAccessedAt: Date.now(),
      },
    ];

    writeFileSync(join(tempDir, "index.json"), JSON.stringify(oldData));

    const result = migrator.migrate(tempDir);

    expect(result.migrated).toBe(1);
    expect(migrator.needsMigration(tempDir)).toBe(false);
  });

  it("should create backup before migration", () => {
    const migrator = new DataMigrator();

    const oldData = [
      {
        id: "1",
        key: "test",
        value: "value",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 1,
        lastAccessedAt: Date.now(),
      },
    ];

    writeFileSync(join(tempDir, "index.json"), JSON.stringify(oldData));
    const result = migrator.migrate(tempDir);

    expect(result.backupPath).toContain("_backup_");
  });

  it("should be idempotent", () => {
    const migrator = new DataMigrator();

    const oldData = [
      {
        id: "1",
        key: "test",
        value: "value",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 1,
        lastAccessedAt: Date.now(),
      },
    ];

    writeFileSync(join(tempDir, "index.json"), JSON.stringify(oldData));

    const result1 = migrator.migrate(tempDir);
    const result2 = migrator.migrate(tempDir);

    expect(result1.migrated).toBe(1);
    expect(result2.migrated).toBe(0);
  });
});
