import type { ShareRule, ShareScope, SharePermission } from '../types/index.js';
import { ShareRepository } from '../../db/share-repository.js';
import { getUserRoles, getUserById } from '../../db/user-repository.js';
import { getDepartmentById } from '../../db/department-repository.js';

export class ShareService {
  private shareRepo: ShareRepository;

  constructor(shareRepo?: ShareRepository) {
    this.shareRepo = shareRepo ?? ShareRepository.getInstance();
  }

  async canAccessResource(
    userId: string,
    resourceType: 'skill' | 'kb_document' | 'file',
    resourceId: string,
    ownerId: string,
    requiredPermission: SharePermission = 'read'
  ): Promise<boolean> {
    if (userId === ownerId) {
      return true;
    }

    const shareRules = await this.getShareRulesForResource(resourceType, resourceId);

    for (const rule of shareRules) {
      if (rule.ownerId !== ownerId) continue;

      if (await this.matchesShareRule(rule, userId)) {
        return this.permissionSatisfies(rule.permission, requiredPermission);
      }
    }

    return false;
  }

  async getShareRulesForResource(
    resourceType: 'skill' | 'kb_document' | 'file',
    resourceId: string
  ): Promise<ShareRule[]> {
    return this.shareRepo.getByResource(resourceType, resourceId);
  }

  async getSharedResourcesForUser(
    userId: string,
    resourceType?: 'skill' | 'kb_document' | 'file'
  ): Promise<ShareRule[]> {
    const roles = await getUserRoles(userId);
    const roleIds = roles.map((r) => r.id);

    const user = await getUserById(userId);
    let deptPath = '/';
    if (user?.departmentId) {
      const dept = await getDepartmentById(user.departmentId);
      if (dept) deptPath = dept.path;
    }

    const allRules = await this.shareRepo.getSharedToUser(userId, roleIds, deptPath);

    if (resourceType) {
      return allRules.filter((r) => r.resourceType === resourceType);
    }

    return allRules;
  }

  async createShareRule(
    rule: Omit<ShareRule, 'id' | 'createdAt'>
  ): Promise<ShareRule> {
    return this.shareRepo.create(rule);
  }

  async deleteShareRule(id: string): Promise<boolean> {
    return this.shareRepo.delete(id);
  }

  private async matchesShareRule(rule: ShareRule, userId: string): Promise<boolean> {
    switch (rule.scope) {
      case 'all':
        return true;
      case 'user':
        return rule.targetId === userId;
      case 'role':
        const roles = await getUserRoles(userId);
        return roles.some((r) => r.id === rule.targetId);
      case 'department':
        const user = await getUserById(userId);
        if (!user?.departmentId) return false;
        const dept = await getDepartmentById(user.departmentId);
        return dept?.path.includes(rule.targetId ?? '') ?? false;
      case 'none':
        return false;
      default:
        return false;
    }
  }

  private permissionSatisfies(
    hasPermission: SharePermission,
    requiresPermission: SharePermission
  ): boolean {
    const permissionLevel: Record<SharePermission, number> = {
      'read': 1,
      'execute': 2,
      'write': 3,
    };
    return permissionLevel[hasPermission] >= permissionLevel[requiresPermission];
  }
}
