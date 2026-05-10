import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware, requireAuth, requirePermission, requireAdmin } from "../../src/permissions/middleware/auth-middleware.js";

vi.mock("../../src/db/auth.js", () => ({
  validateSession: vi.fn(),
}));

vi.mock("../../src/db/user-repository.js", () => ({
  userHasPermission: vi.fn(),
  getUserRoles: vi.fn(),
}));

import { validateSession } from "../../src/db/auth.js";
import { userHasPermission, getUserRoles } from "../../src/db/user-repository.js";

function createMockReq(overrides?: Partial<Request>): Partial<Request> {
  return {
    headers: {},
    cookies: {},
    ...overrides,
  } as Partial<Request>;
}

function createMockRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("authMiddleware (P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should set req.user from Bearer token", async () => {
    const user = { id: "user_1", username: "test" };
    vi.mocked(validateSession).mockResolvedValue(user as any);

    const req = createMockReq({ headers: { authorization: "Bearer token123" } }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await authMiddleware(req, res, next);
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalled();
  });

  it("should set req.user from cookie", async () => {
    const user = { id: "user_1", username: "test" };
    vi.mocked(validateSession).mockResolvedValue(user as any);

    const req = createMockReq({ cookies: { token: "cookie_token" } }) as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await authMiddleware(req, res, next);
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalled();
  });

  it("should proceed without user when no token", async () => {
    const req = createMockReq() as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    await authMiddleware(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe("requireAuth (P1)", () => {
  it("should allow authenticated requests", () => {
    const req = createMockReq() as Request;
    (req as any).user = { id: "user_1" };
    const res = createMockRes() as Response;
    const next = vi.fn();

    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject unauthenticated requests with 401", () => {
    const req = createMockReq() as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

describe("requirePermission (P1)", () => {
  it("should allow requests with permission", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(true);

    const req = createMockReq() as Request;
    (req as any).user = { id: "user_1" };
    const res = createMockRes() as Response;
    const next = vi.fn();

    const middleware = requirePermission("chat");
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject requests without permission", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);

    const req = createMockReq() as Request;
    (req as any).user = { id: "user_1" };
    const res = createMockRes() as Response;
    const next = vi.fn();

    const middleware = requirePermission("chat");
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("should reject unauthenticated requests", async () => {
    const req = createMockReq() as Request;
    const res = createMockRes() as Response;
    const next = vi.fn();

    const middleware = requirePermission("chat");
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("requireAdmin (P1)", () => {
  it("should allow admin users", async () => {
    vi.mocked(getUserRoles).mockResolvedValue([{ id: "role_admin", name: "admin", description: "" }]);

    const req = createMockReq() as Request;
    (req as any).user = { id: "user_1" };
    const res = createMockRes() as Response;
    const next = vi.fn();

    await requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should reject non-admin users", async () => {
    vi.mocked(getUserRoles).mockResolvedValue([{ id: "role_user", name: "user", description: "" }]);

    const req = createMockReq() as Request;
    (req as any).user = { id: "user_1" };
    const res = createMockRes() as Response;
    const next = vi.fn();

    await requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
