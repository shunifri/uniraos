import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ShareService } from "../../src/permissions/services/share-service.js";
import { ShareRepository } from "../../src/db/share-repository.js";

const mockUserRepo = {
  getUserRoles: vi.fn(),
  getUserById: vi.fn(),
};

const mockDeptRepo = {
  getDepartmentById: vi.fn(),
};

vi.mock("../../src/db/user-repository.js", () => ({
  getUserRoles: (...args: any[]) => mockUserRepo.getUserRoles(...args),
  getUserById: (...args: any[]) => mockUserRepo.getUserById(...args),
}));

vi.mock("../../src/db/department-repository.js", () => ({
  getDepartmentById: (...args: any[]) => mockDeptRepo.getDepartmentById(...args),
}));

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_rules (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('skill','kb_document','file')),
      resource_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('all','role','department','user')),
      target_id TEXT,
      permission TEXT NOT NULL CHECK(permission IN ('read','execute','write')) DEFAULT 'read',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      password_hash TEXT,
      department_id TEXT,
      phone TEXT,
      email TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER,
      updated_at INTEGER,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      agent_config TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      path TEXT,
      level INTEGER DEFAULT 0,
      description TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
}

describe("ShareService", () => {
  let testDb: Database.Database;
  let shareRepo: ShareRepository;
  let service: ShareService;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    vi.clearAllMocks();
    shareRepo = new ShareRepository(testDb);
    service = new ShareService(shareRepo);
  });

  describe("createShareRule", () => {
    it("should create a share rule and return it with id and createdAt", async () => {
      const rule = await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      expect(rule.id).toBeDefined();
      expect(rule.createdAt).toBeGreaterThan(0);
      expect(rule.resourceType).toBe("skill");
      expect(rule.scope).toBe("all");
    });
  });

  describe("deleteShareRule", () => {
    it("should delete an existing share rule", async () => {
      const rule = await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      const deleted = await service.deleteShareRule(rule.id);
      expect(deleted).toBe(true);

      const rules = await shareRepo.getByResource("skill", "skill-1");
      expect(rules).toHaveLength(0);
    });

    it("should return false when deleting non-existent rule", async () => {
      const deleted = await service.deleteShareRule("non-existent-id");
      expect(deleted).toBe(false);
    });
  });

  describe("canAccessResource", () => {
    it("should allow owner to access their own resource", async () => {
      const canAccess = await service.canAccessResource("user-1", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(true);
    });

    it("should allow access via 'all' scope share rule", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(true);
    });

    it("should deny access when no matching share rule exists", async () => {
      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(false);
    });

    it("should allow access via 'user' scope share rule", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "user",
        targetId: "user-2",
        permission: "read",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(true);
    });

    it("should deny access when user scope does not match", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "user",
        targetId: "user-3",
        permission: "read",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(false);
    });

    it("should allow access via 'role' scope share rule", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "role",
        targetId: "role-1",
        permission: "read",
      });

      mockUserRepo.getUserRoles.mockResolvedValue([
        { id: "role-1", name: "admin", description: "" },
      ]);

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(true);
    });

    it("should deny access when role scope does not match", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "role",
        targetId: "role-1",
        permission: "read",
      });

      mockUserRepo.getUserRoles.mockResolvedValue([
        { id: "role-2", name: "user", description: "" },
      ]);

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(false);
    });

    it("should allow access via 'department' scope share rule", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "department",
        targetId: "Engineering",
        permission: "read",
      });

      mockUserRepo.getUserById.mockResolvedValue({
        id: "user-2",
        departmentId: "dept-1",
      });
      mockDeptRepo.getDepartmentById.mockResolvedValue({
        id: "dept-1",
        name: "Engineering",
        path: "/Engineering",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1");
      expect(canAccess).toBe(true);
    });

    it("should respect permission levels: write satisfies read", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "write",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1", "read");
      expect(canAccess).toBe(true);
    });

    it("should respect permission levels: read does not satisfy write", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1", "write");
      expect(canAccess).toBe(false);
    });

    it("should respect permission levels: execute satisfies read", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "execute",
      });

      const canAccess = await service.canAccessResource("user-2", "skill", "skill-1", "user-1", "read");
      expect(canAccess).toBe(true);
    });
  });

  describe("getShareRulesForResource", () => {
    it("should return all share rules for a resource", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "user",
        targetId: "user-2",
        permission: "write",
      });

      const rules = await service.getShareRulesForResource("skill", "skill-1");
      expect(rules).toHaveLength(2);
    });
  });

  describe("getSharedResourcesForUser", () => {
    it("should return shared resources filtered by type", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });
      await service.createShareRule({
        resourceType: "file",
        resourceId: "file-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      mockUserRepo.getUserRoles.mockResolvedValue([]);
      mockUserRepo.getUserById.mockResolvedValue({ id: "user-2", departmentId: null });

      const skills = await service.getSharedResourcesForUser("user-2", "skill");
      expect(skills).toHaveLength(1);
      expect(skills[0].resourceType).toBe("skill");

      const files = await service.getSharedResourcesForUser("user-2", "file");
      expect(files).toHaveLength(1);
      expect(files[0].resourceType).toBe("file");
    });

    it("should return all shared resources when no type filter", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      mockUserRepo.getUserRoles.mockResolvedValue([]);
      mockUserRepo.getUserById.mockResolvedValue({ id: "user-2", departmentId: null });

      const all = await service.getSharedResourcesForUser("user-2");
      expect(all).toHaveLength(1);
    });
  });

  describe("rule validation", () => {
    it("should only match share rules from the same owner", async () => {
      await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "all",
        permission: "read",
      });

      // user-2 tries to access skill-1 but owner is user-1, not user-2
      const canAccess = await service.canAccessResource("user-3", "skill", "skill-1", "user-2");
      expect(canAccess).toBe(false);
    });

    it("should reject department scope with LIKE wildcards in targetId", async () => {
      await expect(
        service.createShareRule({
          resourceType: "skill",
          resourceId: "skill-1",
          ownerId: "user-1",
          scope: "department",
          targetId: "%",
          permission: "read",
        })
      ).rejects.toThrow("targetId for department scope cannot contain LIKE wildcards");

      await expect(
        service.createShareRule({
          resourceType: "skill",
          resourceId: "skill-1",
          ownerId: "user-1",
          scope: "department",
          targetId: "Eng_ineering",
          permission: "read",
        })
      ).rejects.toThrow("targetId for department scope cannot contain LIKE wildcards");
    });

    it("should allow valid department scope targetId", async () => {
      const rule = await service.createShareRule({
        resourceType: "skill",
        resourceId: "skill-1",
        ownerId: "user-1",
        scope: "department",
        targetId: "Engineering",
        permission: "read",
      });
      expect(rule.targetId).toBe("Engineering");
    });
  });
});
