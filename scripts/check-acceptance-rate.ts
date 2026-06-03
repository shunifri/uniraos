#!/usr/bin/env tsx
/**
 * P2 #7: Acceptance rate alerting
 *
 * 监控 kg_feedback_events acceptance rate, 阈值不达标时 exit 1 (供 cron/alerting hook)
 *
 * 指标:
 *   - 24h acceptance rate (主要)
 *   - 7d acceptance rate (基线)
 *   - delta (24h - 7d) — 看是恢复中还是退化中
 *   - 24h volume (样本量)
 *
 * 阈值 (env 可配, 默认):
 *   - ACCEPTANCE_THRESHOLD=0.5  ← 24h rate 低于此告警
 *   - MIN_VOLUME=20              ← 24h volume 低于此 skip 告警 (避免 noise)
 *
 * 排除: user_id LIKE 'test%' (生产没这种 user，但 dev/test env 有)
 *
 * 用法:
 *   - 一次性:  npx tsx scripts/check-acceptance-rate.ts
 *   - cron:    每 30 分钟跑一次 (exit 1 时触发 alert hook)
 *   - 预演:    DRY_RUN=1 npx tsx scripts/check-acceptance-rate.ts (只输出，不 exit code)
 */
import { getMySQLAdapter } from "../src/db/mysql-adapter.js";

const THRESHOLD = parseFloat(process.env.ACCEPTANCE_THRESHOLD || "0.5");
const MIN_VOLUME = parseInt(process.env.MIN_VOLUME || "20", 10);
const DRY_RUN = process.env.DRY_RUN === "1";

interface Bucket {
  total: number;
  accepted: number;
}

async function queryBucket(hours: number, excludeTestUsers = true): Promise<Bucket> {
  const adapter = getMySQLAdapter();
  const where = excludeTestUsers ? "AND user_id NOT LIKE 'test%' AND user_id NOT LIKE 'kg_v2_%'" : "";
  const rows = await adapter.query<{ total: number; accepted: number | null }>(
    `SELECT COUNT(*) AS total,
            SUM(accepted) AS accepted
     FROM kg_feedback_events
     WHERE created_at > UNIX_TIMESTAMP(NOW() - INTERVAL ? HOUR) * 1000
       ${where}`,
    [hours]
  );
  return {
    total: rows[0]?.total ?? 0,
    accepted: rows[0]?.accepted ?? 0,
  };
}

function rate(b: Bucket): number {
  return b.total > 0 ? b.accepted / b.total : 0;
}

function fmt(b: Bucket): string {
  if (b.total === 0) return "no data";
  const r = (rate(b) * 100).toFixed(1);
  return `${b.accepted}/${b.total} (${r}%)`;
}

async function main() {
  const bucket24h = await queryBucket(24);
  const bucket7d = await queryBucket(24 * 7);
  const r24 = rate(bucket24h);
  const r7d = rate(bucket7d);
  const delta = r24 - r7d;

  console.log(`[acceptance-rate] ===== ACCEPTANCE RATE CHECK =====`);
  console.log(`  threshold: ${(THRESHOLD * 100).toFixed(0)}%  (env ACCEPTANCE_THRESHOLD)`);
  console.log(`  min volume: ${MIN_VOLUME}  (env MIN_VOLUME)`);
  console.log(`  24h:    ${fmt(bucket24h)}`);
  console.log(`  7d:     ${fmt(bucket7d)}`);
  console.log(`  delta:  ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%  (24h - 7d)`);

  // 报警条件
  const alerts: string[] = [];
  if (bucket24h.total < MIN_VOLUME) {
    console.log(`\n[acceptance-rate] ✓ SKIP: 24h volume ${bucket24h.total} < ${MIN_VOLUME} (insufficient data)`);
  } else {
    if (r24 < THRESHOLD) {
      alerts.push(`24h rate ${(r24 * 100).toFixed(1)}% < ${(THRESHOLD * 100).toFixed(0)}% threshold`);
    }
    if (delta < -0.1) {
      alerts.push(`24h-7d delta ${(delta * 100).toFixed(1)}% < -10% (regression)`);
    }
  }

  if (alerts.length === 0) {
    console.log(`\n[acceptance-rate] ✓ OK: 24h rate ${(r24 * 100).toFixed(1)}% ≥ ${(THRESHOLD * 100).toFixed(0)}% threshold`);
    if (!DRY_RUN) process.exit(0);
  } else {
    console.log(`\n[acceptance-rate] ✗ ALERT (${alerts.length} signal${alerts.length > 1 ? "s" : ""}):`);
    for (const a of alerts) console.log(`  - ${a}`);
    console.log(`\n[acceptance-rate] RECOMMENDED ACTION:`);
    console.log(`  1. 检查 kg_feedback_events rejected_entity_ids 找出被拒实体`);
    console.log(`  2. 跑 scripts/calibrate-from-real-data.ts 看 score 分布`);
    console.log(`  3. 看 OPERATIONS.md §alerting runbook`);
    if (!DRY_RUN) process.exit(1);
  }
}

main().catch((e) => { console.error("[acceptance-rate] FATAL:", e); process.exit(2); });
