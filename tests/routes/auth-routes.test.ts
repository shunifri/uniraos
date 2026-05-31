import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../src/permissions/index.js", () => ({
  permissions: {
    createMiddleware: () => ({
      requireAuth: (req: any, res: any, next: any) => {
        req.user = { id: "user_1", username: "admin", roles: [{ name: "admin" }] };
        next();
      },
      requireAdmin: () => (req: any, res: any, next: any) => next(),
      requirePermission: () => (req: any, res: any, next: any) => next(),
    }),
  },
}));

vi.mock("../../src/db/auth.js", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
}));

vi.mock("../../src/db/user-repository.js", () => ({
  authenticate: vi.fn(),
  getUserWithDetails: vi.fn(),
  getUserByPhone: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  getUserRoles: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
  changePassword: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  getRoleAgentConfig: vi.fn(),
  updateRoleAgentConfig: vi.fn(),
}));

vi.mock("../../src/db/department-repository.js", () => ({
  getDepartmentTree: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  assignResources: vi.fn(),
  removeResources: vi.fn(),
  getDepartmentResources: vi.fn(),
  getDepartmentEffectiveResources: vi.fn(),
}));

vi.mock("../../src/db/resource-repository.js", () => ({
  listResources: vi.fn(),
  getPermissionsByRole: vi.fn(),
  replacePermissionsForRole: vi.fn(),
  assignPermissionsToRole: vi.fn(),
  removePermissionsFromRole: vi.fn(),
  listPermissions: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../../src/routes/validation.js", () => ({
  validate: () => (req: any, res: any, next: any) => next(),
  loginSchema: {},
  registerSchema: {},
}));

import { createAuthRoutes } from "../../src/routes/auth-routes.js";
import * as authDb from "../../src/db/auth.js";
import * as userRepo from "../../src/db/user-repository.js";
import * as deptRepo from "../../src/db/department-repository.js";
import * as resRepo from "../../src/db/resource-repository.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    createAuthRoutes({
      sessionManager: { listSessions: vi.fn(() => []) },
      syncSkillsToResources: vi.fn(() => Promise.resolve()),
    } as any)
  );
  return app;
}

describe("auth-routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /auth/login", () => {
    it("returns token, user and sets cookie on valid credentials", async () => {
      vi.mocked(userRepo.authenticate).mockResolvedValue({ id: "u1", username: "alice" } as any);
      vi.mocked(authDb.createSession).mockResolvedValue({
        token: "sess_abc",
        expiresAt: Date.now() + 86400000,
      });
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "u1", username: "alice", roles: [] } as any);

      const app = createApp();
      const res = await request(app).post("/auth/login").send({ username: "alice", password: "secret" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe("sess_abc");
      expect(res.body.user).toBeDefined();
      expect(res.headers["set-cookie"]).toBeDefined();
      expect(authDb.createSession).toHaveBeenCalledWith("u1");
    });

    it("returns 401 on invalid credentials", async () => {
      vi.mocked(userRepo.authenticate).mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).post("/auth/login").send({ username: "alice", password: "wrong" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Invalid");
    });
  });

  describe("POST /auth/anonymous", () => {
    it("returns 400 for invalid phone", async () => {
      const app = createApp();
      const res = await request(app).post("/auth/anonymous").send({ phone: "123" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("logs in existing phone user and sets cookie", async () => {
      vi.mocked(userRepo.getUserByPhone).mockResolvedValue({ id: "u_phone", username: "guest" } as any);
      vi.mocked(authDb.createSession).mockResolvedValue({
        token: "sess_phone",
        expiresAt: Date.now() + 86400000,
      });
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "u_phone", username: "guest" } as any);

      const app = createApp();
      const res = await request(app).post("/auth/anonymous").send({ phone: "13800138000" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe("sess_phone");
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("creates new anonymous user when phone not found", async () => {
      vi.mocked(userRepo.getUserByPhone).mockResolvedValue(null);
      vi.mocked(userRepo.createUser).mockResolvedValue({ id: "u_new", username: "guest_0000_abcd" } as any);
      vi.mocked(authDb.createSession).mockResolvedValue({
        token: "sess_new",
        expiresAt: Date.now() + 86400000,
      });
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "u_new", username: "guest_0000_abcd" } as any);

      const app = createApp();
      const res = await request(app).post("/auth/anonymous").send({ phone: "13800138001" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userRepo.createUser).toHaveBeenCalled();
      const createCall = vi.mocked(userRepo.createUser).mock.calls[0][0];
      expect(createCall.phone).toBe("13800138001");
      expect(createCall.roleIds).toContain("role_viewer");
    });

    it("returns 500 on unexpected error without leaking internal details", async () => {
      vi.mocked(userRepo.getUserByPhone).mockRejectedValue(new Error("DB down"));

      const app = createApp();
      const res = await request(app).post("/auth/anonymous").send({ phone: "13800138002" });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("POST /auth/logout", () => {
    it("destroys session when Authorization header present", async () => {
      vi.mocked(authDb.destroySession).mockResolvedValue(undefined);

      const app = createApp();
      const res = await request(app).post("/auth/logout").set("Authorization", "Bearer sess_abc");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(authDb.destroySession).toHaveBeenCalledWith("sess_abc");
    });

    it("returns success even without Authorization header", async () => {
      const app = createApp();
      const res = await request(app).post("/auth/logout");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(authDb.destroySession).not.toHaveBeenCalled();
    });
  });

  describe("GET /auth/me", () => {
    it("returns current user details", async () => {
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "user_1", username: "admin" } as any);

      const app = createApp();
      const res = await request(app).get("/auth/me");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe("user_1");
    });

    it("returns 404 when user not found", async () => {
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/auth/me");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /users", () => {
    it("lists all users enriched with roles", async () => {
      vi.mocked(userRepo.listUsers).mockResolvedValue([{ id: "u1", username: "a" } as any]);
      vi.mocked(userRepo.getUserRoles).mockResolvedValue([{ id: "r1", name: "admin", description: "" }]);

      const app = createApp();
      const res = await request(app).get("/users");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users[0].roles).toHaveLength(1);
    });

    it("returns single user when id query provided", async () => {
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "u1", username: "a" } as any);

      const app = createApp();
      const res = await request(app).get("/users?id=u1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe("u1");
    });

    it("returns 404 when queried user not found", async () => {
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/users?id=missing");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /users", () => {
    it("creates a new user and returns details", async () => {
      vi.mocked(userRepo.createUser).mockResolvedValue({ id: "u2", username: "bob" } as any);
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "u2", username: "bob" } as any);

      const app = createApp();
      const res = await request(app).post("/users").send({
        username: "bob",
        password: "password123",
        displayName: "Bob",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe("u2");
    });

    it("returns 400 on repository error", async () => {
      vi.mocked(userRepo.createUser).mockRejectedValue(new Error("username taken"));

      const app = createApp();
      const res = await request(app).post("/users").send({
        username: "bob",
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("username taken");
    });
  });

  describe("PUT /users/:id", () => {
    it("updates a user and returns details", async () => {
      vi.mocked(userRepo.updateUser).mockResolvedValue({ id: "u1", username: "a" } as any);
      vi.mocked(userRepo.getUserWithDetails).mockResolvedValue({ id: "u1", username: "a", displayName: "Alice" } as any);

      const app = createApp();
      const res = await request(app).put("/users/u1").send({ displayName: "Alice" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.displayName).toBe("Alice");
    });

    it("returns 404 when user not found", async () => {
      vi.mocked(userRepo.updateUser).mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).put("/users/missing").send({ displayName: "Alice" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /users/:id", () => {
    it("deletes a user", async () => {
      vi.mocked(userRepo.deleteUser).mockResolvedValue(true);

      const app = createApp();
      const res = await request(app).delete("/users/u2");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBe(true);
    });

    it("rejects self-deletion", async () => {
      const app = createApp();
      const res = await request(app).delete("/users/user_1");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("yourself");
    });
  });

  describe("POST /users/:id/roles", () => {
    it("assigns a role", async () => {
      vi.mocked(userRepo.assignRole).mockResolvedValue(undefined);
      vi.mocked(userRepo.getUserRoles).mockResolvedValue([{ id: "r1", name: "admin", description: "" }]);

      const app = createApp();
      const res = await request(app).post("/users/u1/roles").send({ roleId: "r1", action: "assign" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userRepo.assignRole).toHaveBeenCalledWith("u1", "r1");
    });

    it("removes a role", async () => {
      vi.mocked(userRepo.removeRole).mockResolvedValue(undefined);
      vi.mocked(userRepo.getUserRoles).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).post("/users/u1/roles").send({ roleId: "r1", action: "remove" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userRepo.removeRole).toHaveBeenCalledWith("u1", "r1");
    });

    it("returns 400 when roleId or action missing", async () => {
      const app = createApp();
      const res = await request(app).post("/users/u1/roles").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /users/:id/password", () => {
    it("changes password", async () => {
      vi.mocked(userRepo.changePassword).mockResolvedValue(true);

      const app = createApp();
      const res = await request(app).post("/users/u1/password").send({ password: "newpass" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.changed).toBe(true);
      expect(userRepo.changePassword).toHaveBeenCalledWith("u1", "newpass");
    });

    it("returns 400 when password missing", async () => {
      const app = createApp();
      const res = await request(app).post("/users/u1/password").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /user/password", () => {
    it("changes own password with correct old password", async () => {
      vi.mocked(userRepo.authenticate).mockResolvedValue({ id: "user_1", username: "admin" } as any);
      vi.mocked(userRepo.changePassword).mockResolvedValue(true);

      const app = createApp();
      const res = await request(app).post("/user/password").send({ oldPassword: "oldpass", newPassword: "newpass123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userRepo.authenticate).toHaveBeenCalledWith("admin", "oldpass");
      expect(userRepo.changePassword).toHaveBeenCalledWith("user_1", "newpass123");
    });

    it("returns 401 when old password is incorrect", async () => {
      vi.mocked(userRepo.authenticate).mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).post("/user/password").send({ oldPassword: "wrong", newPassword: "newpass123" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(userRepo.changePassword).not.toHaveBeenCalled();
    });

    it("returns 400 when parameters missing", async () => {
      const app = createApp();
      const res1 = await request(app).post("/user/password").send({});
      expect(res1.status).toBe(400);

      const res2 = await request(app).post("/user/password").send({ oldPassword: "old" });
      expect(res2.status).toBe(400);

      const res3 = await request(app).post("/user/password").send({ newPassword: "new" });
      expect(res3.status).toBe(400);
    });

    it("returns 400 when new password too short", async () => {
      const app = createApp();
      const res = await request(app).post("/user/password").send({ oldPassword: "oldpass", newPassword: "123" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Department routes", () => {
    it("GET /departments returns department tree", async () => {
      vi.mocked(deptRepo.getDepartmentTree).mockResolvedValue([{ id: "d1", name: "Engineering" } as any]);

      const app = createApp();
      const res = await request(app).get("/departments");

      expect(res.status).toBe(200);
      expect(res.body.departments).toHaveLength(1);
    });

    it("POST /departments creates a department", async () => {
      vi.mocked(deptRepo.createDepartment).mockResolvedValue({ id: "d1", name: "Engineering" } as any);

      const app = createApp();
      const res = await request(app).post("/departments").send({ name: "Engineering" });

      expect(res.status).toBe(200);
      expect(res.body.department.name).toBe("Engineering");
    });

    it("POST /departments returns 400 when name missing", async () => {
      const app = createApp();
      const res = await request(app).post("/departments").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("PUT /departments/:id updates a department", async () => {
      vi.mocked(deptRepo.updateDepartment).mockResolvedValue({ id: "d1", name: "Eng" } as any);

      const app = createApp();
      const res = await request(app).put("/departments/d1").send({ name: "Eng" });

      expect(res.status).toBe(200);
      expect(res.body.department.name).toBe("Eng");
    });

    it("PUT /departments/:id returns 404 when not found", async () => {
      vi.mocked(deptRepo.updateDepartment).mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).put("/departments/d1").send({ name: "Eng" });

      expect(res.status).toBe(404);
    });

    it("DELETE /departments/:id deletes a department", async () => {
      vi.mocked(deptRepo.deleteDepartment).mockResolvedValue(undefined);

      const app = createApp();
      const res = await request(app).delete("/departments/d1");

      expect(res.status).toBe(200);
    });

    it("POST /departments/:id/resources assigns resources", async () => {
      vi.mocked(deptRepo.getDepartmentResources).mockResolvedValue([{ id: "res1", name: "R1", type: "skill", description: "" }]);

      const app = createApp();
      const res = await request(app).post("/departments/d1/resources").send({ resourceIds: ["res1"] });

      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(1);
      expect(deptRepo.assignResources).toHaveBeenCalledWith("d1", ["res1"]);
    });

    it("POST /departments/:id/resources returns 400 when resourceIds invalid", async () => {
      const app = createApp();
      const res = await request(app).post("/departments/d1/resources").send({ resourceIds: "bad" });

      expect(res.status).toBe(400);
    });

    it("DELETE /departments/:id/resources removes resources", async () => {
      vi.mocked(deptRepo.getDepartmentResources).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).delete("/departments/d1/resources").send({ resourceIds: ["res1"] });

      expect(res.status).toBe(200);
      expect(deptRepo.removeResources).toHaveBeenCalledWith("d1", ["res1"]);
    });

    it("GET /departments/:id/resources returns resources", async () => {
      vi.mocked(deptRepo.getDepartmentResources).mockResolvedValue([{ id: "res1", name: "R1", type: "skill", description: "" }]);

      const app = createApp();
      const res = await request(app).get("/departments/d1/resources");

      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(1);
    });

    it("GET /departments/:id/resources?effective=true returns effective resources", async () => {
      vi.mocked(deptRepo.getDepartmentEffectiveResources).mockResolvedValue([{ id: "res1", name: "R1", type: "skill", description: "" }]);

      const app = createApp();
      const res = await request(app).get("/departments/d1/resources?effective=true");

      expect(res.status).toBe(200);
      expect(deptRepo.getDepartmentEffectiveResources).toHaveBeenCalledWith("d1");
    });
  });

  describe("Resource routes", () => {
    it("GET /resources lists resources", async () => {
      vi.mocked(resRepo.listResources).mockResolvedValue([{ id: "res1", name: "R1", type: "skill" } as any]);

      const app = createApp();
      const res = await request(app).get("/resources");

      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(1);
    });

    it("GET /resources filters by type", async () => {
      vi.mocked(resRepo.listResources).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).get("/resources?type=skill");

      expect(res.status).toBe(200);
      expect(resRepo.listResources).toHaveBeenCalledWith("skill");
    });

    it("POST /resources/sync triggers skill sync and returns skill resources", async () => {
      vi.mocked(resRepo.listResources).mockResolvedValue([{ id: "res1", name: "R1", type: "skill" } as any]);

      const app = createApp();
      const res = await request(app).post("/resources/sync");

      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(1);
    });
  });

  describe("Role routes", () => {
    it("GET /roles lists roles", async () => {
      vi.mocked(userRepo.listRoles).mockResolvedValue([{ id: "r1", name: "admin", description: "", isSystem: false }]);

      const app = createApp();
      const res = await request(app).get("/roles");

      expect(res.status).toBe(200);
      expect(res.body.roles).toHaveLength(1);
    });

    it("POST /roles creates a role", async () => {
      vi.mocked(userRepo.createRole).mockResolvedValue({ id: "r2", name: "editor", description: "", isSystem: false });

      const app = createApp();
      const res = await request(app).post("/roles").send({ name: "editor" });

      expect(res.status).toBe(200);
      expect(res.body.role.name).toBe("editor");
    });

    it("POST /roles returns 400 when name missing", async () => {
      const app = createApp();
      const res = await request(app).post("/roles").send({});

      expect(res.status).toBe(400);
    });

    it("DELETE /roles/:id deletes a role", async () => {
      vi.mocked(userRepo.deleteRole).mockResolvedValue(true);

      const app = createApp();
      const res = await request(app).delete("/roles/r1");

      expect(res.status).toBe(200);
    });

    it("DELETE /roles/:id returns 404 when role not found", async () => {
      vi.mocked(userRepo.deleteRole).mockResolvedValue(false);

      const app = createApp();
      const res = await request(app).delete("/roles/r1");

      expect(res.status).toBe(404);
    });

    it("GET /roles/:id/permissions returns permissions", async () => {
      vi.mocked(resRepo.getPermissionsByRole).mockResolvedValue([{ id: "p1", name: "read", resourceId: "res1", action: "read" }]);

      const app = createApp();
      const res = await request(app).get("/roles/r1/permissions");

      expect(res.status).toBe(200);
      expect(res.body.permissions).toHaveLength(1);
    });

    it("POST /roles/:id/permissions replaces permissions", async () => {
      vi.mocked(resRepo.replacePermissionsForRole).mockResolvedValue(undefined);
      vi.mocked(resRepo.getPermissionsByRole).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).post("/roles/r1/permissions").send({ permissions: ["p1", "p2"] });

      expect(res.status).toBe(200);
      expect(resRepo.replacePermissionsForRole).toHaveBeenCalledWith("r1", ["p1", "p2"]);
    });

    it("POST /roles/:id/permissions assigns permissions", async () => {
      vi.mocked(resRepo.assignPermissionsToRole).mockResolvedValue(undefined);
      vi.mocked(resRepo.getPermissionsByRole).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).post("/roles/r1/permissions").send({ permissionIds: ["p1"], action: "assign" });

      expect(res.status).toBe(200);
      expect(resRepo.assignPermissionsToRole).toHaveBeenCalledWith("r1", ["p1"]);
    });

    it("POST /roles/:id/permissions removes permissions", async () => {
      vi.mocked(resRepo.removePermissionsFromRole).mockResolvedValue(undefined);
      vi.mocked(resRepo.getPermissionsByRole).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).post("/roles/r1/permissions").send({ permissionIds: ["p1"], action: "remove" });

      expect(res.status).toBe(200);
      expect(resRepo.removePermissionsFromRole).toHaveBeenCalledWith("r1", ["p1"]);
    });

    it("POST /roles/:id/permissions returns 400 for invalid action", async () => {
      const app = createApp();
      const res = await request(app).post("/roles/r1/permissions").send({ permissionIds: ["p1"], action: "bad" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("action must be 'assign' or 'remove'");
    });

    it("POST /roles/:id/permissions returns 400 for invalid body", async () => {
      const app = createApp();
      const res = await request(app).post("/roles/r1/permissions").send({});

      expect(res.status).toBe(400);
    });

    it("GET /roles/:id/agent-config returns config", async () => {
      vi.mocked(userRepo.getRoleAgentConfig).mockResolvedValue({ systemPrompt: "sp", temperature: 0.5 } as any);

      const app = createApp();
      const res = await request(app).get("/roles/r1/agent-config");

      expect(res.status).toBe(200);
      expect(res.body.config.systemPrompt).toBe("sp");
    });

    it("GET /roles/:id/agent-config returns 500 on error", async () => {
      vi.mocked(userRepo.getRoleAgentConfig).mockRejectedValue(new Error("fail"));

      const app = createApp();
      const res = await request(app).get("/roles/r1/agent-config");

      expect(res.status).toBe(500);
    });

    it("POST /roles/:id/agent-config updates config", async () => {
      vi.mocked(userRepo.updateRoleAgentConfig).mockResolvedValue(undefined);

      const app = createApp();
      const res = await request(app).post("/roles/r1/agent-config").send({ systemPrompt: "sp2" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("POST /roles/:id/agent-config returns 500 on error", async () => {
      vi.mocked(userRepo.updateRoleAgentConfig).mockRejectedValue(new Error("fail"));

      const app = createApp();
      const res = await request(app).post("/roles/r1/agent-config").send({});

      expect(res.status).toBe(500);
    });
  });

  describe("Permission routes", () => {
    it("GET /permissions lists permissions", async () => {
      vi.mocked(resRepo.listPermissions).mockResolvedValue([{ id: "p1", name: "read", resourceId: "res1", action: "read" }]);

      const app = createApp();
      const res = await request(app).get("/permissions");

      expect(res.status).toBe(200);
      expect(res.body.permissions).toHaveLength(1);
    });
  });

  describe("Session routes", () => {
    it("GET /user/sessions returns sessions", async () => {
      const app = createApp();
      const res = await request(app).get("/user/sessions");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sessions)).toBe(true);
    });
  });
});
