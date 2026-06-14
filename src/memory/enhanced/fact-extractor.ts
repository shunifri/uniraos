/**
 * Fact Extractor - 从原始文本提取结构化事实
 * 使用 LLM 进行智能提取，支持置信度过滤
 */
import type { LLMProvider } from "../../llm/types.js";
import type { LTMBackend } from "../ltm-backend.js";

export interface ExtractedFact {
  key: string;
  fact: string;
  confidence: number;
  tags: string[];
}

export interface ExtractResult {
  facts: ExtractedFact[];
}

export interface ExtractAndStoreResult {
  extracted: number;
  stored: number;
  facts: ExtractedFact[];
}

export class FactExtractor {
  /**
   * 从文本中提取结构化事实
   */
  async extract(
    text: string,
    llmProvider?: LLMProvider,
    entityContext?: string
  ): Promise<ExtractedFact[]> {
    if (!text || !llmProvider) {
      return [];
    }

    // 截断 entityContext
    const contextStr = entityContext
      ? entityContext.substring(0, 1500)
      : "";

    const prompt = `You are an expert at extracting structured facts from text.

Given the following text${contextStr ? ` and entity context` : ""}, extract key facts. For each fact, provide:
- key: A short identifier (alphanumeric with underscores)
- fact: The actual statement
- confidence: A number between 0 and 1 indicating confidence
- tags: An array of relevant tags

Return ONLY valid JSON array of objects with these fields. No markdown, no explanation.

${contextStr ? `Entity Context: ${contextStr}\n` : ""}
Text to analyze:
${text}`;

    try {
      const response = await llmProvider.chat([
        { role: "user", content: prompt },
      ]);

      if (!response.content) {
        return [];
      }

      let jsonStr = response.content.trim();

      // 尝试从 markdown 代码块提取 JSON
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      
      // 验证解析结果是否为数组
      if (!Array.isArray(parsed)) {
        console.warn('[FactExtractor] LLM returned non-array JSON');
        return [];
      }
      
      // 过滤并验证每个事实
      const facts: ExtractedFact[] = parsed.filter((f: unknown): f is ExtractedFact => {
        if (typeof f !== 'object' || f === null) return false;
        const fact = f as Record<string, unknown>;
        return (
          typeof fact.key === 'string' &&
          typeof fact.fact === 'string' &&
          typeof fact.confidence === 'number' &&
          fact.confidence >= 0.5 &&
          Array.isArray(fact.tags) &&
          fact.tags.every((t: unknown) => typeof t === 'string')
        );
      });
      
      return facts;
    } catch (err: unknown) {
      console.warn('[FactExtractor] Failed to extract facts:', err);
      return [];
    }
  }

  /**
   * 从文本中提取事实并存储到 LTM
   */
  async extractAndStore(
    text: string,
    ltmBackend: LTMBackend,
    llmProvider?: LLMProvider,
    entityContext?: string
  ): Promise<ExtractAndStoreResult> {
    const facts = await this.extract(text, llmProvider, entityContext);

    const stored: string[] = [];
    for (const fact of facts) {
      try {
        const id = await ltmBackend.store(`fact:${fact.key}`, fact.fact, {
          tags: [...fact.tags, "fact", "extracted"],
          summary: fact.fact.substring(0, 100),
          source: "fact_extractor",
        });
        stored.push(id);
      } catch {
        // 单条存储失败不影响其他
      }
    }

    return {
      extracted: facts.length,
      stored: stored.length,
      facts,
    };
  }
}
