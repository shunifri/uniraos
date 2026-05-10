import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LRUCache } from "../../src/utils/lru-cache.js";

describe("lru-cache", () => {
  describe("LRUCache", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should store and retrieve values", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      expect(cache.get("a")).toBe("apple");
    });

    it("should return undefined for missing keys", () => {
      const cache = new LRUCache<string>(3, 1000);
      expect(cache.get("missing")).toBeUndefined();
    });

    it("should return undefined for expired entries", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      vi.advanceTimersByTime(1001);
      expect(cache.get("a")).toBeUndefined();
    });

    it("should evict least recently used when exceeding max size", () => {
      const cache = new LRUCache<string>(2, 1000);
      cache.set("a", "apple");
      cache.set("b", "banana");
      cache.set("c", "cherry");

      expect(cache.get("a")).toBeUndefined(); // evicted
      expect(cache.get("b")).toBe("banana");
      expect(cache.get("c")).toBe("cherry");
    });

    it("should update LRU order on get", () => {
      const cache = new LRUCache<string>(2, 1000);
      cache.set("a", "apple");
      cache.set("b", "banana");

      // Access 'a' to make it recently used
      cache.get("a");

      // Add 'c' — 'b' should be evicted since 'a' was just accessed
      cache.set("c", "cherry");
      expect(cache.get("a")).toBe("apple");
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe("cherry");
    });

    it("should update LRU order on set of existing key", () => {
      const cache = new LRUCache<string>(2, 1000);
      cache.set("a", "apple");
      cache.set("b", "banana");
      cache.set("a", "apricot"); // re-set 'a'

      cache.set("c", "cherry");
      expect(cache.get("a")).toBe("apricot");
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe("cherry");
    });

    it("should check existence with has()", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      expect(cache.has("a")).toBe(true);
      expect(cache.has("missing")).toBe(false);
    });

    it("has() should return false for expired entries", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      vi.advanceTimersByTime(1001);
      expect(cache.has("a")).toBe(false);
    });

    it("should delete specific keys", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.delete("a")).toBe(false);
    });

    it("should clear all entries", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      cache.set("b", "banana");
      cache.clear();
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it("should report correct size", () => {
      const cache = new LRUCache<string>(3, 1000);
      expect(cache.size).toBe(0);
      cache.set("a", "apple");
      expect(cache.size).toBe(1);
      cache.set("b", "banana");
      expect(cache.size).toBe(2);
    });

    it("should refresh timestamp on get", () => {
      const cache = new LRUCache<string>(3, 1000);
      cache.set("a", "apple");
      vi.advanceTimersByTime(500);
      cache.get("a"); // refreshes timestamp
      vi.advanceTimersByTime(600);
      expect(cache.get("a")).toBe("apple"); // still valid because refreshed
    });

    it("should handle has() without updating LRU order", () => {
      const cache = new LRUCache<string>(2, 1000);
      cache.set("a", "apple");
      cache.set("b", "banana");
      cache.has("a"); // does not update LRU
      cache.set("c", "cherry");
      expect(cache.get("a")).toBeUndefined(); // still evicted
      expect(cache.get("b")).toBe("banana");
    });

    it("should handle mixed types", () => {
      const cache = new LRUCache<unknown>(3, 1000);
      cache.set("num", 42);
      cache.set("obj", { key: "val" });
      cache.set("arr", [1, 2, 3]);

      expect(cache.get("num")).toBe(42);
      expect(cache.get("obj")).toEqual({ key: "val" });
      expect(cache.get("arr")).toEqual([1, 2, 3]);
    });
  });
});
