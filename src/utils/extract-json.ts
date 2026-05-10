/**
 * Extract a JSON string from LLM response text.
 *
 * Tries three strategies in order:
 * 1. Markdown code block (```json ... ```)
 * 2. First {...} substring
 * 3. Text that starts with "{" and ends with "}"
 *
 * Returns the raw JSON string (not parsed) or null if nothing found.
 */
export function extractJsonString(text: string): string | null {
  // Strategy 1: Markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // Strategy 2: First { ... } in text
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  // Strategy 3: Text itself is JSON-like
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  return null;
}
