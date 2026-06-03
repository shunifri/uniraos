/**
 * P2-7 标定（v3 review）：FULLTEXT relevance 评分校准脚本
 *
 * 用法：
 *   npx tsx scripts/calibrate-fts-score.ts [--data path/to/data.json] [--k-min 0.5] [--k-max 5]
 *
 * 输入数据格式（JSON 数组，每条是 (raw MySQL score, human-judged relevance 0-1)）：
 * [
 *   { "raw": 0.5, "relevance": 0.3 },
 *   { "raw": 1.0, "relevance": 0.5 },
 *   ...
 * ]
 *
 * 标定逻辑：
 *   对每个候选 k，tanh(raw / k) 计算预测值，squared error 算 RMSE
 *   选 RMSE 最小的 k 作为推荐值
 *
 * 真实数据收集方法（生产用）：
 *   1. 拉 1000 个用户真实 query + 召回的前 5 个节点
 *   2. 对每个 (query, node) 对，让 ops 或 LLM 打分 0-1 relevance
 *   3. 跑该节点的 MySQL MATCH AGAINST 拿 raw score
 *   4. 把 (raw, relevance) 对喂给本脚本
 *   5. 选出的 k 写到 .env.local: FTS_SCORE_K=<k>
 *
 * 默认用合成 ground truth（生产标定前先用这个验证流程通畅）。
 */

import * as fs from "fs";
import * as path from "path";

export interface GroundTruthPoint {
  raw: number;
  relevance: number; // 0-1
}

/**
 * 默认合成 ground truth：基于 FTS relevance 经验值的"看起来对"的标定
 * - 噪声（raw < 0.3）应该 < 0.2 relevance
 * - 弱命中（raw 0.5-1）应该在 0.3-0.5
 * - 中等（raw 1-2）应该在 0.5-0.8
 * - 强命中（raw 2-4）应该在 0.8-0.95
 * - 极强（raw > 4）应该趋近 0.99
 *
 * 真实数据收集后，应该替换这个数组。
 */
const DEFAULT_SYNTHETIC_GROUND_TRUTH: GroundTruthPoint[] = [
  { raw: 0.1, relevance: 0.05 },
  { raw: 0.2, relevance: 0.10 },
  { raw: 0.3, relevance: 0.18 },
  { raw: 0.5, relevance: 0.30 },
  { raw: 0.7, relevance: 0.40 },
  { raw: 1.0, relevance: 0.50 },
  { raw: 1.3, relevance: 0.60 },
  { raw: 1.5, relevance: 0.68 },
  { raw: 1.7, relevance: 0.74 },
  { raw: 2.0, relevance: 0.80 },
  { raw: 2.5, relevance: 0.87 },
  { raw: 3.0, relevance: 0.92 },
  { raw: 4.0, relevance: 0.96 },
  { raw: 5.0, relevance: 0.98 },
  { raw: 6.0, relevance: 0.99 },
  { raw: 10.0, relevance: 0.999 },
];

/**
 * 给定 raw score 和 k，预测归一化分数
 */
export function predict(raw: number, k: number): number {
  if (raw <= 0) return 0;
  return Math.tanh(raw / k);
}

/**
 * 算 RMSE
 */
export function rmse(points: GroundTruthPoint[], k: number): number {
  if (points.length === 0) return Infinity;
  const sumSqErr = points.reduce((acc, p) => {
    const pred = predict(p.raw, k);
    const err = pred - p.relevance;
    return acc + err * err;
  }, 0);
  return Math.sqrt(sumSqErr / points.length);
}

/**
 * 找最优 k
 */
export function findBestK(points: GroundTruthPoint[], kMin: number, kMax: number, step: number = 0.05): { k: number; rmse: number } {
  let bestK = kMin;
  let bestRmse = rmse(points, kMin);
  for (let k = kMin; k <= kMax; k += step) {
    const r = rmse(points, k);
    if (r < bestRmse) {
      bestRmse = r;
      bestK = k;
    }
  }
  return { k: bestK, rmse: bestRmse };
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  let dataPath: string | null = null;
  let kMin = 0.5;
  let kMax = 5.0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data" && i + 1 < args.length) {
      dataPath = args[++i];
    } else if (args[i] === "--k-min" && i + 1 < args.length) {
      kMin = parseFloat(args[++i]);
    } else if (args[i] === "--k-max" && i + 1 < args.length) {
      kMax = parseFloat(args[++i]);
    }
  }

  // 加载数据
  let points: GroundTruthPoint[];
  if (dataPath) {
    const absPath = path.resolve(dataPath);
    const raw = fs.readFileSync(absPath, "utf-8");
    points = JSON.parse(raw) as GroundTruthPoint[];
    console.log(`[calibrate] loaded ${points.length} points from ${absPath}`);
  } else {
    points = DEFAULT_SYNTHETIC_GROUND_TRUTH;
    console.log(`[calibrate] using default synthetic ground truth (${points.length} points)`);
    console.log(`[calibrate] (生产用 --data path/to/real-data.json 传真实标定数据)`);
  }

  if (points.length === 0) {
    console.error("[calibrate] no data points provided");
    process.exit(1);
  }

  // 算当前 k=2 (production default) 的 RMSE
  const currentK = 2;
  const currentRmse = rmse(points, currentK);
  console.log(`\n[calibrate] current default k=${currentK}, RMSE=${currentRmse.toFixed(4)}`);

  // 网格搜索最优 k
  const { k: bestK, rmse: bestRmse } = findBestK(points, kMin, kMax);
  console.log(`[calibrate] best k in [${kMin}, ${kMax}]: k=${bestK.toFixed(2)}, RMSE=${bestRmse.toFixed(4)}`);

  // 展示关键 raw 值的预测对比
  console.log(`\n[calibrate] prediction comparison (raw → predicted at best k vs current k):`);
  console.log(`  raw    | best k=${bestK.toFixed(2)} | current k=${currentK} | ground truth`);
  console.log(`  -------|----------------|---------------|--------------`);
  for (const p of points) {
    const predBest = predict(p.raw, bestK);
    const predCurrent = predict(p.raw, currentK);
    const diff = predBest - p.relevance;
    const sign = diff >= 0 ? " " : "-";
    console.log(
      `  ${p.raw.toFixed(2).padStart(5)} | ${predBest.toFixed(4).padStart(14)} | ${predCurrent.toFixed(4).padStart(13)} | ${p.relevance.toFixed(4)} (${sign}${Math.abs(diff).toFixed(4)})`
    );
  }

  // 给出建议
  console.log(`\n[calibrate] recommendation:`);
  if (Math.abs(bestK - currentK) < 0.1) {
    console.log(`  ✓ current k=${currentK} is already near optimal (RMSE diff < 0.1)`);
    console.log(`  → keep k=${currentK} in production`);
  } else {
    console.log(`  ⚠ current k=${currentK} is suboptimal, best k=${bestK.toFixed(2)}`);
    console.log(`  → set FTS_SCORE_K=${bestK.toFixed(2)} in .env.local`);
    console.log(`  → or pass { k: ${bestK.toFixed(2)} } to normalizeFtsScore in code`);
  }

  // 给出改善率
  const improvement = ((currentRmse - bestRmse) / currentRmse) * 100;
  if (improvement > 1) {
    console.log(`  → expected RMSE improvement: ${improvement.toFixed(1)}%`);
  } else {
    console.log(`  → expected RMSE improvement: ${improvement.toFixed(2)}% (negligible, keep current k)`);
  }
}

// 只在直接调用时跑 main()（被 import 时不跑）
// ESM 模式：import.meta.url === pathToFileURL(process.argv[1]).href
import { pathToFileURL } from "url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[calibrate] failed:", err);
    process.exit(1);
  });
}
