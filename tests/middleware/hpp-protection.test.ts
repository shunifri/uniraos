import { describe, it, expect, vi } from "vitest";
import { hppProtectionMiddleware } from "../../src/middleware/hpp-protection.js";
import type { Request, Response } from "express";

function createMockReq(query: Record<string, unknown>): Partial<Request> {
  return { query };
}

function createMockRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("hppProtectionMiddleware", () => {
  it("should allow single value query params", () => {
    const middleware = hppProtectionMiddleware();
    const req = createMockReq({ id: "123", name: "test" }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject polluted query params", () => {
    const middleware = hppProtectionMiddleware();
    const req = createMockReq({ id: ["123", "456"] }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should allow whitelisted array fields", () => {
    const middleware = hppProtectionMiddleware(["ids"]);
    const req = createMockReq({ ids: ["1", "2", "3"] }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
