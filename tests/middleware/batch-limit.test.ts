import { describe, it, expect, vi } from "vitest";
import { batchLimitMiddleware } from "../../src/middleware/batch-limit.js";
import type { Request, Response } from "express";

function createMockReq(body: unknown): Partial<Request> {
  return { body };
}

function createMockRes(): Partial<Response> {
  const res: Partial<Response> = {
    statusCode: 200,
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

describe("batchLimitMiddleware", () => {
  it("should allow requests without batch fields", () => {
    const middleware = batchLimitMiddleware();
    const req = createMockReq({ name: "test" }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should allow batch within limit", () => {
    const middleware = batchLimitMiddleware(5);
    const req = createMockReq({ items: [1, 2, 3] }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should reject batch exceeding limit", () => {
    const middleware = batchLimitMiddleware(3);
    const req = createMockReq({ items: [1, 2, 3, 4] }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it("should check multiple batch fields", () => {
    const middleware = batchLimitMiddleware(2);
    const req = createMockReq({ ids: [1, 2, 3], name: "ok" }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});
