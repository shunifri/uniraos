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
 * 抽取的实体（KG v2 修 3 新增）。
 * 注意：与 ExtractedRelation 不同，entity 是**单端**信息，
 * 即使不形成关系也应该被抽取。
 */
export interface ExtractedEntity {
  /** 原始 surface form（如 "苹果公司"） */
  label: string;
  /** 实体类型：person / organization / concept / technology / product / event / location */
  type: string;
  /** 重要性 0-1（基于在文本中的中心度） */
  importance: number;
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
 * KG v2 修 3：单独抽取实体（不依赖关系）。
 *
 * 为什么需要这个：之前 entity 只是 relations 的副产物，
 * 文档里"X 单独出现但没形成关系"的情况不会进图谱，
 * 导致召回不完备。这个函数让 LLM 主动报告所有命名实体。
 *
 * 类型建议：person / organization / concept / technology / product / event / location
 */
export async function extractEntities(
  text: string,
  llmProvider?: LLMProvider | null,
): Promise<ExtractedEntity[]> {
  if (!llmProvider || !text || text.trim().length === 0) return [];

  const prompt = `从以下文本中抽取所有**命名实体**（不只抽取形成关系的，所有独立出现的也算）。返回 JSON 数组。

文本: "${text}"

要求:
1. 每个实体包含: label(实体名), type(实体类型), importance(0-1 重要性)
2. type 必须是以下之一: person / organization / concept / technology / product / event / location
3. importance: 文本核心实体=0.8-1.0, 提及多次=0.5-0.7, 仅提及一次=0.3-0.5
4. label 简洁明了，去除冗余修饰（最多 30 字符）
5. 同义实体合并为同一个（如 "苹果" 和 "Apple" 视为同一 entity，统一用最常见的形式）
6. 只输出 JSON 数组，不要其他内容

示例输出:
[{"label": "苹果公司", "type": "organization", "importance": 0.9}, {"label": "蒂姆·库克", "type": "person", "importance": 0.85}, {"label": "iPhone", "type": "product", "importance": 0.7}]`;

  try {
    const response = await llmProvider.chat([{ role: "user", content: prompt }]);
    let json = (response.content ?? "").trim();

    if (json.startsWith("```")) {
      json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const start = json.indexOf("[");
    const end = json.lastIndexOf("]");
    if (start !== -1 && end > start) {
      json = json.slice(start, end + 1);
    }

    const parsed = JSON.parse(json) as ExtractedEntity[];
    return parsed.filter((e) =>
      e.label &&
      typeof e.label === "string" &&
      e.label.length >= 1 && e.label.length <= 30 &&
      typeof e.type === "string" &&
      typeof e.importance === "number" &&
      e.importance >= 0.1 && e.importance <= 1.0
    );
  } catch {
    return [];
  }
}

/**
 * P1-6 修复（v3 review）：合并 entities + relations 为单次 LLM 调用。
 * 之前是两次独立调用（extractEntities + extractRelationships），成本和延迟都是 2x。
 * 合并后：1 次 LLM 调用同时返回 entities 和 relations，省成本 +50%、省延迟 ~50%。
 *
 * 输出 schema：
 * {
 *   "entities":  [{ label, type, importance }],
 *   "relations": [{ sourceLabel, targetLabel, relation, confidence }]
 * }
 *
 * 容错策略：解析失败/字段缺失时，**静默返回空 entities+relations**，
 *   让上层用"什么也没抽到"的安全路径，不要把 LLM 抖动扩散成整次失败。
 */
export async function extractEntitiesAndRelationships(
  text: string,
  llmProvider?: LLMProvider | null,
): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
  const empty = { entities: [] as ExtractedEntity[], relations: [] as ExtractedRelation[] };
  if (!llmProvider || !text || text.trim().length === 0) return empty;

  const prompt = `从以下文本中同时抽取：(1) 所有命名实体（独立出现的也算），(2) 实体之间的关系。返回单个 JSON 对象。

文本: "${text}"

要求:
1. entities: 每个实体包含 label(实体名, ≤30字符), type(person/organization/concept/technology/product/event/location), importance(0-1)
2. relations: 每个关系包含 sourceLabel(源实体, 必须出现在 entities 里), targetLabel(目标实体, 必须出现在 entities 里), relation(关系类型, 英文驼峰或中文), confidence(0-1)
3. importance: 文本核心实体=0.8-1.0, 提及多次=0.5-0.7, 仅提及一次=0.3-0.5
4. confidence: 明确提及=0.9+, 可推断=0.5-0.8, 不要凑数
5. 同义实体合并为同一个
6. **只输出单个 JSON 对象**，格式:
{
  "entities": [{"label":"苹果公司","type":"organization","importance":0.9}],
  "relations": [{"sourceLabel":"苹果公司","targetLabel":"蒂姆·库克","relation":"created_by","confidence":0.9}]
}`;

  try {
    const response = await llmProvider.chat([{ role: "user", content: prompt }]);
    let json = (response.content ?? "").trim();

    // 去掉 markdown code fence
    if (json.startsWith("```")) {
      json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    // P2-10 容错：LLM 偶尔不听话直接返回 array 而不是 object
    //   - 返回 [{...}, {...}] 当 entities 处理、relations 留空
    //   - 这样不丢覆盖率（旧路径也是 2 个独立调用分别返回 array）
    //   - 检测方法：第一个非空白字符是 `[` → 整段是 array
    const firstChar = json.replace(/^[\s\n]+/, "").charAt(0);
    if (firstChar === "[") {
      const arrayEnd = json.lastIndexOf("]");
      const arrayJson = json.slice(0, arrayEnd + 1);
      try {
        const arr = JSON.parse(arrayJson) as ExtractedEntity[];
        if (Array.isArray(arr)) {
          const entities = arr.filter((e) =>
            e &&
            e.label &&
            typeof e.label === "string" &&
            e.label.length >= 1 && e.label.length <= 30 &&
            typeof e.type === "string" &&
            typeof e.importance === "number" &&
            e.importance >= 0.1 && e.importance <= 1.0
          );
          return { entities, relations: [] };
        }
      } catch { /* fall through to object parsing */ }
    }

    // 提取 {...} 部分
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start === -1 || end <= start) return empty;
    json = json.slice(start, end + 1);

    const parsed = JSON.parse(json) as {
      entities?: ExtractedEntity[];
      relations?: ExtractedRelation[];
    };

    const entities = Array.isArray(parsed.entities)
      ? parsed.entities.filter((e) =>
          e &&
          e.label &&
          typeof e.label === "string" &&
          e.label.length >= 1 && e.label.length <= 30 &&
          typeof e.type === "string" &&
          typeof e.importance === "number" &&
          e.importance >= 0.1 && e.importance <= 1.0
        )
      : [];

    const relations = Array.isArray(parsed.relations)
      ? parsed.relations.filter((r) =>
          r &&
          r.sourceLabel &&
          r.targetLabel &&
          r.relation &&
          typeof r.confidence === "number" &&
          r.confidence >= 0.1
        )
      : [];

    return { entities, relations };
  } catch {
    return empty;
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
