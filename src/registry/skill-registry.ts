import type { SkillDefinition } from "../types/index.js";
import {
  DuplicateSkillError,
  SkillNotFoundError,
  DependencyInUseError,
} from "../utils/errors.js";
import { validateDAG } from "./dag-validator.js";

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  /** 多版本存储: name → version → SkillDefinition */
  private versions = new Map<string, Map<string, SkillDefinition>>();

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
