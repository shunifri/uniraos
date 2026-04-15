/**
 * 自定义 Skill 持久化仓库
 * 支持 SQLite 和 MySQL 双模式
 * 负责保存和加载用户创建的自定义 Skill
 */
import { randomUUID } from "crypto";
import { getDb, isMySQL } from "./database.js";
import type { SkillDefinition } from "../types/index.js";
import { defineSkill, defineSystemSkill } from "../types/index.js";

export interface CustomSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  definition: string;
  ownerId: string;
  isSystem: boolean;
  createdAt: number;
  updatedAt: number;
}

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('./mysql-adapter.js');
  return getAdapter();
}

export class CustomSkillRepository {
  constructor(private sqliteDb?: any) {}

  /** 创建自定义 Skill 记录 */
  async create(
    skill: SkillDefinition,
    ownerId: string
  ): Promise<CustomSkill> {
    const id = `custom_${randomUUID().slice(0, 12)}`;
    const now = Date.now();

    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `INSERT INTO custom_skills (
          id, name, description, version, definition, owner_id, is_system, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          skill.name,
          skill.description || "",
          skill.version || "1.0.0",
          JSON.stringify(skill),
          ownerId,
          skill.isSystem ? 1 : 0,
          now,
          now,
        ]
      );
    } else {
      if (!this.sqliteDb) throw new Error("SQLite database not provided");
      this.sqliteDb.prepare(`
        INSERT INTO custom_skills (
          id, name, description, version, definition, owner_id, is_system, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        skill.name,
        skill.description || "",
        skill.version || "1.0.0",
        JSON.stringify(skill),
        ownerId,
        skill.isSystem ? 1 : 0,
        now,
        now
      );
    }

    return {
      id,
      name: skill.name,
      description: skill.description || "",
      version: skill.version || "1.0.0",
      definition: JSON.stringify(skill),
      ownerId,
      isSystem: !!skill.isSystem,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 按名称查找自定义 Skill */
  async findByName(name: string): Promise<CustomSkill | null> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query(
        "SELECT * FROM custom_skills WHERE name = ?",
        [name]
      );
      return rows.length > 0 ? this.mapRow(rows[0]) : null;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const row = this.sqliteDb.prepare(
      "SELECT * FROM custom_skills WHERE name = ?"
    ).get(name);
    return row ? this.mapRow(row) : null;
  }

  /** 获取用户的所有自定义 Skill */
  async findByOwner(ownerId: string): Promise<CustomSkill[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query(
        "SELECT * FROM custom_skills WHERE owner_id = ?",
        [ownerId]
      );
      return rows.map(this.mapRow);
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const rows = this.sqliteDb.prepare(
      "SELECT * FROM custom_skills WHERE owner_id = ?"
    ).all(ownerId);
    return rows.map(this.mapRow);
  }

  /** 获取所有自定义 Skill */
  async findAll(): Promise<CustomSkill[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM custom_skills");
      return rows.map(this.mapRow);
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const rows = this.sqliteDb.prepare("SELECT * FROM custom_skills").all();
    return rows.map(this.mapRow);
  }

  /** 删除自定义 Skill */
  async delete(id: string): Promise<boolean> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const result = await adapter.execute(
        "DELETE FROM custom_skills WHERE id = ?",
        [id]
      );
      return result.affectedRows > 0;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const result = this.sqliteDb.prepare(
      "DELETE FROM custom_skills WHERE id = ?"
    ).run(id);
    return result.changes > 0;
  }

  /** 删除用户的所有自定义 Skill */
  async deleteByOwner(ownerId: string): Promise<number> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const result = await adapter.execute(
        "DELETE FROM custom_skills WHERE owner_id = ?",
        [ownerId]
      );
      return result.affectedRows;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const result = this.sqliteDb.prepare(
      "DELETE FROM custom_skills WHERE owner_id = ?"
    ).run(ownerId);
    return result.changes;
  }

  /** 从自定义 Skill 记录中重建 SkillDefinition */
  async reconstructSkill(customSkill: CustomSkill): Promise<SkillDefinition> {
    const definition = JSON.parse(customSkill.definition);

    // 根据类型选择合适的构建方法
    const builder = definition.isSystem ? defineSystemSkill : defineSkill;

    return builder({
      name: customSkill.name,
      description: customSkill.description,
      version: customSkill.version,
      owner: customSkill.ownerId,
      isSystem: customSkill.isSystem,
      handler: async (params, context) => {
        // 重建时需要重新构建 handler
        // 对于组合 Skill，可能需要重新创建 handler 函数
        // 这里我们假设 definition 包含可执行的 handler
        // 如果是简单 Skill，可以从 definition 中直接获取
        if (definition.handler) {
          // 对于序列化的函数，这里需要特殊处理
          // 简单的方法是重新执行构建过程
          // 复杂的情况需要使用沙箱或函数重建技术
          throw new Error(`Skill handler reconstruction not supported`);
        }

        throw new Error(`Skill ${customSkill.name} requires handler reconstruction`);
      },
      ...definition,
    });
  }

  /** 从数据库加载并注册所有自定义 Skill */
  async loadAllSkills(): Promise<CustomSkill[]> {
    const allSkills = await this.findAll();
    const result: CustomSkill[] = [];

    for (const customSkill of allSkills) {
      try {
        const skill = await this.reconstructSkill(customSkill);
        result.push(customSkill);
      } catch (error) {
        console.warn(`Failed to load custom skill ${customSkill.name}:`, error);
      }
    }

    return result;
  }

  private mapRow(row: any): CustomSkill {
    return {
      id: row.id,
      name: row.name,
      description: row.description || "",
      version: row.version || "1.0.0",
      definition: row.definition,
      ownerId: row.owner_id,
      isSystem: !!row.is_system,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function getCustomSkillRepository(): CustomSkillRepository {
  return new CustomSkillRepository(isMySQL() ? undefined : getDb());
}
