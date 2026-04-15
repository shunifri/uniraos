import { describe, it, expect } from "vitest";
import {
  PermissionError,
  AuthenticationRequiredError,
  AccessDeniedError,
  SkillAccessDeniedError,
} from "../../src/permissions/errors/permission-errors.js";

describe("Permission Errors", () => {
  describe("PermissionError", () => {
    it("should create basic permission error", () => {
      const error = new PermissionError("Test error");
      expect(error.name).toBe("PermissionError");
      expect(error.message).toBe("Test error");
    });

    it("should include permission name and userId", () => {
      const error = new PermissionError("Test error", "config.read", "user-123");
      expect(error.permissionName).toBe("config.read");
      expect(error.userId).toBe("user-123");
    });
  });

  describe("AuthenticationRequiredError", () => {
    it("should create authentication required error", () => {
      const error = new AuthenticationRequiredError();
      expect(error.name).toBe("AuthenticationRequiredError");
      expect(error.message).toBe("Authentication required");
    });

    it("should accept custom message", () => {
      const error = new AuthenticationRequiredError("Custom message");
      expect(error.message).toBe("Custom message");
    });
  });

  describe("AccessDeniedError", () => {
    it("should create access denied error with permission name", () => {
      const error = new AccessDeniedError("config.read");
      expect(error.name).toBe("AccessDeniedError");
      expect(error.permissionName).toBe("config.read");
      expect(error.message).toBe("Access denied: config.read");
    });

    it("should include userId and custom message", () => {
      const error = new AccessDeniedError(
        "config.read",
        "user-456",
        "You are not authorized"
      );
      expect(error.permissionName).toBe("config.read");
      expect(error.userId).toBe("user-456");
      expect(error.message).toBe("You are not authorized");
    });
  });

  describe("SkillAccessDeniedError", () => {
    it("should create skill access denied error with skill name", () => {
      const error = new SkillAccessDeniedError("test-skill");
      expect(error.name).toBe("SkillAccessDeniedError");
      expect(error.permissionName).toBe("skill:test-skill.execute");
      expect(error.message).toBe("Permission denied for skill: test-skill");
    });

    it("should include userId", () => {
      const error = new SkillAccessDeniedError("test-skill", "user-789");
      expect(error.userId).toBe("user-789");
    });
  });

  describe("Error Hierarchy", () => {
    it("should all be instances of Error", () => {
      expect(new PermissionError("test") instanceof Error).toBe(true);
      expect(new AuthenticationRequiredError() instanceof Error).toBe(true);
      expect(new AccessDeniedError("perm") instanceof Error).toBe(true);
      expect(new SkillAccessDeniedError("skill") instanceof Error).toBe(true);
    });

    it("should all be instances of PermissionError", () => {
      expect(new AuthenticationRequiredError() instanceof PermissionError).toBe(true);
      expect(new AccessDeniedError("perm") instanceof PermissionError).toBe(true);
      expect(new SkillAccessDeniedError("skill") instanceof PermissionError).toBe(true);
    });
  });
});
