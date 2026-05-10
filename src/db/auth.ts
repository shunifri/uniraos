/**
 * Session token 认证
 * 简单高效：随机 token 存数据库，无需 JWT 依赖
 * 支持 SQLite 和 MySQL
 */
import { randomBytes } from "crypto";
import { getDb, isMySQL } from "./database.js";
import { getUserById, type User } from "./user-repository.js";
import { log } from "../utils/logger.js";

const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 天

// MySQL 适配器延迟加载
let mysqlAdapter: any = null;

async function getMySQLAdapter() {
  if (!mysqlAdapter) {
    const { getMySQLAdapter: getAdapter } = await import('./mysql-adapter.js');
    mysqlAdapter = getAdapter();
  }
  return mysqlAdapter;
}

/** 创建 session token */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      [token, userId, expiresAt * 1000, Date.now()]
    );
  } else {
    getDb().prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
    ).run(token, userId, expiresAt);
  }

  log("info", "auth.session_created", { userId });
  return { token, expiresAt };
}

/** 验证 token，返回用户（null 表示无效/过期） */
export async function validateSession(token: string): Promise<User | null> {
  if (!token) return null;

  let userId: string | null = null;

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const now = Date.now();
    const rows: any[] = await adapter.query(
      `SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?`,
      [token, now]
    );
    if (rows.length === 0) return null;
    userId = rows[0].user_id;
  } else {
    const row = getDb().prepare(`
      SELECT user_id FROM sessions
      WHERE token = ? AND expires_at > unixepoch()
    `).get(token) as { user_id: string } | undefined;
    if (!row) return null;
    userId = row.user_id;
  }

  return userId ? getUserById(userId) : null;
}

/** 销毁 session（登出） */
export async function destroySession(token: string): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(`DELETE FROM sessions WHERE token = ?`, [token]);
  } else {
    getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}

/** 销毁用户的所有 session */
export async function destroyUserSessions(userId: string): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  } else {
    getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  log("info", "auth.sessions_destroyed", { userId });
}

/** 清理过期 session（定时调用） */
export async function cleanExpiredSessions(): Promise<number> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const now = Date.now();
    const result = await adapter.execute(`DELETE FROM sessions WHERE expires_at <= ?`, [now]);
    return result.affectedRows;
  } else {
    const result = getDb().prepare("DELETE FROM sessions WHERE expires_at <= unixepoch()").run();
    return result.changes;
  }
}
