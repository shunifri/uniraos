/**
 * 反馈应用管线 — KG v2 阶段 4 反馈环路
 *
 * 职责：把 FeedbackEvent 应用到图谱（边 weight、entity importance）
 * 详见 docs/KG_ARCHITECTURE_VISION.md §5.1。
 */
import { saveFeedback, type FeedbackEvent } from "./feedback-store.js";
import type { GraphStoreLike } from "./extraction-pipeline.js";

export interface ApplyFeedbackResult {
  edgesUpdated: number;
  nodesUpdated: number;
  feedbackId: number;
}

/**
 * 应用单条反馈到图谱。
 *
 * 策略：
 * - 边：累加 feedbackScore，weight 用 tanh 缩放（避免单边反馈把 weight 推到极端）
 *   `weight = baseWeight * (1 + tanh(feedbackScore))`
 * - 节点 importance：指数移动平均（EMA）
 *   `importance = 0.9 * old + 0.1 * newSignal` 其中 newSignal=1 (采纳) 或 0 (拒绝)
 *
 * 注意：
 * - 单条失败不应该影响其他写入
 * - 不抛错（让 saveFeedback 单独 try/catch）
 */
export async function applyFeedback(
  event: FeedbackEvent,
  store: GraphStoreLike
): Promise<ApplyFeedbackResult> {
  // 1. 持久化 feedback
  const feedbackId = await saveFeedback(event);

  // 2. 调整边 feedbackScore
  let edgesUpdated = 0;
  const snapshot = event.recallSnapshot ? safeJsonParse(event.recallSnapshot) : null;
  const edgeIds: string[] = (snapshot && Array.isArray(snapshot.edges)) ? snapshot.edges : [];

  const delta = event.accepted ? 1 : -1;
  for (const edgeId of edgeIds) {
    try {
      // P2-12：用类型守卫代替 as any（updateEdge 在 GraphStoreLike 是可选方法）
      if (store.updateEdge) {
        const ok = await store.updateEdge(edgeId, { feedbackScoreDelta: delta });
        if (ok) edgesUpdated++;
      }
    } catch (err) {
      console.warn(`[feedback-pipeline] updateEdge ${edgeId} failed:`, err);
    }
  }

  // 3. 调整 entity importance
  let nodesUpdated = 0;
  const entityIds: string[] = [];
  if (event.rejectedEntityIds) entityIds.push(...event.rejectedEntityIds);
  if (snapshot && Array.isArray(snapshot.seedEntities)) {
    for (const sid of snapshot.seedEntities) entityIds.push(sid);
  }
  // 去重
  const uniqueEntityIds = Array.from(new Set(entityIds));

  for (const nodeId of uniqueEntityIds) {
    try {
      // P2-12：用类型守卫代替 as any（getNode 在 GraphStoreLike 是可选方法）
      if (store.getNode) {
        const node = await store.getNode(nodeId);
        if (!node) continue;
        const oldImportance = node.importance ?? 0.5;
        // EMA：采纳 +0.05 信号，拒绝 -0.1 信号
        const signal = event.accepted ? 1 : 0;
        const targetImportance = event.accepted
          ? Math.min(1, oldImportance + 0.05)
          : Math.max(0, oldImportance - 0.1);
        // 用 EMA 平滑：new = 0.9 * old + 0.1 * signal
        const newImportance = event.accepted
          ? Math.max(targetImportance, 0.9 * oldImportance + 0.1 * signal)
          : Math.min(targetImportance, 0.9 * oldImportance);
        const ok = await store.updateNode?.(nodeId, {
          importance: newImportance,
          version: (node.version ?? 1) + 1,
        });
        if (ok) nodesUpdated++;
      }
    } catch (err) {
      console.warn(`[feedback-pipeline] updateNode ${nodeId} failed:`, err);
    }
  }

  return { edgesUpdated, nodesUpdated, feedbackId };
}

/**
 * 把单条反馈追加为抽取训练样本（导出为 JSONL）。
 * 阶段 4：先落到文件，阶段 5 接 LLM 微调。
 */
export function asExtractionSample(event: FeedbackEvent): string {
  const sample = {
    query: event.query,
    queryType: event.queryType,
    accepted: event.accepted,
    rating: event.rating,
    snapshot: event.recallSnapshot ? safeJsonParse(event.recallSnapshot) : null,
    timestamp: event.timestamp,
  };
  return JSON.stringify(sample);
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
