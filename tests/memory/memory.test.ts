import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShortTermMemory } from "../../src/memory/stm.js";
import { FileLTMBackend, MySQLLTMBackend, LongTermMemory } from "../../src/memory/ltm.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ShortTermMemory", () => {
  let stm: ShortTermMemory;

  beforeEach(() => {
    stm = new ShortTermMemory({ maxEntries: 5 });
  });

  it("should store and retrieve values", () => {
    stm.set("name", "Alice");
    expect(stm.get("name")).toBe("Alice");
  });

  it("should return undefined for missing keys", () => {
    expect(stm.get("nonexistent")).toBeUndefined();
  });

  it("should delete values", () => {
    stm.set("key", "value");
    expect(stm.delete("key")).toBe(true);
    expect(stm.get("key")).toBeUndefined();
  });

  it("should evict LRU when maxEntries exceeded", () => {
    for (let i = 0; i < 5; i++) stm.set(`k${i}`, i);
    // Access k1-k4 to make them recent, leaving k0 as oldest
    stm.get("k1"); stm.get("k2"); stm.get("k3"); stm.get("k4");
    // Add one more, should evict k0 (least recently accessed)
    stm.set("k5", 5);
    expect(stm.size).toBe(5);
    expect(stm.get("k0")).toBeUndefined(); // evicted
    expect(stm.get("k1")).toBe(1); // still there
  });

  it("should search by keyword", () => {
    stm.set("user_name", "Alice");
    stm.set("user_age", 30);
    stm.set("color", "blue");
    const results = stm.search("user");
    expect(results.length).toBe(2);
  });
});

describe("LongTermMemory (FileLTMBackend)", () => {
  let ltm: FileLTMBackend;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "raos-ltm-"));
    ltm = new FileLTMBackend({ storePath: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should store and retrieve by key", async () => {
    await ltm.store("pref", "dark_mode");
    const entry = await ltm.getByKey("pref");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe("dark_mode");
  });

  it("should search by keyword", async () => {
    await ltm.store("user_pref", "likes pools", { tags: ["hotel"], summary: "User prefers hotel with pool" });
    await ltm.store("flight_pref", "window seat", { tags: ["flight"] });
    const results = await ltm.search("pool");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // user_pref should rank highest (matches value + summary)
    expect(results[0].key).toBe("user_pref");
  });

  it("should search by tags", async () => {
    await ltm.store("a", 1, { tags: ["x"] });
    await ltm.store("b", 2, { tags: ["y"] });
    await ltm.store("c", 3, { tags: ["x", "y"] });
    const r2 = await ltm.search("a", { tags: ["x"] });
    expect(r2.some((e) => e.key === "a")).toBe(true);
  });

  it("should persist and reload", async () => {
    await ltm.store("persist_test", { important: true }, { tags: ["test"] });
    // Create new instance pointing to same dir
    const ltm2 = new FileLTMBackend({ storePath: tmpDir });
    const entry = await ltm2.getByKey("persist_test");
    expect(entry).toBeDefined();
    expect((entry!.value as any).important).toBe(true);
  });

  it("should delete by key", async () => {
    await ltm.store("to_delete", "gone");
    expect(await ltm.deleteByKey("to_delete")).toBe(true);
    expect(await ltm.getByKey("to_delete")).toBeUndefined();
  });

  it("should report stats", async () => {
    await ltm.store("a", 1, { tags: ["x", "y"] });
    await ltm.store("b", 2, { tags: ["x"] });
    const stats = await ltm.stats();
    expect(stats.total).toBe(2);
    expect(stats.tags["x"]).toBe(2);
    expect(stats.tags["y"]).toBe(1);
  });

  it("LongTermMemory alias should be MySQLLTMBackend", () => {
    expect(LongTermMemory).toBe(MySQLLTMBackend);
  });
});
