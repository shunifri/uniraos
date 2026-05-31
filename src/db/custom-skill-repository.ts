/**
 * 自定义 Skill 持久化仓库
 * 支持 SQLite 和 MySQL 双模式
 * 负责保存和加载用户创建的自定义 Skill
 */
import { randomUUID } from "crypto";
import { getDb, isMySQL } from "./database.js";
import type { SkillDefinition } from "../types/index.js";
import { defineSkill, defineSystemSkill } from "../types/index.js";

/** 自定义 Skill 默认可调用的系统 Skill 白名单 */
const DEFAULT_ALLOWED_SKILLS = new Set([
  "form_data_query",
  "db_query",
  "mysql_query",
  "file_provide",
  "file_provide_multi",
  "file_list",
  "calculate",
  "chart_generate",
  "chart_recommend",
  "kb_search",
  "kb_list",
  "kb_stats",
  "kb_formats",
]);

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
    ownerId: string,
    handlerCode?: string
  ): Promise<CustomSkill> {
    const id = `custom_${randomUUID().slice(0, 12)}`;
    const now = Date.now();

    // 将 handler 代码字符串嵌入 definition，以便重建时恢复
    const definitionObj = { ...skill, _handlerCode: handlerCode };
    const definitionJson = JSON.stringify(definitionObj);

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
          definitionJson,
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
        definitionJson,
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

  /** 按 ID 查找自定义 Skill */
  async findById(id: string): Promise<CustomSkill | null> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query(
        "SELECT * FROM custom_skills WHERE id = ?",
        [id]
      );
      return rows.length > 0 ? this.mapRow(rows[0]) : null;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const row = this.sqliteDb.prepare(
      "SELECT * FROM custom_skills WHERE id = ?"
    ).get(id);
    return row ? this.mapRow(row) : null;
  }

  /** 按名称和所有者查找自定义 Skill */
  async findByName(name: string, ownerId?: string): Promise<CustomSkill | null> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      let sql = "SELECT * FROM custom_skills WHERE name = ?";
      const params: unknown[] = [name];
      if (ownerId) { sql += " AND owner_id = ?"; params.push(ownerId); }
      const rows = await adapter.query(sql, params);
      return rows.length > 0 ? this.mapRow(rows[0]) : null;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const sql = ownerId
      ? "SELECT * FROM custom_skills WHERE name = ? AND owner_id = ?"
      : "SELECT * FROM custom_skills WHERE name = ?";
    const params = ownerId ? [name, ownerId] : [name];
    const row = this.sqliteDb.prepare(sql).get(...params);
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

  /** 获取所有自定义 Skill（仅用于系统启动加载） */
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

  /** 删除自定义 Skill（可选按所有者验证） */
  async delete(id: string, ownerId?: string): Promise<boolean> {
    if (ownerId) {
      const existing = await this.findById(id);
      if (!existing || existing.ownerId !== ownerId) return false;
    }
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

  /** 按名称删除自定义 Skill（需要 ownerId 校验） */
  async deleteByName(name: string, ownerId: string): Promise<boolean> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const result = await adapter.execute(
        "DELETE FROM custom_skills WHERE name = ? AND owner_id = ?",
        [name, ownerId]
      );
      return result.affectedRows > 0;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const result = this.sqliteDb.prepare(
      "DELETE FROM custom_skills WHERE name = ? AND owner_id = ?"
    ).run(name, ownerId);
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

    // 安全：通过 Worker 沙箱执行自定义 handler，替代危险的 new Function
    let restoredHandler: import("../types/index.js").SkillHandler;
    if (definition._handlerCode && typeof definition._handlerCode === "string") {
      const handlerCode = definition._handlerCode;
      restoredHandler = async (params, context) => {
        const { runInSandbox } = await import("../engine/worker-sandbox.js");
        const { getGlobalExecutionEngine } = await import("../engine/execution-engine.js");
        const sandboxCtx = {
          callSkill: async (skillName: string, skillParams: Record<string, unknown>) => {
            if (!DEFAULT_ALLOWED_SKILLS.has(skillName)) {
              throw new Error(
                `Skill "${skillName}" 不在自定义 Skill 的白名单中。` +
                `允许的 Skill: ${[...DEFAULT_ALLOWED_SKILLS].join(", ")}`
              );
            }
            const engine = getGlobalExecutionEngine();
            if (!engine) throw new Error("Execution engine not available");
            const result = await engine.execute(skillName, skillParams);
            if (!result.success) {
              throw new Error(result.error?.message || `Skill "${skillName}" 执行失败`);
            }
            return result.data;
          },
          user: context?.user,
        };
        const result = await runInSandbox(
          handlerCode,
          params as Record<string, unknown>,
          { timeout: definition.timeout ?? 30000 },
          sandboxCtx
        );
        if (!result.success) {
          return { success: false, error: new Error(result.error ?? "Sandbox execution failed") };
        }
        // Worker 沙箱已透传 skill handler 的标准返回对象，无需再次包装
        return { success: true, data: result.data };
      };
    } else {
      restoredHandler = async (params: Record<string, unknown>) => {
        return { success: true, data: { echo: params } };
      };
    }

    const base = {
      name: customSkill.name,
      description: customSkill.description,
      version: customSkill.version,
      owner: customSkill.ownerId,
      isSystem: customSkill.isSystem,
      handler: restoredHandler,
    };

    // 用数据库记录覆盖序列化定义中的元数据，但保留恢复的 handler
    const merged = { ...definition, ...base, handler: restoredHandler };

    return builder(merged);
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
    // MySQL JSON 字段可能返回对象，确保 definition 为字符串
    let definition = row.definition;
    if (typeof definition !== "string") {
      definition = JSON.stringify(definition);
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description || "",
      version: row.version || "1.0.0",
      definition,
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
