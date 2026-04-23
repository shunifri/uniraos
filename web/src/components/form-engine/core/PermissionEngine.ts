/**
 * RAOS Form Engine - Permission Engine
 *
 * Evaluates field-level read/write permissions against user permissions.
 */

export interface FieldPermission {
  read?: string[];
  write?: string[];
}

export interface PermissionResult {
  visible: boolean;
  readOnly: boolean;
}

/**
 * Check if user has any of the required permissions.
 */
function hasAnyPermission(
  required: string[] | undefined,
  userPermissions: string[]
): boolean {
  if (!required || required.length === 0) return true;
  return required.some((perm) => userPermissions.includes(perm));
}

/**
 * Evaluate field permission for the current user.
 *
 * Rules:
 * - No permission config → visible + writable (default)
 * - Has write permission → visible + writable
 * - Has read but not write → visible + readonly
 * - No read permission → hidden
 */
export function evaluateFieldPermission(
  permission: FieldPermission | undefined,
  userPermissions: string[]
): PermissionResult {
  if (!permission) {
    return { visible: true, readOnly: false };
  }

  const canWrite = hasAnyPermission(permission.write, userPermissions);
  if (canWrite) {
    return { visible: true, readOnly: false };
  }

  const canRead = hasAnyPermission(permission.read, userPermissions);
  if (canRead) {
    return { visible: true, readOnly: true };
  }

  return { visible: false, readOnly: true };
}

/**
 * Get current user permissions from auth store.
 * Includes role names as implicit permissions.
 */
export function getUserPermissions(
  user: { roles?: { name: string }[]; permissions?: string[] } | null
): string[] {
  if (!user) return [];
  const rolePerms = (user.roles || []).map((r) => r.name);
  const explicitPerms = user.permissions || [];
  return Array.from(new Set([...rolePerms, ...explicitPerms]));
}
