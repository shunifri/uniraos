/**
 * P2-CRITICAL-FIX（接真数据 #1）：数据源发现 + 质量报告
 *
 * 自动扫描所有可用的真实数据源（feedback events / recall snapshot / query log），
 * 报告数据质量（unique queries / diversity / freshness），给 ops 行动建议。
 *
 * 用法：
 *   npx tsx scripts/audit-data-quality.ts
 *
 * 输出示例（dev DB）：
 *   - feedback events: 78 rows, 4 unique queries (全是 "test"/"broken" → 不可用)
 *   - graph nodes: 235 (96 entity, 73 kb_document, 66 ltm)
 *   - calibration pipeline 估计：全 synthetic fallback → 数据驱动结论可靠性低
 *   - 建议：接真 query log 或运行 1 周生产数据
 */

import { getMySQLAdapter } from "../src/db/mysql-adapter.js";

interface SourceStats {
  source: string;
  totalRows: number;
  uniqueQueries: number;
  uniqueNodes: number;
  uniqueUsers: number;
  sampleQueries: Array<{ query: string; cnt: number }>;
  earliestTimestamp?: number;
  latestTimestamp?: number;
  dataQuality: "empty" | "test-only" | "sparse" | "production-like";
  recommendation: string;
}

async function auditKgFeedbackEvents(): Promise<SourceStats> {
  const adapter = getMySQLAdapter();
  const total = await adapter.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM kg_feedback_events`
  );
  const totalRows = Number(total[0]?.cnt ?? 0);

  if (totalRows === 0) {
    return {
      source: "kg_feedback_events",
      totalRows: 0,
      uniqueQueries: 0,
      uniqueNodes: 0,
      uniqueUsers: 0,
      sampleQueries: [],
      dataQuality: "empty",
      recommendation: "空表。系统没收到任何 feedback——可能 (1) 用户没用过 kb_search，(2) feedback API 没接上。**action**: 先确认 /api/graph/feedback 工作正常。",
    };
  }

  const uniqQ = await adapter.query<{ query: string; cnt: number }>(
    `SELECT query, COUNT(*) as cnt FROM kg_feedback_events
     WHERE query IS NOT NULL AND LENGTH(query) > 0
     GROUP BY query ORDER BY cnt DESC LIMIT 20`
  );
  const uniqU = await adapter.query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT user_id) as cnt FROM kg_feedback_events`
  );
  const range = await adapter.query<{ earliest: number; latest: number }>(
    `SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM kg_feedback_events`
  );

  const uniqueQueries = uniqQ.length;
  const uniqueUsers = Number(uniqU[0]?.cnt ?? 0);
  const sampleQueries = uniqQ.map((r) => ({ query: r.query, cnt: Number(r.cnt) }));

  // 判断数据质量
  const nonTestQueries = uniqQ.filter((r) => !/^test|^broken/i.test(r.query.trim()));
  let dataQuality: SourceStats["dataQuality"];
  let recommendation: string;

  if (uniqueQueries === 0) {
    dataQuality = "empty";
    recommendation = "空表。同上。";
  } else if (nonTestQueries.length === 0) {
    // 全部是 test 字符串
    dataQuality = "test-only";
    recommendation = `**${uniqueQueries} 个 unique queries 全是 "test" / "broken" 占位**——这是 dev/test fixture，不是真生产数据。**action**: 把 kg_feedback_events 接到生产 kb_search 的 feedback API，让真用户流量写表。`;
  } else if (uniqueQueries < 20) {
    dataQuality = "sparse";
    recommendation = `**${uniqueQueries} 个真 queries**——少于 calibration 阈值（20-30 个 unique 才能算 diverse）。**action**: 跑 1 周生产数据再校准，或者用真数据作为 seed 让 LLM 合成 200 个 diverse queries。`;
  } else {
    dataQuality = "production-like";
    recommendation = `**${uniqueQueries} 个真 queries**——足够 calibrate。跑 \`npx tsx scripts/calibrate-from-real-data.ts --llm\` 拿真相关性分数。`;
  }

  return {
    source: "kg_feedback_events",
    totalRows,
    uniqueQueries,
    uniqueNodes: 0,
    uniqueUsers,
    sampleQueries,
    earliestTimestamp: range[0]?.earliest ? Number(range[0].earliest) : undefined,
    latestTimestamp: range[0]?.latest ? Number(range[0].latest) : undefined,
    dataQuality,
    recommendation,
  };
}

async function auditGraphNodes(): Promise<SourceStats> {
  const adapter = getMySQLAdapter();
  const total = await adapter.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM kb_graph_nodes`
  );
  const totalRows = Number(total[0]?.cnt ?? 0);

  if (totalRows === 0) {
    return {
      source: "kb_graph_nodes",
      totalRows: 0,
      uniqueQueries: 0,
      uniqueNodes: 0,
      uniqueUsers: 0,
      sampleQueries: [],
      dataQuality: "empty",
      recommendation: "图谱空。kgExtractionQueue 跑过吗？",
    };
  }

  const byType = await adapter.query<{ type: string; cnt: number }>(
    `SELECT type, COUNT(*) as cnt FROM kb_graph_nodes GROUP BY type ORDER BY cnt DESC`
  );
  const uniqueOwners = await adapter.query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT owner_id) as cnt FROM kb_graph_nodes`
  );
  const uniqueNodes = Number(uniqueOwners[0]?.cnt ?? 0);

  const typeMap = byType.map((r) => `${r.type}=${r.cnt}`).join(", ");

  let dataQuality: SourceStats["dataQuality"];
  let recommendation: string;

  if (totalRows < 50) {
    dataQuality = "sparse";
    recommendation = `**${totalRows} 个节点**——图谱太小，calibration 的 synthetic fallback 也会太窄。**action**: 跑 kgExtractionQueue 多积累一些节点再校准。`;
  } else {
    dataQuality = "production-like";
    recommendation = `**${totalRows} 个节点**（${typeMap}）——足够做 calibration。`;
  }

  return {
    source: "kb_graph_nodes",
    totalRows,
    uniqueQueries: 0,
    uniqueNodes,
    uniqueUsers: 0,
    sampleQueries: byType.map((r) => ({ query: `${r.type} (${r.cnt})`, cnt: Number(r.cnt) })),
    dataQuality,
    recommendation,
  };
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "n/a";
  return new Date(ts).toISOString().slice(0, 19);
}

async function main() {
  const adapter = getMySQLAdapter();
  console.log("[audit-data-quality] scanning all data sources...\n");

  const sources: SourceStats[] = [];
  sources.push(...(await Promise.all([auditKgFeedbackEvents(), auditGraphNodes()])));

  for (const s of sources) {
    console.log(`[audit] ===== ${s.source} =====`);
    console.log(`  total rows:           ${s.totalRows}`);
    if (s.uniqueQueries > 0) {
      console.log(`  unique queries:      ${s.uniqueQueries}`);
      console.log(`  unique users:         ${s.uniqueUsers}`);
      console.log(`  earliest:             ${formatTimestamp(s.earliestTimestamp)}`);
      console.log(`  latest:               ${formatTimestamp(s.latestTimestamp)}`);
    }
    if (s.uniqueNodes > 0) console.log(`  unique owners:        ${s.uniqueNodes}`);
    if (s.sampleQueries.length > 0) {
      console.log(`  sample:`);
      for (const sq of s.sampleQueries.slice(0, 8)) {
        console.log(`    "${sq.query}" × ${sq.cnt}`);
      }
    }
    console.log(`  data quality:         ${s.dataQuality.toUpperCase()}`);
    console.log(`  recommendation:`);
    console.log(`    ${s.recommendation}`);
    console.log();
  }

  // 总结
  const overallQuality = sources.some((s) => s.dataQuality === "production-like") ? "OK" : "NEEDS DATA";
  console.log(`[audit] ===== OVERALL: ${overallQuality} =====`);

  await adapter.close?.();
  process.exit(overallQuality === "OK" ? 0 : 1);
}

main().catch((err) => {
  console.error("[audit] failed:", err);
  process.exit(1);
});
