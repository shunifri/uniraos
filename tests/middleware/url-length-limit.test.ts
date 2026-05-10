import { describe, it, expect, vi } from "vitest";
import { urlLengthLimitMiddleware } from "../../src/middleware/url-length-limit.js";
import type { Request, Response } from "express";

function createMockReq(url: string): Partial<Request> {
  return { originalUrl: url };
}

function createMockRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("urlLengthLimitMiddleware", () => {
  it("should allow normal URLs", () => {
    const middleware = urlLengthLimitMiddleware(100);
    const req = createMockReq("/api/test") as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject overly long URLs", () => {
    const middleware = urlLengthLimitMiddleware(10);
    const req = createMockReq("/api/very-long-path") as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(414);
  });
});
