/**
 * 图谱健康度指标 — KG v2 阶段 4
 *
 * 详见 docs/KG_ARCHITECTURE_VISION.md §5.2。
 *
 * 暴露的指标：
 * - nodeCount / edgeCount
 * - avgDegree（平均度数）
 * - isolatedNodeCount（度数为 0 的孤立节点）
 * - topCommunitySize（最大社区节点数）
 * - acceptedRateAllTime / per-query-type
 * - recentAcceptanceRate（最近 50 条）
 */
import { getMySQLAdapter } from "../../db/mysql-adapter.js";
import { GraphStore } from "./graph-store.js";
import { detectCommunities } from "./community-detection.js";
import { isChineseTokenizerActive } from "./query-understanding.js";

export interface GraphHealth {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  isolatedNodeCount: number;
  communityCount: number;
  topCommunitySize: number;
  acceptedRateAllTime: { total: number; accepted: number; rate: number };
  perQueryType: Array<{
    type: "factual" | "relational" | "discovery" | "hybrid";
    total: number;
    accepted: number;
    rate: number;
  }>;
  /**
   * P1-5 修复（v3 review）：把中文分词后端加到 health check。
   * - backend: "nodejieba" | "heuristic" — 当前用的是哪个
   * - note: 简短说明，提醒 ops 切到 nodejieba 才能拿到正确分词
   */
  tokenizer: {
    backend: "nodejieba" | "heuristic";
    note?: string;
  };
}

/**
 * 一次性计算健康度指标。约 200-500ms 量级，调用方应当缓存或定时跑。
 */
export async function getGraphHealth(owner: string): Promise<GraphHealth> {
  const store = new GraphStore(owner);

  // 1. 基础统计
  const nodeCount = await store.countNodes();
  const edgeCount = await store.countEdges();

  // 2. 平均度数 + 孤立节点
  let isolatedNodeCount = 0;
  let totalDegree = 0;
  const nodes = await store.getAllNodes();
  for (const n of nodes) {
    const degree = await store.getDegree(n.id);
    totalDegree += degree;
    if (degree === 0) isolatedNodeCount++;
  }
  const avgDegree = nodeCount > 0 ? totalDegree / nodeCount : 0;

  // 3. 社区统计
  let communityCount = 0;
  let topCommunitySize = 0;
  if (nodeCount > 0) {
    const communities = await detectCommunities(store);
    communityCount = communities.size;
    for (const [, ids] of communities) {
      if (ids.length > topCommunitySize) topCommunitySize = ids.length;
    }
  }

  // 4. 反馈统计
  const feedbackStats = await getFeedbackStats(owner);

  return {
    nodeCount,
    edgeCount,
    avgDegree: Math.round(avgDegree * 100) / 100,
    isolatedNodeCount,
    communityCount,
    topCommunitySize,
    acceptedRateAllTime: feedbackStats.allTime,
    perQueryType: feedbackStats.perType,
    tokenizer: isChineseTokenizerActive()
      ? { backend: "nodejieba" }
      : {
          backend: "heuristic",
          note: "nodejieba 未加载，中文按字符/2-字切分。建议安装 nodejieba 拿到 cppjieba 精度。",
        },
  };
}

/**
 * 反馈采纳率统计。
 */
export async function getFeedbackStats(userId: string): Promise<{
  allTime: { total: number; accepted: number; rate: number };
  perType: Array<{ type: any; total: number; accepted: number; rate: number }>;
}> {
  const adapter = getMySQLAdapter();
  const allTimeRows = await adapter.query<{ total: number; accepted: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted
     FROM kg_feedback_events
     WHERE user_id = ?`,
    [userId]
  );
  const allTimeTotal = Number(allTimeRows[0]?.total ?? 0);
  const allTimeAccepted = Number(allTimeRows[0]?.accepted ?? 0);

  const perTypeRows = await adapter.query<{
    query_type: string;
    total: number;
    accepted: number;
  }>(
    `SELECT
       query_type,
       COUNT(*) as total,
       SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted
     FROM kg_feedback_events
     WHERE user_id = ? AND query_type IS NOT NULL
     GROUP BY query_type`,
    [userId]
  );

  return {
    allTime: {
      total: allTimeTotal,
      accepted: allTimeAccepted,
      rate: allTimeTotal > 0 ? allTimeAccepted / allTimeTotal : 0,
    },
    perType: perTypeRows.map((r) => ({
      type: r.query_type,
      total: Number(r.total),
      accepted: Number(r.accepted),
      rate: Number(r.total) > 0 ? Number(r.accepted) / Number(r.total) : 0,
    })),
  };
}

/**
 * 告警检查：连续 N 次某 query type 采纳率过低。
 * 返回需要告警的 query types。
 */
export async function checkAcceptanceAlerts(
  userId: string,
  thresholds: { factual?: number; relational?: number; discovery?: number; hybrid?: number; windowSize?: number } = {}
): Promise<Array<{ type: string; rate: number; total: number; threshold: number }>> {
  const defaults = { factual: 0.5, relational: 0.5, discovery: 0.5, hybrid: 0.5, windowSize: 20 };
  const t = { ...defaults, ...thresholds };
  const adapter = getMySQLAdapter();
  const alerts: Array<{ type: string; rate: number; total: number; threshold: number }> = [];

  for (const queryType of ["factual", "relational", "discovery", "hybrid"] as const) {
    const threshold = t[queryType]!;
    const window = t.windowSize!;
    const rows = await adapter.query<{ total: number; accepted: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted
       FROM (
         SELECT accepted FROM kg_feedback_events
         WHERE user_id = ? AND query_type = ?
         ORDER BY created_at DESC
         LIMIT ?
       ) t`,
      [userId, queryType, window]
    );
    const total = Number(rows[0]?.total ?? 0);
    const accepted = Number(rows[0]?.accepted ?? 0);
    if (total >= 5) {
      // 至少 5 条样本才有统计意义
      const rate = accepted / total;
      if (rate < threshold) {
        alerts.push({ type: queryType, rate, total, threshold });
      }
    }
  }

  return alerts;
}
