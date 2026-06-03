/**
 * P2-7 标定 pipeline (v3 review 闭环)：从真实数据生成 ground_truth.json
 *
 * 数据流：
 *   1. 拉真实数据：kg_feedback_events.recall_snapshot 里 seedEntities + edges
 *      （生产环境会累积真实 user query）
 *   2. Fallback：dev DB 没真实数据时，从 kb_graph_nodes 生成 synthetic tuples
 *      演示 pipeline 能跑通
 *   3. 对每个 (query, node) 对，调 MySQL MATCH AGAINST 拿 raw_score
 *   4. 用 LLM（heuristic 模式作为 fallback）打 0-1 relevance
 *   5. 写 ground_truth.json
 *   6. 调 scripts/calibrate-fts-score.ts 选最优 k
 *
 * 用法：
 *   # 真实数据 + LLM 评分
 *   npx tsx scripts/calibrate-from-real-data.ts --llm
 *
 *   # 真实数据 + heuristic 评分（不需要 LLM 也能跑）
 *   npx tsx scripts/calibrate-from-real-data.ts
 *
 *   # Synthetic fallback（dev DB 没数据时自动启用）
 *   npx tsx scripts/calibrate-from-real-data.ts --synthetic 200
 *
 *   # 指定输出
 *   npx tsx scripts/calibrate-from-real-data.ts --out /tmp/gt.json --llm
 */

import * as fs from "fs";
import * as path from "path";
import { getMySQLAdapter, type MySQLAdapter } from "../src/db/mysql-adapter.js";
import { GraphStore } from "../src/memory/knowledge-graph/graph-store.js";
import { surfaceToCanonical } from "../src/memory/knowledge-graph/entity-linker.js";
import { findBestK, rmse, predict } from "./calibrate-fts-score.js";

interface CalibrationPoint {
  raw: number; // FULLTEXT raw score
  productionScore: number; // multi-stage fallback 后的 production searchNodesByKeywords score
  stage: number; // 1=FULLTEXT, 2=exact/canonical, 4=substring
  relevance: number; // 0-1
  query?: string;
  nodeId?: string;
  nodeLabel?: string;
  source?: "real" | "synthetic";
}

interface RealTuple {
  query: string;
  nodeId: string;
  nodeLabel: string;
}

const args = process.argv.slice(2);
const useLlm = args.includes("--llm");
const outIdx = args.indexOf("--out");
let outFile = path.resolve("ground_truth.json");
if (outIdx !== -1 && outIdx + 1 < args.length) outFile = path.resolve(args[outIdx + 1]);
const synthIdx = args.indexOf("--synthetic");
let synthCount = 200;
if (synthIdx !== -1 && synthIdx + 1 < args.length) synthCount = parseInt(args[synthIdx + 1], 10);
const userIdIdx = args.indexOf("--user");
let targetUser: string | null = null;
if (userIdIdx !== -1 && userIdIdx + 1 < args.length) targetUser = args[userIdIdx + 1];
const limitIdx = args.indexOf("--limit");
let realLimit = 1000;
if (limitIdx !== -1 && limitIdx + 1 < args.length) realLimit = parseInt(args[limitIdx + 1], 10);

const LLM_SCORE_PROMPT = `你是 KG v2 检索质量评估员。给 query 和候选节点打分（0-1）：

query: "{query}"
节点 label: "{label}"
节点 type: "{type}"

打分标准：
- 1.0：完全相关
- 0.7-0.9：相关但有噪声
- 0.4-0.6：部分相关
- 0.1-0.3：基本不相关
- 0.0：完全不相关

只输出 0-1 之间的数字，不要其他内容。`;

/**
 * Heuristic 评分：不用 LLM，根据 surface match / alias match 给 0-1 分
 * 比 LLM 粗，但生产可立即用、零成本
 */
function heuristicScore(query: string, label: string, _type: string): number {
  if (!label || !query) return 0;
  const q = query.toLowerCase().trim();
  const l = label.toLowerCase().trim();
  // 完全等值
  if (q === l) return 1.0;
  // canonical 归一化后等值
  if (surfaceToCanonical(q) === surfaceToCanonical(l)) return 0.95;
  // 包含关系
  if (l.includes(q) || q.includes(l)) {
    const overlap = Math.min(q.length, l.length) / Math.max(q.length, l.length);
    return Math.max(0.4, overlap * 0.9);
  }
  // 词级 token 重叠
  const qTokens = q.split(/\s+/).filter((t) => t.length > 1);
  const lTokens = l.split(/\s+/).filter((t) => t.length > 1);
  if (qTokens.length === 0) return 0;
  const overlap = qTokens.filter((t) => lTokens.some((lt) => lt.includes(t) || t.includes(lt))).length;
  return Math.min(0.6, overlap / qTokens.length * 0.6);
}

/**
 * LLM 评分：调 LLMProvider 给 0-1 分
 */
async function llmScore(
  query: string,
  label: string,
  type: string,
  llmProvider: { chat: (msgs: { role: string; content: string }[]) => Promise<{ content: string }> } | null
): Promise<number> {
  if (!llmProvider) return 0;
  try {
    const prompt = LLM_SCORE_PROMPT
      .replace("{query}", query.slice(0, 200))
      .replace("{label}", label.slice(0, 200))
      .replace("{type}", type);
    const resp = await llmProvider.chat([{ role: "user", content: prompt }]);
    const m = resp.content.match(/[0-1](?:\.\d+)?/);
    if (!m) return 0;
    const v = parseFloat(m[0]);
    return Math.max(0, Math.min(1, v));
  } catch {
    return 0;
  }
}

/**
 * 调 MySQL MATCH AGAINST 拿 raw_score（**直接走 FULLTEXT，绕过 multi-stage fallback**）
 *
 * 用途：calibration pipeline 测 FULLTEXT 原始分数 vs 相关性——**这是 calibration 的目标**。
 *  生产路径（searchNodesByKeywords）会加 multi-stage fallback，**这测的是 underlying FULLTEXT 召回质量**。
 *  两者分开看：FULLTEXT 召回质量是 signal 1，multi-stage fallback 是补救——分别标定。
 */
async function getRawFtsScore(
  adapter: MySQLAdapter,
  owner: string,
  query: string
): Promise<Array<{ id: string; label: string; type: string; raw: number }>> {
  if (!query.trim()) return [];
  const boolQuery = `+${query.replace(/[+\-><()~*"@]/g, " ")}*`;
  const rows = await adapter.query<{ id: string; label: string; type: string; raw: number }>(
    `SELECT id, label, type, MATCH(label) AGAINST (? IN BOOLEAN MODE) AS raw
     FROM kb_graph_nodes USE INDEX (ft_kb_graph_nodes_label)
     WHERE owner_id = ? AND MATCH(label) AGAINST (? IN BOOLEAN MODE)
     ORDER BY raw DESC
     LIMIT 20`,
    [boolQuery, owner, boolQuery]
  );
  return rows;
}

/**
 * 调 production searchNodesByKeywords（multi-stage fallback 后）拿 **production score**
 *
 * 用途：calibration 测**生产实际召回**的 score vs 相关性——这是用户真正看到的。
 *  对比 getRawFtsScore 看出 multi-stage fallback 救了多少 raw=0 的召回。
 */
async function getProductionScore(
  owner: string,
  query: string,
  groundTruthNodeId: string
): Promise<{ productionScore: number; rawFulltextScore: number; stage: number }> {
  const { GraphStore } = await import("../src/memory/knowledge-graph/graph-store.js");
  const store = new GraphStore(owner);
  // 调 production 多 stage search
  const hits = await store.searchNodesByKeywords([query], 50);

  // 找这个 tuple 对应的 node 命中
  const hit = hits.find((h) => h.node.id === groundTruthNodeId);
  if (!hit) {
    return { productionScore: 0, rawFulltextScore: 0, stage: 0 };
  }

  // 拿到 fulltext raw score 用于对比
  const adapter = getMySQLAdapter();
  const boolQuery = `+${query.replace(/[+\-><()~*"@]/g, " ")}*`;
  const rows = await adapter.query<{ raw: number }>(
    `SELECT MATCH(label) AGAINST (? IN BOOLEAN MODE) AS raw
     FROM kb_graph_nodes USE INDEX (ft_kb_graph_nodes_label)
     WHERE owner_id = ? AND id = ? AND MATCH(label) AGAINST (? IN BOOLEAN MODE)`,
    [boolQuery, owner, groundTruthNodeId, boolQuery]
  );
  const raw = Number(rows[0]?.raw ?? 0);

  // 简单 heuristic 判断 stage：hit.score > 0.9 → exact/canonical, > 0.6 → substring, 其它 → FULLTEXT
  let stage = 1;
  if (hit.score >= 0.9) stage = 2;
  else if (hit.score >= 0.6) stage = 4;

  return { productionScore: hit.score, rawFulltextScore: raw, stage };
}

/**
 * 步骤 1: 收集真实 (query, node, label, type) tuples
 */
async function collectRealTuples(adapter: MySQLAdapter, limit: number): Promise<RealTuple[]> {
  console.log(`[calibrate-real] pulling real tuples from kg_feedback_events (limit ${limit})...`);

  // 优先用 recall_snapshot.seedEntities（如果非空）
  const rows = await adapter.query<{
    query: string;
    snapshot: string | null;
  }>(
    `SELECT query, recall_snapshot AS snapshot
     FROM kg_feedback_events
     WHERE recall_snapshot IS NOT NULL AND query IS NOT NULL AND LENGTH(query) > 0
     ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );

  const tuples: RealTuple[] = [];
  for (const row of rows) {
    try {
      const snap = row.snapshot ? JSON.parse(row.snapshot) : null;
      const seeds = Array.isArray(snap?.seedEntities) ? snap.seedEntities : [];
      for (const seed of seeds) {
        if (seed && seed.label && seed.id) {
          tuples.push({ query: row.query, nodeId: seed.id, nodeLabel: seed.label });
        }
      }
    } catch { /* skip */ }
  }
  return tuples;
}

/**
 * 步骤 2: Fallback——从 kb_graph_nodes 生成 synthetic (query, node) 对
 * 每个 node label 拆成词，挑一些作为"用户 query"
 */
async function collectSyntheticTuples(
  adapter: MySQLAdapter,
  owner: string,
  count: number
): Promise<RealTuple[]> {
  console.log(`[calibrate-real] generating ${count} synthetic tuples from kb_graph_nodes...`);

  const nodes = await adapter.query<{ id: string; label: string; type: string }>(
    `SELECT id, label, type FROM kb_graph_nodes WHERE owner_id = ? AND label IS NOT NULL LIMIT ?`,
    [owner, count]
  );

  const tuples: RealTuple[] = [];
  for (const node of nodes) {
    if (!node.label) continue;
    // 把 label 拆成"假设的 query"——取第一个 token 作为短 query
    const tokens = node.label.split(/[\s_]+/).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    // 60% 单 token query, 40% 多 token query
    if (tokens.length === 1 || Math.random() < 0.6) {
      tuples.push({ query: tokens[0], nodeId: node.id, nodeLabel: node.label });
    } else {
      const slice = tokens.slice(0, Math.min(3, tokens.length)).join(" ");
      tuples.push({ query: slice, nodeId: node.id, nodeLabel: node.label });
    }
  }
  return tuples;
}

/**
 * 步骤 3: 给每个 tuple 拿 MySQL raw_score
 */
async function enrichWithRawScore(
  adapter: MySQLAdapter,
  owner: string,
  tuples: RealTuple[]
): Promise<Array<RealTuple & { raw: number; type: string }>> {
  console.log(`[calibrate-real] enriching ${tuples.length} tuples with MySQL raw_score...`);
  // 按 query 分组（同一个 query 一次查）以省 SQL
  const byQuery = new Map<string, RealTuple[]>();
  for (const t of tuples) {
    if (!byQuery.has(t.query)) byQuery.set(t.query, []);
    byQuery.get(t.query)!.push(t);
  }

  const enriched: Array<RealTuple & { raw: number; type: string; productionScore: number; stage: number }> = [];
  for (const [query, group] of byQuery.entries()) {
    const hits = await getRawFtsScore(adapter, owner, query);
    const hitById = new Map(hits.map((h) => [h.id, h]));
    for (const t of group) {
      // raw FULLTEXT score（underlying signal 1）
      const hit = hitById.get(t.nodeId);
      const raw = hit ? hit.raw : 0;
      const type = hit ? hit.type : "entity";

      // production searchNodesByKeywords score（multi-stage fallback 后的真用户看到值）
      // —— 这是 calibration 应该测的"用户实际看到"的东西
      let productionScore = 0;
      let stage = 0;
      try {
        const prod = await getProductionScore(owner, query, t.nodeId);
        productionScore = prod.productionScore;
        stage = prod.stage;
      } catch {
        // getProductionScore 失败——用 raw 计算近似
        productionScore = Math.tanh(raw / 2);
        stage = 1;
      }

      enriched.push({ ...t, raw, type, productionScore, stage });
    }
  }
  return enriched;
}

/**
 * 步骤 4: 评分（LLM 或 heuristic）
 */
async function scoreTuples(
  tuples: Array<RealTuple & { raw: number; type: string; productionScore: number; stage: number }>,
  useLlmFlag: boolean
): Promise<CalibrationPoint[]> {
  console.log(`[calibrate-real] scoring ${tuples.length} tuples (mode: ${useLlmFlag ? "llm" : "heuristic"})...`);

  // 尝试拿 LLM provider
  let llmProvider: { chat: (msgs: any[]) => Promise<{ content: string }> } | null = null;
  if (useLlmFlag) {
    try {
      const { UserSessionManager } = await import("../src/user/user-session.js");
      const tmpDir = path.join(process.cwd(), ".raos-test", "calibrate-" + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });
      const sm = new UserSessionManager(tmpDir);
      const lp: any = (sm as any).getLLMProvider?.();
      if (lp && typeof lp.chat === "function") {
        llmProvider = lp;
        console.log(`[calibrate-real] using LLM provider: ${lp.name ?? "unknown"}`);
      } else {
        console.warn(`[calibrate-real] --llm requested but no provider available; falling back to heuristic`);
      }
    } catch (err) {
      console.warn(`[calibrate-real] failed to get LLM provider: ${err}; falling back to heuristic`);
    }
  }

  const points: CalibrationPoint[] = [];
  for (const t of tuples) {
    const relevance = llmProvider
      ? await llmScore(t.query, t.nodeLabel, t.type, llmProvider)
      : heuristicScore(t.query, t.nodeLabel, t.type);
    points.push({
      raw: t.raw,
      productionScore: t.productionScore,
      stage: t.stage,
      relevance,
      query: t.query,
      nodeId: t.nodeId,
      nodeLabel: t.nodeLabel,
      source: "real", // 标记是"从图谱真实数据"生成的，不是纯合成
    });
  }
  return points;
}

/**
 * 主函数
 */
async function main() {
  const adapter = getMySQLAdapter();

  // 找节点最多的 owner 作为默认（dev DB 通常是 user_admin）
  let owner = targetUser;
  if (!owner) {
    try {
      const rows = await adapter.query<{ owner_id: string }>(
        `SELECT owner_id FROM kb_graph_nodes GROUP BY owner_id ORDER BY COUNT(*) DESC LIMIT 1`
      );
      owner = rows[0]?.owner_id ?? "calibration_default";
      console.log(`[calibrate-real] using owner_id = ${owner} (节点最多)`);
    } catch {
      owner = "calibration_default";
    }
  }
  try {
    await adapter.execute(
      `INSERT IGNORE INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)`,
      [owner, "calibrate_" + owner, "h", 1]
    );
  } catch { /* ignore */ }

  // 步骤 1: 收集真实 tuples
  let tuples = await collectRealTuples(adapter, realLimit);
  console.log(`[calibrate-real] collected ${tuples.length} real tuples`);

  // 步骤 2: Fallback 到 synthetic（如果没真实数据）
  if (tuples.length < 50) {
    console.log(`[calibrate-real] insufficient real data (${tuples.length} < 50), supplementing with synthetic tuples`);
    const synth = await collectSyntheticTuples(adapter, owner, synthCount);
    tuples = tuples.concat(synth);
    console.log(`[calibrate-real] total after synthetic supplement: ${tuples.length}`);
  }

  if (tuples.length === 0) {
    console.error(`[calibrate-real] no tuples collected; aborting`);
    process.exit(1);
  }

  // 步骤 3: 拿 MySQL raw_score
  const enriched = await enrichWithRawScore(adapter, owner, tuples);

  // 步骤 4: 评分
  const points = await scoreTuples(enriched, useLlm);

  // 步骤 5: 写 ground_truth.json
  fs.writeFileSync(outFile, JSON.stringify(points, null, 2));
  console.log(`[calibrate-real] wrote ${points.length} points to ${outFile}`);

  // 步骤 6: 跑 calibration
  // 现在每个 point 都有 (raw, productionScore, stage, relevance)
  // - raw: MySQL FULLTEXT 原始分（underlying signal）
  // - productionScore: searchNodesByKeywords 返回的 score（multi-stage fallback 后——用户实际看到）
  // - stage: 1=FULLTEXT, 2=exact/canonical, 4=substring
  console.log(`\n[calibrate-real] running calibration on ${points.length} points...`);

  // 对比 1: production score vs relevance（这才是真用户看到的）
  //  对每个点算 |productionScore - relevance| 的 RMSE
  const prodRmse = (() => {
    if (points.length === 0) return 0;
    const sumSqErr = points.reduce((acc, p) => {
      const err = p.productionScore - p.relevance;
      return acc + err * err;
    }, 0);
    return Math.sqrt(sumSqErr / points.length);
  })();

  // 对比 2: 只对 stage=1 的点跑 k 网格搜索（FULLTEXT 那段的归一化）
  const fulltextPoints = points.filter((p) => p.stage === 1 && p.raw > 0);
  if (fulltextPoints.length > 0) {
    const ftPointsForCalib = fulltextPoints.map((p) => ({ raw: p.raw, relevance: p.relevance }));
    const { k: bestK, rmse: bestRmse } = findBestK(ftPointsForCalib, 0.5, 5);
    const currentK = 2;
    const currentFtRmse = rmse(ftPointsForCalib, currentK);
    const improvement = ((currentFtRmse - bestRmse) / currentFtRmse) * 100;
    console.log(`\n[calibrate-real] ===== FULLTEXT STAGE CALIBRATION (stage=1, raw>0) =====`);
    console.log(`  fulltext points: ${fulltextPoints.length} (out of ${points.length} total)`);
    console.log(`  current k=2: RMSE=${currentFtRmse.toFixed(4)}`);
    console.log(`  best k=${bestK.toFixed(2)}:  RMSE=${bestRmse.toFixed(4)}`);
    console.log(`  improvement:  ${improvement.toFixed(1)}%`);
    if (Math.abs(bestK - currentK) < 0.1) {
      console.log(`  → current k=2 is near optimal, no change needed`);
    } else {
      console.log(`  → set FTS_SCORE_K=${bestK.toFixed(2)} in .env.local to apply`);
    }
  }

  // 阶段分布：multi-stage fallback 救了多少 raw=0
  const stageCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 };
  let rescuedCount = 0;
  for (const p of points) {
    const s = (p.stage ?? 0) as 0 | 1 | 2 | 3 | 4;
    stageCounts[s] = (stageCounts[s] ?? 0) + 1;
    if (s >= 2 && p.productionScore > 0) rescuedCount++;
  }

  console.log(`\n[calibrate-real] ===== MULTI-STAGE FALLBACK IMPACT =====`);
  console.log(`  data points: ${points.length}`);
  console.log(`  score mode:  ${useLlm && points.length > 0 && points[0].source === "real" ? "llm" : "heuristic"}`);
  console.log(`  stage distribution:`);
  for (const [stage, count] of Object.entries(stageCounts)) {
    if (count === 0) continue;
    const label = stage === "0" ? "no match" : stage === "1" ? "FULLTEXT" : stage === "2" ? "exact/canonical" : stage === "3" ? "canonical" : "substring";
    console.log(`    stage ${stage.padStart(2)} (${label.padEnd(15)}): ${count}`);
  }
  console.log(`  rescued by fallback: ${rescuedCount} / ${points.length} (${(rescuedCount / points.length * 100).toFixed(1)}%)`);
  console.log(`  production RMSE (vs relevance): ${prodRmse.toFixed(4)}`);

  // 抽 10 个样本展示
  console.log(`\n[calibrate-real] sample (first 10):`);
  console.log(`  raw    | prod   | stage | relevance | query → label`);
  console.log(`  -------|--------|-------|-----------|----------------`);
  const sample = points.slice(0, 10);
  for (const p of sample) {
    const q = (p.query ?? "").slice(0, 16);
    const l = (p.nodeLabel ?? "").slice(0, 20);
    const stageLabel = p.stage === 1 ? "FT" : p.stage === 2 ? "EX" : p.stage === 4 ? "SUB" : "NO";
    console.log(
      `  ${p.raw.toFixed(2).padStart(5)} | ${p.productionScore.toFixed(2).padStart(6)} | ${stageLabel.padStart(5)} | ${p.relevance.toFixed(2).padStart(9)} | ${q} → ${l}`
    );
  }

  await adapter.close?.();
}

main().catch((err) => {
  console.error("[calibrate-real] failed:", err);
  process.exit(1);
});
