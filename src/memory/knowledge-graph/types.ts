export type NodeType = "ltm" | "kb_document" | "entity" | "concept";

/**
 * EdgeType 边类型语义说明：
 * - EXTRACTED: 来自 ltm_store / onFactStored 时显式 relation 参数
 * - INFERRED: 来自 LLM 关系抽取（与 LLM_EXTRACTED 区分：INFERRED 是离线 pipeline 产出，置信度高）
 * - TEMPORAL: 来自 tag 重叠（heuristic）
 * - PERSONAL: 来自个人信息聚合（user_name → user_phone / user_company）
 * - CONTAINS: 文档锚点 → 内容实体（kb_doc_xxx → entity_xxx）
 * - LLM_EXTRACTED: 来自在线 kb_ingest / ParsingQueue 调用的 LLM 抽取
 * - PARENT_OF: 文档结构父子关系（document → section → paragraph → run）；docx 编辑器产物
 * - REVISION_OF: 修订历史（v1 → v2 → v3）；track-changes 产物
 * - ANCHORED_TO: 浮动对象锚定（v:shape / textbox → 文本位置）；docx 浮动元素产物
 */
export type EdgeType =
  | "EXTRACTED"
  | "INFERRED"
  | "TEMPORAL"
  | "PERSONAL"
  | "CONTAINS"
  | "LLM_EXTRACTED"
  | "PARENT_OF"
  | "REVISION_OF"
  | "ANCHORED_TO";

/**
 * 关系分类辅助：根据 LLM 抽取的 relation label 自动建议 EdgeType
 *
 * 目的：让 extraction pipeline 少调一次 LLM（避免 2x cost）
 * 启发式基于 label 关键词匹配：
 *   - "属于/包含/位于/在...里"   → PARENT_OF (downward: 父→子)
 *   - "继承/历史/版本/修订/替换"  → REVISION_OF
 *   - "锚定/附着/挂载"            → ANCHORED_TO
 *   - 默认                       → EXTRACTED
 */
export function inferEdgeTypeFromLabel(label: string): EdgeType {
  const l = label.toLowerCase();
  if (/(?:属于|包含|位于|在.+里|parent|contains|has_child)/.test(l)) return "PARENT_OF";
  if (/(?:继承|历史|版本|修订|替换|replaces|revision|history|version)/.test(l)) return "REVISION_OF";
  if (/(?:锚定|附着|挂载|anchor|attached_to)/.test(l)) return "ANCHORED_TO";
  return "EXTRACTED";
}

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  tags: string[];
  properties: Record<string, unknown>;
  createdAt: number;
  communityId?: number;
  /** 实体节点从此 chunk 抽出（KG→KB 反向链接）。详见 KG_ARCHITECTURE_VISION §3.3 */
  sourceChunkIds?: string[];
  /** 节点版本，每次 update 自增。详见 KG_ARCHITECTURE_VISION §3.3 */
  version?: number;
  /** 节点重要性评分（0-1）。由反馈环路增量调整 */
  importance?: number;
  /** 实体归一后的 canonical form（实体合并/跨语言去重使用） */
  canonicalForm?: string;
  /** 实体合并时，指向被合并的旧节点 ID */
  supersedes?: string;
  /** 多步合并链 */
  supersedesChain?: string[];
  /** 首次出现时间戳 */
  firstSeen?: number;
  /** 最近更新时间戳 */
  lastUpdated?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label: string;
  weight: number;
  createdAt: number;
  /** 关系从哪个 KB chunk 抽出（用于证据回溯） */
  sourceChunkId?: string;
  /** 原文证据片段 */
  evidence?: string;
  /** 边版本号 */
  version?: number;
  /** 反馈评分（由反馈环路调整）。最终 weight = baseWeight * (1 + tanh(feedbackScore)) */
  feedbackScore?: number;
  /** 时间有效性（可选，用于时序图谱） */
  validFrom?: number;
  validTo?: number;
}

export interface GraphData {
  version: 1;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  adjacency: Record<string, string[]>;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seedNodes: string[];
}
