/**
 * 反馈事件存储 — KG v2 阶段 4 反馈环路
 *
 * 详见 docs/KG_ARCHITECTURE_VISION.md §5.1。
 */
import { getMySQLAdapter } from "../../db/mysql-adapter.js";

export interface FeedbackEvent {
  id?: number;
  userId: string;
  queryId: string;
  query: string;
  queryType?: "factual" | "relational" | "discovery" | "hybrid";
  /**
   * 被采纳的图谱节点 / 边 / chunk 标识
   * 格式：{ nodes?: string[]; edges?: string[]; chunks?: Array<{ docId: string; chunkIndex: number }> }
   */
  accepted: boolean;
  rating?: number; // 1-5
  rejectedEntityIds?: string[];
  acceptedChunkKeys?: string[]; // "docId:chunkIndex"
  dwellTimeMs?: number;
  followUpQuery?: string;
  /** 检索快照（用于反哺） */
  recallSnapshot?: string; // JSON
  timestamp: number;
}

/**
 * 插入反馈事件。失败不抛错（前端请求不应该被反馈存储失败影响）。
 */
export async function saveFeedback(event: FeedbackEvent): Promise<number> {
  const adapter = getMySQLAdapter();
  try {
    const result = await adapter.execute(
      `INSERT INTO kg_feedback_events
        (user_id, query_id, query, query_type, accepted, rating,
         rejected_entity_ids, accepted_chunk_keys, dwell_time_ms,
         follow_up_query, recall_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.userId,
        event.queryId,
        event.query,
        event.queryType ?? null,
        event.accepted ? 1 : 0,
        event.rating ?? null,
        event.rejectedEntityIds ? JSON.stringify(event.rejectedEntityIds) : null,
        event.acceptedChunkKeys ? JSON.stringify(event.acceptedChunkKeys) : null,
        event.dwellTimeMs ?? null,
        event.followUpQuery ?? null,
        event.recallSnapshot ?? null,
        event.timestamp,
      ]
    );
    return (result as any).insertId ?? -1;
  } catch (err) {
    console.warn("[kg_feedback] save failed:", err);
    return -1;
  }
}

/**
 * 查询某用户最近的反馈（用于监控和样本导出）。
 */
export async function getRecentFeedback(
  userId: string,
  limit = 100
): Promise<FeedbackEvent[]> {
  const adapter = getMySQLAdapter();
  const rows = await adapter.query<any>(
    `SELECT id, user_id as userId, query_id as queryId, query, query_type as queryType,
            accepted, rating, rejected_entity_ids as rejectedEntityIds,
            accepted_chunk_keys as acceptedChunkKeys, dwell_time_ms as dwellTimeMs,
            follow_up_query as followUpQuery, recall_snapshot as recallSnapshot, created_at as timestamp
     FROM kg_feedback_events
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows.map(parseFeedbackRow);
}

function parseFeedbackRow(row: any): FeedbackEvent {
  return {
    id: row.id,
    userId: row.userId,
    queryId: row.queryId,
    query: row.query,
    queryType: row.queryType ?? undefined,
    accepted: row.accepted === 1 || row.accepted === true,
    rating: row.rating ?? undefined,
    rejectedEntityIds: safeParseJsonArray(row.rejectedEntityIds),
    acceptedChunkKeys: safeParseJsonArray(row.acceptedChunkKeys),
    dwellTimeMs: row.dwellTimeMs ?? undefined,
    followUpQuery: row.followUpQuery ?? undefined,
    recallSnapshot: row.recallSnapshot ?? undefined,
    timestamp: row.timestamp,
  };
}

/** 兼容 mysql2 自动 parse 成对象/数组的情况 */
function safeParseJsonArray(input: unknown): string[] | undefined {
  if (input === null || input === undefined) return undefined;
  if (Array.isArray(input)) return input as string[];
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? (parsed as string[]) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 统计某 query type 的采纳率（最近 N 条反馈）。
 * 用于"连续 N 次某 query type 召回失败"告警。
 */
export async function getAcceptanceRate(
  queryType: "factual" | "relational" | "discovery" | "hybrid",
  window = 50
): Promise<{ total: number; accepted: number; rate: number }> {
  const adapter = getMySQLAdapter();
  const rows = await adapter.query<{ total: number; accepted: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted
     FROM (
       SELECT accepted FROM kg_feedback_events
       WHERE query_type = ?
       ORDER BY created_at DESC
       LIMIT ?
     ) t`,
    [queryType, window]
  );
  const total = Number(rows[0]?.total ?? 0);
  const accepted = Number(rows[0]?.accepted ?? 0);
  return {
    total,
    accepted,
    rate: total > 0 ? accepted / total : 0,
  };
}
