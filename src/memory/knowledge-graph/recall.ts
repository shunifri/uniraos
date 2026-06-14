/**
 * 图谱召回 (Recall) — KG v2 阶段 3 KG-first 检索的 Step 2
 *
 * 取代散落在 querySubgraph / graphSearch / pathSearch 的逻辑，
 * 统一为单条 recall 管线。
 *
 * 详见 docs/KG_ARCHITECTURE_VISION.md §4.2。
 */
import type { GraphEdge, GraphNode } from "./types.js";
import type { GraphStoreLike } from "./extraction-pipeline.js";
import type {
  QueryUnderstanding,
  QueryEntity,
} from "./query-understanding.js";
import { extractSubgraph, findShortestPath } from "./bfs-extractor.js";

export interface RecallOptions {
  maxSeeds?: number;
  maxDepth?: number;
  maxEntities?: number;
  /** 是否启用 path 召回（仅 relational + 多个 entity 时） */
  includePaths?: boolean;
  /** ACL：允许的 KB 文档 ID 列表（仅 kb_document 节点生效） */
  allowedDocIds?: string[];
}

export interface RecalledPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RecallResult {
  /** 召回的 seed entity 节点（query 直接命中） */
  seedEntities: GraphNode[];
  /** 通过图谱边扩展出来的相关节点 */
  relatedEntities: GraphNode[];
  /** 子图里的所有边 */
  edges: GraphEdge[];
  /** 路径召回（仅 relational 查询且有 >=2 个 entity） */
  paths: RecalledPath[];
  /** 节点相关性分数（id → 0-1） */
  scores: Map<string, number>;
  /** 召回耗时（毫秒） */
  durationMs: number;
}

const DEFAULT_OPTIONS: Required<RecallOptions> = {
  maxSeeds: 5,
  maxDepth: 3,
  maxEntities: 100,
  includePaths: true,
  allowedDocIds: [],
};

/**
 * 主 recall 入口。
 *
 * 流程：
 *   1. 收集 seed nodes（从 query.entities.matchedNodeIds）
 *   2. 调 BFS 子图扩展
 *   3. （relational + 多 entity）做路径召回
 *   4. （discovery）做社区召回
 *   5. ACL 过滤：kb_document 节点必须在 allowedDocIds 里
 *   6. 计算节点相关性分数
 */
export async function recall(
  understanding: QueryUnderstanding,
  store: GraphStoreLike,
  options?: RecallOptions
): Promise<RecallResult> {
  const start = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  // 1. 收集 seed nodes（去重 + 截断）
  const seedIds = new Set<string>();
  for (const e of understanding.entities) {
    for (const id of e.matchedNodeIds) seedIds.add(id);
    if (seedIds.size >= opts.maxSeeds) break;
  }

  // 2. 从 store 拿 seed 节点对象
  const seedEntities: GraphNode[] = [];
  for (const id of seedIds) {
    // P2-12：用类型守卫代替 as any
    if (store.getNode) {
      const n = await store.getNode(id);
      if (n) seedEntities.push(n);
    }
  }

  // 3. ACL 过滤 helper
  // P2-11 安全修复：ACL 改用精确等值（之前 n.id.includes(id) 是模糊匹配，
  //   理论上 "doc_abc" 会被 "doc_abc_v2" 这种 id 误命中）
  // kb_document 节点 id 形如 `kb_doc_${docId}`，allowedDocIds 是外部传入的 docId 列表。
  // 用 === 比较 `n.id` 后缀部分（去掉 `kb_doc_` 前缀）和 allowed 列表里的 id。
  const isAllowed = (n: GraphNode): boolean => {
    if (opts.allowedDocIds.length === 0) return true;
    if (!n.tags?.includes("kb_document")) return true;
    const KB_DOC_PREFIX = "kb_doc_";
    const nodeDocId = n.id.startsWith(KB_DOC_PREFIX) ? n.id.slice(KB_DOC_PREFIX.length) : n.id;
    return opts.allowedDocIds.some((id) => nodeDocId === id);
  };

  const seedAfterAcl = seedEntities.filter(isAllowed);

  // 4. BFS 子图扩展 — KG v2 阶段 3: 显式传 seedNodeIds，让 BFS 从已链接的 seed 开始扩展
  const subgraph = await extractSubgraph(
    store,
    understanding.raw,
    {
      maxSeeds: opts.maxSeeds,
      maxDepth: opts.maxDepth,
      maxNodes: opts.maxEntities,
      allowedDocIds: opts.allowedDocIds,
      seedNodeIds: seedAfterAcl.map((n) => n.id),
    }
  );

  // 5. 路径召回（relational + 多 entity）
  const paths: RecalledPath[] = [];
  if (
    opts.includePaths &&
    understanding.queryType === "relational" &&
    seedAfterAcl.length >= 2
  ) {
    for (let i = 0; i < seedAfterAcl.length; i++) {
      for (let j = i + 1; j < seedAfterAcl.length; j++) {
        const path = await findShortestPath(
          store,
          seedAfterAcl[i].id,
          seedAfterAcl[j].id,
          opts.maxDepth
        );
        if (path) {
          paths.push({ nodes: path.path, edges: path.edges });
        }
      }
    }
  }

  // 6. 收集所有相关节点 + 边
  // P0-1 修复：relatedEntities 也必须经过 ACL 过滤
  // 之前只过滤 seed，related 节点会绕过 isAllowed 越权访问 kb_document
  const allNodes = subgraph.nodes.filter(isAllowed);
  const seedIdSet = new Set(seedAfterAcl.map((n) => n.id));
  const relatedEntities = allNodes.filter((n) => !seedIdSet.has(n.id));

  // 7. 计算节点分数：seed=1.0，1-hop neighbor=0.7，2-hop=0.5
  const scores = new Map<string, number>();
  for (const n of seedAfterAcl) {
    scores.set(n.id, 1.0);
  }
  for (const n of relatedEntities) {
    // 简化：BFS 距离近似
    const edgeCount = subgraph.edges.filter(
      (e) => e.source === n.id || e.target === n.id
    ).length;
    scores.set(n.id, Math.max(0.3, 1 - edgeCount * 0.05));
  }

  // P0-1 修复：边也过滤——只保留两端节点都在 allowed set 里的边
  const allowedIdSet = new Set(allNodes.map((n) => n.id));
  const safeEdges = subgraph.edges.filter(
    (e) => allowedIdSet.has(e.source) && allowedIdSet.has(e.target)
  );

  return {
    seedEntities: seedAfterAcl,
    relatedEntities,
    edges: safeEdges,
    paths: paths.filter((p) =>
      // 路径里的节点也必须在 allowed set 里
      p.nodes.every((n) => allowedIdSet.has(n.id))
    ),
    scores,
    durationMs: Date.now() - start,
  };
}

/**
 * KG v2 修 1：把 recall 结果生成人类可读的子图摘要。
 * 让 LLM 真正"理解关联"——而不是只看到一堆 id 和 count。
 *
 * 例子输出：
 *   "种子节点: 苹果公司(apple_inc), 蒂姆·库克(tim_cook)
 *    关联路径: 苹果公司 -[created_by]-> 蒂姆·库克
 *    社区归属: 0, 1
 *    邻近节点: iPhone(iphone), 史蒂夫·乔布斯(steve_jobs)"
 */
export function summarizeSubgraph(
  understanding: QueryUnderstanding,
  recall: RecallResult
): string {
  const lines: string[] = [];

  // 1. 种子节点
  if (recall.seedEntities.length > 0) {
    const seedLines = recall.seedEntities
      .map((n) => `  - ${n.label}${n.canonicalForm && n.canonicalForm !== n.label ? ` (${n.canonicalForm})` : ""} [${n.type}]`)
      .join("\n");
    lines.push(`种子节点 (${recall.seedEntities.length}):\n${seedLines}`);
  }

  // 2. 关联路径（核心：关系推理的关键信息）
  if (recall.paths.length > 0) {
    const pathLines = recall.paths.slice(0, 3).map((p) => {
      const nodeLabels = p.nodes.map((n) => n.label).join(" → ");
      const relationLabels = p.edges.map((e) => `[${e.label || e.type}]`).join(" ");
      return `  - ${nodeLabels} ${relationLabels}`;
    });
    lines.push(`关联路径 (${recall.paths.length} 条):\n${pathLines.join("\n")}`);
  }

  // 3. 邻近节点（用 importance 排序，TOP 5）
  if (recall.relatedEntities.length > 0) {
    const topRelated = recall.relatedEntities
      .slice()
      .sort((a, b) => (b.importance ?? 0.5) - (a.importance ?? 0.5))
      .slice(0, 5);
    const relLines = topRelated
      .map((n) => `  - ${n.label}${n.canonicalForm && n.canonicalForm !== n.label ? ` (${n.canonicalForm})` : ""}`)
      .join("\n");
    lines.push(`相关节点 (${recall.relatedEntities.length} 个, top 5 by importance):\n${relLines}`);
  }

  // 4. 社区归属
  const communityIds = Array.from(
    new Set(
      [...recall.seedEntities, ...recall.relatedEntities]
        .map((n) => n.communityId)
        .filter((c): c is number => c !== undefined)
    )
  );
  if (communityIds.length > 0) {
    lines.push(`社区归属: [${communityIds.join(", ")}]`);
  }

  // 5. 查询类型相关的提示
  if (understanding.queryType === "relational" && recall.paths.length === 0 && recall.seedEntities.length >= 2) {
    lines.push("(注意：查询是关系型，但 seed 节点之间没找到路径。可能需要扩展邻居。)");
  }

  if (lines.length === 0) {
    return "(图谱召回为空)";
  }
  return lines.join("\n");
}
