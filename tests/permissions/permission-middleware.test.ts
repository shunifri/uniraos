import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createPermissionMiddleware } from "../../src/permissions/middleware/permission-middleware.js";

function createMockPermissionService() {
  return {
    hasPermission: vi.fn(),
    getUserRoles: vi.fn(),
    isAdmin: vi.fn(),
    hasSkillPermission: vi.fn(),
  };
}

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

describe("createPermissionMiddleware (P1)", () => {
  let service: ReturnType<typeof createMockPermissionService>;
  let middleware: ReturnType<typeof createPermissionMiddleware>;

  beforeEach(() => {
    service = createMockPermissionService();
    middleware = createPermissionMiddleware(service as any);
    vi.clearAllMocks();
  });

  describe("requirePermission", () => {
    it("should allow when user has permission", async () => {
      service.hasPermission.mockResolvedValue(true);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requirePermission("config.read");
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(service.hasPermission).toHaveBeenCalledWith("user_1", "config.read");
    });

    it("should reject when user lacks permission", async () => {
      service.hasPermission.mockResolvedValue(false);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requirePermission("config.read");
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should reject unauthenticated users", async () => {
      const req = createMockReq() as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requirePermission("config.read");
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe("requireRole", () => {
    it("should allow when user has role", async () => {
      service.getUserRoles.mockResolvedValue([{ id: "r1", name: "editor", description: "" }]);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requireRole("editor");
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject when user lacks role", async () => {
      service.getUserRoles.mockResolvedValue([{ id: "r1", name: "viewer", description: "" }]);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requireRole("editor");
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("requireAdmin", () => {
    it("should allow admin users", async () => {
      service.isAdmin.mockResolvedValue(true);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requireAdmin();
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject non-admin users", async () => {
      service.isAdmin.mockResolvedValue(false);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requireAdmin();
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("requireSkillAccess", () => {
    it("should allow when user has skill access", async () => {
      service.hasSkillPermission.mockResolvedValue(true);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requireSkillAccess("web_search");
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(service.hasSkillPermission).toHaveBeenCalledWith("user_1", "web_search");
    });

    it("should reject when user lacks skill access", async () => {
      service.hasSkillPermission.mockResolvedValue(false);

      const req = createMockReq() as Request;
      (req as any).user = { id: "user_1" };
      const res = createMockRes() as Response;
      const next = vi.fn();

      const mw = middleware.requireSkillAccess("web_search");
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
