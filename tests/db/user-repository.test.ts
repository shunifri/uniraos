import { describe, it, expect, vi, beforeEach } from "vitest";

// ── module mocks (factories must be self-contained) ────────────────────────
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: vi.fn(() => "mocked-uuid-1234"),
    randomBytes: vi.fn((size: number) => Buffer.alloc(size, 0xab)),
  };
});

vi.mock("../../src/db/database.js", () => ({
  getDb: vi.fn(),
  isMySQL: vi.fn(() => false),
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../../src/db/department-repository.js", () => ({
  getDepartmentById: vi.fn(),
}));

// ── imports ────────────────────────────────────────────────────────────────
import {
  hashPassword,
  verifyPassword,
  createUser,
  getUserById,
  getUserByUsername,
  getUserByPhone,
  listUsers,
  countUsers,
  updateUser,
  changePassword,
  deleteUser,
  authenticate,
  getUserRoles,
  assignRole,
  removeRole,
  userHasPermission,
  getUserPermissions,
  getUserWithDetails,
  listRoles,
  createRole,
  deleteRole,
  getRoleAgentConfig,
  updateRoleAgentConfig,
  getUserDepartment,
  ensureAdminExists,
} from "../../src/db/user-repository.js";

import { getDb, isMySQL } from "../../src/db/database.js";
import { log } from "../../src/utils/logger.js";
import { getDepartmentById } from "../../src/db/department-repository.js";

// ── helpers ─────────────────────────────────────────────────────────────────
function createMockDb() {
  const stmt = {
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  };
  const db = {
    prepare: vi.fn(() => stmt),
    transaction: vi.fn((fn: Function) => fn),
  };
  return { db, stmt };
}

function makeUserRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u_test",
    username: "testuser",
    display_name: "Test User",
    avatar: "",
    phone: "",
    email: "",
    department_id: null,
    status: "active",
    created_at: 1700000000000,
    updated_at: 1700000000000,
    last_login_at: null,
    ...overrides,
  };
}

function makeRoleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "role_1",
    name: "user",
    description: "Regular user",
    is_system: 0,
    ...overrides,
  };
}

// ── test suite ──────────────────────────────────────────────────────────────
describe("user-repository.ts", () => {
  let mockDb: ReturnType<typeof createMockDb>["db"];
  let mockStmt: ReturnType<typeof createMockDb>["stmt"];

  beforeEach(() => {
    const m = createMockDb();
    mockDb = m.db;
    mockStmt = m.stmt;

    vi.mocked(getDb).mockReturnValue(mockDb);
    vi.mocked(isMySQL).mockReturnValue(false);
    vi.mocked(log).mockClear();
    vi.mocked(getDepartmentById).mockReset();

    mockStmt.get.mockReturnValue(undefined);
    mockStmt.all.mockReturnValue([]);
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  // ── password hashing ─────────────────────────────────────────────────────
  describe("hashPassword / verifyPassword", () => {
    it("hashPassword returns v2 format", async () => {
      const hash = await hashPassword("password123");
      expect(hash).toMatch(/^v2:[a-f0-9]{32}:[a-f0-9]{128}$/);
    });

    it("verifyPassword returns true for correct password (v2)", async () => {
      const hash = await hashPassword("password123");
      expect(await verifyPassword("password123", hash)).toBe(true);
    });

    it("verifyPassword returns false for wrong password (v2)", async () => {
      const hash = await hashPassword("password123");
      expect(await verifyPassword("wrongpassword", hash)).toBe(false);
    });

    it("verifyPassword supports old format (no v2 prefix)", async () => {
      const { scrypt } = await import("crypto");
      const salt = "oldsalt";
      const hash = await new Promise<Buffer>((resolve, reject) => {
        scrypt("secret", salt, 64, {}, (err, derived) => {
          if (err) reject(err);
          else resolve(derived);
        });
      });
      const oldFormat = `${salt}:${hash.toString("hex")}`;
      expect(await verifyPassword("secret", oldFormat)).toBe(true);
      expect(await verifyPassword("wrong", oldFormat)).toBe(false);
    });

    it("verifyPassword returns false for invalid formats", async () => {
      expect(await verifyPassword("pwd", "v2:incomplete")).toBe(false);
      expect(await verifyPassword("pwd", "")).toBe(false);
      expect(await verifyPassword("pwd", "nocolon")).toBe(false);
    });
  });

  // ── createUser ───────────────────────────────────────────────────────────
  describe("createUser", () => {
    it("creates user with hashed password and default role", async () => {
      const userRow = makeUserRow({
        id: "u_mocked-uuid-",
        username: "alice",
        display_name: "alice",
        department_id: "dept_root",
      });
      mockStmt.get.mockReturnValue(userRow);

      const user = await createUser({ username: "alice", password: "secret" });

      expect(user.username).toBe("alice");
      expect(user.departmentId).toBe("dept_root");

      // Capture the generated ID from the INSERT users call
      const insertUserCall = vi.mocked(mockStmt.run).mock.calls.find(
        (c) => c.length > 2 && c[1] === "alice"
      );
      expect(insertUserCall).toBeDefined();
      const generatedId = insertUserCall![0] as string;
      expect(generatedId).toMatch(/^u_/);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO users")
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)"
      );
      expect(mockStmt.run).toHaveBeenCalledWith(generatedId, "role_user");
    });

    it("creates user with custom roles and department", async () => {
      const userRow = makeUserRow({
        id: "u_mocked-uuid-",
        username: "bob",
        display_name: "Bob",
        department_id: "dept_1",
      });
      mockStmt.get.mockReturnValue(userRow);

      await createUser({
        username: "bob",
        password: "secret",
        displayName: "Bob",
        departmentId: "dept_1",
        phone: "13800138000",
        email: "bob@example.com",
        roleIds: ["role_admin", "role_user"],
      });

      // Capture generated ID from INSERT users call
      const insertUserCall = vi.mocked(mockStmt.run).mock.calls.find(
        (c) => c.length > 2 && c[1] === "bob"
      );
      expect(insertUserCall).toBeDefined();
      const generatedId = insertUserCall![0] as string;

      expect(mockStmt.run).toHaveBeenCalledWith(generatedId, "role_admin");
      expect(mockStmt.run).toHaveBeenCalledWith(generatedId, "role_user");
    });
  });

  // ── lookups ──────────────────────────────────────────────────────────────
  describe("getUserById / getUserByUsername / getUserByPhone", () => {
    it("getUserById returns mapped user", async () => {
      mockStmt.get.mockReturnValue(makeUserRow({ id: "u_1", username: "a" }));
      const user = await getUserById("u_1");
      expect(user).not.toBeNull();
      expect(user!.id).toBe("u_1");
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ? AND status != 'deleted'"
      );
    });

    it("getUserById returns null when not found", async () => {
      mockStmt.get.mockReturnValue(undefined);
      expect(await getUserById("u_missing")).toBeNull();
    });

    it("getUserByUsername returns mapped user", async () => {
      mockStmt.get.mockReturnValue(makeUserRow({ username: "tom" }));
      const user = await getUserByUsername("tom");
      expect(user!.username).toBe("tom");
    });

    it("getUserByPhone returns mapped user", async () => {
      mockStmt.get.mockReturnValue(makeUserRow({ phone: "13900139000" }));
      const user = await getUserByPhone("13900139000");
      expect(user!.phone).toBe("13900139000");
    });
  });

  // ── listUsers ────────────────────────────────────────────────────────────
  describe("listUsers", () => {
    it("returns mapped users with pagination defaults", async () => {
      mockStmt.all.mockReturnValue([
        makeUserRow({ id: "u_1" }),
        makeUserRow({ id: "u_2" }),
      ]);
      const users = await listUsers();
      expect(users).toHaveLength(2);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      );
      expect(mockStmt.all).toHaveBeenCalledWith("active", 50, 0);
    });

    it("respects custom limit, offset, and status", async () => {
      mockStmt.all.mockReturnValue([]);
      await listUsers({ limit: 10, offset: 20, status: "disabled" });
      expect(mockStmt.all).toHaveBeenCalledWith("disabled", 10, 20);
    });
  });

  // ── countUsers ───────────────────────────────────────────────────────────
  describe("countUsers", () => {
    it("returns count for given status", async () => {
      mockStmt.get.mockReturnValue({ c: 42 });
      expect(await countUsers("active")).toBe(42);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "SELECT COUNT(*) as c FROM users WHERE status = ?"
      );
      expect(mockStmt.get).toHaveBeenCalledWith("active");
    });
  });

  // ── updateUser ───────────────────────────────────────────────────────────
  describe("updateUser", () => {
    it("updates specified fields and returns updated user", async () => {
      const updatedRow = makeUserRow({
        id: "u_1",
        display_name: "New Name",
        avatar: "new.png",
      });
      mockStmt.get.mockReturnValue(updatedRow);

      const user = await updateUser("u_1", {
        displayName: "New Name",
        avatar: "new.png",
      });

      expect(user!.displayName).toBe("New Name");
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users SET")
      );
    });

    it("replaces roles when roleIds provided", async () => {
      mockStmt.get.mockReturnValue(makeUserRow({ id: "u_1" }));

      await updateUser("u_1", { roleIds: ["role_admin"] });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        "DELETE FROM user_roles WHERE user_id = ?"
      );
      expect(mockStmt.run).toHaveBeenCalledWith("u_1", "role_admin");
    });

    it("does not update when no fields provided", async () => {
      mockStmt.get.mockReturnValue(makeUserRow({ id: "u_1" }));
      await updateUser("u_1", {});
      const updateCalls = vi
        .mocked(mockDb.prepare)
        .mock.calls.filter(
          (c) => typeof c[0] === "string" && c[0].startsWith("UPDATE")
        );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ── changePassword ───────────────────────────────────────────────────────
  describe("changePassword", () => {
    it("returns true and logs on success", async () => {
      mockStmt.run.mockReturnValue({ changes: 1 });
      const result = await changePassword("u_1", "newpass");
      expect(result).toBe(true);
      expect(log).toHaveBeenCalledWith(
        "info",
        "auth.password_changed",
        { userId: "u_1" }
      );
    });

    it("returns false when no rows changed", async () => {
      mockStmt.run.mockReturnValue({ changes: 0 });
      const result = await changePassword("u_1", "newpass");
      expect(result).toBe(false);
      expect(log).not.toHaveBeenCalled();
    });
  });

  // ── deleteUser ───────────────────────────────────────────────────────────
  describe("deleteUser", () => {
    it("soft deletes user and logs on success", async () => {
      mockStmt.run.mockReturnValue({ changes: 1 });
      const result = await deleteUser("u_1");
      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "UPDATE users SET status = 'deleted', updated_at = unixepoch() WHERE id = ?"
      );
      expect(log).toHaveBeenCalledWith("info", "auth.user_deleted", {
        userId: "u_1",
      });
    });

    it("returns false when no rows changed", async () => {
      mockStmt.run.mockReturnValue({ changes: 0 });
      expect(await deleteUser("u_1")).toBe(false);
    });
  });

  // ── authenticate ─────────────────────────────────────────────────────────
  describe("authenticate", () => {
    it("returns user and updates last_login_at on success", async () => {
      const password = "correct";
      const hash = await hashPassword(password);
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_1", username: "alice", password_hash: hash })
      );

      const user = await authenticate("alice", password);

      expect(user).not.toBeNull();
      expect(user!.username).toBe("alice");
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "UPDATE users SET last_login_at = unixepoch() WHERE id = ?"
      );
      expect(mockStmt.run).toHaveBeenCalledWith("u_1");
      expect(log).toHaveBeenCalledWith(
        "info",
        "auth.login_success",
        { username: "alice", userId: "u_1" }
      );
    });

    it("returns null and logs when user not found", async () => {
      mockStmt.get.mockReturnValue(undefined);
      expect(await authenticate("nobody", "pass")).toBeNull();
      expect(log).toHaveBeenCalledWith("warn", "auth.login_failed", {
        username: "nobody",
        reason: "user_not_found",
      });
    });

    it("returns null and logs when password invalid", async () => {
      const hash = await hashPassword("correct");
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_1", username: "alice", password_hash: hash })
      );
      expect(await authenticate("alice", "wrong")).toBeNull();
      expect(log).toHaveBeenCalledWith("warn", "auth.login_failed", {
        username: "alice",
        userId: "u_1",
        reason: "invalid_password",
      });
    });
  });

  // ── role management ──────────────────────────────────────────────────────
  describe("getUserRoles / assignRole / removeRole", () => {
    it("getUserRoles returns roles array", async () => {
      mockStmt.all.mockReturnValue([
        { id: "role_1", name: "admin", description: "Admin role" },
      ]);
      const roles = await getUserRoles("u_1");
      expect(roles).toHaveLength(1);
      expect(roles[0].name).toBe("admin");
    });

    it("assignRole inserts and logs", async () => {
      await assignRole("u_1", "role_admin");
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)"
      );
      expect(mockStmt.run).toHaveBeenCalledWith("u_1", "role_admin");
      expect(log).toHaveBeenCalledWith("info", "auth.role_assigned", {
        userId: "u_1",
        roleId: "role_admin",
      });
    });

    it("removeRole deletes and logs", async () => {
      await removeRole("u_1", "role_admin");
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "DELETE FROM user_roles WHERE user_id = ? AND role_id = ?"
      );
      expect(mockStmt.run).toHaveBeenCalledWith("u_1", "role_admin");
      expect(log).toHaveBeenCalledWith("info", "auth.role_removed", {
        userId: "u_1",
        roleId: "role_admin",
      });
    });
  });

  // ── permission queries ───────────────────────────────────────────────────
  describe("userHasPermission / getUserPermissions", () => {
    it("userHasPermission returns true when permission exists", async () => {
      mockStmt.get.mockReturnValue({ 1: 1 });
      expect(await userHasPermission("u_1", "users.read")).toBe(true);
    });

    it("userHasPermission returns false when permission missing", async () => {
      mockStmt.get.mockReturnValue(undefined);
      expect(await userHasPermission("u_1", "users.delete")).toBe(false);
    });

    it("getUserPermissions returns distinct names", async () => {
      mockStmt.all.mockReturnValue([
        { name: "users.read" },
        { name: "users.write" },
      ]);
      const perms = await getUserPermissions("u_1");
      expect(perms).toEqual(["users.read", "users.write"]);
    });
  });

  // ── getUserWithDetails ───────────────────────────────────────────────────
  describe("getUserWithDetails", () => {
    it("returns full user with roles, department, and permissions", async () => {
      mockStmt.get
        .mockReturnValueOnce(
          makeUserRow({ id: "u_1", department_id: "dept_1" })
        )
        .mockReturnValueOnce({
          id: "dept_1",
          name: "Engineering",
          path: "/Engineering",
        });

      mockStmt.all
        .mockReturnValueOnce([
          { id: "role_1", name: "admin", description: "" },
        ])
        .mockReturnValueOnce([{ name: "users.read" }]);

      const details = await getUserWithDetails("u_1");
      expect(details).not.toBeNull();
      expect(details!.roles).toHaveLength(1);
      expect(details!.department!.name).toBe("Engineering");
      expect(details!.permissions).toContain("users.read");
    });

    it("returns null when user not found", async () => {
      mockStmt.get.mockReturnValue(undefined);
      expect(await getUserWithDetails("u_missing")).toBeNull();
    });

    it("handles user without department", async () => {
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_1", department_id: null })
      );
      mockStmt.all.mockReturnValueOnce([]).mockReturnValueOnce([]);

      const details = await getUserWithDetails("u_1");
      expect(details!.department).toBeNull();
    });
  });

  // ── role CRUD ────────────────────────────────────────────────────────────
  describe("listRoles / createRole / deleteRole", () => {
    it("listRoles returns mapped roles", async () => {
      mockStmt.all.mockReturnValue([
        makeRoleRow({ id: "role_admin", name: "admin", is_system: 1 }),
        makeRoleRow({ id: "role_user", name: "user", is_system: 0 }),
      ]);
      const roles = await listRoles();
      expect(roles).toHaveLength(2);
      expect(roles[0].isSystem).toBe(true);
      expect(roles[1].isSystem).toBe(false);
    });

    it("createRole inserts and returns role", async () => {
      mockStmt.run.mockReturnValue({ changes: 1 });
      const role = await createRole({
        name: "editor",
        description: "Can edit",
      });
      expect(role.id).toMatch(/^role_/);
      expect(role.name).toBe("editor");
      expect(role.isSystem).toBe(false);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "INSERT INTO roles (id, name, description, is_system) VALUES (?, ?, ?, 0)"
      );
    });

    it("deleteRole deletes related records and returns true", async () => {
      mockStmt.get.mockReturnValue({ is_system: 0 });
      mockStmt.run.mockReturnValue({ changes: 1 });

      const result = await deleteRole("role_1");
      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "DELETE FROM role_permissions WHERE role_id = ?"
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "DELETE FROM user_roles WHERE role_id = ?"
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "DELETE FROM roles WHERE id = ?"
      );
    });

    it("deleteRole returns false when role not found", async () => {
      mockStmt.get.mockReturnValue(undefined);
      expect(await deleteRole("role_missing")).toBe(false);
    });

    it("deleteRole throws for system roles", async () => {
      mockStmt.get.mockReturnValue({ is_system: 1 });
      await expect(deleteRole("role_admin")).rejects.toThrow(
        "Cannot delete system role"
      );
    });
  });

  // ── role agent config ────────────────────────────────────────────────────
  describe("getRoleAgentConfig / updateRoleAgentConfig", () => {
    it("getRoleAgentConfig parses JSON config", async () => {
      const config = { systemPrompt: "Be helpful", maxIterations: 5 };
      mockStmt.get.mockReturnValue({ agent_config: JSON.stringify(config) });
      const result = await getRoleAgentConfig("role_1");
      expect(result).toEqual(config);
    });

    it("getRoleAgentConfig returns null when missing", async () => {
      mockStmt.get.mockReturnValue({ agent_config: null });
      expect(await getRoleAgentConfig("role_1")).toBeNull();
    });

    it("getRoleAgentConfig returns null on invalid JSON", async () => {
      mockStmt.get.mockReturnValue({ agent_config: "not-json" });
      expect(await getRoleAgentConfig("role_1")).toBeNull();
    });

    it("updateRoleAgentConfig updates config", async () => {
      const config = { personality: "friendly" };
      await updateRoleAgentConfig("role_1", config);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "UPDATE roles SET agent_config = ? WHERE id = ?"
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        JSON.stringify(config),
        "role_1"
      );
    });

    it("updateRoleAgentConfig handles null config", async () => {
      await updateRoleAgentConfig("role_1", null);
      expect(mockStmt.run).toHaveBeenCalledWith(null, "role_1");
    });
  });

  // ── getUserDepartment ────────────────────────────────────────────────────
  describe("getUserDepartment", () => {
    it("returns department via dynamic import", async () => {
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_1", department_id: "dept_1" })
      );
      vi.mocked(getDepartmentById).mockResolvedValue({
        id: "dept_1",
        name: "Sales",
        path: "/Sales",
      });

      const dept = await getUserDepartment("u_1");
      expect(dept).not.toBeNull();
      expect(dept!.name).toBe("Sales");
      expect(getDepartmentById).toHaveBeenCalledWith("dept_1");
    });

    it("returns null when user has no department", async () => {
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_1", department_id: null })
      );
      expect(await getUserDepartment("u_1")).toBeNull();
    });

    it("returns null when department not found", async () => {
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_1", department_id: "dept_1" })
      );
      vi.mocked(getDepartmentById).mockResolvedValue(null);
      expect(await getUserDepartment("u_1")).toBeNull();
    });
  });

  // ── ensureAdminExists ────────────────────────────────────────────────────
  describe("ensureAdminExists", () => {
    it("returns existing admin when found", async () => {
      mockStmt.get.mockReturnValue(
        makeUserRow({ id: "u_admin", username: "admin" })
      );
      const user = await ensureAdminExists();
      expect(user.username).toBe("admin");
      const insertCalls = vi
        .mocked(mockDb.prepare)
        .mock.calls.filter(
          (c) => typeof c[0] === "string" && c[0].startsWith("INSERT")
        );
      expect(insertCalls).toHaveLength(0);
    });

    it("creates new admin with random password when not found", async () => {
      mockStmt.get
        .mockReturnValueOnce(undefined) // getUserByUsername("admin")
        .mockReturnValue(
          makeUserRow({
            id: "u_mocked-uuid-",
            username: "admin",
            display_name: "Administrator",
          })
        );

      const user = await ensureAdminExists();
      expect(user.username).toBe("admin");
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO users")
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')"
      );
    });
  });
});
