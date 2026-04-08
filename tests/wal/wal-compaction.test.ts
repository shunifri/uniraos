import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WALManager } from "../../src/wal/wal-manager.js";
import { FileWALStore } from "../../src/wal/file-wal-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("WAL Compaction", () => {
  let walDir: string;
  let walFile: string;
  let wal: WALManager;

  beforeEach(() => {
    walDir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-test-"));
    walFile = path.join(walDir, "wal.jsonl");
    wal = new WALManager(new FileWALStore(walFile));
  });

  afterEach(() => {
    fs.rmSync(walDir, { recursive: true, force: true });
  });

  it("should compact completed entries from WAL file", () => {
    // Create 10 completed entries
    for (let i = 0; i < 10; i++) {
      const id = wal.begin(`trace-${i}`, `skill_${i}`, { i });
      wal.complete(id, { result: i });
    }
    // Create one incomplete entry
    wal.begin("trace-incomplete", "running_skill", {});

    const beforeSize = fs.statSync(walFile).size;

    const result = wal.compact();
    const afterSize = fs.statSync(walFile).size;

    expect(result.removedEntries).toBeGreaterThan(0);
    expect(result.removedEntries).toBe(10);
    expect(result.remainingEntries).toBe(1);
    expect(afterSize).toBeLessThan(beforeSize);

    // Incomplete entry should remain
    const content = fs.readFileSync(walFile, "utf-8");
    expect(content).toContain("running_skill");
  });

  it("should preserve incomplete entries during compaction", () => {
    const id1 = wal.begin("trace-1", "pending_skill", {});
    const id2 = wal.begin("trace-2", "finished_skill", {});
    wal.complete(id2, { done: true });

    const result = wal.compact();

    expect(result.removedEntries).toBe(1);
    expect(result.remainingEntries).toBe(1);

    const content = fs.readFileSync(walFile, "utf-8");
    expect(content).toContain("pending_skill");
    expect(content).not.toContain("finished_skill");

    // In-memory state should still be intact
    const incomplete = wal.getIncomplete();
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].id).toBe(id1);
  });

  it("should remove all entries when all are completed", () => {
    const id1 = wal.begin("trace-1", "skill_a", {});
    const id2 = wal.begin("trace-2", "skill_b", {});
    wal.complete(id1, { ok: true });
    wal.complete(id2, { ok: true });

    const result = wal.compact();

    expect(result.removedEntries).toBe(2);
    expect(result.remainingEntries).toBe(0);

    const content = fs.readFileSync(walFile, "utf-8");
    expect(content.trim()).toBe("");
  });

  it("should remove failed entries during compaction", () => {
    const id1 = wal.begin("trace-1", "failed_skill", {});
    wal.fail(id1, "something went wrong");
    wal.begin("trace-2", "pending_skill", {});

    const result = wal.compact();

    expect(result.removedEntries).toBe(1);
    expect(result.remainingEntries).toBe(1);

    const content = fs.readFileSync(walFile, "utf-8");
    expect(content).not.toContain("failed_skill");
    expect(content).toContain("pending_skill");
  });

  it("should handle compaction on an empty WAL", () => {
    const result = wal.compact();

    expect(result.removedEntries).toBe(0);
    expect(result.remainingEntries).toBe(0);
  });

  it("should produce a valid reloadable WAL file after compaction", () => {
    const id1 = wal.begin("trace-1", "completed_skill", {});
    wal.complete(id1, { done: true });
    wal.begin("trace-2", "pending_skill", { key: "value" });

    wal.compact();

    // Reload from the compacted file
    const reloadedWal = new WALManager(new FileWALStore(walFile));
    const all = reloadedWal.getAll();
    const incomplete = reloadedWal.getIncomplete();

    expect(all).toHaveLength(1);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].skillName).toBe("pending_skill");
    expect(incomplete[0].params).toEqual({ key: "value" });
  });
});
