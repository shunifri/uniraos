/**
 * Monitoring metrics for RAOS.
 *
 * 添加了 WAL (Write-Ahead Log) 主动监控 — Q3 W3 Item #8.
 * 替代 P1-20 的 100MB 截断兜底 (file-wal-store.ts:85), 让运维在截断前收到告警.
 *
 * 暴露指标:
 *   - wal_active_size_bytes (gauge, label: path) — 当前 active WAL 文件字节数
 *
 * 配套脚本: scripts/wal-compact.ts (--apply 时调 updateWalActiveSize).
 * 配套告警: src/monitoring/alerts.ts WAL_SIZE_HIGH.
 */

import { Gauge } from "prom-client";
import { statSync, existsSync } from "fs";

/**
 * 当前 active WAL 文件字节数.
 * `path` label 区分多实例 / 多 WAL 文件场景.
 */
export const walActiveSizeBytes = new Gauge({
  name: "wal_active_size_bytes",
  help: "Size of the active WAL file in bytes. Updated by wal-compact script after each compaction and on startup. Drop below threshold after compaction, climb back up to threshold on next scheduled run.",
  labelNames: ["path"] as const,
});

/**
 * Read WAL file size from disk and update the gauge.
 * Returns the size in bytes (0 if file doesn't exist).
 *
 * Idempotent — safe to call from anywhere. Caller decides when to update.
 * Production: called by scripts/wal-compact.ts after each apply, and on backend
 * startup (TODO: wire to src/server/bootstrap.ts if running frequent reads).
 */
export function updateWalActiveSize(walPath: string): number {
  let size = 0;
  try {
    if (existsSync(walPath)) {
      size = statSync(walPath).size;
    }
  } catch {
    // statSync failure (permission, race) — leave gauge at 0
    size = 0;
  }
  walActiveSizeBytes.set({ path: walPath }, size);
  return size;
}
