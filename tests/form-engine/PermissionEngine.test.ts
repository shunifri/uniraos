import { describe, it, expect } from "vitest";
import { evaluateFieldPermission, getUserPermissions } from "../../web/src/components/form-engine/core/PermissionEngine";

describe("PermissionEngine", () => {
  it("should allow all when no permission config", () => {
    const result = evaluateFieldPermission(undefined, ["user"]);
    expect(result.visible).toBe(true);
    expect(result.readOnly).toBe(false);
  });

  it("should grant write when user has write permission", () => {
    const result = evaluateFieldPermission(
      { read: ["admin"], write: ["editor"] },
      ["editor"]
    );
    expect(result.visible).toBe(true);
    expect(result.readOnly).toBe(false);
  });

  it("should grant read-only when user has read but not write", () => {
    const result = evaluateFieldPermission(
      { read: ["viewer", "admin"], write: ["editor"] },
      ["viewer"]
    );
    expect(result.visible).toBe(true);
    expect(result.readOnly).toBe(true);
  });

  it("should hide when user has no read permission", () => {
    const result = evaluateFieldPermission(
      { read: ["admin"], write: ["admin"] },
      ["user"]
    );
    expect(result.visible).toBe(false);
    expect(result.readOnly).toBe(true);
  });

  it("should collect user permissions from roles and explicit permissions", () => {
    const perms = getUserPermissions({
      roles: [{ name: "admin" }, { name: "developer" }],
      permissions: ["form.edit", "form.view"],
    });
    expect(perms).toContain("admin");
    expect(perms).toContain("developer");
    expect(perms).toContain("form.edit");
  });
});
