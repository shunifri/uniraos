/**
 * Pending Confirm Repository — 持久化用户确认队列
 * 支持 SQLite 和 MySQL 双模式
 * 用于 user_confirm 的跨会话/跨重启恢复
 */
import type Database from "better-sqlite3";
import { getDb, isMySQL } from "./database.js";

export interface PendingConfirm {
  confirmId: string;
  conversationId: string;
  userId: string;
  confirmData: Record<string, unknown>;
  responseData?: Record<string, unknown>;
  status: "pending" | "resolved" | "expired";
  createdAt: number;
  resolvedAt?: number;
  expiresAt?: number;
}

interface PendingConfirmRow {
  confirm_id: string;
  conversation_id: string;
  user_id: string;
  confirm_data: string;
  response_data: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
  expires_at: number | null;
}

function rowToPendingConfirm(row: PendingConfirmRow): PendingConfirm {
  return {
    confirmId: row.confirm_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    confirmData: typeof row.confirm_data === "string" ? JSON.parse(row.confirm_data) : row.confirm_data,
    responseData: row.response_data ? (typeof row.response_data === "string" ? JSON.parse(row.response_data) : row.response_data) : undefined,
    status: row.status as PendingConfirm["status"],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import("./mysql-adapter.js");
  return getAdapter();
}

export class PendingConfirmRepository {
  constructor(private sqliteDb?: Database.Database) {}

  static getInstance(): PendingConfirmRepository {
    return new PendingConfirmRepository(isMySQL() ? undefined : getDb());
  }

  /** 创建 pending confirm（默认 7 天后过期） */
  async create(confirm: Omit<PendingConfirm, "createdAt">): Promise<void> {
    const { confirmId, conversationId, userId, confirmData, status, expiresAt } = confirm;
    const createdAt = Date.now();
    const finalExpiresAt = expiresAt ?? createdAt + 7 * 24 * 60 * 60 * 1000; // 默认 7 天

    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `INSERT INTO pending_confirms (confirm_id, conversation_id, user_id, confirm_data, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [confirmId, conversationId, userId, JSON.stringify(confirmData), status, createdAt, finalExpiresAt]
      );
      return;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    this.sqliteDb.prepare(
      `INSERT INTO pending_confirms (confirm_id, conversation_id, user_id, confirm_data, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(confirmId, conversationId, userId, JSON.stringify(confirmData), status, createdAt, finalExpiresAt);
  }

  /** 查找 */
  async findById(confirmId: string): Promise<PendingConfirm | null> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query<PendingConfirmRow>(
        `SELECT * FROM pending_confirms WHERE confirm_id = ?`,
        [confirmId]
      );
      return rows[0] ? rowToPendingConfirm(rows[0]) : null;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const row = this.sqliteDb.prepare(`SELECT * FROM pending_confirms WHERE confirm_id = ?`).get(confirmId) as PendingConfirmRow | undefined;
    return row ? rowToPendingConfirm(row) : null;
  }

  /** 标记为已解决 */
  async resolve(confirmId: string, responseData?: Record<string, unknown>): Promise<boolean> {
    const resolvedAt = Date.now();

    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const result = await adapter.execute(
        `UPDATE pending_confirms SET status = 'resolved', response_data = ?, resolved_at = ? WHERE confirm_id = ? AND status = 'pending'`,
        [responseData ? JSON.stringify(responseData) : null, resolvedAt, confirmId]
      );
      return result.affectedRows > 0;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const result = this.sqliteDb.prepare(
      `UPDATE pending_confirms SET status = 'resolved', response_data = ?, resolved_at = ? WHERE confirm_id = ? AND status = 'pending'`
    ).run(responseData ? JSON.stringify(responseData) : null, resolvedAt, confirmId);
    return result.changes > 0;
  }

  /** 列出所有 pending */
  async listPending(): Promise<PendingConfirm[]> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query<PendingConfirmRow>(
        `SELECT * FROM pending_confirms WHERE status = 'pending' ORDER BY created_at DESC`
      );
      return rows.map(rowToPendingConfirm);
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const rows = this.sqliteDb.prepare(`SELECT * FROM pending_confirms WHERE status = 'pending' ORDER BY created_at DESC`).all() as PendingConfirmRow[];
    return rows.map(rowToPendingConfirm);
  }

  /** 删除 */
  async delete(confirmId: string): Promise<boolean> {
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const result = await adapter.execute(`DELETE FROM pending_confirms WHERE confirm_id = ?`, [confirmId]);
      return result.affectedRows > 0;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const result = this.sqliteDb.prepare(`DELETE FROM pending_confirms WHERE confirm_id = ?`).run(confirmId);
    return result.changes > 0;
  }

  /** 清理过期和已解决的记录（resolved 保留 30 天，expired 立即删除） */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const resolvedCutoff = now - 30 * 24 * 60 * 60 * 1000; // 30 天前

    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      // 删除已过期超过 30 天的 resolved 记录，以及任何已 expired 的记录
      const result = await adapter.execute(
        `DELETE FROM pending_confirms WHERE (status = 'resolved' AND resolved_at < ?) OR (status = 'expired') OR (expires_at < ? AND status = 'pending')`,
        [resolvedCutoff, now]
      );
      return result.affectedRows ?? 0;
    }

    if (!this.sqliteDb) throw new Error("SQLite database not provided");
    const result = this.sqliteDb.prepare(
      `DELETE FROM pending_confirms WHERE (status = 'resolved' AND resolved_at < ?) OR (status = 'expired') OR (expires_at < ? AND status = 'pending')`
    ).run(resolvedCutoff, now);
    return result.changes ?? 0;
  }
}
