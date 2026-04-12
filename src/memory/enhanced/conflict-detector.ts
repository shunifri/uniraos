/**
 * Conflict Detector - 检测新记忆与已有记忆的矛盾
 * 使用 LLM 进行智能对比，返回矛盾列表及严重程度
 */
import type { LLMProvider } from "../../llm/types.js";
import type { LTMBackend } from "../ltm-backend.js";
import type { LTMEntry } from "../ltm.js";

export interface ConflictInfo {
  existingId: string;
  existingKey: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export class ConflictDetector {
  /**
   * 检测新条目与候选条目之间的矛盾
   */
  async detect(
    newEntry: { key: string; value: unknown },
    candidates: LTMEntry[],
    llmProvider?: LLMProvider
  ): Promise<ConflictInfo[]> {
    if (!candidates.length || !llmProvider) {
      return [];
    }

    const newValueStr =
      typeof newEntry.value === "string"
        ? newEntry.value
        : JSON.stringify(newEntry.value);

    const candidateTexts = candidates
      .slice(0, 10)
      .map(
        (c, i) =>
          `[${i}] key="${c.key}", value="${
            typeof c.value === "string"
              ? c.value
              : JSON.stringify(c.value)
          }"`
      )
      .join("\n");

    const prompt = `You are an expert at identifying contradictions in information.

New entry to store:
key: "${newEntry.key}"
value: "${newValueStr}"

Existing entries (top candidates):
${candidateTexts}

Identify any contradictions between the new entry and existing entries. For each contradiction found, return a JSON object with:
- existingId: Use the [index] from above, format as "candidate_{index}"
- existingKey: The key from the existing entry
- description: Brief description of the contradiction
- severity: "low", "medium", or "high"

Return ONLY a valid JSON array. If no contradictions, return an empty array [].`;

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
        console.warn('[ConflictDetector] LLM returned non-array JSON');
        return [];
      }
      
      // 验证每个冲突的结构
      const conflicts: ConflictInfo[] = parsed.filter((c: unknown): c is ConflictInfo => {
        if (typeof c !== 'object' || c === null) return false;
        const conflict = c as Record<string, unknown>;
        return (
          typeof conflict.existingId === 'string' &&
          typeof conflict.existingKey === 'string' &&
          typeof conflict.description === 'string' &&
          typeof conflict.severity === 'string' &&
          ['low', 'medium', 'high'].includes(conflict.severity)
        );
      });
      
      return conflicts;
    } catch (err: unknown) {
      console.warn('[ConflictDetector] Failed to detect conflicts:', err);
      return [];
    }
  }

  /**
   * 为特定 key 检测矛盾（便捷方法）
   * 自动搜索相关条目并检测
   */
  async detectForKey(
    key: string,
    newValue: unknown,
    ltmBackend: LTMBackend,
    llmProvider?: LLMProvider
  ): Promise<ConflictInfo[]> {
    // 搜索语义相近的条目
    const searchResults = await ltmBackend.search(
      typeof newValue === "string" ? newValue : JSON.stringify(newValue),
      { limit: 10 }
    );

    // 获取同 key 的历史记录
    const existing = await ltmBackend.getByKey(key);

    // 合并并去重
    const candidates = searchResults.concat(existing ? [existing] : []);
    const uniqueCandidates = Array.from(
      new Map(candidates.map((c) => [c.id, c])).values()
    );

    return this.detect({ key, value: newValue }, uniqueCandidates, llmProvider);
  }
}
