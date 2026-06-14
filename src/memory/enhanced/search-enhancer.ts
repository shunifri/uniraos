/**
 * SearchEnhancer - Enhanced search ranking and filtering for LTM entries.
 *
 * Provides LLM-based reranking, metadata filtering with boolean logic,
 * and query rewriting for improved search quality.
 */

import type { LLMProvider, Message } from '../../llm/types.js';

// Re-export from version-chain once it exists; defined here for now.
export interface EnhancedLTMEntry {
  id: string;
  key: string;
  value: unknown;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  source?: string;
  summary?: string;
  lastAccessedAt: number;
  /** Relevance score from vector / keyword search (0-1) */
  score?: number;
  /** Arbitrary metadata for filtering */
  metadata?: Record<string, unknown>;
}

// ---- Filter expression types ----

export interface MetadataFilter {
  key: string;
  value: string | number | boolean;
  filterType: 'metadata' | 'numeric' | 'array_contains' | 'string_contains';
  numericOperator?: '>' | '<' | '>=' | '<=' | '=';
  negate?: boolean;
}

export type FilterExpression =
  | MetadataFilter
  | { OR: FilterExpression[] }
  | { AND: FilterExpression[] };

// ---- Rerank result type ----

export interface RerankResult {
  entry: EnhancedLTMEntry;
  relevanceScore: number;
}

// ---- Helpers ----

const MAX_RERANK = 20;

function isMetadataFilter(expr: FilterExpression): expr is MetadataFilter {
  return 'key' in expr && 'filterType' in expr;
}

function isOrExpression(expr: FilterExpression): expr is { OR: FilterExpression[] } {
  return 'OR' in expr;
}

function isAndExpression(expr: FilterExpression): expr is { AND: FilterExpression[] } {
  return 'AND' in expr;
}

/**
 * Resolve a dotted key path against an entry, falling back into `metadata`.
 */
function resolveField(entry: EnhancedLTMEntry, key: string): unknown {
  // Direct top-level field
  if (key in entry) {
    return (entry as unknown as Record<string, unknown>)[key];
  }
  // Try inside metadata
  if (entry.metadata && key in entry.metadata) {
    return entry.metadata[key];
  }
  // Try nested dotted path in metadata
  const parts = key.split('.');
  let current: unknown = entry.metadata;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateSingleFilter(entry: EnhancedLTMEntry, filter: MetadataFilter): boolean {
  const fieldValue = resolveField(entry, filter.key);
  let result: boolean;

  switch (filter.filterType) {
    case 'metadata': {
      result = fieldValue === filter.value;
      break;
    }
    case 'numeric': {
      const numField = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
      const numValue = typeof filter.value === 'number' ? filter.value : Number(filter.value);
      if (Number.isNaN(numField) || Number.isNaN(numValue)) {
        result = false;
        break;
      }
      const op = filter.numericOperator ?? '=';
      switch (op) {
        case '>':  result = numField > numValue; break;
        case '<':  result = numField < numValue; break;
        case '>=': result = numField >= numValue; break;
        case '<=': result = numField <= numValue; break;
        case '=':  result = numField === numValue; break;
        default:   result = false;
      }
      break;
    }
    case 'array_contains': {
      if (Array.isArray(fieldValue)) {
        result = fieldValue.includes(filter.value);
      } else {
        result = false;
      }
      break;
    }
    case 'string_contains': {
      if (typeof fieldValue === 'string' && typeof filter.value === 'string') {
        result = fieldValue.includes(filter.value);
      } else {
        result = false;
      }
      break;
    }
    default:
      result = false;
  }

  return filter.negate ? !result : result;
}

function evaluateFilter(entry: EnhancedLTMEntry, expr: FilterExpression): boolean {
  if (isMetadataFilter(expr)) {
    return evaluateSingleFilter(entry, expr);
  }
  if (isOrExpression(expr)) {
    return expr.OR.length === 0 ? true : expr.OR.some(sub => evaluateFilter(entry, sub));
  }
  if (isAndExpression(expr)) {
    return expr.AND.length === 0 ? true : expr.AND.every(sub => evaluateFilter(entry, sub));
  }
  return false;
}

// ---- Public API ----

export class SearchEnhancer {
  /**
   * LLM-based reranking of the top-N search results.
   * Sends at most MAX_RERANK results to the LLM for scoring.
   * On LLM failure, returns the original order.
   */
  async rerank(
    query: string,
    results: EnhancedLTMEntry[],
    llmProvider: LLMProvider,
  ): Promise<RerankResult[]> {
    if (results.length === 0) return [];

    const toRerank = results.slice(0, MAX_RERANK);
    const rest = results.slice(MAX_RERANK);

    // Build a numbered snippet list for the LLM
    const snippets = toRerank.map((entry, i) => {
      const text = entry.summary
        ?? (typeof entry.value === 'string' ? entry.value.slice(0, 300) : JSON.stringify(entry.value).slice(0, 300));
      return `[${i}] ${text}`;
    }).join('\n');

    const systemPrompt = `You are a search relevance judge. Given a query and a list of numbered results, score each result's relevance to the query on a scale from 0.0 to 1.0. Reply ONLY with a JSON array of objects: [{"index": 0, "score": 0.9}, ...]. Include every index exactly once. Do not include any other text.`;

    const userPrompt = `Query: ${query}\n\nResults:\n${snippets}`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await llmProvider.chat(messages);
      const content = response.content ?? '';

      // Extract JSON array from response (tolerant of markdown fences)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.fallbackResults(results);
      }

      const scores: Array<{ index: number; score: number }> = JSON.parse(jsonMatch[0]);
      const scoreMap = new Map<number, number>();
      for (const s of scores) {
        if (typeof s.index === 'number' && typeof s.score === 'number') {
          scoreMap.set(s.index, Math.max(0, Math.min(1, s.score)));
        }
      }

      const reranked: RerankResult[] = toRerank.map((entry, i) => ({
        entry,
        relevanceScore: scoreMap.get(i) ?? entry.score ?? 0,
      }));

      reranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Append remaining entries with their original scores
      const restResults: RerankResult[] = rest.map(entry => ({
        entry,
        relevanceScore: entry.score ?? 0,
      }));

      return [...reranked, ...restResults];
    } catch {
      return this.fallbackResults(results);
    }
  }

  /**
   * Apply nested AND/OR metadata filters to a list of entries.
   */
  applyMetadataFilters(
    results: EnhancedLTMEntry[],
    filters: FilterExpression,
  ): EnhancedLTMEntry[] {
    return results.filter(entry => evaluateFilter(entry, filters));
  }

  /**
   * Optional LLM query rewriting for better search recall.
   * On failure, returns the original query unchanged.
   */
  async rewriteQuery(
    query: string,
    llmProvider: LLMProvider,
  ): Promise<string> {
    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are a search query optimizer. Rewrite the following user query to improve recall in a semantic search system. Output ONLY the rewritten query, nothing else. Keep it concise (under 100 words).',
      },
      { role: 'user', content: query },
    ];

    try {
      const response = await llmProvider.chat(messages);
      const rewritten = (response.content ?? '').trim();
      return rewritten.length > 0 ? rewritten : query;
    } catch {
      return query;
    }
  }

  // ---- Private helpers ----

  private fallbackResults(results: EnhancedLTMEntry[]): RerankResult[] {
    return results.map(entry => ({
      entry,
      relevanceScore: entry.score ?? 0,
    }));
  }
}
