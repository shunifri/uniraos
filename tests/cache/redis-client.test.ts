import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { RedisClient, getRedisClient, resetRedisClient } from "../../src/cache/redis-client.js";
import { dbConfig } from "../../src/config/db-config.js";

/**
 * Redis Client Tests
 *
 * These tests require a running Redis server.
 * Set REDIS_HOSTS environment variable to configure the Redis connection.
 * Default: localhost:6379
 */

describe("RedisClient", () => {
  let client: RedisClient;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _testPrefix = "raos:test:";

  // Helper to check if Redis is available
  async function isRedisAvailable(): Promise<boolean> {
    try {
      const tempClient = getRedisClient();
      const isHealthy = await tempClient.healthCheck();
      return isHealthy;
    } catch {
      return false;
    }
  }

  beforeAll(async () => {
    // Reset any existing singleton
    resetRedisClient();
    client = getRedisClient();

    // Verify Redis is available, skip tests if not
    const available = await isRedisAvailable();
    if (!available) {
      console.warn("Redis is not available, skipping Redis tests");
    }
  });

  afterAll(async () => {
    if (client) {
      await client.close();
      resetRedisClient();
    }
  });

  beforeEach(async () => {
    // Clean up test keys before each test
    if (client) {
      const keys = await client.keys("test:*");
      for (const key of keys) {
        await client.delete(`test:${key}`);
      }
    }
  });

  describe("Basic Operations", () => {
    it("should set and get a value", async () => {
      // Skip if Redis is not available
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:basic";
      const value = { name: "test", value: 123 };

      await client.set(key, value);
      const result = await client.get<typeof value>(key);

      expect(result).toEqual(value);

      // Cleanup
      await client.delete(key);
    });

    it("should return null for non-existent key", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const result = await client.get("test:nonexistent");
      expect(result).toBeNull();
    });

    it("should set value with TTL", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:ttl";
      const value = { temp: true };

      await client.set(key, value, 1); // 1 second TTL

      // Should exist immediately
      let result = await client.get<typeof value>(key);
      expect(result).toEqual(value);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      result = await client.get<typeof value>(key);
      expect(result).toBeNull();
    });

    it("should delete a key", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:delete";
      await client.set(key, "value");

      // Verify it exists
      let exists = await client.exists(key);
      expect(exists).toBe(true);

      // Delete it
      await client.delete(key);

      // Verify it's gone
      exists = await client.exists(key);
      expect(exists).toBe(false);
    });

    it("should delete multiple keys", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const keys = ["test:multi1", "test:multi2", "test:multi3"];
      for (const key of keys) {
        await client.set(key, "value");
      }

      await client.deleteMany(keys);

      for (const key of keys) {
        const exists = await client.exists(key);
        expect(exists).toBe(false);
      }
    });

    it("should increment a counter", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:counter";

      const result1 = await client.increment(key);
      expect(result1).toBe(1);

      const result2 = await client.increment(key, 5);
      expect(result2).toBe(6);

      const result3 = await client.increment(key, -2);
      expect(result3).toBe(4);

      // Cleanup
      await client.delete(key);
    });

    it("should set expiration on a key", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:expire";
      await client.set(key, "value");

      // Set 2 second expiration
      await client.expire(key, 2);

      // Check TTL
      const ttl = await client.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 2100));

      const result = await client.get(key);
      expect(result).toBeNull();
    });

    it("should check if key exists", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:exists";

      let exists = await client.exists(key);
      expect(exists).toBe(false);

      await client.set(key, "value");

      exists = await client.exists(key);
      expect(exists).toBe(true);

      // Cleanup
      await client.delete(key);
    });
  });

  describe("Data Types", () => {
    it("should handle string values", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:string";
      const value = "Hello, Redis!";

      await client.set(key, value);
      const result = await client.get<string>(key);

      expect(result).toBe(value);

      // Cleanup
      await client.delete(key);
    });

    it("should handle number values", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:number";
      const value = 42.5;

      await client.set(key, value);
      const result = await client.get<number>(key);

      expect(result).toBe(value);

      // Cleanup
      await client.delete(key);
    });

    it("should handle object values", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:object";
      const value = {
        id: 123,
        name: "Test Object",
        nested: {
          array: [1, 2, 3],
          bool: true,
          null: null,
        },
      };

      await client.set(key, value);
      const result = await client.get<typeof value>(key);

      expect(result).toEqual(value);

      // Cleanup
      await client.delete(key);
    });

    it("should handle array values", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:array";
      const value = [1, "two", { three: 3 }, [4, 5]];

      await client.set(key, value);
      const result = await client.get<typeof value>(key);

      expect(result).toEqual(value);

      // Cleanup
      await client.delete(key);
    });

    it("should handle boolean values", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key1 = "test:bool_true";
      const key2 = "test:bool_false";

      await client.set(key1, true);
      await client.set(key2, false);

      const result1 = await client.get<boolean>(key1);
      const result2 = await client.get<boolean>(key2);

      expect(result1).toBe(true);
      expect(result2).toBe(false);

      // Cleanup
      await client.delete(key1);
      await client.delete(key2);
    });

    it("should handle null values", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const key = "test:null";

      await client.set(key, null);
      const result = await client.get<null>(key);

      expect(result).toBeNull();

      // Cleanup
      await client.delete(key);
    });
  });

  describe("Health Check", () => {
    it("should return true when Redis is healthy", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });
  });

  describe("Keys Pattern", () => {
    it("should find keys matching pattern", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      // Set up some test keys
      await client.set("test:pattern:one", "1");
      await client.set("test:pattern:two", "2");
      await client.set("test:other:three", "3");

      const keys = await client.keys("test:pattern:*");

      expect(keys).toContain("test:pattern:one");
      expect(keys).toContain("test:pattern:two");
      expect(keys).not.toContain("test:other:three");

      // Cleanup
      await client.delete("test:pattern:one");
      await client.delete("test:pattern:two");
      await client.delete("test:other:three");
    });
  });

  describe("Key Prefix", () => {
    it("should use configured key prefix", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      // The client uses the prefix from dbConfig
      expect(dbConfig.redis.keyPrefix).toBe("raos:");

      // Set a value
      await client.set("test:prefixed", "value");

      // Get it back
      const result = await client.get("test:prefixed");
      expect(result).toBe("value");

      // Cleanup
      await client.delete("test:prefixed");
    });
  });

  describe("Raw Client Access", () => {
    it("should provide access to raw Redis client", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      const rawClient = client.getClient();
      expect(rawClient).toBeDefined();
      expect(typeof rawClient.ping).toBe("function");
    });

    it("should report cluster mode correctly", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      // In tests, we typically have a single Redis node
      expect(client.isClusterMode()).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should handle get errors gracefully", async () => {
      const available = await isRedisAvailable();
      if (!available) {
        console.warn("Skipping test: Redis not available");
        return;
      }

      // Getting a non-existent key should return null, not throw
      const result = await client.get("test:nonexistent:key");
      expect(result).toBeNull();
    });
  });
});

describe("getRedisClient Singleton", () => {
  it("should return the same instance", () => {
    resetRedisClient();
    const client1 = getRedisClient();
    const client2 = getRedisClient();
    expect(client1).toBe(client2);
  });

  it("should create new instance after reset", () => {
    resetRedisClient();
    const client1 = getRedisClient();
    resetRedisClient();
    const client2 = getRedisClient();
    expect(client1).not.toBe(client2);
  });
});
