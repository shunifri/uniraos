import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryCache } from "../../src/cache/query-cache.js";
import { getRedisClient, resetRedisClient } from "../../src/cache/redis-client.js";

vi.mock("../../src/cache/redis-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cache/redis-client.js")>();
  return {
    ...actual,
    getRedisClient: vi.fn(),
    resetRedisClient: vi.fn(),
  };
});

function createMockRedis() {
  const store = new Map<string, string>();
  const locks = new Map<string, string>();
  return {
    get: vi.fn(async <T>(key: string): Promise<T | null> => {
      const v = store.get(key);
      return v ? JSON.parse(v) : null;
    }),
    set: vi.fn(async (key: string, value: unknown, ttl?: number) => {
      store.set(key, JSON.stringify(value));
    }),
    getClient: vi.fn(() => ({
      set: vi.fn(async (key: string, token: string, ...args: unknown[]) => {
        if (!locks.has(key)) {
          locks.set(key, token);
          return "OK";
        }
        return null;
      }),
      get: vi.fn(async (key: string) => locks.get(key) ?? null),
      del: vi.fn(async (key: string) => { locks.delete(key); }),
    })),
    getPrefixedKey: vi.fn((k: string) => `raos:${k}`),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    increment: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    exists: vi.fn(),
    healthCheck: vi.fn(),
    keys: vi.fn(),
    flushPrefix: vi.fn(),
    close: vi.fn(),
    isClusterMode: vi.fn(),
  };
}

describe("QueryCache", () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as any);
  });

  it("should fetch and cache data on miss", async () => {
    const cache = new QueryCache();
    const fetchFn = vi.fn().mockResolvedValue([{ id: 1 }]);

    const result = await cache.getOrSet("SELECT * FROM t", [], fetchFn);

    expect(result).toEqual([{ id: 1 }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it("should return cached data on hit", async () => {
    const cache = new QueryCache();
    mockRedis.get.mockResolvedValueOnce({ data: [{ id: 2 }], timestamp: Date.now() });
    const fetchFn = vi.fn();

    const result = await cache.getOrSet("SELECT * FROM t", [], fetchFn);

    expect(result).toEqual([{ id: 2 }]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should cache empty results to prevent cache penetration", async () => {
    const cache = new QueryCache();
    const fetchFn = vi.fn().mockResolvedValue([]);

    const result = await cache.getOrSet("SELECT * FROM empty", [], fetchFn);

    expect(result).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ empty: true }),
      30,
    );
  });

  it("should return cached empty result without hitting db", async () => {
    const cache = new QueryCache();
    mockRedis.get.mockResolvedValueOnce({ data: [], empty: true });
    const fetchFn = vi.fn();

    const result = await cache.getOrSet("SELECT * FROM empty", [], fetchFn);

    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should use distributed lock to prevent cache stampede", async () => {
    const cache = new QueryCache();
    const fetchFn = vi.fn().mockResolvedValue([{ id: 3 }]);

    const result = await cache.getOrSet("SELECT * FROM hot", [], fetchFn);

    expect(result).toEqual([{ id: 3 }]);
    // 锁的获取和释放都应该发生
    expect(mockRedis.getClient).toHaveBeenCalled();
  });

  it("should respect maxResults limit", async () => {
    const cache = new QueryCache({ maxResults: 2 });
    const fetchFn = vi.fn().mockResolvedValue([1, 2, 3]);

    await cache.getOrSet("SELECT * FROM t", [], fetchFn);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
