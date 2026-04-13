import type { LLMProvider } from "../../llm/types.js";

/** 归一化关系类型 - 统一关系表达方式（内部版本） */
function normalizeRelationType(relation: string): string {
  const lowerRel = relation.toLowerCase();

  const relationMap: Record<string, string> = {
    '相关': 'related_to',
    '关联': 'related_to',
    '连接': 'related_to',
    '关于': 'about',
    '属于': 'part_of',
    '包含': 'contains',
    '包括': 'contains',
    '使用': 'uses',
    '依赖': 'depends_on',
    '基于': 'based_on',
    '参考': 'references',
    '引用': 'references',
    '创建': 'created_by',
    '是': 'is_a',
    '等于': 'is_a',
    '区别于': 'different_from',
    '不同于': 'different_from',
    '相似于': 'similar_to',
  };

  // 精确匹配
  if (relationMap[lowerRel]) {
    return relationMap[lowerRel];
  }

  // 部分匹配
  for (const [key, value] of Object.entries(relationMap)) {
    if (lowerRel.includes(key)) {
      return value;
    }
  }

  // 默认返回原始关系
  return relation;
}

export interface ExtractedRelation {
  sourceLabel: string;
  targetLabel: string;
  relation: string;       // "related_to", "depends_on", "part_of", etc.
  confidence: number;     // 0-1
}

/**
 * 优化后的关系抽取 - 使用更好的提示和处理逻辑
 * Extract entity relationships from text using LLM.
 * Falls back gracefully if LLM is unavailable.
 */
export async function extractRelationships(
  text: string,
  llmProvider?: LLMProvider | null,
): Promise<ExtractedRelation[]> {
  if (!llmProvider || !text || text.trim().length === 0) return [];

  const prompt = `从以下文本中提取实体之间的关系。返回 JSON 数组。

文本: "${text}"

要求:
1. 每个关系包含: sourceLabel(源实体), targetLabel(目标实体), relation(关系类型), confidence(0-1)
2. 关系类型: 使用英文驼峰命名或中文关系词，如: "related_to", "depends_on", "part_of", "uses", "created_by", "包含", "属于", "使用", "依赖" 等
3. confidence: 明确提及=0.9+, 可推断=0.5-0.8
4. 只提取有意义的关系，不要凑数
5. 实体标签应该简洁明了，去除冗余修饰
6. 只输出 JSON 数组，不要其他内容

示例输出:
[{"sourceLabel": "用户", "targetLabel": "深色模式", "relation": "prefers", "confidence": 0.9}, {"sourceLabel": "数据中台", "targetLabel": "数据仓库", "relation": "related_to", "confidence": 0.85}]`;

  try {
    const response = await llmProvider.chat([{ role: "user", content: prompt }]);
    let json = (response.content ?? "").trim();

    // Clean markdown
    if (json.startsWith("```")) {
      json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    // Try to find JSON array
    const start = json.indexOf("[");
    const end = json.lastIndexOf("]");
    if (start !== -1 && end > start) {
      json = json.slice(start, end + 1);
    }

    const parsed = JSON.parse(json) as ExtractedRelation[];
    return parsed.filter(r =>
      r.sourceLabel && r.targetLabel && r.relation &&
      typeof r.confidence === "number" && r.confidence >= 0.3 &&
      r.sourceLabel.length <= 50 && r.targetLabel.length <= 50 // 限制标签长度
    ).map(r => ({
      ...r,
      relation: normalizeRelationType(r.relation) // 归一化关系类型
    }));
  } catch {
    return [];
  }
}

/**
 * Create TEMPORAL relationships based on tag overlap.
 * No LLM needed — purely deterministic.
 */
export function extractTagRelationships(
  entryTags: string[],
  existingEntries: Array<{ id: string; label: string; tags: string[] }>,
  minOverlap = 1,
): Array<{ targetId: string; targetLabel: string; sharedTags: string[] }> {
  const results: Array<{ targetId: string; targetLabel: string; sharedTags: string[] }> = [];

  for (const entry of existingEntries) {
    const shared = entryTags.filter(t => entry.tags.includes(t));
    if (shared.length >= minOverlap) {
      results.push({ targetId: entry.id, targetLabel: entry.label, sharedTags: shared });
    }
  }

  return results;
}
