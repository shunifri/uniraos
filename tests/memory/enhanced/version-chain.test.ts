import { describe, it, expect } from "vitest";
import {
  createVersion,
  getHistory,
  getChain,
  getRelated,
  type EnhancedLTMEntry,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  type VersionRelation,
} from "../../../src/memory/enhanced/version-chain.js";

/** Helper: create a minimal EnhancedLTMEntry for testing */
function makeEntry(
  overrides: Partial<EnhancedLTMEntry> & { id: string; key: string },
): EnhancedLTMEntry {
  const now = Date.now();
  return {
    value: overrides.value ?? "test-value",
    tags: [],
    createdAt: now,
    updatedAt: now,
    accessCount: 1,
    lastAccessedAt: now,
    version: 1,
    parentId: null,
    rootId: null,
    relation: "creates",
    isLatest: true,
    forgotten: false,
    ...overrides,
  };
}

describe("VersionChain", () => {
  describe("createVersion", () => {
    it("should create first version with version=1 and relation=creates", () => {
      const entries: EnhancedLTMEntry[] = [];
      const result = createVersion("config", { port: 3000 }, entries);

      expect(result.fields.version).toBe(1);
      expect(result.fields.relation).toBe("creates");
      expect(result.fields.parentId).toBeNull();
      expect(result.fields.rootId).toBeNull();
      expect(result.fields.isLatest).toBe(true);
      expect(result.fields.forgotten).toBe(false);
      expect(result.deprecatedId).toBeNull();
    });

    it("should increment version for same key and default relation to updates", () => {
      const v1 = makeEntry({
        id: "v1",
        key: "config",
        version: 1,
        isLatest: true,
        rootId: "v1",
      });
      const entries = [v1];

      const result = createVersion("config", { port: 4000 }, entries);

      expect(result.fields.version).toBe(2);
      expect(result.fields.relation).toBe("updates");
      expect(result.fields.parentId).toBe("v1");
      expect(result.fields.rootId).toBe("v1");
      expect(result.fields.isLatest).toBe(true);
      expect(result.deprecatedId).toBe("v1");
    });

    it("should use explicit relation when provided", () => {
      const v1 = makeEntry({
        id: "v1",
        key: "config",
        version: 1,
        isLatest: true,
        rootId: "v1",
      });
      const entries = [v1];

      const result = createVersion(
        "config",
        { port: 4000 },
        entries,
        "extends",
      );

      expect(result.fields.relation).toBe("extends");
    });

    it("should use explicit parentId when provided", () => {
      const v1 = makeEntry({
        id: "v1",
        key: "config",
        version: 1,
        isLatest: false,
        rootId: "v1",
      });
      const v2 = makeEntry({
        id: "v2",
        key: "config",
        version: 2,
        isLatest: true,
        parentId: "v1",
        rootId: "v1",
      });
      const entries = [v1, v2];

      // Derive from v1 instead of latest v2
      const result = createVersion(
        "config",
        { port: 5000 },
        entries,
        "derives",
        "v1",
      );

      expect(result.fields.parentId).toBe("v1");
      expect(result.fields.rootId).toBe("v1");
      expect(result.fields.relation).toBe("derives");
      expect(result.fields.version).toBe(3); // still increments from latest
    });

    it("should resolve rootId by walking up parent chain", () => {
      const v1 = makeEntry({
        id: "root-1",
        key: "settings",
        version: 1,
        isLatest: false,
        rootId: "root-1",
        parentId: null,
      });
      const v2 = makeEntry({
        id: "v2",
        key: "settings",
        version: 2,
        isLatest: true,
        parentId: "root-1",
        rootId: "root-1",
      });
      const entries = [v1, v2];

      const result = createVersion("settings", "new-val", entries);

      expect(result.fields.rootId).toBe("root-1");
      expect(result.fields.parentId).toBe("v2");
      expect(result.fields.version).toBe(3);
    });

    it("should ignore forgotten entries when finding latest", () => {
      const v1 = makeEntry({
        id: "v1",
        key: "data",
        version: 1,
        isLatest: true,
        forgotten: true,
        rootId: "v1",
      });
      const entries = [v1];

      const result = createVersion("data", "new", entries);

      // v1 is forgotten so treated as no existing version
      expect(result.fields.version).toBe(1);
      expect(result.fields.relation).toBe("creates");
      expect(result.fields.parentId).toBeNull();
      expect(result.deprecatedId).toBeNull();
    });

    it("should handle multiple keys independently", () => {
      const a1 = makeEntry({
        id: "a1",
        key: "keyA",
        version: 1,
        isLatest: true,
        rootId: "a1",
      });
      const b1 = makeEntry({
        id: "b1",
        key: "keyB",
        version: 1,
        isLatest: true,
        rootId: "b1",
      });
      const entries = [a1, b1];

      const resultA = createVersion("keyA", "val", entries);
      expect(resultA.fields.version).toBe(2);
      expect(resultA.fields.parentId).toBe("a1");

      const resultC = createVersion("keyC", "val", entries);
      expect(resultC.fields.version).toBe(1);
      expect(resultC.fields.relation).toBe("creates");
    });
  });

  describe("getHistory", () => {
    const entries: EnhancedLTMEntry[] = [
      makeEntry({ id: "v1", key: "config", version: 1, isLatest: false }),
      makeEntry({ id: "v2", key: "config", version: 2, isLatest: false }),
      makeEntry({ id: "v3", key: "config", version: 3, isLatest: true }),
      makeEntry({ id: "other", key: "other-key", version: 1, isLatest: true }),
    ];

    it("should return all versions of a key sorted by version descending", () => {
      const history = getHistory("config", entries);

      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(3);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(1);
    });

    it("should not return entries from a different key", () => {
      const history = getHistory("config", entries);
      expect(history.every((e) => e.key === "config")).toBe(true);
    });

    it("should return empty array for nonexistent key", () => {
      expect(getHistory("nonexistent", entries)).toHaveLength(0);
    });

    it("should exclude forgotten entries by default", () => {
      const withForgotten = [
        ...entries,
        makeEntry({
          id: "v4",
          key: "config",
          version: 4,
          isLatest: false,
          forgotten: true,
        }),
      ];

      const history = getHistory("config", withForgotten);
      expect(history).toHaveLength(3);
      expect(history.find((e) => e.id === "v4")).toBeUndefined();
    });

    it("should include forgotten entries when flag is set", () => {
      const withForgotten = [
        ...entries,
        makeEntry({
          id: "v4",
          key: "config",
          version: 4,
          isLatest: false,
          forgotten: true,
        }),
      ];

      const history = getHistory("config", withForgotten, true);
      expect(history).toHaveLength(4);
      expect(history[0].version).toBe(4);
    });
  });

  describe("getChain", () => {
    const entries: EnhancedLTMEntry[] = [
      makeEntry({
        id: "r1",
        key: "settings",
        version: 1,
        parentId: null,
        rootId: "r1",
        isLatest: false,
      }),
      makeEntry({
        id: "r2",
        key: "settings",
        version: 2,
        parentId: "r1",
        rootId: "r1",
        isLatest: false,
      }),
      makeEntry({
        id: "r3",
        key: "settings",
        version: 3,
        parentId: "r2",
        rootId: "r1",
        isLatest: true,
      }),
      makeEntry({
        id: "other1",
        key: "other",
        version: 1,
        isLatest: true,
      }),
    ];

    it("should return complete chain sorted by version ascending from any version", () => {
      // Start from middle
      const chain = getChain("r2", entries);
      expect(chain).toHaveLength(3);
      expect(chain[0].id).toBe("r1");
      expect(chain[1].id).toBe("r2");
      expect(chain[2].id).toBe("r3");
    });

    it("should return complete chain when starting from root", () => {
      const chain = getChain("r1", entries);
      expect(chain).toHaveLength(3);
      expect(chain[0].version).toBe(1);
      expect(chain[2].version).toBe(3);
    });

    it("should return complete chain when starting from latest", () => {
      const chain = getChain("r3", entries);
      expect(chain).toHaveLength(3);
    });

    it("should return empty array for nonexistent id", () => {
      expect(getChain("nonexistent", entries)).toHaveLength(0);
    });

    it("should return single-entry chain for standalone version", () => {
      const chain = getChain("other1", entries);
      expect(chain).toHaveLength(1);
      expect(chain[0].id).toBe("other1");
    });

    it("should handle circular references gracefully", () => {
      const circular: EnhancedLTMEntry[] = [
        makeEntry({
          id: "c1",
          key: "loop",
          version: 1,
          parentId: "c2",
          rootId: "c1",
          isLatest: false,
        }),
        makeEntry({
          id: "c2",
          key: "loop",
          version: 2,
          parentId: "c1",
          rootId: "c1",
          isLatest: true,
        }),
      ];

      // Should not infinite loop
      const chain = getChain("c1", circular);
      expect(chain.length).toBeGreaterThan(0);
    });
  });

  describe("getRelated", () => {
    const entries: EnhancedLTMEntry[] = [
      makeEntry({
        id: "p1",
        key: "db-config",
        version: 1,
        parentId: null,
        rootId: "p1",
        isLatest: false,
        relation: "creates",
      }),
      makeEntry({
        id: "p2",
        key: "db-config",
        version: 2,
        parentId: "p1",
        rootId: "p1",
        isLatest: false,
        relation: "updates",
      }),
      makeEntry({
        id: "p3",
        key: "db-config",
        version: 3,
        parentId: "p2",
        rootId: "p1",
        isLatest: true,
        relation: "extends",
      }),
    ];

    it("should return null for nonexistent id", () => {
      expect(getRelated("nonexistent", entries)).toBeNull();
    });

    it("should return context for middle version", () => {
      const ctx = getRelated("p2", entries)!;

      expect(ctx.entry.id).toBe("p2");
      expect(ctx.parents).toHaveLength(1);
      expect(ctx.parents[0].id).toBe("p1");
      expect(ctx.children).toHaveLength(1);
      expect(ctx.children[0].id).toBe("p3");
    });

    it("should return no parents for root version", () => {
      const ctx = getRelated("p1", entries)!;

      expect(ctx.parents).toHaveLength(0);
      expect(ctx.children).toHaveLength(1);
      expect(ctx.children[0].id).toBe("p2");
    });

    it("should return no children for latest version", () => {
      const ctx = getRelated("p3", entries)!;

      expect(ctx.parents).toHaveLength(2); // walks up: p2, p1
      expect(ctx.parents[0].id).toBe("p2");
      expect(ctx.parents[1].id).toBe("p1");
      expect(ctx.children).toHaveLength(0);
    });

    it("should collect all relation types", () => {
      const ctx = getRelated("p2", entries)!;

      expect(ctx.relationTypes).toContain("updates");
      expect(ctx.relationTypes).toContain("creates");
      expect(ctx.relationTypes).toContain("extends");
    });

    it("should work for standalone entry", () => {
      const standalone = makeEntry({
        id: "solo",
        key: "standalone",
        version: 1,
        relation: "creates",
      });
      const ctx = getRelated("solo", [standalone])!;

      expect(ctx.entry.id).toBe("solo");
      expect(ctx.parents).toHaveLength(0);
      expect(ctx.children).toHaveLength(0);
      expect(ctx.relationTypes).toEqual(["creates"]);
    });
  });

  describe("integration: multi-version workflow", () => {
    it("should support a full create→update→update lifecycle", () => {
      const entries: EnhancedLTMEntry[] = [];

      // Version 1: create
      const r1 = createVersion("user-prefs", { theme: "dark" }, entries);
      expect(r1.fields.version).toBe(1);
      expect(r1.fields.relation).toBe("creates");

      const v1 = makeEntry({
        id: "u1",
        key: "user-prefs",
        ...r1.fields,
        rootId: "u1", // caller sets rootId to own id for first version
        value: { theme: "dark" },
      });
      entries.push(v1);

      // Version 2: update
      const r2 = createVersion("user-prefs", { theme: "light" }, entries);
      expect(r2.fields.version).toBe(2);
      expect(r2.fields.relation).toBe("updates");
      expect(r2.deprecatedId).toBe("u1");

      // Mark old version
      v1.isLatest = false;

      const v2 = makeEntry({
        id: "u2",
        key: "user-prefs",
        ...r2.fields,
        value: { theme: "light" },
      });
      entries.push(v2);

      // Version 3: extend
      const r3 = createVersion(
        "user-prefs",
        { theme: "light", font: "mono" },
        entries,
        "extends",
      );
      expect(r3.fields.version).toBe(3);
      expect(r3.fields.relation).toBe("extends");

      v2.isLatest = false;

      const v3 = makeEntry({
        id: "u3",
        key: "user-prefs",
        ...r3.fields,
        value: { theme: "light", font: "mono" },
      });
      entries.push(v3);

      // Verify history
      const history = getHistory("user-prefs", entries);
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(3);
      expect(history[2].version).toBe(1);

      // Verify chain from middle
      const chain = getChain("u2", entries);
      expect(chain).toHaveLength(3);
      expect(chain[0].id).toBe("u1");
      expect(chain[2].id).toBe("u3");

      // Verify related context for v2
      const ctx = getRelated("u2", entries)!;
      expect(ctx.parents[0].id).toBe("u1");
      expect(ctx.children[0].id).toBe("u3");
    });
  });
});
