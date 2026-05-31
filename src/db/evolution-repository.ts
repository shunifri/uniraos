/**
 * Evolution Repository — 进化控制器数据持久化
 * 支持 SQLite 和 MySQL 双模式
 * 负责保存和加载 evolution_generations / evolution_violations / evolution_approvals
 */
import { getDb, isMySQL } from "./database.js";
import type Database from "better-sqlite3";

export interface EvolutionGenerationRecord {
  id: string;
  skillName: string;
  generatedBy: string;
  depth: number;
  createdAt: number;
  approved: boolean;
  data?: string;
}

export interface EvolutionViolationRecord {
  id: string;
  constraintId: string;
  description: string;
  blocking: boolean;
  skillName: string;
  detectedAt: number;
}

export interface EvolutionApprovalRecord {
  id: string;
  name: string;
  description: string;
  code: string;
  capabilities: string[];
  generatedBy: string;
  depth: number;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
  statusUpdatedAt?: number;
}

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import("./mysql-adapter.js");
  return getAdapter();
}

export class EvolutionRepository {
  constructor(private sqliteDb?: Database.Database) {}

  static getInstance(): EvolutionRepository {
    return new EvolutionRepository();
  }

  /** 初始化表结构 */
  async initTables(): Promise<void> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS evolution_generations (
          id VARCHAR(36) PRIMARY KEY,
          skill_name VARCHAR(200) NOT NULL,
          generated_by VARCHAR(200) NOT NULL,
          depth INT NOT NULL,
          created_at BIGINT NOT NULL,
          approved TINYINT NOT NULL DEFAULT 0,
          data TEXT,
          INDEX idx_ev_gen_skill (skill_name),
          INDEX idx_ev_gen_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS evolution_violations (
          id VARCHAR(36) PRIMARY KEY,
          constraint_id VARCHAR(200) NOT NULL,
          description TEXT NOT NULL,
          blocking TINYINT NOT NULL DEFAULT 1,
          skill_name VARCHAR(200) NOT NULL,
          detected_at BIGINT NOT NULL,
          INDEX idx_ev_viol_constraint (constraint_id),
          INDEX idx_ev_viol_detected (detected_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS evolution_approvals (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          description TEXT NOT NULL,
          code LONGTEXT,
          capabilities TEXT,
          generated_by VARCHAR(200) NOT NULL,
          depth INT NOT NULL,
          created_at BIGINT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          status_updated_at BIGINT,
          INDEX idx_ev_app_status (status),
          INDEX idx_ev_app_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return;
    }

    const db = this.sqliteDb ?? getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_generations (
        id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        generated_by TEXT NOT NULL,
        depth INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        data TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ev_gen_skill ON evolution_generations(skill_name);
      CREATE INDEX IF NOT EXISTS idx_ev_gen_created ON evolution_generations(created_at);
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_violations (
        id TEXT PRIMARY KEY,
        constraint_id TEXT NOT NULL,
        description TEXT NOT NULL,
        blocking INTEGER NOT NULL DEFAULT 1,
        skill_name TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ev_viol_constraint ON evolution_violations(constraint_id);
      CREATE INDEX IF NOT EXISTS idx_ev_viol_detected ON evolution_violations(detected_at);
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_approvals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        code TEXT,
        capabilities TEXT,
        generated_by TEXT NOT NULL,
        depth INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        status_updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ev_app_status ON evolution_approvals(status);
      CREATE INDEX IF NOT EXISTS idx_ev_app_created ON evolution_approvals(created_at);
    `);
  }

  /** 保存 generation */
  async saveGeneration(record: EvolutionGenerationRecord): Promise<void> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `INSERT INTO evolution_generations (id, skill_name, generated_by, depth, created_at, approved, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.skillName, record.generatedBy, record.depth, record.createdAt, record.approved ? 1 : 0, record.data ?? null]
      );
      return;
    }
    const db = this.sqliteDb ?? getDb();
    db.prepare(
      `INSERT INTO evolution_generations (id, skill_name, generated_by, depth, created_at, approved, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(record.id, record.skillName, record.generatedBy, record.depth, record.createdAt, record.approved ? 1 : 0, record.data ?? null);
  }

  /** 保存 violation */
  async saveViolation(record: EvolutionViolationRecord): Promise<void> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `INSERT INTO evolution_violations (id, constraint_id, description, blocking, skill_name, detected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.id, record.constraintId, record.description, record.blocking ? 1 : 0, record.skillName, record.detectedAt]
      );
      return;
    }
    const db = this.sqliteDb ?? getDb();
    db.prepare(
      `INSERT INTO evolution_violations (id, constraint_id, description, blocking, skill_name, detected_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(record.id, record.constraintId, record.description, record.blocking ? 1 : 0, record.skillName, record.detectedAt);
  }

  /** 保存 approval */
  async saveApproval(record: EvolutionApprovalRecord): Promise<void> {
    const capabilitiesJson = JSON.stringify(record.capabilities);
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `INSERT INTO evolution_approvals (id, name, description, code, capabilities, generated_by, depth, created_at, status, status_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.name, record.description, record.code, capabilitiesJson, record.generatedBy, record.depth, record.createdAt, record.status, record.statusUpdatedAt ?? null]
      );
      return;
    }
    const db = this.sqliteDb ?? getDb();
    db.prepare(
      `INSERT INTO evolution_approvals (id, name, description, code, capabilities, generated_by, depth, created_at, status, status_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(record.id, record.name, record.description, record.code, capabilitiesJson, record.generatedBy, record.depth, record.createdAt, record.status, record.statusUpdatedAt ?? null);
  }

  /** 更新 approval 状态（带 CAS：仅当状态为 pending 时才更新） */
  async updateApprovalStatus(id: string, status: string, statusUpdatedAt: number): Promise<number> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const result = await adapter.execute(
        `UPDATE evolution_approvals SET status = ?, status_updated_at = ? WHERE id = ? AND status = 'pending'`,
        [status, statusUpdatedAt, id]
      );
      return (result as any)?.affectedRows ?? 0;
    }
    const db = this.sqliteDb ?? getDb();
    const result = db.prepare(
      `UPDATE evolution_approvals SET status = ?, status_updated_at = ? WHERE id = ? AND status = 'pending'`
    ).run(status, statusUpdatedAt, id);
    return result.changes;
  }

  /** 加载所有 generations */
  async loadGenerations(): Promise<EvolutionGenerationRecord[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM evolution_generations");
      return (rows as any[]).map((r) => ({
        id: r.id,
        skillName: r.skill_name,
        generatedBy: r.generated_by,
        depth: r.depth,
        createdAt: r.created_at,
        approved: r.approved === 1 || r.approved === true,
        data: r.data,
      }));
    }
    const db = this.sqliteDb ?? getDb();
    const rows = db.prepare("SELECT * FROM evolution_generations").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      skillName: r.skill_name,
      generatedBy: r.generated_by,
      depth: r.depth,
      createdAt: r.created_at,
      approved: r.approved === 1,
      data: r.data,
    }));
  }

  /** 加载所有 violations */
  async loadViolations(): Promise<EvolutionViolationRecord[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM evolution_violations");
      return (rows as any[]).map((r) => ({
        id: r.id,
        constraintId: r.constraint_id,
        description: r.description,
        blocking: r.blocking === 1 || r.blocking === true,
        skillName: r.skill_name,
        detectedAt: r.detected_at,
      }));
    }
    const db = this.sqliteDb ?? getDb();
    const rows = db.prepare("SELECT * FROM evolution_violations").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      constraintId: r.constraint_id,
      description: r.description,
      blocking: r.blocking === 1,
      skillName: r.skill_name,
      detectedAt: r.detected_at,
    }));
  }

  /** 加载 pending approvals */
  async loadPendingApprovals(): Promise<EvolutionApprovalRecord[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM evolution_approvals WHERE status = 'pending'");
      return (rows as any[]).map((r) => this.mapApprovalRow(r));
    }
    const db = this.sqliteDb ?? getDb();
    const rows = db.prepare("SELECT * FROM evolution_approvals WHERE status = 'pending'").all() as any[];
    return rows.map((r) => this.mapApprovalRow(r));
  }

  /** 获取已审批列表 */
  async getApprovedApprovals(): Promise<EvolutionApprovalRecord[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM evolution_approvals WHERE status = 'approved'");
      return (rows as any[]).map((r) => this.mapApprovalRow(r));
    }
    const db = this.sqliteDb ?? getDb();
    const rows = db.prepare("SELECT * FROM evolution_approvals WHERE status = 'approved'").all() as any[];
    return rows.map((r) => this.mapApprovalRow(r));
  }

  /** 按状态获取审批列表 */
  async getApprovalsByStatus(status: string): Promise<EvolutionApprovalRecord[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query("SELECT * FROM evolution_approvals WHERE status = ? ORDER BY created_at DESC", [status]);
      return (rows as any[]).map((r) => this.mapApprovalRow(r));
    }
    const db = this.sqliteDb ?? getDb();
    const rows = db.prepare("SELECT * FROM evolution_approvals WHERE status = ? ORDER BY created_at DESC").all(status) as any[];
    return rows.map((r) => this.mapApprovalRow(r));
  }

  private mapApprovalRow(row: any): EvolutionApprovalRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      code: row.code || "",
      capabilities: row.capabilities ? (typeof row.capabilities === "string" ? JSON.parse(row.capabilities) : row.capabilities) : [],
      generatedBy: row.generated_by,
      depth: row.depth,
      createdAt: row.created_at,
      status: row.status,
      statusUpdatedAt: row.status_updated_at ?? undefined,
    };
  }
}
