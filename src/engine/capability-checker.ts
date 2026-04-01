/**
 * Skill 能力权限验证器
 *
 * 能力声明格式: "domain:action:resource_pattern"
 * 例如: "file:read:/tmp/*", "network:outbound:*", "db:query:users"
 *
 * 授予格式相同，支持通配符:
 *   "file:*:*"         — 允许所有文件操作
 *   "*:*:*"            — 超级权限
 *   "file:read:/tmp/*" — 仅允许读 /tmp 下的文件
 */

export interface CapabilityGrant {
  domain: string;
  action: string;
  resource: string;
}

export class CapabilityChecker {
  private grants: CapabilityGrant[] = [];

  /** 设置当前执行上下文的授权列表 */
  setGrants(grants: string[]): void {
    this.grants = grants.map(parseCapability);
  }

  /** 检查 Skill 所需的所有能力是否满足 */
  check(required: string[]): CapabilityViolation[] {
    if (!required || required.length === 0) return [];
    if (this.grants.length === 0 && required.length > 0) {
      // 未配置任何授权时，默认全部通过（向后兼容）
      return [];
    }

    const violations: CapabilityViolation[] = [];
    for (const req of required) {
      const parsed = parseCapability(req);
      if (!this.grants.some((g) => matchCapability(g, parsed))) {
        violations.push({ required: req, granted: this.grants.map(formatCapability) });
      }
    }
    return violations;
  }

  /** 计算传播后的权限（子 Skill 不能超过父 Skill 的权限） */
  narrow(parentGrants: string[], childRequired: string[]): string[] {
    if (!parentGrants || parentGrants.length === 0) return childRequired;
    // 子 Skill 只能使用父 Skill 已授权的能力的子集
    return childRequired.filter((req) => {
      const parsed = parseCapability(req);
      return parentGrants.some((g) => matchCapability(parseCapability(g), parsed));
    });
  }
}

export interface CapabilityViolation {
  required: string;
  granted: string[];
}

function parseCapability(cap: string): CapabilityGrant {
  const parts = cap.split(":");
  return {
    domain: parts[0] || "*",
    action: parts[1] || "*",
    resource: parts.slice(2).join(":") || "*",
  };
}

function formatCapability(g: CapabilityGrant): string {
  return `${g.domain}:${g.action}:${g.resource}`;
}

function matchCapability(grant: CapabilityGrant, required: CapabilityGrant): boolean {
  return (
    matchPattern(grant.domain, required.domain) &&
    matchPattern(grant.action, required.action) &&
    matchPattern(grant.resource, required.resource)
  );
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;
  // 简单通配符: "foo/*" matches "foo/bar" and "foo/bar/baz"
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "foo/"
    return value.startsWith(prefix) || value === pattern.slice(0, -2);
  }
  return false;
}
