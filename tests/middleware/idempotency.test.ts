import { describe, it, expect, vi, beforeEach } from "vitest";
import { idempotencyMiddleware } from "../../src/middleware/idempotency.js";
import type { Request, Response } from "express";

vi.mock("../../src/cache/redis-client.js", () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

function createMockReq(method: string, headers: Record<string, string> = {}, body?: unknown): Partial<Request> {
  return { method, headers, body };
}

function createMockRes(): Partial<Response> {
  const res: Partial<Response> = {
    statusCode: 200,
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockImplementation(function (code: number) {
      (this as Response).statusCode = code;
      return this;
    }) as any,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
  };
  return res;
}

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip GET/HEAD requests", async () => {
    const req = createMockReq("GET") as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should skip requests without idempotency key", async () => {
    const req = createMockReq("POST") as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject invalid idempotency key format", async () => {
    const req = createMockReq("POST", { "x-idempotency-key": "bad key!" }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should reject overly long idempotency key", async () => {
    const req = createMockReq("POST", { "x-idempotency-key": "a".repeat(200) }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should allow valid idempotency key and capture response", async () => {
    const req = createMockReq("POST", { "x-idempotency-key": "test-key-123" }, { name: "test" }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
