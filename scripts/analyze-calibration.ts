/**
 * Analyze a ground_truth.json in detail:
 * - Distribution of raw scores
 * - Distribution of relevance
 * - Raw vs relevance correlation
 * - RMSE breakdown by raw score bucket
 * - Best k with finer step
 *
 * Usage: npx tsx scripts/analyze-calibration.ts /tmp/real-gt.json
 */

import * as fs from "fs";

interface Point {
  raw: number;
  productionScore: number;
  stage: number;
  relevance: number;
  query?: string;
  nodeLabel?: string;
}

function predict(raw: number, k: number): number {
  if (raw <= 0) return 0;
  return Math.tanh(raw / k);
}

function rmse(points: Point[], k: number): number {
  if (points.length === 0) return Infinity;
  const sumSqErr = points.reduce((acc, p) => {
    const err = predict(p.raw, k) - p.relevance;
    return acc + err * err;
  }, 0);
  return Math.sqrt(sumSqErr / points.length);
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function correlation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    denomX += (xs[i] - meanX) ** 2;
    denomY += (ys[i] - meanY) ** 2;
  }
  return num / Math.sqrt(denomX * denomY);
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/analyze-calibration.ts <ground_truth.json>");
    process.exit(1);
  }
  const points: Point[] = JSON.parse(fs.readFileSync(path, "utf-8"));
  console.log(`[analyze] loaded ${points.length} points from ${path}\n`);

  // 1. Raw score distribution
  const raws = points.map((p) => p.raw);
  console.log(`[analyze] ===== RAW SCORE DISTRIBUTION =====`);
  console.log(`  min:    ${Math.min(...raws).toFixed(3)}`);
  console.log(`  p25:    ${percentile(raws, 0.25).toFixed(3)}`);
  console.log(`  p50:    ${percentile(raws, 0.5).toFixed(3)}`);
  console.log(`  p75:    ${percentile(raws, 0.75).toFixed(3)}`);
  console.log(`  max:    ${Math.max(...raws).toFixed(3)}`);
  console.log(`  mean:   ${(raws.reduce((a, b) => a + b, 0) / raws.length).toFixed(3)}`);

  // histogram
  const buckets = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 10];
  const hist = new Array(buckets.length - 1).fill(0);
  for (const r of raws) {
    for (let i = 0; i < buckets.length - 1; i++) {
      if (r >= buckets[i] && r < buckets[i + 1]) {
        hist[i]++;
        break;
      }
    }
  }
  console.log(`  histogram:`);
  for (let i = 0; i < buckets.length - 1; i++) {
    const lo = buckets[i];
    const hi = buckets[i + 1];
    const count = hist[i];
    const bar = "█".repeat(Math.round(count / raws.length * 50));
    console.log(`    [${lo.toString().padStart(4)}-${hi.toString().padStart(4)}] ${count.toString().padStart(3)} ${bar}`);
  }

  // 2. Relevance distribution
  const relevs = points.map((p) => p.relevance);
  console.log(`\n[analyze] ===== RELEVANCE DISTRIBUTION =====`);
  console.log(`  min:  ${Math.min(...relevs).toFixed(3)}`);
  console.log(`  max:  ${Math.max(...relevs).toFixed(3)}`);
  console.log(`  mean: ${(relevs.reduce((a, b) => a + b, 0) / relevs.length).toFixed(3)}`);

  // 3. Correlation between raw and relevance
  const corr = correlation(raws, relevs);
  console.log(`\n[analyze] ===== CORRELATION =====`);
  console.log(`  Pearson r(raw, relevance): ${corr.toFixed(4)}`);
  if (corr < 0.3) console.log(`  → weak signal: raw score is not very predictive of relevance`);
  else if (corr < 0.6) console.log(`  → moderate signal`);
  else console.log(`  → strong signal: raw score reliably ranks relevance`);

  // 4. RMSE by raw score bucket
  console.log(`\n[analyze] ===== RMSE BY RAW BUCKET =====`);
  for (let i = 0; i < buckets.length - 1; i++) {
    const lo = buckets[i];
    const hi = buckets[i + 1];
    const sub = points.filter((p) => p.raw >= lo && p.raw < hi);
    if (sub.length === 0) continue;
    const r2 = rmse(sub, 2);
    const r1_1 = rmse(sub, 1.1);
    console.log(`  [${lo.toString().padStart(4)}-${hi.toString().padStart(4)}] n=${sub.length.toString().padStart(3)} | k=2 RMSE=${r2.toFixed(4)} | k=1.1 RMSE=${r1_1.toFixed(4)}`);
  }

  // 5. Best k with finer step
  console.log(`\n[analyze] ===== FINE-GRAINED K SEARCH =====`);
  let bestK = 1;
  let bestRmse = rmse(points, 1);
  for (let k = 0.5; k <= 5; k += 0.1) {
    const r = rmse(points, k);
    if (r < bestRmse) {
      bestRmse = r;
      bestK = k;
    }
  }
  console.log(`  best k:   ${bestK.toFixed(2)}  RMSE=${bestRmse.toFixed(4)}`);
  console.log(`  current:   2.00  RMSE=${rmse(points, 2).toFixed(4)}`);
  console.log(`  baseline:  1.50  RMSE=${rmse(points, 1.5).toFixed(4)}`);
  console.log(`  improvement: ${((rmse(points, 2) - bestRmse) / rmse(points, 2) * 100).toFixed(2)}%`);

  // 6. Sample of high-error points (for debugging)
  console.log(`\n[analyze] ===== TOP 10 HIGHEST-ERROR POINTS (k=${bestK.toFixed(2)}) =====`);
  const errors = points.map((p) => ({
    ...p,
    pred: predict(p.raw, bestK),
    err: Math.abs(predict(p.raw, bestK) - p.relevance),
  }));
  errors.sort((a, b) => b.err - a.err);
  for (const e of errors.slice(0, 10)) {
    console.log(`  raw=${e.raw.toFixed(2)} truth=${e.relevance.toFixed(2)} pred=${e.pred.toFixed(2)} | ${e.query} → ${e.nodeLabel}`);
  }
}

main();
