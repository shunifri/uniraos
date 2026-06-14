import type { SkillDefinition } from "../types/index.js";
import {
  DuplicateSkillError,
  SkillNotFoundError,
  DependencyInUseError,
} from "../utils/errors.js";
import { validateDAG } from "./dag-validator.js";

/** Skill 变更事件 */
export interface SkillRegistryEvent {
  type: "registered" | "unregistered" | "version_switched";
  skillName: string;
  skill?: SkillDefinition;
}

type EventListener = (event: SkillRegistryEvent) => void;

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  /** 多版本存储: name → version → SkillDefinition */
  private versions = new Map<string, Map<string, SkillDefinition>>();
  private listeners: Set<EventListener> = new Set();

  /** 订阅 Skill 变更事件 */
  onChange(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 触发事件 */
  private emit(event: SkillRegistryEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    });
  }

  /** 注册 Skill，自动验证依赖图 */
  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.name)) {
      throw new DuplicateSkillError(skill.name);
    }

    // 先加入再验证，失败则回滚
    this.skills.set(skill.name, skill);
    try {
      validateDAG(this.skills);
    } catch (err) {
      this.skills.delete(skill.name);
      throw err;
    }

    // 记录版本
    if (!this.versions.has(skill.name)) {
      this.versions.set(skill.name, new Map());
    }
    this.versions.get(skill.name)!.set(skill.version, skill);

    // 触发事件
    this.emit({ type: "registered", skillName: skill.name, skill });
  }

  /** 注册同名 Skill 的新版本（旧版本保留但不再活跃） */
  registerVersion(skill: SkillDefinition): void {
    const existing = this.skills.get(skill.name);
    if (existing && existing.version === skill.version) {
      throw new DuplicateSkillError(`${skill.name}@${skill.version}`);
    }

    // 替换活跃版本
    this.skills.set(skill.name, skill);
    try {
      validateDAG(this.skills);
    } catch (err) {
      // 回滚
      if (existing) {
        this.skills.set(skill.name, existing);
      } else {
        this.skills.delete(skill.name);
      }
      throw err;
    }

    if (!this.versions.has(skill.name)) {
      this.versions.set(skill.name, new Map());
    }
    this.versions.get(skill.name)!.set(skill.version, skill);
  }

  /** 切换到指定版本 */
  switchVersion(name: string, version: string): void {
    const versionMap = this.versions.get(name);
    if (!versionMap) throw new SkillNotFoundError(name);
    const skill = versionMap.get(version);
    if (!skill) throw new SkillNotFoundError(`${name}@${version}`);
    this.skills.set(name, skill);

    // 触发事件
    this.emit({ type: "version_switched", skillName: name, skill });
  }

  /** 获取某个 Skill 的所有版本 */
  getVersions(name: string): string[] {
    const versionMap = this.versions.get(name);
    return versionMap ? [...versionMap.keys()] : [];
  }

  /** 注销 Skill，检查是否被其他 Skill 依赖 */
  unregister(name: string): void {
    if (!this.skills.has(name)) {
      throw new SkillNotFoundError(name);
    }

    const dependents = this.getDependents(name);
    if (dependents.length > 0) {
      throw new DependencyInUseError(name, dependents);
    }

    this.skills.delete(name);
    this.versions.delete(name);

    // 触发事件
    this.emit({ type: "unregistered", skillName: name });
  }

  /** 查找 Skill */
  lookup(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /** 获取 Skill（不存在则抛异常） */
  get(name: string): SkillDefinition {
    const skill = this.skills.get(name);
    if (!skill) throw new SkillNotFoundError(name);
    return skill;
  }

  /** 列出所有 Skill */
  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  /** 列出对模型可见的 Skill */
  listVisible(): SkillDefinition[] {
    return this.list().filter((s) => s.visible);
  }

  /** 列出特定用户可用的 Skill（系统 + 自己的 + 共享给自己的） */
  listForUser(userId: string, sharedSkillNames?: string[]): SkillDefinition[] {
    return this.list().filter(s =>
      s.isSystem !== false || // 系统 Skill
      !s.owner || // 无 owner（系统 Skill）
      s.owner === userId || // 自己的
      (sharedSkillNames && sharedSkillNames.includes(s.name)) // 共享的
    );
  }

  /** 列出特定用户可见的 Skill（用于 Tool Bridge） */
  listVisibleForUser(userId: string, sharedSkillNames?: string[]): SkillDefinition[] {
    return this.listForUser(userId, sharedSkillNames).filter(s => s.visible);
  }

  /** 按权限列表过滤 Skill（用于 role-based skill 装载） */
  listByPermissions(permissions: string[]): SkillDefinition[] {
    const permSet = new Set(permissions);
    // 检查是否有通配符权限
    const hasWildcard = permSet.has("skill:*.execute") || permSet.has("skill:*.read");
    if (hasWildcard) return this.list();
    return this.list().filter(s => permSet.has(`skill:${s.name}.execute`));
  }

  /** 按权限列表过滤可见 Skill */
  listVisibleByPermissions(permissions: string[]): SkillDefinition[] {
    return this.listByPermissions(permissions).filter(s => s.visible);
  }

  /** 获取 Skill 数量 */
  get size(): number {
    return this.skills.size;
  }

  /** 获取拓扑排序 */
  getTopologicalOrder(): string[] {
    return validateDAG(this.skills);
  }

  /** 查找依赖某个 Skill 的所有 Skill */
  private getDependents(name: string): string[] {
    const dependents: string[] = [];
    for (const [skillName, skill] of this.skills) {
      if (skill.dependencies.includes(name)) {
        dependents.push(skillName);
      }
    }
    return dependents;
  }
}
