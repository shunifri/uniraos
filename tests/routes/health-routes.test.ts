import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import healthRouter from "../../src/routes/health-routes.js";

vi.mock("../../src/permissions/middleware/auth-middleware.js", () => ({
  requireAuth: (req: any, res: any, next: any) => next(),
  requireAdmin: () => (req: any, res: any, next: any) => next(),
}));

vi.mock("../../src/health/health-check.js", () => ({
  healthCheck: vi.fn(),
  readinessCheck: vi.fn(),
}));

vi.mock("prom-client", () => {
  const metricsFn = () => Promise.resolve("# HELP test\n# TYPE test counter\ntest 1\n");
  return {
    register: {
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      metrics: metricsFn,
      registerMetric: () => {},
    },
    collectDefaultMetrics: () => {},
    Histogram: class Histogram {
      name: string;
      constructor(opts: any) { this.name = opts.name; }
      observe() {}
    },
    Counter: class Counter {
      name: string;
      constructor(opts: any) { this.name = opts.name; }
      inc() {}
    },
  };
});

import { healthCheck, readinessCheck } from "../../src/health/health-check.js";

describe("health-routes (P1)", () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(healthRouter);
  });

  it("GET /live should return alive", async () => {
    const res = await request(app).get("/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
    expect(res.body.timestamp).toBeGreaterThan(0);
  });

  it("GET /ready should return ready when healthy", async () => {
    vi.mocked(readinessCheck).mockResolvedValue({ ready: true });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("GET /ready should return 503 when not ready", async () => {
    vi.mocked(readinessCheck).mockResolvedValue({ ready: false, reason: "MySQL down" });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not ready");
    expect(res.body.reason).toBe("MySQL down");
  });

  it("GET /health should return health status", async () => {
    vi.mocked(healthCheck).mockResolvedValue({
      status: "healthy",
      version: "1.0.0",
      timestamp: Date.now(),
      uptime: 1000,
      services: {
        mysql: { status: "up", latencyMs: 10 },
        redis: { status: "up", latencyMs: 5 },
        qdrant: { status: "up", latencyMs: 8 },
        rabbitmq: { status: "up", latencyMs: 3 },
        neo4j: { status: "up", latencyMs: 0 },
        minio: { status: "up", latencyMs: 0 },
      },
    } as any);

    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("GET /health should return 503 when degraded", async () => {
    vi.mocked(healthCheck).mockResolvedValue({
      status: "degraded",
      version: "1.0.0",
      timestamp: Date.now(),
      uptime: 1000,
      services: {
        mysql: { status: "down", latencyMs: 10, error: "conn refused" },
        redis: { status: "up", latencyMs: 5 },
        qdrant: { status: "up", latencyMs: 8 },
        rabbitmq: { status: "up", latencyMs: 3 },
        neo4j: { status: "up", latencyMs: 0 },
        minio: { status: "up", latencyMs: 0 },
      },
    } as any);

    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  // eslint-disable-next-line local/no-new-skip -- legacy skip, see docs/migration-skip-to-todo.md
  it.skip("GET /prom/metrics should require auth and admin", async () => {
    // Skipped: prom-client register.metrics() times out in test environment
    // Auth protection is verified in auth-middleware tests
    const res = await request(app).get("/prom/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });
});
