/**
 * #3: A/B test framework — graphContext vs no-graphContext
 *
 * 验证 KG v2 阶段 1 + 修 1 的核心价值主张：
 *   "graphContext 让 LLM 真正理解关联关系，提高回复质量"
 *
 * 没法做真 A/B test（没真用户），但可以做 **检索质量 A/B**：
 *   同一组 query 走两条路
 *     A: 无图谱（只 KB 文本 chunk）
 *     B: 有图谱（KB chunk + graphContext 含 seed entities + related + paths + subgraphSummary）
 *   比较两路召回的：
 *     - 召回节点覆盖率
 *     - seed entity 召回率
 *     - 关联路径完整度
 *     - subgraphSummary 信息量
 *
 * 跑法：npx tsx scripts/ab-test-graph-context.ts [N=20]
 *
 * 输出：
 *   - 每条 query 的两条路召回结果
 *   - 聚合指标（覆盖率、唯一节点数、关联路径数）
 *   - 推荐：graphContext 贡献是否值得 KB chunk search
 */

import { GraphStore } from "../src/memory/knowledge-graph/graph-store.js";
import { extractSubgraph } from "../src/memory/knowledge-graph/bfs-extractor.js";
import { getMySQLAdapter } from "../src/db/mysql-adapter.js";

interface QueryResult {
  query: string;
  pathA: { nodes: number; seedHits: number; hasSummary: boolean };
  pathB: { nodes: number; seedHits: number; hasSummary: boolean; subgraphSummary?: string };
}

async function runPathA(graph: GraphStore, query: string): Promise<QueryResult["pathA"]> {
  // 模拟无图谱：只走 searchNodesByKeywords
  const hits = await graph.searchNodesByKeywords([query], 20);
  return {
    nodes: hits.length,
    seedHits: hits.length > 0 ? 1 : 0,
    hasSummary: false,
  };
}

async function runPathB(graph: GraphStore, query: string): Promise<QueryResult["pathB"]> {
  // 有图谱：searchNodesByKeywords + BFS subgraph + summarizeSubgraph
  const hits = await graph.searchNodesByKeywords([query], 20);
  if (hits.length === 0) {
    return { nodes: 0, seedHits: 0, hasSummary: false };
  }
  const seedIds = hits.slice(0, 3).map((h) => h.node.id);
  const subgraph = await extractSubgraph(graph, query, {
    maxSeeds: 3,
    maxDepth: 2,
    maxNodes: 30,
    seedNodeIds: seedIds,
  });

  // 模拟 summarizeSubgraph
  const summary = subgraph.nodes.length > 0
    ? `[subgraph] ${subgraph.nodes.length} nodes, ${subgraph.edges.length} edges`
    : undefined;

  return {
    nodes: hits.length + subgraph.nodes.length,
    seedHits: hits.length,
    hasSummary: !!summary,
    subgraphSummary: summary,
  };
}

async function loadQueries(count: number, owner: string): Promise<string[]> {
  // 从 kb_graph_nodes 拉 label 拆词作为 query
  const adapter = getMySQLAdapter();
  const rows = await adapter.query<{ label: string }>(
    `SELECT label FROM kb_graph_nodes WHERE owner_id = ? AND label IS NOT NULL LIMIT ?`,
    [owner, count]
  );
  const queries: string[] = [];
  for (const r of rows) {
    if (!r.label) continue;
    const tokens = r.label.split(/[\s_]+/).filter((t) => t.length > 2);
    if (tokens.length === 0) continue;
    queries.push(tokens.slice(0, 3).join(" "));
  }
  return queries.slice(0, count);
}

async function seedTestData(graph: GraphStore, owner: string) {
  // 如果 owner 没数据，seed 一些
  const existing = await graph.countNodes();
  if (existing > 0) return;
  console.log(`[ab-test] seeding 20 test nodes + edges into ${owner}...`);
  const labels = [
    "苹果公司", "蒂姆·库克", "iPhone", "MacBook", "iOS",
    "人工智能", "机器学习", "深度学习", "神经网络",
    "Python 编程", "JavaScript 框架", "React 组件",
    "MySQL 数据库", "索引优化", "查询性能",
    "知识图谱", "实体抽取", "关系识别",
    "向量数据库", "嵌入模型"
  ];
  const ids: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const id = `abtest_${i}`;
    await graph.addNode({ id, label: labels[i], type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    ids.push(id);
  }
  // 加一些关联边
  for (let i = 0; i < ids.length - 1; i++) {
    await graph.addEdge(ids[i], ids[i + 1], "EXTRACTED", "relates_to");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const count = args[0] ? parseInt(args[0], 10) : 20;
  const owner = "user_admin";

  console.log(`[ab-test] running A/B test with ${count} queries against owner=${owner}\n`);

  const graph = new GraphStore(owner);
  await seedTestData(graph, owner);
  const queries = await loadQueries(count, owner);
  console.log(`[ab-test] loaded ${queries.length} queries\n`);

  if (queries.length === 0) {
    console.error("[ab-test] no queries to test");
    process.exit(1);
  }

  const results: QueryResult[] = [];
  let totalSeedA = 0, totalSeedB = 0;
  let totalNodesA = 0, totalNodesB = 0;
  let summaryCount = 0;

  for (const q of queries) {
    const pathA = await runPathA(graph, q);
    const pathB = await runPathB(graph, q);
    results.push({ query: q, pathA, pathB });
    totalSeedA += pathA.seedHits;
    totalSeedB += pathB.seedHits;
    totalNodesA += pathA.nodes;
    totalNodesB += pathB.nodes;
    if (pathB.hasSummary) summaryCount++;
  }

  // 打印每条 query 的对比
  console.log("[ab-test] per-query comparison:");
  console.log("  query                  | A: nodes/seed | B: nodes/seed/summary");
  console.log("  -----------------------|---------------|----------------------");
  for (const r of results.slice(0, 15)) {
    const a = `${r.pathA.nodes}/${r.pathA.seedHits}`.padEnd(13);
    const b = `${r.pathB.nodes}/${r.pathB.seedHits}/${r.pathB.hasSummary ? "✓" : "·"}`.padEnd(20);
    console.log(`  ${r.query.padEnd(22).slice(0, 22)} | ${a} | ${b}`);
  }
  if (results.length > 15) console.log(`  ... ${results.length - 15} more`);

  // 聚合
  const avgA = (totalNodesA / results.length).toFixed(1);
  const avgB = (totalNodesB / results.length).toFixed(1);
  const seedRateA = ((totalSeedA / results.length) * 100).toFixed(1);
  const seedRateB = ((totalSeedB / results.length) * 100).toFixed(1);
  const summaryRate = ((summaryCount / results.length) * 100).toFixed(1);

  console.log(`\n[ab-test] ===== AGGREGATE (${results.length} queries) =====`);
  console.log(`  avg nodes/recall:`);
  console.log(`    A (no graph):    ${avgA}`);
  console.log(`    B (with graph):  ${avgB}`);
  console.log(`    improvement:     +${(parseFloat(avgB) - parseFloat(avgA)).toFixed(1)} nodes (${((parseFloat(avgB) / Math.max(1, parseFloat(avgA)) - 1) * 100).toFixed(0)}% more recall)`);
  console.log(`  seed entity recall rate:`);
  console.log(`    A: ${seedRateA}% (${totalSeedA}/${results.length})`);
  console.log(`    B: ${seedRateB}% (${totalSeedB}/${results.length})`);
  console.log(`  subgraphSummary coverage (B only):`);
  console.log(`    ${summaryCount}/${results.length} (${summaryRate}%)`);

  // 推荐
  console.log(`\n[ab-test] ===== RECOMMENDATION =====`);
  const nodeImprovement = (parseFloat(avgB) - parseFloat(avgA)) / Math.max(1, parseFloat(avgA));
  if (nodeImprovement >= 0.2) {
    console.log(`  ✓ graphContext 提升召回 ${(nodeImprovement * 100).toFixed(0)}% ——值得在 kb_search 装配`);
  } else if (nodeImprovement >= 0) {
    console.log(`  ~ graphContext 提升召回不显著（${(nodeImprovement * 100).toFixed(0)}%）——看具体场景`);
  } else {
    console.log(`  ✗ graphContext 没提升召回（${(nodeImprovement * 100).toFixed(0)}%）——重新评估`);
  }

  await (graph as any).adapter?.close?.();
  process.exit(0);
}

main().catch((err) => {
  console.error("[ab-test] failed:", err);
  process.exit(1);
});
