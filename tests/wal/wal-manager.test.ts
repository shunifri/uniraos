import { describe, it, expect, beforeEach } from "vitest";
import { WALManager } from "../../src/wal/wal-manager.js";
import { InMemoryWALStore } from "../../src/wal/wal-store.js";

let wal: WALManager;

beforeEach(() => {
  wal = new WALManager(new InMemoryWALStore());
});

describe("WALManager", () => {
  describe("basic lifecycle", () => {
    it("should create pending entries via begin()", () => {
      const id = wal.begin("trace-1", "skill_a", { key: "val" });
      expect(id).toBeDefined();
      const all = wal.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe("pending");
      expect(all[0].skillName).toBe("skill_a");
      expect(all[0].traceId).toBe("trace-1");
      expect(all[0].params).toEqual({ key: "val" });
    });

    it("should mark entries as completed", () => {
      const id = wal.begin("t", "s", {});
      wal.complete(id, { result: 42 });
      const all = wal.getAll();
      expect(all[0].status).toBe("completed");
      expect(all[0].result).toEqual({ result: 42 });
      expect(all[0].completedAt).toBeDefined();
    });

    it("should mark entries as failed", () => {
      const id = wal.begin("t", "s", {});
      wal.fail(id, "boom");
      const all = wal.getAll();
      expect(all[0].status).toBe("failed");
      expect(all[0].error).toBe("boom");
    });
  });

  describe("parent-child relationships", () => {
    it("should track parentEntryId", () => {
      const parentId = wal.begin("t", "parent", {});
      const childId = wal.begin("t", "child", {}, parentId);
      const all = wal.getAll();
      const child = all.find((e) => e.id === childId)!;
      expect(child.parentEntryId).toBe(parentId);
    });
  });

  describe("getIncomplete", () => {
    it("returns only pending entries", () => {
      const id1 = wal.begin("t", "s1", {});
      const id2 = wal.begin("t", "s2", {});
      wal.begin("t", "s3", {});
      wal.complete(id1);
      wal.fail(id2, "err");

      const incomplete = wal.getIncomplete();
      expect(incomplete).toHaveLength(1);
      expect(incomplete[0].skillName).toBe("s3");
    });

    it("returns empty when all complete", () => {
      const id = wal.begin("t", "s", {});
      wal.complete(id);
      expect(wal.getIncomplete()).toHaveLength(0);
    });
  });

  describe("recovery", () => {
    it("generates recovery plan for incomplete entries", () => {
      wal.begin("t", "s1", {});
      wal.begin("t", "s2", {});
      const plan = wal.recover();
      expect(plan.entries).toHaveLength(2);
      expect(plan.description).toContain("2 skill(s)");
      expect(plan.description).toContain("s1");
      expect(plan.description).toContain("s2");
    });

    it("reports no recovery needed when all complete", () => {
      const id = wal.begin("t", "s", {});
      wal.complete(id);
      const plan = wal.recover();
      expect(plan.entries).toHaveLength(0);
      expect(plan.description).toContain("No incomplete");
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      wal.begin("t", "s1", {});
      wal.begin("t", "s2", {});
      wal.clear();
      expect(wal.getAll()).toHaveLength(0);
    });
  });

  describe("multiple traces", () => {
    it("handles entries from different traces", () => {
      wal.begin("trace-a", "s1", {});
      wal.begin("trace-b", "s2", {});
      const all = wal.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.traceId).sort()).toEqual(["trace-a", "trace-b"]);
    });
  });
});
