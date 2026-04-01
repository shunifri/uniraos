import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ProfileGenerator } from "../../../src/memory/enhanced/profile-generator.js";
import type { UserProfile } from "../../../src/memory/enhanced/profile-generator.js";
import type { EnhancedLTMEntry } from "../../../src/memory/enhanced/version-chain.js";
import type { LLMProvider } from "../../../src/llm/types.js";

function makeEntry(overrides: Partial<EnhancedLTMEntry> & { key: string; value: unknown }): EnhancedLTMEntry {
  return {
    id: overrides.id ?? `entry-${Math.random().toString(36).slice(2, 8)}`,
    key: overrides.key,
    value: overrides.value,
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago default
    updatedAt: overrides.updatedAt ?? Date.now(),
    accessCount: overrides.accessCount ?? 1,
    lastAccessedAt: overrides.lastAccessedAt ?? Date.now(),
    version: overrides.version ?? 1,
    parentId: overrides.parentId ?? null,
    rootId: overrides.rootId ?? null,
    relation: overrides.relation ?? "creates",
    isLatest: overrides.isLatest ?? true,
    forgotten: overrides.forgotten ?? false,
  };
}

function makeMockLLM(response: { static: string[]; dynamic: string[] }): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(response),
      toolCalls: [],
      finishReason: "stop" as const,
    }),
  };
}

function makeFailingLLM(): LLMProvider {
  return {
    name: "mock-fail",
    model: "mock-model",
    chat: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
  };
}

describe("ProfileGenerator", () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "profile-gen-test-"));
    cachePath = join(tmpDir, "profile-cache.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const gen = new ProfileGenerator({ cachePath });
      expect(gen).toBeDefined();
    });

    it("should load existing cache from file", () => {
      const existingCache: Record<string, UserProfile> = {
        "user-1": {
          userId: "user-1",
          static: ["likes coffee"],
          dynamic: ["working on project X"],
          generatedAt: Date.now(),
          memoryCountAtGeneration: 5,
        },
      };
      writeFileSync(cachePath, JSON.stringify(existingCache), "utf-8");

      const gen = new ProfileGenerator({ cachePath });
      const cached = gen.getCached("user-1");
      expect(cached).not.toBeNull();
      expect(cached!.static).toEqual(["likes coffee"]);
    });

    it("should handle corrupted cache file gracefully", () => {
      writeFileSync(cachePath, "not valid json{{{", "utf-8");
      const gen = new ProfileGenerator({ cachePath });
      expect(gen.getCached("user-1")).toBeNull();
    });
  });

  describe("generate() - rule-based (no LLM)", () => {
    it("should return empty profile for empty entries", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const result = await gen.generate([], undefined, "user-1");
      expect(result.static).toEqual([]);
      expect(result.dynamic).toEqual([]);
    });

    it("should classify old stable facts as static", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "favorite_color", value: "blue", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
        makeEntry({ key: "favorite_color", value: "blue", version: 2, isLatest: true, createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000 }),
      ];
      // Mark the first as not latest
      entries[0].isLatest = false;

      const result = await gen.generate(entries, undefined, "user-1");
      expect(result.static).toHaveLength(1);
      expect(result.static[0]).toContain("favorite_color");
    });

    it("should classify recent single-occurrence facts as dynamic", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "current_mood", value: "happy", createdAt: Date.now() - 1000 }),
      ];

      const result = await gen.generate(entries, undefined, "user-1");
      expect(result.dynamic).toHaveLength(1);
      expect(result.dynamic[0]).toContain("current_mood");
    });

    it("should classify facts with temporal words as dynamic", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "status", value: "I am currently working on a project", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      const result = await gen.generate(entries, undefined, "user-1");
      expect(result.dynamic).toHaveLength(1);
      expect(result.dynamic[0]).toContain("status");
    });

    it("should ignore forgotten entries", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "old_fact", value: "forgotten thing", forgotten: true }),
        makeEntry({ key: "active_fact", value: "still valid", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      const result = await gen.generate(entries, undefined, "user-1");
      // Only active_fact should appear
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.some((f) => f.includes("old_fact"))).toBe(false);
      expect(allFacts.some((f) => f.includes("active_fact"))).toBe(true);
    });

    it("should only use latest versions of each key", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "name", value: "Alice", version: 1, isLatest: false, createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
        makeEntry({ key: "name", value: "Bob", version: 2, isLatest: true, createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000 }),
      ];

      const result = await gen.generate(entries, undefined, "user-1");
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.some((f) => f.includes("Bob"))).toBe(true);
      expect(allFacts.some((f) => f.includes("Alice"))).toBe(false);
    });

    it("should cache the generated profile", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      await gen.generate(entries, undefined, "user-1");
      const cached = gen.getCached("user-1");
      expect(cached).not.toBeNull();
      expect(cached!.userId).toBe("user-1");
      expect(cached!.memoryCountAtGeneration).toBe(1);
    });

    it("should persist cache to file", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      await gen.generate(entries, undefined, "user-1");
      expect(existsSync(cachePath)).toBe(true);

      const fileData = JSON.parse(readFileSync(cachePath, "utf-8"));
      expect(fileData["user-1"]).toBeDefined();
      expect(fileData["user-1"].userId).toBe("user-1");
    });

    it("should use 'default' userId when not provided", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "test", value: "val", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      await gen.generate(entries);
      const cached = gen.getCached("default");
      expect(cached).not.toBeNull();
    });

    it("should handle non-string values", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "settings", value: { theme: "dark" }, createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      const result = await gen.generate(entries, undefined, "user-1");
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.some((f) => f.includes("settings"))).toBe(true);
    });
  });

  describe("generate() - LLM-based", () => {
    it("should use LLM when provided", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const llm = makeMockLLM({
        static: ["User is a software engineer"],
        dynamic: ["Currently learning Rust"],
      });

      const entries = [
        makeEntry({ key: "job", value: "software engineer" }),
        makeEntry({ key: "learning", value: "Rust" }),
      ];

      const result = await gen.generate(entries, llm, "user-1");
      expect(result.static).toEqual(["User is a software engineer"]);
      expect(result.dynamic).toEqual(["Currently learning Rust"]);
      expect(llm.chat).toHaveBeenCalledOnce();
    });

    it("should fall back to rule-based on LLM failure", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const llm = makeFailingLLM();

      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      const result = await gen.generate(entries, llm, "user-1");
      // Should still produce a result via rule-based fallback
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.length).toBeGreaterThan(0);
    });

    it("should handle LLM returning null content", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const llm: LLMProvider = {
        name: "mock-null",
        model: "mock-model",
        chat: vi.fn().mockResolvedValue({
          content: null,
          toolCalls: [],
          finishReason: "stop" as const,
        }),
      };

      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      // Should fall back to rule-based since null content throws
      const result = await gen.generate(entries, llm, "user-1");
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.length).toBeGreaterThan(0);
    });

    it("should handle LLM returning invalid JSON", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const llm: LLMProvider = {
        name: "mock-bad-json",
        model: "mock-model",
        chat: vi.fn().mockResolvedValue({
          content: "This is not JSON at all",
          toolCalls: [],
          finishReason: "stop" as const,
        }),
      };

      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      const result = await gen.generate(entries, llm, "user-1");
      // Falls back to rule-based
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.length).toBeGreaterThan(0);
    });
  });

  describe("getCached()", () => {
    it("should return null for unknown user", () => {
      const gen = new ProfileGenerator({ cachePath });
      expect(gen.getCached("nonexistent")).toBeNull();
    });

    it("should return cached profile after generation", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];

      await gen.generate(entries, undefined, "user-1");
      const cached = gen.getCached("user-1");
      expect(cached).not.toBeNull();
      expect(cached!.userId).toBe("user-1");
    });
  });

  describe("refresh()", () => {
    it("should regenerate profile even if cached", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries1 = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];
      await gen.generate(entries1, undefined, "user-1");

      const entries2 = [
        ...entries1,
        makeEntry({ key: "hobby", value: "painting", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];
      const result = await gen.refresh("user-1", entries2);
      const allFacts = [...result.static, ...result.dynamic];
      expect(allFacts.some((f) => f.includes("hobby"))).toBe(true);

      const cached = gen.getCached("user-1");
      expect(cached!.memoryCountAtGeneration).toBe(2);
    });

    it("should use LLM when provided to refresh", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const llm = makeMockLLM({
        static: ["Refreshed fact"],
        dynamic: [],
      });
      const entries = [makeEntry({ key: "test", value: "val" })];

      const result = await gen.refresh("user-1", entries, llm);
      expect(result.static).toEqual(["Refreshed fact"]);
      expect(llm.chat).toHaveBeenCalledOnce();
    });
  });

  describe("isStale()", () => {
    it("should return true if no cached profile", () => {
      const gen = new ProfileGenerator({ cachePath });
      expect(gen.isStale("user-1", 5)).toBe(true);
    });

    it("should return false for fresh profile with same entry count", async () => {
      const gen = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "name", value: "Alice" }),
      ];
      await gen.generate(entries, undefined, "user-1");

      expect(gen.isStale("user-1", 1)).toBe(false);
    });

    it("should return true when TTL expires", async () => {
      const gen = new ProfileGenerator({ cachePath, cacheTTL: 100 });
      const entries = [makeEntry({ key: "name", value: "Alice" })];
      await gen.generate(entries, undefined, "user-1");

      // Manually set generatedAt to past
      const cached = gen.getCached("user-1")!;
      cached.generatedAt = Date.now() - 200;

      expect(gen.isStale("user-1", 1)).toBe(true);
    });

    it("should return true when entry count exceeds threshold", async () => {
      const gen = new ProfileGenerator({ cachePath, entryThreshold: 5 });
      const entries = [makeEntry({ key: "name", value: "Alice" })];
      await gen.generate(entries, undefined, "user-1");

      // 1 at generation + 5 new = 6 total
      expect(gen.isStale("user-1", 6)).toBe(true);
    });

    it("should return false when entry count is below threshold", async () => {
      const gen = new ProfileGenerator({ cachePath, entryThreshold: 10 });
      const entries = [makeEntry({ key: "name", value: "Alice" })];
      await gen.generate(entries, undefined, "user-1");

      expect(gen.isStale("user-1", 5)).toBe(false);
    });
  });

  describe("cache persistence", () => {
    it("should persist across instances", async () => {
      const gen1 = new ProfileGenerator({ cachePath });
      const entries = [
        makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
      ];
      await gen1.generate(entries, undefined, "user-1");

      // Create new instance with same cache path
      const gen2 = new ProfileGenerator({ cachePath });
      const cached = gen2.getCached("user-1");
      expect(cached).not.toBeNull();
      expect(cached!.static.some((f) => f.includes("name"))).toBe(true);
    });

    it("should handle multiple users in cache", async () => {
      const gen = new ProfileGenerator({ cachePath });

      const entries1 = [makeEntry({ key: "name", value: "Alice", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 })];
      const entries2 = [makeEntry({ key: "name", value: "Bob", createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 })];

      await gen.generate(entries1, undefined, "user-1");
      await gen.generate(entries2, undefined, "user-2");

      expect(gen.getCached("user-1")).not.toBeNull();
      expect(gen.getCached("user-2")).not.toBeNull();
      expect(gen.getCached("user-1")!.static[0]).toContain("Alice");
      expect(gen.getCached("user-2")!.static[0]).toContain("Bob");
    });
  });
});
