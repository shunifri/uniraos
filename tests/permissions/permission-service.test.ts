import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionService } from "../../src/permissions/services/permission-service.js";
import { createPermissionMiddleware } from "../../src/permissions/middleware/permission-middleware.js";
import {
  AuthenticationRequiredError,
  AccessDeniedError,
  SkillAccessDeniedError,
} from "../../src/permissions/errors/permission-errors.js";
import type { Request, Response, NextFunction } from "express";

const mockUserRepo = {
  userHasPermission: vi.fn(),
  getUserPermissions: vi.fn(),
  getUserRoles: vi.fn(),
  getUserById: vi.fn(),
};

vi.mock("../../src/db/database.js", () => ({
  getDb: () => ({
    prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }),
  }),
  isMySQL: () => false,
  isSQLite: () => true,
  getDatabaseType: () => "sqlite",
}));

vi.mock("../../src/db/user-repository.js", () => ({
  userHasPermission: (...args: any[]) => mockUserRepo.userHasPermission(...args),
  getUserPermissions: (...args: any[]) => mockUserRepo.getUserPermissions(...args),
  getUserRoles: (...args: any[]) => mockUserRepo.getUserRoles(...args),
  getUserById: (...args: any[]) => mockUserRepo.getUserById(...args),
}));

function createMockReq(user?: { id: string }): Partial<Request> & { user?: { id: string } } {
  return { user };
}

function createMockRes(): Partial<Response> {
  const res: any = {
    statusCode: 200,
    jsonBody: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.jsonBody = body;
      return this;
    },
  };
  return res;
}

function createMockNext(): NextFunction {
  return vi.fn();
}

describe("PermissionService", () => {
  let service: PermissionService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockRegistry = { onChange: vi.fn(), getSkills: () => [], lookup: () => null } as any;
    service = new PermissionService(mockRegistry);
  });

  describe("hasPermission", () => {
    it("should return true when user has permission", async () => {
      mockUserRepo.userHasPermission.mockResolvedValue(true);
      const result = await service.hasPermission("user-1", "skills.read");
      expect(result).toBe(true);
      expect(mockUserRepo.userHasPermission).toHaveBeenCalledWith("user-1", "skills.read");
    });

    it("should return false when user lacks permission", async () => {
      mockUserRepo.userHasPermission.mockResolvedValue(false);
      const result = await service.hasPermission("user-1", "admin.manage");
      expect(result).toBe(false);
    });
  });

  describe("checkPermission", () => {
    it("should throw AuthenticationRequiredError when userId is empty", async () => {
      await expect(service.checkPermission("", "skills.read")).rejects.toThrow(
        AuthenticationRequiredError
      );
    });

    it("should throw AccessDeniedError when user lacks permission", async () => {
      mockUserRepo.userHasPermission.mockResolvedValue(false);
      await expect(service.checkPermission("user-1", "admin.manage")).rejects.toThrow(
        AccessDeniedError
      );
    });

    it("should resolve when user has permission", async () => {
      mockUserRepo.userHasPermission.mockResolvedValue(true);
      await expect(service.checkPermission("user-1", "skills.read")).resolves.toBeUndefined();
    });
  });

  describe("getUserPermissions", () => {
    it("should return list of permissions for user", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["skills.read", "chat"]);
      const perms = await service.getUserPermissions("user-1");
      expect(perms).toEqual(["skills.read", "chat"]);
    });
  });

  describe("isAdmin", () => {
    it("should return true when user has users.manage", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["users.manage", "chat"]);
      const result = await service.isAdmin("user-1");
      expect(result).toBe(true);
    });

    it("should return true when user has roles.manage", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["roles.manage"]);
      const result = await service.isAdmin("user-1");
      expect(result).toBe(true);
    });

    it("should return false when user has neither admin permission", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["chat", "skills.read"]);
      const result = await service.isAdmin("user-1");
      expect(result).toBe(false);
    });
  });

  describe("getUserRoles", () => {
    it("should return roles for user", async () => {
      mockUserRepo.getUserRoles.mockResolvedValue([
        { id: "role-1", name: "admin", description: "Administrator" },
      ]);
      const roles = await service.getUserRoles("user-1");
      expect(roles).toHaveLength(1);
      expect(roles[0].name).toBe("admin");
    });
  });

  describe("skill permission methods", () => {
    it("hasSkillPermission should delegate to skill service", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["skill:test.execute"]);
      mockUserRepo.getUserById.mockResolvedValue({ id: "user-1" });
      const result = await service.hasSkillPermission("user-1", "test");
      expect(typeof result).toBe("boolean");
    });

    it("checkSkillPermission should throw AuthenticationRequiredError when userId is empty", async () => {
      await expect(service.checkSkillPermission("", "test")).rejects.toThrow(
        AuthenticationRequiredError
      );
    });

    it("checkSkillPermission should throw SkillAccessDeniedError when access is denied", async () => {
      // Force no permissions so skill check fails
      mockUserRepo.getUserPermissions.mockResolvedValue([]);
      mockUserRepo.getUserById.mockResolvedValue({ id: "user-1" });
      await expect(service.checkSkillPermission("user-1", "restricted-skill")).rejects.toThrow(
        SkillAccessDeniedError
      );
    });
  });

  describe("invalidateSkillCache", () => {
    it("should invalidate for specific user", () => {
      expect(() => service.invalidateSkillCache("user-1")).not.toThrow();
    });

    it("should invalidate all when no user specified", () => {
      expect(() => service.invalidateSkillCache()).not.toThrow();
    });
  });
});

describe("createPermissionMiddleware", () => {
  let service: PermissionService;
  let middleware: ReturnType<typeof createPermissionMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockRegistry = { onChange: vi.fn(), getSkills: () => [], lookup: () => null } as any;
    service = new PermissionService(mockRegistry);
    middleware = createPermissionMiddleware(service);
  });

  describe("requirePermission", () => {
    it("should call next() when user has permission", async () => {
      mockUserRepo.userHasPermission.mockResolvedValue(true);
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requirePermission("skills.read")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should return 401 when user is not authenticated", async () => {
      const req = createMockReq(undefined) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requirePermission("skills.read")(req, res, next);
      expect(res.statusCode).toBe(401);
      expect((res as any).jsonBody).toEqual({
        success: false,
        error: "Authentication required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when user lacks permission", async () => {
      mockUserRepo.userHasPermission.mockResolvedValue(false);
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requirePermission("admin.manage")(req, res, next);
      expect(res.statusCode).toBe(403);
      expect((res as any).jsonBody).toEqual({
        success: false,
        error: "Permission denied: admin.manage",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requireRole", () => {
    it("should call next() when user has the required role", async () => {
      mockUserRepo.getUserRoles.mockResolvedValue([
        { id: "role-1", name: "admin", description: "" },
      ]);
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireRole("admin")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should return 403 when user does not have the required role", async () => {
      mockUserRepo.getUserRoles.mockResolvedValue([
        { id: "role-2", name: "user", description: "" },
      ]);
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireRole("admin")(req, res, next);
      expect(res.statusCode).toBe(403);
      expect((res as any).jsonBody).toEqual({
        success: false,
        error: "Role required: admin",
      });
    });

    it("should return 401 when user is not authenticated", async () => {
      const req = createMockReq(undefined) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireRole("admin")(req, res, next);
      expect(res.statusCode).toBe(401);
    });
  });

  describe("requireAdmin", () => {
    it("should call next() when user is admin", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["users.manage"]);
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireAdmin()(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should return 403 when user is not admin", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["chat"]);
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireAdmin()(req, res, next);
      expect(res.statusCode).toBe(403);
      expect((res as any).jsonBody).toEqual({
        success: false,
        error: "Admin access required",
      });
    });
  });

  describe("requireSkillAccess", () => {
    it("should call next() when user has skill access", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue(["skill:test.execute"]);
      mockUserRepo.getUserById.mockResolvedValue({ id: "user-1" });
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireSkillAccess("test")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should return 403 when user lacks skill access", async () => {
      mockUserRepo.getUserPermissions.mockResolvedValue([]);
      mockUserRepo.getUserById.mockResolvedValue({ id: "user-1" });
      const req = createMockReq({ id: "user-1" }) as Request;
      const res = createMockRes() as Response;
      const next = createMockNext();

      await middleware.requireSkillAccess("test")(req, res, next);
      expect(res.statusCode).toBe(403);
      expect((res as any).jsonBody).toEqual({
        success: false,
        error: "No access to skill: test",
      });
    });
  });
});
