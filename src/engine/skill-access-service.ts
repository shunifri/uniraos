/**
 * Skill 访问权限服务
 *
 * 统一管理 Skill 的可见性控制：
 * 1. 角色权限（RBAC）
 * 2. 分享权限（Share Rules）
 * 3. 所有权（Owner）
 *
 * 特性：
 * - 对话开始时计算可用 Skill 列表
 * - 支持动态刷新（自建 Skill、被分享 Skill 后更新）
 * - 订阅 Skill 变更事件，自动更新
 *
 * @deprecated Use src/permissions/services/permission-service.ts instead
 * This module will be removed in a future version.
 */
import type { SkillDefinition } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { getUserPermissions, getUserRoles, getUserById } from "../db/user-repository.js";
import { getDepartmentById } from "../db/department-repository.js";
import { ShareRepository } from "../db/share-repository.js";
import { getDb } from "../db/database.js";

export interface SkillAccessResult {
  /** 可用的 Skill 列表 */
  skills: SkillDefinition[];
  /** Skill 来源映射（用于前端标记） */
  sourceMap: Map<string, "own" | "role" | "shared">;
  /** 用户权限列表 */
  permissions: string[];
  /** 是否管理员 */
  isAdmin: boolean;
}

/** 变更事件类型 */
export interface SkillAccessChangeEvent {
  type: "added" | "removed" | "updated";
  skillName: string;
  source: "own" | "role" | "shared";
  userId: string;
}

type ChangeListener = (event: SkillAccessChangeEvent) => void;

export class SkillAccessService {
  private registry: SkillRegistry;
  private shareRepo: ShareRepository;
  private listeners: Map<string, Set<ChangeListener>> = new Map();
  private cachedResults: Map<string, SkillAccessResult> = new Map();

  constructor(registry: SkillRegistry) {
    this.registry = registry;
    this.shareRepo = new ShareRepository(getDb());

    // 监听 SkillRegistry 变更，清除相关缓存
    this.registry.onChange((event) => {
      // 当 Skill 注册/注销/版本切换时，清除所有缓存（简化处理）
      // 实际可以优化为只清除相关用户的缓存
      this.invalidateAll();
    });
  }

  /**
   * 订阅指定用户的 Skill 变更事件
   */
  subscribe(userId: string, listener: ChangeListener): () => void {
    if (!this.listeners.has(userId)) {
      this.listeners.set(userId, new Set());
    }
    this.listeners.get(userId)!.add(listener);

    return () => {
      this.listeners.get(userId)?.delete(listener);
    };
  }

  /**
   * 通知指定用户的 Skill 访问权限发生变化
   */
  notifyChange(userId: string, event: SkillAccessChangeEvent): void {
    // 清除该用户的缓存
    this.cachedResults.delete(userId);
    
    // 通知监听器
    this.listeners.get(userId)?.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    });
  }

  /**
   * 清除指定用户的缓存，下次访问时重新计算
   */
  invalidate(userId: string): void {
    this.cachedResults.delete(userId);
  }

  /**
   * 清除所有缓存
   */
  invalidateAll(): void {
    this.cachedResults.clear();
  }

  /**
   * 获取用户可用的 Skill 列表（在对话开始时调用）
   *
   * 支持缓存，如需最新数据请先调用 invalidate(userId)
   *
   * @param userId 用户ID
   * @param options 可选过滤条件
   * @param useCache 是否使用缓存（默认 true）
   * @returns Skill 访问结果
   */
  async getAccessibleSkills(
    userId: string,
    options?: {
      /** 只返回可见的 Skill */
      visibleOnly?: boolean;
      /** 指定允许的 Skill 名称（用于 Profile 限制） */
      allowedSkills?: string[];
    },
    useCache = true
  ): Promise<SkillAccessResult> {
    // 生成缓存键
    const cacheKey = `${userId}:${options?.visibleOnly ?? true}:${options?.allowedSkills?.join(",") ?? "all"}`;

    // 检查缓存
    if (useCache && this.cachedResults.has(cacheKey)) {
      return this.cachedResults.get(cacheKey)!;
    }

    const sourceMap = new Map<string, "own" | "role" | "shared">();

    // 1. 获取用户权限
    const permissions = await getUserPermissions(userId);
    const isAdmin = permissions.some((p) => p === "users.manage" || p === "roles.manage");

    // 管理员返回所有 Skill
    if (isAdmin) {
      const skills = this.getAllSkills(options?.visibleOnly);
      skills.forEach((s) => sourceMap.set(s.name, "role"));
      const result = { skills, sourceMap, permissions, isAdmin };
      this.cachedResults.set(cacheKey, result);
      return result;
    }

    // 2. 收集所有来源的 Skill
    const accessibleNames = new Set<string>();

    // 2.1 角色权限允许的 Skill
    const roleSkillNames = permissions
      .filter((p) => p.startsWith("skill:") && p.endsWith(".execute"))
      .map((p) => p.slice(6, -8)); // "skill:xxx.execute" → "xxx"

    roleSkillNames.forEach((name) => {
      accessibleNames.add(name);
      sourceMap.set(name, "role");
    });

    // 2.2 分享给我的 Skill
    const sharedSkillNames = await this.getSharedSkillNames(userId);
    sharedSkillNames.forEach((name) => {
      if (!accessibleNames.has(name)) {
        accessibleNames.add(name);
        sourceMap.set(name, "shared");
      }
    });

    // 2.3 我自己的 Skill
    const ownSkillNames = this.getOwnSkillNames(userId);
    ownSkillNames.forEach((name) => {
      if (!accessibleNames.has(name)) {
        accessibleNames.add(name);
        sourceMap.set(name, "own");
      }
    });

    // 3. 获取 Skill 定义
    let skills = this.registry
      .list()
      .filter((s) => accessibleNames.has(s.name));

    // 4. 应用额外过滤
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

  /**
   * 刷新用户的 Skill 列表（自建 Skill 或收到分享后调用）
   */
  async refresh(userId: string): Promise<SkillAccessResult> {
    this.invalidate(userId);
    return await this.getAccessibleSkills(userId, undefined, false);
  }

  /**
   * 快速检查单个 Skill 是否可用
   */
  async canAccess(userId: string, skillName: string): Promise<boolean> {
    const permissions = await getUserPermissions(userId);
    const isAdmin = permissions.some((p) => p === "users.manage" || p === "roles.manage");

    if (isAdmin) return true;

    // 检查角色权限
    const hasRolePermission = permissions.includes(`skill:${skillName}.execute`);
    if (hasRolePermission) return true;

    // 检查分享
    const sharedNames = await this.getSharedSkillNames(userId);
    if (sharedNames.includes(skillName)) return true;

    // 检查所有权
    const skill = this.registry.lookup(skillName);
    if (skill?.owner === userId) return true;

    return false;
  }

  /**
   * 获取 Skill 的来源
   */
  async getSkillSource(userId: string, skillName: string): Promise<"own" | "role" | "shared" | null> {
    const skill = this.registry.lookup(skillName);
    if (!skill) return null;

    if (skill.owner === userId) return "own";

    const permissions = await getUserPermissions(userId);
    if (permissions.includes(`skill:${skillName}.execute`)) return "role";

    const sharedNames = await this.getSharedSkillNames(userId);
    if (sharedNames.includes(skillName)) return "shared";

    return null;
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

      // Use user-repository instead of direct DB access for MySQL compatibility
      const user = await getUserById(userId);

      let deptPath = "/";
      if (user?.departmentId) {
        const dept = await getDepartmentById(user.departmentId);
        if (dept) deptPath = dept.path;
      }

      return this.shareRepo.getSharedResourceIds("skill", userId, roleIds, deptPath);
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
