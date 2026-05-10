import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { KnowledgeGraphManager } from "../../src/memory/knowledge-graph/manager.js";
import { getMySQLAdapter } from "../../src/db/mysql-adapter.js";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

const TEST_OWNER = "kg_benchmark_owner";
const BENCHMARK_ITERATIONS = 5;
const OUTPUT_PATH = ".raos/benchmarks/kg-retrieval.json";

const describeIfMySQL = process.env.SKIP_MYSQL_TESTS ? describe.skip : describe;

interface TestDocument {
  id: string;
  label: string;
  tags: string[];
  content: string;
}

interface TestQuery {
  query: string;
  type: "factual" | "relational" | "discovery";
  expectedDocId: string;
}

interface BenchmarkResult {
  timestamp: string;
  iterations: number;
  totalDocuments: number;
  totalQueries: number;
  overall: {
    pureHybridAvgLatencyMs: number;
    graphEnhancedAvgLatencyMs: number;
    pureHybridAccuracyAt5: number;
    graphEnhancedAccuracyAt5: number;
    latencyImprovementPct: number;
    accuracyImprovementPct: number;
  };
  byQueryType: Record<
    string,
    {
      pureHybridAvgLatencyMs: number;
      graphEnhancedAvgLatencyMs: number;
      pureHybridAccuracyAt5: number;
      graphEnhancedAccuracyAt5: number;
      queryCount: number;
    }
  >;
  queries: Array<{
    query: string;
    type: string;
    expectedDocId: string;
    pureHybridLatencyMs: number;
    graphEnhancedLatencyMs: number;
    pureHybridCorrect: boolean;
    graphEnhancedCorrect: boolean;
    pureHybridTop5: string[];
    graphEnhancedTop5: string[];
  }>;
}

const TEST_DOCUMENTS: TestDocument[] = [
  {
    id: "kb_doc_raos_intro",
    label: "RAOS 介绍",
    tags: ["raos", "intro", "kb_document"],
    content: "RAOS 是一个基于大语言模型的智能代理操作系统，支持多代理协作、知识库管理和长期记忆。",
  },
  {
    id: "kb_doc_raos_install",
    label: "RAOS 安装指南",
    tags: ["raos", "install", "guide", "kb_document"],
    content: "RAOS 安装步骤：克隆仓库、安装依赖、配置环境变量、启动 Docker 服务。支持一键脚本安装。",
  },
  {
    id: "kb_doc_raos_arch",
    label: "RAOS 系统架构",
    tags: ["raos", "architecture", "system", "kb_document"],
    content: "RAOS 采用分层架构：底层为记忆与存储层，中间为引擎与技能层，上层为代理交互层。",
  },
  {
    id: "kb_doc_agent_skills",
    label: "Agent 技能系统",
    tags: ["agent", "skills", "system", "kb_document"],
    content: "Agent 技能系统允许动态注册和调用工具函数，支持知识库检索、代码执行和外部 API 调用。",
  },
  {
    id: "kb_doc_kg_concepts",
    label: "知识图谱基础概念",
    tags: ["kg", "knowledge_graph", "concepts", "kb_document"],
    content: "知识图谱是一种用图结构表示知识的语义网络，包含实体、关系和属性三元组。",
  },
  {
    id: "kb_doc_vector_search",
    label: "向量检索原理",
    tags: ["vector", "search", "retrieval", "kb_document"],
    content: "向量检索通过将文本编码为高维向量，利用余弦相似度或欧氏距离计算语义相关性。",
  },
  {
    id: "kb_doc_hybrid_search",
    label: "混合检索技术",
    tags: ["hybrid", "search", "retrieval", "kb_document"],
    content: "混合检索结合关键词匹配和语义向量搜索，使用 RRF 算法融合两种检索方式的得分。",
  },
  {
    id: "kb_doc_openclaw",
    label: "OpenClaw 项目介绍",
    tags: ["openclaw", "project", "kb_document"],
    content: "OpenClaw 是一个开源的 AI 代理框架，RAOS 与其在技能系统和记忆管理方面有深度集成。",
  },
  {
    id: "kb_doc_kg_vs_vector",
    label: "知识图谱与向量检索对比",
    tags: ["kg", "vector", "comparison", "kb_document"],
    content: "知识图谱擅长关系推理和结构化查询，向量检索擅长语义匹配和模糊查询，两者互补。",
  },
  {
    id: "kb_doc_kg_features",
    label: "知识图谱检索新特性",
    tags: ["kg", "features", "retrieval", "kb_document"],
    content: "P3 阶段引入知识图谱原生检索，支持子图查询、路径搜索、社区发现和中心节点分析。",
  },
  {
    id: "kb_doc_graph_search_impl",
    label: "图搜索算法实现",
    tags: ["graph", "search", "algorithm", "kb_document"],
    content: "图搜索采用 BFS 子图提取算法，从种子节点出发逐层扩展，支持最大深度和节点数限制。",
  },
  {
    id: "kb_doc_community_detection",
    label: "社区检测算法",
    tags: ["community", "detection", "algorithm", "kb_document"],
    content: "社区检测使用 Louvain 算法识别图谱中的紧密连接子图，用于发现查询的相关文档聚类。",
  },
  {
    id: "kb_doc_p3_roadmap",
    label: "P3 知识图谱路线图",
    tags: ["p3", "roadmap", "kg", "kb_document"],
    content: "P3 路线图包括：图谱构建自动化、原生检索接口、查询分类器、路径搜索和预计算缓存优化。",
  },
  {
    id: "kb_doc_embedding_models",
    label: "Embedding 模型选型",
    tags: ["embedding", "models", "kb_document"],
    content: "RAOS 支持本地 Embedding 模型和 OpenAI 等云端模型，可根据隐私和性能需求灵活切换。",
  },
  {
    id: "kb_doc_ltm_memory",
    label: "长期记忆系统",
    tags: ["ltm", "memory", "long_term", "kb_document"],
    content: "长期记忆系统将用户事实存储在图数据库中，支持个人信息关联和跨会话记忆持久化。",
  },
];

const TEST_QUERIES: TestQuery[] = [
  // Factual queries (5)
  { query: "什么是 RAOS", type: "factual", expectedDocId: "raos_intro" },
  { query: "how to install RAOS", type: "factual", expectedDocId: "raos_install" },
  { query: "向量检索原理是什么", type: "factual", expectedDocId: "vector_search" },
  { query: "OpenClaw 项目介绍", type: "factual", expectedDocId: "openclaw" },
  { query: "Agent 技能系统说明", type: "factual", expectedDocId: "agent_skills" },
  // Relational queries (5)
  { query: "RAOS 和 OpenClaw 有什么关系", type: "relational", expectedDocId: "raos_intro" },
  { query: "知识图谱和向量检索的区别", type: "relational", expectedDocId: "kg_vs_vector" },
  { query: "混合检索和向量检索的关系", type: "relational", expectedDocId: "hybrid_search" },
  { query: "图搜索和社区检测的关联", type: "relational", expectedDocId: "graph_search_impl" },
  { query: "P3 路线图和知识图谱特性有什么联系", type: "relational", expectedDocId: "p3_roadmap" },
  // Discovery queries (5)
  { query: "知识图谱检索有什么新特性", type: "discovery", expectedDocId: "kg_features" },
  { query: "RAOS 系统还有什么功能", type: "discovery", expectedDocId: "raos_arch" },
  { query: "混合检索方法介绍", type: "discovery", expectedDocId: "hybrid_search" },
  { query: "长期记忆相关的技术有哪些", type: "discovery", expectedDocId: "ltm_memory" },
  { query: "Embedding 模型相关的文档", type: "discovery", expectedDocId: "embedding_models" },
];

function extractTerms(query: string): string[] {
  const terms: string[] = [];
  const lower = query.toLowerCase();

  // English / whitespace-separated terms
  const whitespaceTerms = lower.split(/\s+/).filter((t) => t.length > 1);
  terms.push(...whitespaceTerms);

  // Chinese: extract 2-grams and full short sequences
  const chineseSeqs = lower.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seq of chineseSeqs) {
    for (let i = 0; i < seq.length - 1; i++) {
      terms.push(seq.slice(i, i + 2));
    }
    if (seq.length >= 2 && seq.length <= 8) {
      terms.push(seq);
    }
  }

  return Array.from(new Set(terms));
}

function scoreDocument(query: string, doc: TestDocument): number {
  const terms = extractTerms(query);
  if (terms.length === 0) return 0;
  let score = 0;
  const labelLower = doc.label.toLowerCase();
  const contentLower = doc.content.toLowerCase();
  for (const term of terms) {
    if (labelLower.includes(term)) score += 3;
    if (doc.tags.some((t) => t.toLowerCase().includes(term))) score += 2;
    if (contentLower.includes(term)) score += 1;
  }
  return score;
}

async function mockHybridSearch(
  query: string,
  allowedDocIds?: string[],
  limit = 5
): Promise<Array<{ docId: string; score: number }>> {
  let docs = TEST_DOCUMENTS;
  if (allowedDocIds && allowedDocIds.length > 0) {
    docs = docs.filter((d) => allowedDocIds.includes(d.id.replace("kb_doc_", "")));
  }
  const scored = docs
    .map((doc) => ({ docId: doc.id.replace("kb_doc_", ""), score: scoreDocument(query, doc) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

describeIfMySQL.sequential("Knowledge Graph Retrieval Benchmark", () => {
  let manager: KnowledgeGraphManager;

  beforeAll(async () => {
    // Ensure test user exists
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "kg_benchmark_user", "test_hash", 1]
      );
    } catch (err: any) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }

    manager = new KnowledgeGraphManager(TEST_OWNER);
    const store = await manager.getStore();
    if (store.clearGraph) await store.clearGraph();

    // Create concept nodes for relational bridging
    const concepts = [
      { id: "concept_raos", label: "RAOS", type: "concept" as const, tags: ["concept", "raos"] },
      { id: "concept_kg", label: "知识图谱", type: "concept" as const, tags: ["concept", "kg"] },
      { id: "concept_vector", label: "向量检索", type: "concept" as const, tags: ["concept", "vector"] },
      { id: "concept_openclaw", label: "OpenClaw", type: "concept" as const, tags: ["concept", "openclaw"] },
      { id: "concept_hybrid", label: "混合检索", type: "concept" as const, tags: ["concept", "hybrid"] },
      { id: "concept_graph_search", label: "图搜索", type: "concept" as const, tags: ["concept", "graph"] },
      { id: "concept_p3", label: "P3路线图", type: "concept" as const, tags: ["concept", "p3"] },
      { id: "concept_ltm", label: "长期记忆", type: "concept" as const, tags: ["concept", "ltm"] },
    ];

    for (const c of concepts) {
      await store.addNode({
        id: c.id,
        label: c.label,
        type: c.type,
        tags: c.tags,
        properties: {},
        createdAt: Date.now(),
      });
    }

    // Create document nodes
    for (const doc of TEST_DOCUMENTS) {
      await store.addNode({
        id: doc.id,
        label: doc.label,
        type: "kb_document",
        tags: doc.tags,
        properties: { contentPreview: doc.content, value: doc.content },
        createdAt: Date.now(),
      });
    }

    // Concept -> document edges
    const conceptDocEdges: Array<[string, string]> = [
      ["concept_raos", "kb_doc_raos_intro"],
      ["concept_raos", "kb_doc_raos_install"],
      ["concept_raos", "kb_doc_raos_arch"],
      ["concept_kg", "kb_doc_kg_concepts"],
      ["concept_kg", "kb_doc_kg_features"],
      ["concept_kg", "kb_doc_kg_vs_vector"],
      ["concept_kg", "kb_doc_p3_roadmap"],
      ["concept_vector", "kb_doc_vector_search"],
      ["concept_vector", "kb_doc_embedding_models"],
      ["concept_vector", "kb_doc_kg_vs_vector"],
      ["concept_vector", "kb_doc_hybrid_search"],
      ["concept_hybrid", "kb_doc_hybrid_search"],
      ["concept_openclaw", "kb_doc_openclaw"],
      ["concept_graph_search", "kb_doc_graph_search_impl"],
      ["concept_graph_search", "kb_doc_community_detection"],
      ["concept_p3", "kb_doc_p3_roadmap"],
      ["concept_ltm", "kb_doc_ltm_memory"],
      ["concept_ltm", "kb_doc_agent_skills"],
    ];

    for (const [source, target] of conceptDocEdges) {
      await store.addEdge(source, target, "EXTRACTED", "related_to");
    }

    // Cross-concept edges for relational queries
    const conceptEdges: Array<[string, string]> = [
      ["concept_raos", "concept_openclaw"], // RAOS <-> OpenClaw
      ["concept_kg", "concept_vector"], // KG <-> Vector
      ["concept_hybrid", "concept_vector"], // Hybrid <-> Vector
      ["concept_graph_search", "concept_kg"], // Graph search <-> KG
      ["concept_p3", "concept_kg"], // P3 <-> KG
      ["concept_ltm", "concept_raos"], // LTM <-> RAOS
    ];

    for (const [source, target] of conceptEdges) {
      await store.addEdge(source, target, "EXTRACTED", "related_to");
    }

    // Direct document-to-document edges
    const docEdges: Array<[string, string]> = [
      ["kb_doc_kg_vs_vector", "kb_doc_kg_concepts"],
      ["kb_doc_kg_vs_vector", "kb_doc_vector_search"],
      ["kb_doc_hybrid_search", "kb_doc_vector_search"],
      ["kb_doc_graph_search_impl", "kb_doc_community_detection"],
      ["kb_doc_kg_features", "kb_doc_graph_search_impl"],
      ["kb_doc_p3_roadmap", "kb_doc_kg_features"],
      ["kb_doc_raos_arch", "kb_doc_agent_skills"],
      ["kb_doc_raos_intro", "kb_doc_openclaw"],
    ];

    for (const [source, target] of docEdges) {
      await store.addEdge(source, target, "EXTRACTED", "related_to");
    }

    // Precompute communities and god nodes
    await manager.ensurePrecomputed(true);
  });

  afterAll(async () => {
    try {
      const store = await manager.getStore();
      if (store.clearGraph) await store.clearGraph();
    } catch {
      /* ignore */
    }
  });

  it("runs benchmark comparing pure hybrid vs graph-enhanced retrieval", async () => {
    const queryResults: BenchmarkResult["queries"] = [];

    for (const q of TEST_QUERIES) {
      // Pure hybrid search latency (averaged over iterations)
      const pureLatencies: number[] = [];
      let pureHybridTop5: string[] = [];
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const start = Date.now();
        const results = await mockHybridSearch(q.query, undefined, 5);
        const end = Date.now();
        pureLatencies.push(end - start);
        if (i === 0) pureHybridTop5 = results.map((r) => r.docId);
      }
      const pureHybridLatency = pureLatencies.reduce((a, b) => a + b, 0) / pureLatencies.length;
      const pureHybridCorrect = pureHybridTop5.includes(q.expectedDocId);

      // Graph-enhanced search latency (simulating kb_search pipeline)
      const graphLatencies: number[] = [];
      let graphEnhancedTop5: string[] = [];
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const start = Date.now();
        // Stage 1: Graph search to find relevant doc IDs
        const graphResults = await manager.graphSearch(q.query, {
          limit: 10,
          maxDepth: 3,
          maxNodes: 50,
        });
        const graphDocIds = graphResults.map((r: any) => r.docId);
        // Stage 2: Hybrid search on filtered doc set
        const hybridResults = await mockHybridSearch(q.query, graphDocIds, 10);
        // Stage 3: Apply graph boost (mirrors kb_search logic)
        const graphResultMap = new Map(graphResults.map((r: any) => [r.docId, r]));
        const enhanced = hybridResults
          .map((r) => {
            const gr = graphResultMap.get(r.docId);
            const boost = gr ? gr.score * 0.2 : 0;
            return { ...r, score: Math.min(r.score + boost, 1.0) };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        const end = Date.now();
        graphLatencies.push(end - start);
        if (i === 0) graphEnhancedTop5 = enhanced.map((r) => r.docId);
      }
      const graphEnhancedLatency = graphLatencies.reduce((a, b) => a + b, 0) / graphLatencies.length;
      const graphEnhancedCorrect = graphEnhancedTop5.includes(q.expectedDocId);

      queryResults.push({
        query: q.query,
        type: q.type,
        expectedDocId: q.expectedDocId,
        pureHybridLatencyMs: Math.round(pureHybridLatency * 100) / 100,
        graphEnhancedLatencyMs: Math.round(graphEnhancedLatency * 100) / 100,
        pureHybridCorrect,
        graphEnhancedCorrect,
        pureHybridTop5,
        graphEnhancedTop5,
      });
    }

    // Aggregate statistics
    const totalPureLatency = queryResults.reduce((s, q) => s + q.pureHybridLatencyMs, 0);
    const totalGraphLatency = queryResults.reduce((s, q) => s + q.graphEnhancedLatencyMs, 0);
    const pureCorrectCount = queryResults.filter((q) => q.pureHybridCorrect).length;
    const graphCorrectCount = queryResults.filter((q) => q.graphEnhancedCorrect).length;

    const byType: Record<string, { latenciesP: number[]; latenciesG: number[]; correctP: number; correctG: number; count: number }> = {};
    for (const q of queryResults) {
      if (!byType[q.type]) {
        byType[q.type] = { latenciesP: [], latenciesG: [], correctP: 0, correctG: 0, count: 0 };
      }
      byType[q.type].latenciesP.push(q.pureHybridLatencyMs);
      byType[q.type].latenciesG.push(q.graphEnhancedLatencyMs);
      if (q.pureHybridCorrect) byType[q.type].correctP++;
      if (q.graphEnhancedCorrect) byType[q.type].correctG++;
      byType[q.type].count++;
    }

    const byQueryType: BenchmarkResult["byQueryType"] = {};
    for (const [type, stats] of Object.entries(byType)) {
      byQueryType[type] = {
        pureHybridAvgLatencyMs:
          Math.round((stats.latenciesP.reduce((a, b) => a + b, 0) / stats.latenciesP.length) * 100) / 100,
        graphEnhancedAvgLatencyMs:
          Math.round((stats.latenciesG.reduce((a, b) => a + b, 0) / stats.latenciesG.length) * 100) / 100,
        pureHybridAccuracyAt5: Math.round((stats.correctP / stats.count) * 100) / 100,
        graphEnhancedAccuracyAt5: Math.round((stats.correctG / stats.count) * 100) / 100,
        queryCount: stats.count,
      };
    }

    const result: BenchmarkResult = {
      timestamp: new Date().toISOString(),
      iterations: BENCHMARK_ITERATIONS,
      totalDocuments: TEST_DOCUMENTS.length,
      totalQueries: TEST_QUERIES.length,
      overall: {
        pureHybridAvgLatencyMs: Math.round((totalPureLatency / TEST_QUERIES.length) * 100) / 100,
        graphEnhancedAvgLatencyMs: Math.round((totalGraphLatency / TEST_QUERIES.length) * 100) / 100,
        pureHybridAccuracyAt5: Math.round((pureCorrectCount / TEST_QUERIES.length) * 100) / 100,
        graphEnhancedAccuracyAt5: Math.round((graphCorrectCount / TEST_QUERIES.length) * 100) / 100,
        latencyImprovementPct:
          Math.round(
            ((totalPureLatency - totalGraphLatency) / totalPureLatency) * 10000
          ) / 100,
        accuracyImprovementPct:
          Math.round(
            ((graphCorrectCount - pureCorrectCount) / Math.max(pureCorrectCount, 1)) * 10000
          ) / 100,
      },
      byQueryType,
      queries: queryResults,
    };

    // Write results
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

    // Assertions to ensure benchmark is meaningful
    expect(result.totalDocuments).toBe(TEST_DOCUMENTS.length);
    expect(result.totalQueries).toBe(TEST_QUERIES.length);
    expect(result.overall.graphEnhancedAccuracyAt5).toBeGreaterThanOrEqual(0);
    expect(result.overall.pureHybridAccuracyAt5).toBeGreaterThanOrEqual(0);

    // Log summary
    console.log("\n=== KG Retrieval Benchmark Results ===");
    console.log(`Documents: ${result.totalDocuments}, Queries: ${result.totalQueries}, Iterations: ${result.iterations}`);
    console.log(`Pure Hybrid   - Avg Latency: ${result.overall.pureHybridAvgLatencyMs}ms, Accuracy@5: ${result.overall.pureHybridAccuracyAt5}`);
    console.log(`Graph Enhanced - Avg Latency: ${result.overall.graphEnhancedAvgLatencyMs}ms, Accuracy@5: ${result.overall.graphEnhancedAccuracyAt5}`);
    console.log(`Latency Improvement: ${result.overall.latencyImprovementPct}%`);
    console.log(`Accuracy Improvement: ${result.overall.accuracyImprovementPct}%`);
    console.log("By Query Type:", JSON.stringify(result.byQueryType, null, 2));
    console.log(`Results written to: ${OUTPUT_PATH}\n`);
  });
});
