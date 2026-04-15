export class PermissionChecker {
  private permissions: Set<string>;

  constructor(permissions: string[]) {
    this.permissions = new Set(permissions);
  }

  has(permissionName: string): boolean {
    if (this.permissions.has('*')) return true;

    if (this.permissions.has(permissionName)) return true;

    const parts = permissionName.split('.');
    if (parts.length === 2) {
      if (this.permissions.has(`${parts[0]}.*`)) return true;
    }

    if (permissionName.startsWith('skill:')) {
      if (this.permissions.has('skill:*')) return true;
      // 精确匹配 skill:*.execute 模式
      if (permissionName.endsWith('.execute')) {
        if (this.permissions.has('skill:*.execute')) return true;
      }
    }

    return false;
  }

  hasAny(permissionNames: string[]): boolean {
    return permissionNames.some((p) => this.has(p));
  }

  hasAll(permissionNames: string[]): boolean {
    return permissionNames.every((p) => this.has(p));
  }
}
