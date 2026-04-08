import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryGarbageCollector } from "../../src/memory/gc-collect.js";

describe("MemoryGarbageCollector", () => {
  let mockStm: any;
  let mockLtm: any;

  beforeEach(() => {
    mockStm = {
      list: vi.fn().mockReturnValue([
        { key: "recent", value: "data", accessedAt: Date.now() },
        { key: "old", value: "data", accessedAt: Date.now() - 7200_000 },
      ]),
      delete: vi.fn(),
    };
    mockLtm = {
      list: vi.fn().mockReturnValue([
        { key: "active_mem", value: "important", accessCount: 10, lastAccessedAt: Date.now(), createdAt: Date.now() },
        { key: "stale_mem", value: "forgotten", accessCount: 0, lastAccessedAt: Date.now() - 90 * 86400_000, createdAt: Date.now() - 200 * 86400_000 },
        { key: "low_value", value: "x", accessCount: 1, lastAccessedAt: Date.now() - 60 * 86400_000, createdAt: Date.now() - 100 * 86400_000 },
      ]),
      archive: vi.fn().mockResolvedValue({ archived: 1 }),
    };
  });

  it("should identify stale STM entries beyond TTL", () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, { stmMaxAgeMs: 3600_000 });
    const staleEntries = gc.findStaleStmEntries();
    expect(staleEntries).toHaveLength(1);
    expect(staleEntries[0].key).toBe("old");
  });

  it("should identify cold LTM entries for archival", () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, { ltmColdDays: 30, ltmMinAccessCount: 2 });
    const coldEntries = gc.findColdLtmEntries();
    expect(coldEntries.length).toBeGreaterThanOrEqual(1);
    expect(coldEntries.some(e => e.key === "stale_mem")).toBe(true);
  });

  it("should clean STM when running gc", async () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, { stmMaxAgeMs: 3600_000 });
    const report = await gc.collect();
    expect(report.stmCleaned).toBe(1);
    expect(mockStm.delete).toHaveBeenCalledWith("old");
  });

  it("should archive cold LTM entries when running gc", async () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, { ltmColdDays: 30, ltmMinAccessCount: 2 });
    const report = await gc.collect();
    expect(report.ltmArchived).toBeGreaterThanOrEqual(1);
  });
});
