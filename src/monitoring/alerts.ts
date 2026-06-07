/**
 * Monitoring alert rule definitions for RAOS.
 *
 * 这些是 TS 形状的告警定义, 跟 `monitoring/prometheus/alert-rules.yml` 镜像.
 * 目的:
 *   1. 给代码侧 (单元测试, 健康检查, runtime eval) 一份可枚举的告警清单
 *   2. 写一份脚本可以同步 YAML (见 `scripts/sync-alerts.ts` — follow-up),
 *      避免两边漂移
 *   3. 让告警阈值 review 时有 PR diff
 *
 * Q3 W3 Item #8: WAL_SIZE_HIGH — WAL 文件 > 200MB 持续 5min 触发.
 *   设计参考 docs/ROADMAP-2026-Q3.md §"暂存" 反向陷阱:
 *   - 不能孤立地用 "rate 0% 看似健康" 的逻辑判断 (可能根本没人用)
 *   - WAL 是绝对值指标, 不存在零除问题, 但需要配 for 持续时间避免
 *     "刚启动时 WAL=0 → 缓慢爬升到 200MB" 的 5min 假阳性
 *   - 建议 review: 阈值 200MB / for 5min 是经验值, 跟 100MB truncate 兜底
 *     留 2x buffer; 等稳定 1 季度后再校准.
 */

export type AlertSeverity = "warning" | "critical";

export interface AlertRule {
  alert: string;
  expr: string;
  for: string;
  labels: {
    severity: AlertSeverity;
    [k: string]: string;
  };
  annotations: {
    summary: string;
    description: string;
  };
}

/**
 * Q3 W3 Item #8: WAL 文件 > 200MB 持续 5 分钟触发.
 *
 * 触发条件: wal_active_size_bytes 持续 5 分钟 > 200MB (200 * 1024 * 1024 = 209715200)
 * 应对: 跑 `npm run wal:compact -- --apply` 归档已完成 entry.
 *
 * 阈值选择:
 *   - 200MB = 2x 100MB truncate 兜底 (file-wal-store.ts:85)
 *   - 200MB 留 buffer 给 cron 没跑 (例如周末 on-call 没注意)
 *   - 5min for: 避免单次 spike 误告 (例如 backfill 大量 entry 后回归)
 *
 * P1 缓解: 同时配 "持续 1 小时 > 150MB" 的 warning 级, 给 on-call 早期信号.
 *   (没加, 避免告警风暴 — 等真生产 1 季度后再校准)
 */
export const WAL_SIZE_HIGH: AlertRule = {
  alert: "WAL_SIZE_HIGH",
  expr: "wal_active_size_bytes > 209715200",
  for: "5m",
  labels: {
    severity: "warning",
  },
  annotations: {
    summary: "RAOS WAL file size is high",
    description:
      "Active WAL file is {{ $value | humanize }}B (>200MB) for 5+ minutes. " +
      "Run `npm run wal:compact -- --apply` to archive completed entries. " +
      "If unchecked, P1-20 truncate fallback at 100MB will start dropping history.",
  },
};

/** All alerts registered. Add new ones here, then mirror to monitoring/prometheus/alert-rules.yml. */
export const ALL_ALERTS: ReadonlyArray<AlertRule> = [WAL_SIZE_HIGH];

/** Lookup helper for tests / runtime validation. */
export function findAlert(name: string): AlertRule | undefined {
  return ALL_ALERTS.find((a) => a.alert === name);
}
