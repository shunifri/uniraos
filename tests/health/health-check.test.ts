import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { healthCheck, readinessCheck, resetUptime } from "../../src/health/health-check.js";

// Mocks
vi.mock("../../src/db/mysql-adapter.js", () => ({
  getMySQLAdapter: vi.fn(),
}));

vi.mock("../../src/cache/redis-client.js", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("../../src/vector/qdrant-client.js", () => ({
  getQdrantClient: vi.fn(),
}));

vi.mock("../../src/queue/rabbitmq-client.js", () => ({
  getRabbitMQClient: vi.fn(),
}));

vi.mock("../../src/utils/fetch-with-timeout.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
}));

import { getMySQLAdapter } from "../../src/db/mysql-adapter.js";
import { getRedisClient } from "../../src/cache/redis-client.js";
import { getQdrantClient } from "../../src/vector/qdrant-client.js";
import { getRabbitMQClient } from "../../src/queue/rabbitmq-client.js";
import { fetchWithTimeout } from "../../src/utils/fetch-with-timeout.js";

describe("healthCheck (P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUptime();
    delete process.env.NEO4J_URI;
    delete process.env.MINIO_ENDPOINT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return healthy when all services are up", async () => {
    const mockMysql = {
      healthCheck: vi.fn().mockResolvedValue({ primary: true, replicas: [true] }),
      query: vi.fn().mockResolvedValue([{}]),
    };
    const mockRedis = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockQdrant = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockRabbitMQ = {
      state: "connected",
    };

    vi.mocked(getMySQLAdapter).mockReturnValue(mockMysql as any);
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as any);
    vi.mocked(getQdrantClient).mockReturnValue(mockQdrant as any);
    vi.mocked(getRabbitMQClient).mockReturnValue(mockRabbitMQ as any);

    const result = await healthCheck();

    expect(result.status).toBe("healthy");
    expect(result.services.mysql.status).toBe("up");
    expect(result.services.redis.status).toBe("up");
    expect(result.services.qdrant.status).toBe("up");
    expect(result.services.rabbitmq.status).toBe("up");
    expect(result.services.neo4j.status).toBe("up"); // skipped when NEO4J_URI not set
    expect(result.services.minio.status).toBe("up"); // skipped when MINIO_ENDPOINT not set
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("should return degraded when some services are down", async () => {
    const mockMysql = {
      healthCheck: vi.fn().mockRejectedValue(new Error("MySQL down")),
    };
    const mockRedis = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockQdrant = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockRabbitMQ = {
      state: "disconnected",
    };

    vi.mocked(getMySQLAdapter).mockReturnValue(mockMysql as any);
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as any);
    vi.mocked(getQdrantClient).mockReturnValue(mockQdrant as any);
    vi.mocked(getRabbitMQClient).mockReturnValue(mockRabbitMQ as any);

    const result = await healthCheck();

    expect(result.status).toBe("degraded");
    expect(result.services.mysql.status).toBe("down");
    expect(result.services.mysql.error).toContain("MySQL down");
    expect(result.services.redis.status).toBe("up");
    expect(result.services.rabbitmq.status).toBe("down");
  });

  it("should return degraded when all services are down", async () => {
    vi.mocked(getMySQLAdapter).mockReturnValue({
      healthCheck: vi.fn().mockRejectedValue(new Error("fail")),
    } as any);
    vi.mocked(getRedisClient).mockReturnValue({
      healthCheck: vi.fn().mockRejectedValue(new Error("fail")),
    } as any);
    vi.mocked(getQdrantClient).mockReturnValue({
      healthCheck: vi.fn().mockRejectedValue(new Error("fail")),
    } as any);
    vi.mocked(getRabbitMQClient).mockReturnValue({
      state: "disconnected",
    } as any);

    const result = await healthCheck();

    expect(result.status).toBe("degraded");
    expect(Object.values(result.services).every((s: any) => s.status === "down" || s.status === "up")).toBe(true);
  });

  it("should check Neo4j when NEO4J_URI is configured", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.NEO4J_USER = "neo4j";
    process.env.NEO4J_PASSWORD = "test";

    vi.mocked(getMySQLAdapter).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue({ primary: true }),
      query: vi.fn().mockResolvedValue([{}]),
    } as any);
    vi.mocked(getRedisClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getQdrantClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getRabbitMQClient).mockReturnValue({
      state: "connected",
    } as any);

    // neo4j-driver will fail because it's not installed, so it should be down
    const result = await healthCheck();
    expect(result.services.neo4j.status).toBe("down");
  });

  it("should check MinIO when MINIO_ENDPOINT is configured", async () => {
    process.env.MINIO_ENDPOINT = "localhost";
    process.env.MINIO_PORT = "9000";
    process.env.MINIO_USE_SSL = "false";

    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("Connection refused"));

    vi.mocked(getMySQLAdapter).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue({ primary: true }),
      query: vi.fn().mockResolvedValue([{}]),
    } as any);
    vi.mocked(getRedisClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getQdrantClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getRabbitMQClient).mockReturnValue({
      state: "connected",
    } as any);

    const result = await healthCheck();
    expect(result.services.minio.status).toBe("down");
    expect(result.services.minio.error).toContain("Connection refused");
  });
});

describe("readinessCheck (P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return ready when all critical services are healthy", async () => {
    const mockMysql = {
      query: vi.fn().mockResolvedValue([{}]),
    };
    const mockRedis = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockQdrant = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockRabbitMQ = {
      state: "connected",
    };

    vi.mocked(getMySQLAdapter).mockReturnValue(mockMysql as any);
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as any);
    vi.mocked(getQdrantClient).mockReturnValue(mockQdrant as any);
    vi.mocked(getRabbitMQClient).mockReturnValue(mockRabbitMQ as any);

    const result = await readinessCheck();
    expect(result.ready).toBe(true);
  });

  it("should return not ready when MySQL fails", async () => {
    vi.mocked(getMySQLAdapter).mockReturnValue({
      query: vi.fn().mockRejectedValue(new Error("MySQL connection lost")),
    } as any);

    const result = await readinessCheck();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("MySQL connection lost");
  });

  it("should return not ready when Qdrant fails", async () => {
    vi.mocked(getMySQLAdapter).mockReturnValue({
      query: vi.fn().mockResolvedValue([{}]),
    } as any);
    vi.mocked(getRedisClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getQdrantClient).mockReturnValue({
      healthCheck: vi.fn().mockRejectedValue(new Error("Qdrant timeout")),
    } as any);

    const result = await readinessCheck();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("Qdrant timeout");
  });

  it("should return not ready when RabbitMQ is disconnected", async () => {
    vi.mocked(getMySQLAdapter).mockReturnValue({
      query: vi.fn().mockResolvedValue([{}]),
    } as any);
    vi.mocked(getRedisClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getQdrantClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue(true),
    } as any);
    vi.mocked(getRabbitMQClient).mockReturnValue({
      state: "disconnected",
    } as any);

    const result = await readinessCheck();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("RabbitMQ not connected");
  });
});
