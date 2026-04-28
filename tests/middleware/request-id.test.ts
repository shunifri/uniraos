import { describe, it, expect, vi } from "vitest";
import { requestIdMiddleware } from "../../src/middleware/request-id";
import type { Request, Response, NextFunction } from "express";

describe("requestIdMiddleware", () => {
  it("should generate a new UUID when no header is present", () => {
    const req = { headers: {} } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it("should reuse request ID from X-Request-Id header", () => {
    const req = {
      headers: { "x-request-id": "custom-id-123" },
    } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe("custom-id-123");
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", "custom-id-123");
    expect(next).toHaveBeenCalled();
  });
});
