/**
 * Inbox Repository — SQLite 数据访问层
 *
 * 所有 inbox_items 表的读写操作集中在此
 */

import { getDb } from "../db/database.js";
import { log } from "../utils/logger.js";
import type { InboxItem, InboxQuery, InboxStats, CreateInboxItemInput } from "./inbox-types.js";

function ensureTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('approval', 'notification', 'task', 'alert')),
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
      status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread', 'read', 'pending', 'completed', 'dismissed')),
      payload TEXT,
      ai_suggestion TEXT,
      aggregate_group_id TEXT,
      aggregate_count INTEGER DEFAULT 1,
      conversation_id TEXT,
      scheduled_at INTEGER,
      due_at INTEGER,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_user_status ON inbox_items(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_inbox_conversation ON inbox_items(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_inbox_aggregate ON inbox_items(aggregate_group_id);
    CREATE INDEX IF NOT EXISTS idx_inbox_due ON inbox_items(due_at);
  `);
}

export class InboxRepository {
  /**
   * 创建 InboxItem
   */
  async create(item: CreateInboxItemInput): Promise<InboxItem> {
    const db = getDb();
    ensureTable(db);

    const id = `inbx_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();

    db.prepare(
      `INSERT INTO inbox_items
        (id, user_id, type, category, source, source_id, title, description,
         priority, status, payload, conversation_id, scheduled_at, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      item.userId,
      item.type,
      item.category,
      item.source,
      item.sourceId || null,
      item.title,
      item.description || null,
      item.priority || "normal",
      "unread",
      item.payload ? JSON.stringify(item.payload) : null,
      item.conversationId || null,
      item.scheduledAt || null,
      item.dueAt || null,
      now,
    );

    return {
      id,
      userId: item.userId,
      type: item.type,
      category: item.category,
      source: item.source,
      sourceId: item.sourceId,
      title: item.title,
      description: item.description,
      priority: item.priority || "normal",
      status: "unread",
      payload: item.payload || {},
      aiSuggestion: undefined,
      aggregateGroupId: undefined,
      aggregateCount: 1,
      conversationId: item.conversationId,
      scheduledAt: item.scheduledAt,
      dueAt: item.dueAt,
      createdAt: now,
    };
  }

  /**
   * 根据 ID 查询
   */
  async findById(id: string): Promise<InboxItem | null> {
    const db = getDb();
    ensureTable(db);

    const row = db.prepare("SELECT * FROM inbox_items WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.parseRow(row);
  }

  /**
   * 根据 source + sourceId 查找（用于关联系统回调）
   */
  async findBySourceAndSourceId(source: string, sourceId: string): Promise<InboxItem | null> {
    const db = getDb();
    ensureTable(db);

    const row = db.prepare(
      "SELECT * FROM inbox_items WHERE source = ? AND source_id = ? AND status IN ('unread', 'pending', 'read') ORDER BY created_at DESC LIMIT 1"
    ).get(source, sourceId) as any;
    if (!row) return null;
    return this.parseRow(row);
  }

  /**
   * 列表查询（支持过滤、分页）
   */
  async list(query: InboxQuery): Promise<{ items: InboxItem[]; total: number }> {
    const db = getDb();
    ensureTable(db);

    const conditions: string[] = [];
    const params: any[] = [];

    if (query.userId) {
      conditions.push("user_id = ?");
      params.push(query.userId);
    }
    if (query.type) {
      conditions.push("type = ?");
      params.push(query.type);
    }
    if (query.category) {
      conditions.push("category = ?");
      params.push(query.category);
    }
    if (query.status) {
      const statuses = query.status.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push("status = ?");
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
        params.push(...statuses);
      }
    }
    if (query.priority) {
      conditions.push("priority = ?");
      params.push(query.priority);
    }
    if (query.source) {
      conditions.push("source = ?");
      params.push(query.source);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const allowedSortColumns = new Set(["created_at", "updated_at", "priority", "status", "due_at", "scheduled_at"]);
    const rawSortBy = query.sortBy || "created_at";
    const sortBy = allowedSortColumns.has(rawSortBy) ? rawSortBy : "created_at";
    const sortOrder = query.sortOrder === "asc" ? "ASC" : "DESC";

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM inbox_items ${where}`).get(...params) as { total: number };
    const dataRows = db.prepare(
      `SELECT * FROM inbox_items ${where} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset) as any[];

    return {
      items: dataRows.map((r) => this.parseRow(r)),
      total: countRow?.total || 0,
    };
  }

  /**
   * 更新状态（带条件检查，用于防止 TOCTOU 竞态）
   * 返回受影响的行数（0 表示条件不满足）
   */
  async updateStatusIf(id: string, status: string, expectedStatuses: string[], completedAt?: number): Promise<number> {
    const db = getDb();
    ensureTable(db);

    const placeholders = expectedStatuses.map(() => "?").join(", ");
    const params = completedAt
      ? [status, completedAt, id, ...expectedStatuses]
      : [status, id, ...expectedStatuses];
    const sql = completedAt
      ? `UPDATE inbox_items SET status = ?, completed_at = ? WHERE id = ? AND status IN (${placeholders})`
      : `UPDATE inbox_items SET status = ? WHERE id = ? AND status IN (${placeholders})`;

    const result = db.prepare(sql).run(...params);
    return result.changes ?? 0;
  }

  /**
   * 更新状态（无条件，仅用于内部系统回调等受控场景）
   */
  async updateStatus(id: string, status: string, completedAt?: number): Promise<void> {
    const db = getDb();
    ensureTable(db);

    if (completedAt) {
      db.prepare(
        "UPDATE inbox_items SET status = ?, completed_at = ? WHERE id = ?"
      ).run(status, completedAt, id);
    } else {
      db.prepare(
        "UPDATE inbox_items SET status = ? WHERE id = ?"
      ).run(status, id);
    }
  }

  /**
   * 更新 AI 建议
   */
  async updateAISuggestion(id: string, aiSuggestion: any): Promise<void> {
    const db = getDb();
    ensureTable(db);

    db.prepare(
      "UPDATE inbox_items SET ai_suggestion = ? WHERE id = ?"
    ).run(JSON.stringify(aiSuggestion), id);
  }

  /**
   * 更新聚合信息
   */
  async updateAggregate(id: string, groupId: string, count: number): Promise<void> {
    const db = getDb();
    ensureTable(db);

    db.prepare(
      "UPDATE inbox_items SET aggregate_group_id = ?, aggregate_count = ? WHERE id = ?"
    ).run(groupId, count, id);
  }

  /**
   * 统计
   */
  async getStats(userId: string): Promise<InboxStats> {
    const db = getDb();
    ensureTable(db);

    const row = db.prepare(
      `SELECT
        COUNT(CASE WHEN status = 'unread' THEN 1 END) as unread_count,
        COUNT(CASE WHEN status IN ('unread', 'pending') AND type = 'approval' THEN 1 END) as pending_approvals,
        COUNT(CASE WHEN status IN ('unread', 'pending') AND type = 'task' THEN 1 END) as pending_tasks,
        COUNT(CASE WHEN status = 'unread' AND type = 'notification' THEN 1 END) as unread_notifications,
        COUNT(CASE WHEN status = 'pending' AND type = 'task' AND scheduled_at > ? THEN 1 END) as upcoming_reminders
      FROM inbox_items
      WHERE user_id = ?`
    ).get(Date.now(), userId) as any;

    return {
      unreadCount: row.unread_count || 0,
      pendingApprovals: row.pending_approvals || 0,
      pendingTasks: row.pending_tasks || 0,
      unreadNotifications: row.unread_notifications || 0,
      upcomingReminders: row.upcoming_reminders || 0,
    };
  }

  /**
   * 获取未读数
   */
  async getUnreadCount(userId: string): Promise<number> {
    const db = getDb();
    ensureTable(db);

    const row = db.prepare(
      "SELECT COUNT(*) as count FROM inbox_items WHERE user_id = ? AND status = 'unread'"
    ).get(userId) as { count: number };
    return row?.count || 0;
  }

  // ─── 私有方法 ───

  private parseRow(row: any): InboxItem {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      category: row.category,
      source: row.source,
      sourceId: row.source_id || undefined,
      title: row.title,
      description: row.description || undefined,
      priority: row.priority,
      status: row.status,
      payload: row.payload ? (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) : {},
      aiSuggestion: row.ai_suggestion
        ? (typeof row.ai_suggestion === "string" ? JSON.parse(row.ai_suggestion) : row.ai_suggestion)
        : undefined,
      aggregateGroupId: row.aggregate_group_id || undefined,
      aggregateCount: row.aggregate_count || 1,
      conversationId: row.conversation_id || undefined,
      scheduledAt: row.scheduled_at || undefined,
      dueAt: row.due_at || undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
    };
  }
}

// 单例
let repoInstance: InboxRepository | null = null;

export function getInboxRepository(): InboxRepository {
  if (!repoInstance) {
    repoInstance = new InboxRepository();
  }
  return repoInstance;
}
