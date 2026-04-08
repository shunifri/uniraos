import type { LLMProvider } from "../../llm/types.js";

export interface ExtractedRelation {
  sourceLabel: string;
  targetLabel: string;
  relation: string;       // "related_to", "depends_on", "part_of", etc.
  confidence: number;     // 0-1
}

/**
 * Extract entity relationships from text using LLM.
 * Falls back gracefully if LLM is unavailable.
 */
export async function extractRelationships(
  text: string,
  llmProvider?: LLMProvider | null,
): Promise<ExtractedRelation[]> {
  if (!llmProvider || !text || text.trim().length === 0) return [];

  const prompt = `从以下文本中提取实体之间的关系。返回 JSON 数组。

文本: "${text.slice(0, 500)}"

要求:
1. 每个关系包含: sourceLabel(源实体), targetLabel(目标实体), relation(关系类型), confidence(0-1)
2. 关系类型如: "related_to", "depends_on", "part_of", "uses", "created_by", "located_in"
3. confidence: 明确提及=0.9+, 可推断=0.5-0.8
4. 只提取有意义的关系，不要凑数
5. 只输出 JSON 数组，不要其他内容

示例输出:
[{"sourceLabel": "用户", "targetLabel": "深色模式", "relation": "prefers", "confidence": 0.9}]`;

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
      typeof r.confidence === "number" && r.confidence >= 0.3
    );
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
