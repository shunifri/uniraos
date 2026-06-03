#!/usr/bin/env tsx
/**
 * P2-CRITICAL-FIX: A/B test graphContext 对 LLM 真实响应的贡献
 *
 * 对每个 query:
 *   A 路径 (no graph): query → FTS top-5 → contextA → LLM
 *   B 路径 (with graph): query → FTS top-5 + BFS subgraph (maxNodes=20) → contextB → LLM
 *
 * Judge (两层):
 *   1. Heuristic: 响应里是否提到 ground-truth 节点 + 邻域节点
 *   2. LLM judge: 用 LLM 评分 (0-1) — 准确性/完整性/无幻觉
 *
 * 数据源: dev MySQL `kb_graph_nodes` label 拆词 → 当 query
 *
 * 输出:
 *   - JSON 到 --out
 *   - stdout markdown 总结
 *
 * 限制 (synthetic):
 *   - query 来自节点 label，跟生产真 query 不完全一样
 *   - 30 queries 限制 (成本控制)
 *   - LLM judge 用同一模型（潜在 bias）— 生产应换不同模型
 */
import { GraphStore } from "../src/memory/knowledge-graph/graph-store.js";
import { extractSubgraph } from "../src/memory/knowledge-graph/bfs-extractor.js";
import { ClaudeProvider } from "../src/llm/claude-provider.js";
import { getMySQLAdapter } from "../src/db/mysql-adapter.js";
import * as fs from "node:fs";

interface QueryItem {
  query: string;
  groundTruthNodeId: string;
  groundTruthLabel: string;
}

interface ABResult {
  query: string;
  groundTruthLabel: string;
  subgraphSize: number;
  responseA: string;
  responseB: string;
  heuristicA: { relevantMentions: number; totalRelevant: number; length: number; hitRate: number };
  heuristicB: { relevantMentions: number; totalRelevant: number; length: number; hitRate: number };
  llmJudgeA: number;
  llmJudgeB: number;
  winner: "A" | "B" | "tie";
  winnerMargin: number;
}

const LLM_CONFIG = {
  type: "claude" as const,
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.kimi.com/coding/",
  model: process.env.LLM_MODEL || "kimi-k2-0711-preview",
  maxContextTokens: 8000,
  timeoutMs: 60_000,
};

async function loadQueries(limit: number, owner: string): Promise<QueryItem[]> {
  const adapter = getMySQLAdapter();
  const rows = owner === "all"
    ? await adapter.query<{ id: string; label: string }>(
        `SELECT id, label FROM kb_graph_nodes
         WHERE LENGTH(label) >= 3 AND LENGTH(label) <= 30
         ORDER BY RAND()
         LIMIT ?`,
        [limit]
      )
    : await adapter.query<{ id: string; label: string }>(
        `SELECT id, label FROM kb_graph_nodes
         WHERE owner_id = ? AND LENGTH(label) >= 3 AND LENGTH(label) <= 30
         ORDER BY RAND()
         LIMIT ?`,
        [owner, limit]
      );
  return rows.map((r) => ({ query: r.label, groundTruthNodeId: r.id, groundTruthLabel: r.label }));
}

function formatContextA(ftsResults: Array<{ node: { label: string; type: string }; score: number }>): string {
  if (ftsResults.length === 0) return "(无检索结果)";
  return ftsResults
    .map((r, i) => `${i + 1}. [${r.node.type}] ${r.node.label} (score=${r.score.toFixed(3)})`)
    .join("\n");
}

function formatContextB(
  ftsResults: Array<{ node: { label: string; type: string }; score: number }>,
  subgraph: { nodes: Array<{ label: string; type: string }>; edges: Array<{ source: string; target: string; type: string; label: string }> }
): string {
  const ftsStr = formatContextA(ftsResults);
  const nodeStr = subgraph.nodes
    .map((n, i) => `${i + 1}. [${n.type}] ${n.label}`)
    .slice(0, 20)
    .join("\n");
  const edgeStr = subgraph.edges
    .map((e) => `- ${e.source} --[${e.type}: ${e.label}]--> ${e.target}`)
    .slice(0, 15)
    .join("\n");
  return `检索结果 (FTS):\n${ftsStr}\n\n知识图谱子图 (${subgraph.nodes.length} 节点, ${subgraph.edges.length} 边):\n${nodeStr}\n\n关系:\n${edgeStr || "(无)"}`;
}

function buildAnswerPrompt(query: string, context: string): string {
  return `你是一个知识助手。基于以下"知识图谱上下文"回答用户问题。

要求:
1. 必须基于上下文回答，**不能编造**上下文中没有的实体
2. 如果上下文不足以回答，直接说"信息不足"
3. 简明扼要 (1-3 句话)
4. 回答中应提及上下文中**相关**的实体

知识图谱上下文:
${context}

用户问题: ${query}

回答:`;
}

function buildJudgePrompt(query: string, response: string, groundTruthLabel: string, relatedLabels: string[]): string {
  return `评估一个知识助手对用户问题的回答质量。

用户问题: ${query}
期望核心答案: ${groundTruthLabel}
相关实体: ${relatedLabels.join("、") || "(无)"}

助手回答: ${response}

按以下 3 维评分 (各 0-1):
1. 准确性 (0-1): 提到的实体是否在相关实体内，不编造
2. 完整性 (0-1): 是否涵盖了核心答案 + 至少一个相关实体
3. 简洁性 (0-1): 1-3 句话，不啰嗦

输出 3 个分数，最后一行格式必须严格: TOTAL=<0-1 之间的小数, 3 维平均>
例如: TOTAL=0.75`;
}

function heuristicJudge(
  response: string,
  groundTruthLabel: string,
  relatedLabels: string[]
): { relevantMentions: number; totalRelevant: number; length: number; hitRate: number } {
  const allRelevant = [groundTruthLabel, ...relatedLabels].filter(Boolean);
  const resp = response.toLowerCase();
  const mentions = allRelevant.filter((l) => resp.includes(l.toLowerCase())).length;
  return {
    relevantMentions: mentions,
    totalRelevant: allRelevant.length,
    length: response.length,
    hitRate: allRelevant.length > 0 ? mentions / allRelevant.length : 0,
  };
}

async function llmJudge(
  llm: ClaudeProvider,
  query: string,
  response: string,
  groundTruthLabel: string,
  relatedLabels: string[]
): Promise<number> {
  try {
    const prompt = buildJudgePrompt(query, response, groundTruthLabel, relatedLabels);
    const r = await llm.chat([{ role: "user", content: prompt }], { maxTokens: 100 });
    const m = r.content.match(/TOTAL=([\d.]+)/);
    if (m) {
      const score = parseFloat(m[1]);
      if (score >= 0 && score <= 1) return score;
    }
    console.warn(`[judge] no TOTAL in response: ${r.content.slice(0, 100)}`);
    return 0.0;
  } catch (err: any) {
    console.warn(`[judge] failed: ${err.message?.slice(0, 100)}`);
    return 0.0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const count = args[0] ? parseInt(args[0], 10) : 20;
  const owner = args[1] || "user_admin";
  const outFile = args[2] || "ab-test-llm-results.json";

  console.log(`[ab-llm] running A/B test on ${count} queries (LLM judge) against ${owner}\n`);

  const graph = new GraphStore(owner);
  const llm = new ClaudeProvider(LLM_CONFIG);

  const queries = await loadQueries(count, owner);
  console.log(`[ab-llm] loaded ${queries.length} queries\n`);

  if (queries.length === 0) {
    console.error("[ab-llm] no queries to test");
    process.exit(1);
  }

  const results: ABResult[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`[${i + 1}/${queries.length}] ${q.query} ... `);

    // 1. 拉 FTS
    const ftsResults = await graph.searchNodesByKeywords([q.query], 5);

    // 2. 拉 BFS 子图
    let subgraph = { nodes: [] as Array<{ label: string; type: string }>, edges: [] as Array<{ source: string; target: string; type: string; label: string }> };
    try {
      subgraph = await extractSubgraph(graph, q.query, { maxDepth: 2, maxNodes: 20 });
    } catch (err) {
      console.warn("subgraph err:", (err as any).message);
    }

    // 邻域节点 label (B 路径 expected 实体)
    const relatedLabels = subgraph.nodes.map((n) => n.label).filter((l) => l !== q.groundTruthLabel);

    // 3. LLM call A
    const contextA = formatContextA(ftsResults);
    const rA = await llm.chat([{ role: "user", content: buildAnswerPrompt(q.query, contextA) }], { maxTokens: 300 });

    // 4. LLM call B
    const contextB = formatContextB(ftsResults, subgraph);
    const rB = await llm.chat([{ role: "user", content: buildAnswerPrompt(q.query, contextB) }], { maxTokens: 300 });

    // 5. Heuristic judge
    const hA = heuristicJudge(rA.content, q.groundTruthLabel, relatedLabels);
    const hB = heuristicJudge(rB.content, q.groundTruthLabel, relatedLabels);

    // 6. LLM judge
    const jA = await llmJudge(llm, q.query, rA.content, q.groundTruthLabel, relatedLabels);
    const jB = await llmJudge(llm, q.query, rB.content, q.groundTruthLabel, relatedLabels);

    // 7. Winner by LLM judge
    let winner: "A" | "B" | "tie" = "tie";
    if (jA > jB + 0.05) winner = "A";
    else if (jB > jA + 0.05) winner = "B";

    results.push({
      query: q.query,
      groundTruthLabel: q.groundTruthLabel,
      subgraphSize: subgraph.nodes.length,
      responseA: rA.content,
      responseB: rB.content,
      heuristicA: hA,
      heuristicB: hB,
      llmJudgeA: jA,
      llmJudgeB: jB,
      winner,
      winnerMargin: Math.abs(jB - jA),
    });

    process.stdout.write(`A=${jA.toFixed(2)} B=${jB.toFixed(2)} winner=${winner} (hA=${hA.hitRate.toFixed(2)} hB=${hB.hitRate.toFixed(2)})\n`);

    // 防止 API 限流
    await new Promise((r) => setTimeout(r, 300));
  }

  // 8. Aggregate
  const winsA = results.filter((r) => r.winner === "A").length;
  const winsB = results.filter((r) => r.winner === "B").length;
  const ties = results.filter((r) => r.winner === "tie").length;
  const avgJudgeA = results.reduce((s, r) => s + r.llmJudgeA, 0) / results.length;
  const avgJudgeB = results.reduce((s, r) => s + r.llmJudgeB, 0) / results.length;
  const avgHitA = results.reduce((s, r) => s + r.heuristicA.hitRate, 0) / results.length;
  const avgHitB = results.reduce((s, r) => s + r.heuristicB.hitRate, 0) / results.length;
  const avgLenA = results.reduce((s, r) => s + r.heuristicA.length, 0) / results.length;
  const avgLenB = results.reduce((s, r) => s + r.heuristicB.length, 0) / results.length;

  console.log(`\n[ab-llm] ===== AGGREGATE (${results.length} queries) =====`);
  console.log(`  win rate: A=${winsA} (${(winsA / results.length * 100).toFixed(1)}%)  B=${winsB} (${(winsB / results.length * 100).toFixed(1)}%)  tie=${ties}`);
  console.log(`  avg LLM judge: A=${avgJudgeA.toFixed(3)}  B=${avgJudgeB.toFixed(3)}  delta=${(avgJudgeB - avgJudgeA).toFixed(3)}`);
  console.log(`  avg heuristic hit rate: A=${avgHitA.toFixed(3)}  B=${avgHitB.toFixed(3)}`);
  console.log(`  avg response length: A=${avgLenA.toFixed(0)} chars  B=${avgLenB.toFixed(0)} chars`);

  const recommendation = avgJudgeB - avgJudgeA > 0.05 ? "B (with graph) 显著更好" : avgJudgeB > avgJudgeA ? "B 略好 (不显著)" : "无明显差异";
  console.log(`\n[ab-llm] ===== RECOMMENDATION =====`);
  console.log(`  ${recommendation}`);

  // Save
  fs.writeFileSync(outFile, JSON.stringify({ summary: { winsA, winsB, ties, avgJudgeA, avgJudgeB, avgHitA, avgHitB, avgLenA, avgLenB, recommendation }, results }, null, 2));
  console.log(`\n[ab-llm] wrote ${outFile}`);
}

main().catch((e) => { console.error("[ab-llm] FATAL:", e); process.exit(1); });
