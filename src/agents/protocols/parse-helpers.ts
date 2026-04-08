/**
 * Structured JSON parsing helpers for multi-agent protocols.
 *
 * Each parser tries three strategies in order:
 * 1. Extract JSON from ```json code blocks
 * 2. Find first {...} in text and try parsing
 * 3. Fallback to legacy text markers ([HANDOFF:role], [TRANSFER:role])
 */

export interface HandoffResult {
  handoff: boolean;
  target: string;
  reason?: string;
}

export interface TransferResult {
  transfer: boolean;
  target: string;
  reason?: string;
}

export interface ManagerDecision {
  decision: "assign" | "revise" | "complete";
  assignments?: Array<{ agent: string; task: string }>;
  revision?: string;
  summary?: string;
}

export interface BidResult {
  confidence: number;
  approach: string;
  estimatedSteps?: number;
}

/**
 * Try to extract a JSON object from a string using two strategies:
 * 1. JSON code block (```json ... ```)
 * 2. First {...} substring
 */
function extractJson(response: string): unknown | null {
  // Strategy 1: JSON code block
  const codeBlockMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // fall through to next strategy
    }
  }

  // Strategy 2: First { ... } in text
  const braceMatch = response.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // fall through to legacy
    }
  }

  return null;
}

/**
 * Parse a handoff decision from an LLM response.
 * Returns null when no handoff is present or handoff is explicitly false.
 */
export function parseHandoffJson(response: string): HandoffResult | null {
  const parsed = extractJson(response);

  if (parsed !== null && typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.handoff === "boolean") {
      if (!obj.handoff) return null;
      return {
        handoff: true,
        target: String(obj.target ?? ""),
        reason: obj.reason !== undefined ? String(obj.reason) : undefined,
      };
    }
  }

  // Strategy 3: Legacy [HANDOFF:role] marker
  const legacyMatch = response.match(/\[HANDOFF:(.+?)\]\s*(.*)/s);
  if (legacyMatch) {
    return {
      handoff: true,
      target: legacyMatch[1].trim(),
      reason: legacyMatch[2].trim() || undefined,
    };
  }

  return null;
}

/**
 * Parse a transfer decision from an LLM response.
 * Returns null when no transfer is present or transfer is explicitly false.
 */
export function parseTransferJson(response: string): TransferResult | null {
  const parsed = extractJson(response);

  if (parsed !== null && typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.transfer === "boolean") {
      if (!obj.transfer) return null;
      return {
        transfer: true,
        target: String(obj.target ?? ""),
        reason: obj.reason !== undefined ? String(obj.reason) : undefined,
      };
    }
  }

  // Strategy 3: Legacy [TRANSFER:role] marker
  const legacyMatch = response.match(/\[TRANSFER:(.+?)\]\s*(.*)/s);
  if (legacyMatch) {
    return {
      transfer: true,
      target: legacyMatch[1].trim(),
      reason: legacyMatch[2].trim() || undefined,
    };
  }

  return null;
}

/**
 * Parse a manager decision from an LLM response.
 * Returns null when no valid decision could be parsed.
 */
export function parseManagerDecisionJson(response: string): ManagerDecision | null {
  const parsed = extractJson(response);

  if (parsed !== null && typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const decision = obj.decision as string | undefined;

    if (decision === "assign" || decision === "revise" || decision === "complete") {
      const result: ManagerDecision = { decision };

      if (decision === "assign" && Array.isArray(obj.assignments)) {
        result.assignments = (obj.assignments as Array<Record<string, unknown>>).map((a) => ({
          agent: String(a.agent ?? ""),
          task: String(a.task ?? ""),
        }));
      }

      if (decision === "revise" && obj.revision !== undefined) {
        result.revision = String(obj.revision);
      }

      if (decision === "complete" && obj.summary !== undefined) {
        result.summary = String(obj.summary);
      }

      return result;
    }
  }

  return null;
}

/**
 * Parse a bid response from an LLM.
 * Always returns a BidResult — defaults confidence to 0.5 on parse failure.
 */
export function parseBidJson(response: string): BidResult {
  const parsed = extractJson(response);

  if (parsed !== null && typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (obj.confidence !== undefined || obj.approach !== undefined) {
      return {
        confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
        approach: obj.approach !== undefined ? String(obj.approach) : response,
        estimatedSteps: typeof obj.estimatedSteps === "number" ? obj.estimatedSteps : undefined,
      };
    }
  }

  // Fallback: return defaults with raw response as approach
  return {
    confidence: 0.5,
    approach: response,
  };
}
