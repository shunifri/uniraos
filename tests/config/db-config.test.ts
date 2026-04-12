import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MySQLConfig, QdrantConfig, RedisConfig } from "../../src/config/db-config.js";

describe("db-config", () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset modules cache to re-evaluate the module with fresh env
    vi.resetModules();
    // Reset process.env to a copy of original
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("MySQLConfig", () => {
    it("should load with default values", async () => {
      // Clear env to test defaults
      const originalEnv = { ...process.env };
      delete process.env.MYSQL_PRIMARY_PORT;
      delete process.env.MYSQL_PASSWORD;
      
      // Import module fresh to get default values
      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.mysql.primary.host).toBe("localhost");
      expect(dbConfig.mysql.primary.port).toBe(3306);
      expect(dbConfig.mysql.primary.user).toBe("raos");
      expect(dbConfig.mysql.primary.password).toBe("password");
      expect(dbConfig.mysql.primary.database).toBe("raos");
      expect(dbConfig.mysql.primary.connectionLimit).toBe(20);
      
      // Restore env
      Object.assign(process.env, originalEnv);
    });

    it("should load with custom env values", async () => {
      process.env.MYSQL_PRIMARY_HOST = "mysql-primary.example.com";
      process.env.MYSQL_PRIMARY_PORT = "3307";
      process.env.MYSQL_USER = "customuser";
      process.env.MYSQL_PASSWORD = "secretpassword";
      process.env.MYSQL_DATABASE = "mydb";
      process.env.MYSQL_CONN_LIMIT = "50";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.mysql.primary.host).toBe("mysql-primary.example.com");
      expect(dbConfig.mysql.primary.port).toBe(3307);
      expect(dbConfig.mysql.primary.user).toBe("customuser");
      expect(dbConfig.mysql.primary.password).toBe("secretpassword");
      expect(dbConfig.mysql.primary.database).toBe("mydb");
      expect(dbConfig.mysql.primary.connectionLimit).toBe(50);
    });

    it("should parse single replica host correctly", async () => {
      process.env.MYSQL_REPLICA_HOSTS = "replica1.example.com";
      process.env.MYSQL_REPLICA_PORT = "3308";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.mysql.replicas).toHaveLength(1);
      expect(dbConfig.mysql.replicas[0].host).toBe("replica1.example.com");
      expect(dbConfig.mysql.replicas[0].port).toBe(3308);
      expect(dbConfig.mysql.replicas[0].connectionLimit).toBe(30);
    });

    it("should parse multiple replica hosts correctly", async () => {
      process.env.MYSQL_REPLICA_HOSTS = "replica1.example.com, replica2.example.com, replica3.example.com";
      process.env.MYSQL_REPLICA_PORT = "3309";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.mysql.replicas).toHaveLength(3);
      expect(dbConfig.mysql.replicas[0].host).toBe("replica1.example.com");
      expect(dbConfig.mysql.replicas[1].host).toBe("replica2.example.com");
      expect(dbConfig.mysql.replicas[2].host).toBe("replica3.example.com");
      expect(dbConfig.mysql.replicas.every(r => r.port === 3309)).toBe(true);
      expect(dbConfig.mysql.replicas.every(r => r.connectionLimit === 30)).toBe(true);
    });

    it("should filter out empty replica hosts", async () => {
      process.env.MYSQL_REPLICA_HOSTS = "replica1.example.com,,replica2.example.com,";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.mysql.replicas).toHaveLength(2);
      expect(dbConfig.mysql.replicas[0].host).toBe("replica1.example.com");
      expect(dbConfig.mysql.replicas[1].host).toBe("replica2.example.com");
    });

    it("should have empty replicas when MYSQL_REPLICA_HOSTS is empty", async () => {
      process.env.MYSQL_REPLICA_HOSTS = "";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.mysql.replicas).toHaveLength(0);
    });
  });

  describe("QdrantConfig", () => {
    it("should load with default values", async () => {
      // Clear env to test defaults
      const originalPort = process.env.QDRANT_PORT;
      const originalGrpcPort = process.env.QDRANT_GRPC_PORT;
      delete process.env.QDRANT_PORT;
      delete process.env.QDRANT_GRPC_PORT;
      
      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.qdrant.host).toBe("localhost");
      expect(dbConfig.qdrant.port).toBe(6333);
      expect(dbConfig.qdrant.grpcPort).toBe(6334);
      expect(dbConfig.qdrant.apiKey).toBeUndefined();
      
      // Restore env
      if (originalPort) process.env.QDRANT_PORT = originalPort;
      if (originalGrpcPort) process.env.QDRANT_GRPC_PORT = originalGrpcPort;
    });

    it("should load with custom env values", async () => {
      process.env.QDRANT_HOST = "qdrant.example.com";
      process.env.QDRANT_PORT = "6444";
      process.env.QDRANT_GRPC_PORT = "6445";
      process.env.QDRANT_API_KEY = "my-api-key";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.qdrant.host).toBe("qdrant.example.com");
      expect(dbConfig.qdrant.port).toBe(6444);
      expect(dbConfig.qdrant.grpcPort).toBe(6445);
      expect(dbConfig.qdrant.apiKey).toBe("my-api-key");
    });
  });

  describe("RedisConfig", () => {
    it("should load with default values", async () => {
      // Clear env to test defaults
      const originalHosts = process.env.REDIS_HOSTS;
      delete process.env.REDIS_HOSTS;
      
      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.redis.nodes).toHaveLength(1);
      expect(dbConfig.redis.nodes[0].host).toBe("localhost");
      expect(dbConfig.redis.nodes[0].port).toBe(6379);
      expect(dbConfig.redis.password).toBeUndefined();
      expect(dbConfig.redis.keyPrefix).toBe("raos:");
      
      // Restore env
      if (originalHosts) process.env.REDIS_HOSTS = originalHosts;
    });

    it("should load with custom env values", async () => {
      process.env.REDIS_HOSTS = "redis1.example.com:6380,redis2.example.com:6381";
      process.env.REDIS_PASSWORD = "redispass";
      process.env.REDIS_KEY_PREFIX = "myapp:";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.redis.nodes).toHaveLength(2);
      expect(dbConfig.redis.nodes[0].host).toBe("redis1.example.com");
      expect(dbConfig.redis.nodes[0].port).toBe(6380);
      expect(dbConfig.redis.nodes[1].host).toBe("redis2.example.com");
      expect(dbConfig.redis.nodes[1].port).toBe(6381);
      expect(dbConfig.redis.password).toBe("redispass");
      expect(dbConfig.redis.keyPrefix).toBe("myapp:");
    });

    it("should parse Redis nodes without explicit port", async () => {
      process.env.REDIS_HOSTS = "redis1.example.com,redis2.example.com:6380";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.redis.nodes).toHaveLength(2);
      expect(dbConfig.redis.nodes[0].host).toBe("redis1.example.com");
      expect(dbConfig.redis.nodes[0].port).toBe(6379); // default port
      expect(dbConfig.redis.nodes[1].host).toBe("redis2.example.com");
      expect(dbConfig.redis.nodes[1].port).toBe(6380);
    });

    it("should trim whitespace from Redis hosts", async () => {
      process.env.REDIS_HOSTS = " redis1.example.com:6380 , redis2.example.com:6381 ";

      const { dbConfig } = await import("../../src/config/db-config.js");

      expect(dbConfig.redis.nodes).toHaveLength(2);
      expect(dbConfig.redis.nodes[0].host).toBe("redis1.example.com");
      expect(dbConfig.redis.nodes[1].host).toBe("redis2.example.com");
    });
  });
});
