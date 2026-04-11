/**
 * Skill 市场（Marketplace）
 *
 * 提供 Skill 的导出、导入和共享能力。
 * 支持将 Skill 打包为标准化格式，可在不同 RAOS 实例间迁移。
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillDefinition } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { runInSandbox } from "../engine/worker-sandbox.js";
import Database from "better-sqlite3";
import { join } from "path";

/** Skill 包格式（用于序列化传输） */
export interface SkillPackage {
  /** 包格式版本 */
  formatVersion: "1.0";
  /** Skill 元信息 */
  name: string;
  version: string;
  description: string;
  /** 作者/来源 */
  author?: string;
  source?: string;
  /** 能力声明 */
  capabilities: string[];
  /** 依赖的其他 Skill */
  dependencies: string[];
  /** Handler 代码（序列化的函数体） */
  handlerCode: string;
  /** 补偿代码 */
  compensateCode?: string;
  /** 配置 */
  visible: boolean;
  timeout: number;
  retry: { maxRetries: number; backoffMs: number; backoffMultiplier: number };
  /** 导出时间 */
  exportedAt: number;
  /** 签名/校验 */
  checksum?: string;
}

export class SkillMarketplace {
  private registry: SkillRegistry;
  private catalog: SkillPackage[] = [];
  private db: Database.Database | null = null;

  constructor(registry: SkillRegistry, dbPath?: string) {
    this.registry = registry;
    // 初始化 SQLite 持久化
    const resolved = dbPath ?? join(process.cwd(), ".raos", "marketplace.db");
    try {
      const { mkdirSync } = require("fs");
      const { dirname } = require("path");
      mkdirSync(dirname(resolved), { recursive: true });
      this.db = new Database(resolved);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS skill_packages (
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          data TEXT NOT NULL,
          published_at INTEGER NOT NULL,
          PRIMARY KEY (name, version)
        )
      `);
      // 加载已有目录
      const rows = this.db.prepare("SELECT data FROM skill_packages").all() as { data: string }[];
      for (const row of rows) {
        try {
          this.catalog.push(JSON.parse(row.data));
        } catch { /* 跳过损坏的记录 */ }
      }
    } catch {
      // SQLite 不可用时退化为纯内存模式
      this.db = null;
    }
  }

  /** 将已注册的 Skill 导出为标准包 */
  exportSkill(name: string, opts?: { author?: string; source?: string }): SkillPackage | null {
    const skill = this.registry.lookup(name);
    if (!skill) return null;

    // 序列化 handler 代码字符串（导入后通过 Worker 沙箱重新执行，无需 new Function）
    const handlerCode = skill.handler.toString();

    const pkg: SkillPackage = {
      formatVersion: "1.0",
      name: skill.name,
      version: skill.version,
      description: skill.description ?? "",
      author: opts?.author,
      source: opts?.source,
      capabilities: skill.capabilities ?? [],
      dependencies: skill.dependencies,
      handlerCode,
      compensateCode: skill.compensate?.toString(),
      visible: skill.visible,
      timeout: skill.timeout,
      retry: {
        maxRetries: skill.retry.maxRetries,
        backoffMs: skill.retry.backoffMs,
        backoffMultiplier: skill.retry.backoffMultiplier,
      },
      exportedAt: Date.now(),
    };

    // 简单校验和
    pkg.checksum = simpleChecksum(JSON.stringify({ name: pkg.name, code: pkg.handlerCode }));

    return pkg;
  }

  /** 从标准包导入 Skill */
  importSkill(pkg: SkillPackage): { success: boolean; error?: string } {
    if (pkg.formatVersion !== "1.0") {
      return { success: false, error: `不支持的包格式版本: ${pkg.formatVersion}` };
    }

    if (this.registry.lookup(pkg.name)) {
      return { success: false, error: `Skill 已存在: ${pkg.name}` };
    }

    // 安全检查
    const forbidden = ["require(", "import ", "process.", "child_process", "eval("];
    for (const f of forbidden) {
      if (pkg.handlerCode.includes(f)) {
        return { success: false, error: `Handler 包含禁止的操作: ${f}` };
      }
    }

    try {
      // 从函数代码恢复 handler — 通过 Worker 沙箱执行，避免 new Function() 安全风险
      const handlerCode = pkg.handlerCode;
      const handler: SkillDefinition["handler"] = async (params) => {
        try {
          const sandboxResult = await runInSandbox(handlerCode, params as Record<string, unknown>);
          if (!sandboxResult.success) {
            return { success: false, error: new Error(sandboxResult.error ?? "Sandbox execution failed") };
          }
          const result = sandboxResult.data as { success: boolean; data?: unknown; error?: unknown };
          if (typeof result !== "object" || result === null) {
            return { success: false, error: new Error("Skill 返回无效结果") };
          }
          return {
            success: result.success,
            data: result.data,
            error: result.error instanceof Error ? result.error : result.error ? new Error(String(result.error)) : undefined,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      };

      const skill = defineSystemSkill({
        name: pkg.name,
        version: pkg.version,
        description: `[导入] ${pkg.description}`,
        visible: pkg.visible,
        timeout: pkg.timeout,
        retry: pkg.retry,
        capabilities: pkg.capabilities,
        dependencies: [], // 导入时不恢复依赖（避免依赖缺失）
        handler,
      });

      this.registry.register(skill);
      return { success: true };
    } catch (err) {
      return { success: false, error: `导入失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** 发布到本地市场目录（内存 + SQLite 持久化） */
  publish(pkg: SkillPackage): void {
    const existing = this.catalog.findIndex((p) => p.name === pkg.name && p.version === pkg.version);
    if (existing >= 0) {
      this.catalog[existing] = pkg;
    } else {
      this.catalog.push(pkg);
    }

    // 持久化到 SQLite
    if (this.db) {
      try {
        this.db.prepare(
          `INSERT OR REPLACE INTO skill_packages (name, version, data, published_at) VALUES (?, ?, ?, ?)`,
        ).run(pkg.name, pkg.version, JSON.stringify(pkg), Date.now());
      } catch { /* 持久化失败不影响内存操作 */ }
    }
  }

  /** 从市场中移除 Skill 包 */
  unpublish(name: string, version?: string): boolean {
    const before = this.catalog.length;
    this.catalog = version
      ? this.catalog.filter((p) => !(p.name === name && p.version === version))
      : this.catalog.filter((p) => p.name !== name);

    if (this.db) {
      try {
        if (version) {
          this.db.prepare("DELETE FROM skill_packages WHERE name = ? AND version = ?").run(name, version);
        } else {
          this.db.prepare("DELETE FROM skill_packages WHERE name = ?").run(name);
        }
      } catch { /* ignore */ }
    }

    return this.catalog.length < before;
  }

  /** 搜索市场 */
  search(query?: string): SkillPackage[] {
    if (!query) return [...this.catalog];
    const q = query.toLowerCase();
    return this.catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.capabilities.some((c) => c.toLowerCase().includes(q)),
    );
  }

  /** 获取市场统计 */
  stats(): { total: number; byCapability: Record<string, number> } {
    const byCapability: Record<string, number> = {};
    for (const pkg of this.catalog) {
      for (const cap of pkg.capabilities) {
        byCapability[cap] = (byCapability[cap] ?? 0) + 1;
      }
    }
    return { total: this.catalog.length, byCapability };
  }
}

function simpleChecksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}
