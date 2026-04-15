import { describe, it, expect } from "vitest";
import {
  API_PERMISSIONS,
  MENU_PERMISSIONS,
  ROLE_NAMES,
  USER_ALLOWED_SKILLS,
  ANONYMOUS_ALLOWED_SKILLS,
  ADMIN_SKILL_PERMISSIONS,
  skillPermission,
  isAdminPermission,
} from "../../src/permissions/constants.js";

describe("Permission Constants", () => {
  describe("API_PERMISSIONS", () => {
    it("should define all required API permissions", () => {
      expect(API_PERMISSIONS.SKILLS_READ).toBe("skills.read");
      expect(API_PERMISSIONS.SKILLS_EXECUTE).toBe("skills.execute");
      expect(API_PERMISSIONS.SKILLS_MANAGE).toBe("skills.manage");
      expect(API_PERMISSIONS.CONFIG_READ).toBe("config.read");
      expect(API_PERMISSIONS.CONFIG_WRITE).toBe("config.write");
      expect(API_PERMISSIONS.MEMORY_READ).toBe("memory.read");
      expect(API_PERMISSIONS.MEMORY_WRITE).toBe("memory.write");
      expect(API_PERMISSIONS.KNOWLEDGE_READ).toBe("knowledge.read");
      expect(API_PERMISSIONS.KNOWLEDGE_WRITE).toBe("knowledge.write");
      expect(API_PERMISSIONS.KNOWLEDGE_MANAGE).toBe("knowledge.manage");
      expect(API_PERMISSIONS.FILES_READ).toBe("files.read");
      expect(API_PERMISSIONS.FILES_WRITE).toBe("files.write");
      expect(API_PERMISSIONS.USERS_MANAGE).toBe("users.manage");
      expect(API_PERMISSIONS.ROLES_MANAGE).toBe("roles.manage");
      expect(API_PERMISSIONS.DEPARTMENTS_MANAGE).toBe("departments.manage");
      expect(API_PERMISSIONS.PLUGINS_MANAGE).toBe("plugins.manage");
      expect(API_PERMISSIONS.TASKS_READ).toBe("tasks.read");
      expect(API_PERMISSIONS.SYSTEM_MANAGE).toBe("system.manage");
    });
  });

  describe("MENU_PERMISSIONS", () => {
    it("should define all required menu permissions", () => {
      expect(MENU_PERMISSIONS.MENU_SKILLS).toBe("menu:skills.read");
      expect(MENU_PERMISSIONS.MENU_CHAT).toBe("menu:chat.read");
      expect(MENU_PERMISSIONS.MENU_KNOWLEDGE).toBe("menu:knowledge.read");
      expect(MENU_PERMISSIONS.MENU_FILES).toBe("menu:files.read");
      expect(MENU_PERMISSIONS.MENU_CONFIG).toBe("menu:config.read");
      expect(MENU_PERMISSIONS.MENU_MEMORY).toBe("menu:memory.read");
      expect(MENU_PERMISSIONS.MENU_EVOLUTION).toBe("menu:evolution.read");
      expect(MENU_PERMISSIONS.MENU_GRAPH).toBe("menu:graph.read");
      expect(MENU_PERMISSIONS.MENU_ADMIN).toBe("menu:admin.read");
    });
  });

  describe("ROLE_NAMES", () => {
    it("should define role names", () => {
      expect(ROLE_NAMES.ADMIN).toBe("admin");
      expect(ROLE_NAMES.USER).toBe("user");
      expect(ROLE_NAMES.ANONYMOUS).toBe("anonymous");
    });
  });

  describe("Skill Lists", () => {
    it("should define user allowed skills", () => {
      expect(Array.isArray(USER_ALLOWED_SKILLS)).toBe(true);
      expect(USER_ALLOWED_SKILLS.length).toBeGreaterThan(0);
    });

    it("should define anonymous allowed skills", () => {
      expect(Array.isArray(ANONYMOUS_ALLOWED_SKILLS)).toBe(true);
      expect(ANONYMOUS_ALLOWED_SKILLS.length).toBeGreaterThan(0);
    });

    it("should define admin skill permissions", () => {
      expect(Array.isArray(ADMIN_SKILL_PERMISSIONS)).toBe(true);
      expect(ADMIN_SKILL_PERMISSIONS).toContain("skill:*.execute");
      expect(ADMIN_SKILL_PERMISSIONS).toContain("skill:*.read");
      expect(ADMIN_SKILL_PERMISSIONS).toContain("skill:*.manage");
    });
  });

  describe("Helper Functions", () => {
    describe("skillPermission", () => {
      it("should create skill permission string", () => {
        expect(skillPermission("test-skill")).toBe("skill:test-skill.execute");
        expect(skillPermission("another_skill")).toBe("skill:another_skill.execute");
      });
    });

    describe("isAdminPermission", () => {
      it("should identify admin-only permissions", () => {
        expect(isAdminPermission("users.manage")).toBe(true);
        expect(isAdminPermission("roles.manage")).toBe(true);
        expect(isAdminPermission("departments.manage")).toBe(true);
        expect(isAdminPermission("plugins.manage")).toBe(true);
        expect(isAdminPermission("system.manage")).toBe(true);
      });

      it("should return false for non-admin permissions", () => {
        expect(isAdminPermission("config.read")).toBe(false);
        expect(isAdminPermission("skills.execute")).toBe(false);
        expect(isAdminPermission("memory.read")).toBe(false);
        expect(isAdminPermission("knowledge.read")).toBe(false);
      });
    });
  });
});
