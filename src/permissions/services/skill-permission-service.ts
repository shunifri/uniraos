import type { SkillRegistry } from '../../registry/index.js';
import type { SkillDefinition } from '../../types/index.js';
import { getUserPermissions, getUserRoles, getUserById } from '../../db/user-repository.js';
import { getDepartmentById } from '../../db/department-repository.js';
import { ShareRepository } from '../../db/share-repository.js';
import { getDb, isMySQL } from '../../db/database.js';
import { skillPermission } from '../constants.js';

/** 变更事件类型 */
export interface SkillAccessChangeEvent {
  type: "added" | "removed" | "updated";
  skillName: string;
  source: "own" | "role" | "shared";
  userId: string;
}

type ChangeListener = (event: SkillAccessChangeEvent) => void;

export interface SkillAccessResult {
  skills: SkillDefinition[];
  sourceMap: Map<string, 'own' | 'role' | 'shared'>;
  permissions: string[];
  isAdmin: boolean;
}

export class SkillPermissionService {
  private registry: SkillRegistry;
  private shareRepo: ShareRepository;
  private listeners: Map<string, Set<ChangeListener>> = new Map();
  private cachedResults: Map<string, SkillAccessResult> = new Map();

  constructor(registry: SkillRegistry) {
    this.registry = registry;
    this.shareRepo = new ShareRepository(isMySQL() ? undefined : getDb());

    this.registry.onChange(() => {
      this.invalidateAll();
    });
  }

  subscribe(userId: string, listener: ChangeListener): () => void {
    if (!this.listeners.has(userId)) {
      this.listeners.set(userId, new Set());
    }
    this.listeners.get(userId)!.add(listener);

    return () => {
      this.listeners.get(userId)?.delete(listener);
    };
  }

  notifyChange(userId: string, event: SkillAccessChangeEvent): void {
    this.cachedResults.delete(userId);

    this.listeners.get(userId)?.forEach((listener) => {
      try {
        listener(event);
      } catch {
      }
    });
  }

  invalidate(userId: string): void {
    this.cachedResults.delete(userId);
  }

  invalidateAll(): void {
    this.cachedResults.clear();
  }

  async refresh(userId: string): Promise<SkillAccessResult> {
    this.invalidate(userId);
    return await this.getAccessibleSkills(userId, undefined, false);
  }

  async canAccess(userId: string, skillName: string): Promise<boolean> {
    const permissions = await getUserPermissions(userId);
    const isAdmin = this.isAdmin(permissions);

    if (isAdmin) return true;

    if (permissions.includes(skillPermission(skillName))) return true;

    const sharedNames = await this.getSharedSkillNames(userId);
    if (sharedNames.includes(skillName)) return true;

    const skill = this.registry.lookup(skillName);
    if (skill?.owner === userId) return true;

    return false;
  }

  async getSkillSource(
    userId: string,
    skillName: string
  ): Promise<"own" | "role" | "shared" | null> {
    const skill = this.registry.lookup(skillName);
    if (!skill) return null;

    if (skill.owner === userId) return "own";

    const permissions = await getUserPermissions(userId);
    if (permissions.includes(skillPermission(skillName))) return "role";

    const sharedNames = await this.getSharedSkillNames(userId);
    if (sharedNames.includes(skillName)) return "shared";

    return null;
  }

  async getAccessibleSkills(
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    },
    useCache = true
  ): Promise<SkillAccessResult> {
    const cacheKey = `${userId}:${options?.visibleOnly ?? true}:${options?.allowedSkills?.join(',') ?? 'all'}`;

    if (useCache && this.cachedResults.has(cacheKey)) {
      return this.cachedResults.get(cacheKey)!;
    }

    const sourceMap = new Map<string, 'own' | 'role' | 'shared'>();
    const permissions = await getUserPermissions(userId);
    const isAdmin = this.isAdmin(permissions);

    if (isAdmin) {
      const skills = this.getAllSkills(options?.visibleOnly);
      skills.forEach((s) => sourceMap.set(s.name, 'role'));
      const result = { skills, sourceMap, permissions, isAdmin };
      this.cachedResults.set(cacheKey, result);
      return result;
    }

    const accessibleNames = new Set<string>();

    const roleSkillNames = permissions
      .filter((p) => p.startsWith('skill:') && p.endsWith('.execute'))
      .map((p) => p.slice(6, -8));

    roleSkillNames.forEach((name) => {
      accessibleNames.add(name);
      sourceMap.set(name, 'role');
    });

    const sharedSkillNames = await this.getSharedSkillNames(userId);
    sharedSkillNames.forEach((name) => {
      if (!accessibleNames.has(name)) {
        accessibleNames.add(name);
        sourceMap.set(name, 'shared');
      }
    });

    const ownSkillNames = this.getOwnSkillNames(userId);
    ownSkillNames.forEach((name) => {
      if (!accessibleNames.has(name)) {
        accessibleNames.add(name);
        sourceMap.set(name, 'own');
      }
    });

    let skills = this.registry
      .list()
      .filter((s) => accessibleNames.has(s.name));

    if (options?.visibleOnly) {
      skills = skills.filter((s) => s.visible);
    }

    if (options?.allowedSkills && options.allowedSkills.length > 0) {
      skills = skills.filter((s) => options.allowedSkills!.includes(s.name));
    }

    const result = { skills, sourceMap, permissions, isAdmin };
    this.cachedResults.set(cacheKey, result);
    return result;
  }

  private isAdmin(permissions: string[]): boolean {
    return permissions.some((p) => p === 'users.manage' || p === 'roles.manage');
  }

  private getAllSkills(visibleOnly?: boolean): SkillDefinition[] {
    const skills = this.registry.list();
    if (visibleOnly) {
      return skills.filter((s) => s.visible);
    }
    return skills;
  }

  private async getSharedSkillNames(userId: string): Promise<string[]> {
    try {
      const roles = await getUserRoles(userId);
      const roleIds = roles.map((r) => r.id);

      const user = await getUserById(userId);
      let deptPath = '/';
      if (user?.departmentId) {
        const dept = await getDepartmentById(user.departmentId);
        if (dept) deptPath = dept.path;
      }

      return this.shareRepo.getSharedResourceIds('skill', userId, roleIds, deptPath);
    } catch {
      return [];
    }
  }

  private getOwnSkillNames(userId: string): string[] {
    return this.registry
      .list()
      .filter((s) => s.owner === userId)
      .map((s) => s.name);
  }
}
