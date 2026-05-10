import { describe, it, expect, vi } from "vitest";
import { jsonDepthLimitMiddleware } from "../../src/middleware/json-depth-limit.js";
import type { Request, Response } from "express";

function createMockReq(body: unknown): Partial<Request> {
  return { body };
}

function createMockRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("jsonDepthLimitMiddleware", () => {
  it("should allow shallow JSON", () => {
    const middleware = jsonDepthLimitMiddleware(5);
    const req = createMockReq({ a: 1, b: { c: 2 } }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject deeply nested JSON", () => {
    const middleware = jsonDepthLimitMiddleware(3);
    const deep = { a: { b: { c: { d: 1 } } } }; // depth 4
    const req = createMockReq(deep) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should skip non-object bodies", () => {
    const middleware = jsonDepthLimitMiddleware(5);
    const req = createMockReq(undefined) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
