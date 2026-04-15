import type { SkillRegistry } from '../../registry/index.js';
import type { SkillDefinition } from '../../types/index.js';
import {
  userHasPermission,
  getUserPermissions,
  getUserRoles,
} from '../../db/user-repository.js';
import {
  API_PERMISSIONS,
  MENU_PERMISSIONS,
  skillPermission,
  isAdminPermission,
} from '../constants.js';
import {
  PermissionError,
  AuthenticationRequiredError,
  AccessDeniedError,
  SkillAccessDeniedError,
} from '../errors/permission-errors.js';
import { SkillPermissionService } from './skill-permission-service.js';
import { DataIsolationService } from './data-isolation-service.js';
import { ShareService } from './share-service.js';

export class PermissionService {
  readonly skills: SkillPermissionService;
  readonly dataIsolation: DataIsolationService;
  readonly share: ShareService;

  constructor(registry: SkillRegistry) {
    this.skills = new SkillPermissionService(registry);
    this.dataIsolation = new DataIsolationService();
    this.share = new ShareService();
  }

  async hasPermission(
    userId: string,
    permissionName: string
  ): Promise<boolean> {
    return userHasPermission(userId, permissionName);
  }

  async checkPermission(
    userId: string,
    permissionName: string
  ): Promise<void> {
    if (!userId) {
      throw new AuthenticationRequiredError();
    }

    const hasPerm = await this.hasPermission(userId, permissionName);
    if (!hasPerm) {
      throw new AccessDeniedError(permissionName, userId);
    }
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    return getUserPermissions(userId);
  }

  async isAdmin(userId: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.some((p) => p === 'users.manage' || p === 'roles.manage');
  }

  async getUserRoles(userId: string): Promise<Array<{ id: string; name: string; description: string }>> {
    return getUserRoles(userId);
  }

  async hasSkillPermission(
    userId: string,
    skillName: string
  ): Promise<boolean> {
    return this.skills.canAccess(userId, skillName);
  }

  async checkSkillPermission(
    userId: string,
    skillName: string
  ): Promise<void> {
    if (!userId) {
      throw new AuthenticationRequiredError();
    }

    const hasAccess = await this.hasSkillPermission(userId, skillName);
    if (!hasAccess) {
      throw new SkillAccessDeniedError(skillName, userId);
    }
  }

  async getAccessibleSkills(
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    }
  ): Promise<{
    skills: SkillDefinition[];
    sourceMap: Map<string, 'own' | 'role' | 'shared'>;
    permissions: string[];
    isAdmin: boolean;
  }> {
    return this.skills.getAccessibleSkills(userId, options);
  }

  async getAccessibleSkillsList(
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    }
  ): Promise<SkillDefinition[]> {
    const result = await this.skills.getAccessibleSkills(userId, options);
    return result.skills;
  }

  invalidateSkillCache(userId?: string): void {
    if (userId) {
      this.skills.invalidate(userId);
    } else {
      this.skills.invalidateAll();
    }
  }
}
