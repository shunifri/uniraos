/**
 * 查询理解 — KG v2 阶段 3 KG-first 检索的 Step 1
 *
 * 职责：
 * 1. 复用 classifyQuery 做意图分类
 * 2. 实体识别（NER）+ 实体链接
 * 3. 输出 QueryUnderstanding 给后续 recall / chunk-expander 使用
 *
 * 详见 docs/KG_ARCHITECTURE_VISION.md §4.1。
 */
import type { LLMProvider } from "../../llm/types.js";
import type { GraphStoreLike } from "./extraction-pipeline.js";
import {
  defaultEntityLinker,
  surfaceToCanonical,
  type EntityLinker,
} from "./entity-linker.js";
import { chineseTokenize, isJiebaActive } from "./chinese-tokenizer.js";

export type QueryType = "factual" | "relational" | "discovery" | "hybrid";

export interface QueryEntity {
  /** 原始 token（query 里出现的形式） */
  surfaceForm: string;
  /** 归一化 + alias 后的 canonical form */
  canonicalForm: string;
  /** 在图谱里命中的节点（可能多个，因为 alias） */
  matchedNodeIds: string[];
  /** 链接置信度：精确标签匹配=1，alias 命中=0.8，substring 匹配=0.5 */
  confidence: number;
}

export interface QueryUnderstanding {
  /** 原始 query */
  raw: string;
  /** 小写 + trim 的归一化 */
  normalized: string;
  /** 意图分类（factual / relational / discovery / hybrid） */
  queryType: QueryType;
  /** 分类置信度 0-1 */
  queryTypeConfidence: number;
  /** 提取的关键词 */
  keywords: string[];
  /** 提取的实体（已链接到图谱节点） */
  entities: QueryEntity[];
  /** 实体类型提示（"person" / "org" / ...），来自 graph node.type */
  entityTypes: string[];
}

export interface UnderstandQueryOptions {
  llmProvider?: LLMProvider | null;
  entityLinker?: EntityLinker;
  /** 最多返回多少个 matchedNodeIds（按 confidence 截断） */
  maxEntities?: number;
}

/**
 * P1-3 修复（v3 review）：QUERY_CACHE 加 LRU 上限。
 * 之前是无界 Map，process-global 永不释放，长跑 daemon 会缓慢泄露。
 * 200 条上限足够覆盖单用户单 session 内的查询去重；超出的最久未使用条目
 * 在 set 时被淘汰（Map 保持插入顺序，先入先出）。
 */
class LruQueryCache {
  private readonly maxSize: number;
  private readonly map = new Map<string, QueryUnderstanding>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): QueryUnderstanding | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // LRU: 命中后重新插入到尾部（Map 保留插入顺序）
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: QueryUnderstanding): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    // 超容：删最旧的（Map 头）
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const QUERY_CACHE = new LruQueryCache(200);

/**
 * 从 query 提取候选 surface tokens：
 * - 中文：优先用 nodejieba（KG v2 阶段 6）；不可用时降级到启发式切分
 * - 英文：连续字母（>=1 字）
 * - 数字
 */
export function tokenizeQuery(query: string): string[] {
  // 阶段 6：中文部分走 nodejieba，英文/数字保留原样
  const tokens = chineseTokenize(query);

  // 后处理：过滤过短的 token（英文 < 2 字符去掉，中文 < 2 字符也去掉以减少噪声）
  return tokens.filter((t) => {
    const isCJK = /[\u4e00-\u9fff]/.test(t);
    if (isCJK) return t.length >= 2;
    return t.length >= 2; // 英文也保持 >= 2
  });
}

/** 当前是否使用 nodejieba（暴露给 health check） */
export function isChineseTokenizerActive(): boolean {
  return isJiebaActive();
}

/**
 * KG-first 检索的查询理解。
 * - 分类复用 classifyQuery（基于规则的快速分类，可选 LLM 兜底）
 * - 实体识别先查图谱里的现有 label（含 alias），没有命中就走 substring 模糊匹配
 * - 所有匹配都通过 entity linker 归一化
 */
export async function understandQuery(
  query: string,
  store: GraphStoreLike | null | undefined,
  options: UnderstandQueryOptions = {}
): Promise<QueryUnderstanding> {
  const cached = QUERY_CACHE.get(query);
  if (cached) return cached;

  const linker = options.entityLinker ?? defaultEntityLinker;
  const tokens = tokenizeQuery(query);
  const canonicalForms = Array.from(new Set(tokens.map((t) => surfaceToCanonical(t))));

  // 1. 意图分类（复用 knowledge-skills 中的 classifyQuery）
  // 这里走简化版本，不调 LLM（保持延迟可控）
  const queryType = classifyByRules(query);
  const queryTypeConfidence = 0.7;

  // 2. 实体链接
  const entities: QueryEntity[] = [];
  if (store) {
    // 2a. 精确 + alias 命中
    for (const cf of canonicalForms) {
      const node = await store.findNodeByLabel(cf);
      if (node) {
        entities.push({
          surfaceForm: tokens.find((t) => surfaceToCanonical(t) === cf) ?? cf,
          canonicalForm: cf,
          matchedNodeIds: [node.id],
          confidence: 1.0,
        });
        continue;
      }
      // 2b. substring 模糊匹配（遍历节点的代价大，阶段 4 应改用 SQL/Neo4j 索引）
      if (cf.length >= 3 && typeof store.getAllNodes === "function") {
        const allNodes = await store.getAllNodes();
        for (const n of allNodes) {
          if (
            n.label.toLowerCase().includes(cf) ||
            cf.includes(n.label.toLowerCase())
          ) {
            entities.push({
              surfaceForm: cf,
              canonicalForm: linker.toCanonical(n.label),
              matchedNodeIds: [n.id],
              confidence: 0.5,
            });
            break; // 一个 canonical 只取一个最相似的
          }
        }
      }
    }
  } else {
    // 没有 store 时只做归一化，不做链接
    for (const cf of canonicalForms) {
      entities.push({
        surfaceForm: cf,
        canonicalForm: cf,
        matchedNodeIds: [],
        confidence: 0,
      });
    }
  }

  // 按 confidence 降序，截断
  entities.sort((a, b) => b.confidence - a.confidence);
  const maxEntities = options.maxEntities ?? 10;
  const topEntities = entities.slice(0, maxEntities);

  const result: QueryUnderstanding = {
    raw: query,
    normalized: query.toLowerCase().trim(),
    queryType,
    queryTypeConfidence,
    keywords: tokens,
    entities: topEntities,
    entityTypes: Array.from(new Set(topEntities.map((e) => e.canonicalForm))),
  };
  QUERY_CACHE.set(query, result);
  return result;
}

/** 简单规则分类（不调 LLM） */
function classifyByRules(query: string): QueryType {
  const q = query.toLowerCase();
  const factual = ["什么是", "定义", "介绍", "说明", "how to", "what is"].filter((i) => q.includes(i)).length;
  const relational = ["关系", "关联", "连接", "从...到", "通过", "路径", "区别", "相同"].filter((i) => q.includes(i)).length;
  const discovery = ["意外", "没想到", "新发现", "探索", "发现", "有什么", "还有什么"].filter((i) => q.includes(i)).length;

  const scores = { factual, relational, discovery };
  const max = Math.max(...Object.values(scores));
  if (max === 0) return "hybrid";
  const tied = Object.values(scores).filter((s) => s === max).length;
  if (tied > 1) return "hybrid";
  // return first key with max score
  for (const [k, v] of Object.entries(scores)) {
    if (v === max) return k as QueryType;
  }
  return "hybrid";
}

/** 暴露给测试 */
export function _clearQueryCache() {
  QUERY_CACHE.clear();
}
