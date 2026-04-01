/**
 * Session token 认证
 * 简单高效：随机 token 存 SQLite，无需 JWT 依赖
 */
import { randomBytes } from "crypto";
import { getDb } from "./database.js";
import { getUserById, type User } from "./user-repository.js";

const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 天

/** 创建 session token */
export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;

  getDb().prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, expiresAt);

  return { token, expiresAt };
}

/** 验证 token，返回用户（null 表示无效/过期） */
export function validateSession(token: string): User | null {
  if (!token) return null;

  const row = getDb().prepare(`
    SELECT user_id FROM sessions
    WHERE token = ? AND expires_at > unixepoch()
  `).get(token) as { user_id: string } | undefined;

  if (!row) return null;

  return getUserById(row.user_id);
}

/** 销毁 session（登出） */
export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** 销毁用户的所有 session */
export function destroyUserSessions(userId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** 清理过期 session（定时调用） */
export function cleanExpiredSessions(): number {
  const result = getDb().prepare("DELETE FROM sessions WHERE expires_at <= unixepoch()").run();
  return result.changes;
}
