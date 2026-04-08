import { describe, it, expect } from "vitest";
import {
  parseHandoffJson,
  parseTransferJson,
  parseManagerDecisionJson,
  parseBidJson,
} from "../../../src/agents/protocols/parse-helpers.js";

describe("Protocol Parse Helpers", () => {
  describe("parseHandoffJson", () => {
    it("should parse JSON block from LLM response", () => {
      const response =
        'I think agent B should handle this.\n```json\n{"handoff": true, "target": "researcher", "reason": "needs deep analysis"}\n```';
      const result = parseHandoffJson(response);
      expect(result).toEqual({ handoff: true, target: "researcher", reason: "needs deep analysis" });
    });

    it("should parse inline JSON object", () => {
      const response = '{"handoff": true, "target": "coder", "reason": "code needed"}';
      const result = parseHandoffJson(response);
      expect(result?.handoff).toBe(true);
      expect(result?.target).toBe("coder");
    });

    it("should return null when no JSON found", () => {
      const response = "I'll handle this myself, no handoff needed.";
      expect(parseHandoffJson(response)).toBeNull();
    });

    it("should return null when handoff is false", () => {
      expect(parseHandoffJson('{"handoff": false}')).toBeNull();
    });

    it("should fallback to legacy [HANDOFF:role] format", () => {
      const result = parseHandoffJson("[HANDOFF:researcher] Please analyze this data");
      expect(result).toEqual({ handoff: true, target: "researcher", reason: "Please analyze this data" });
    });

    it("should parse handoff without reason field", () => {
      const result = parseHandoffJson('```json\n{"handoff": true, "target": "analyst"}\n```');
      expect(result?.handoff).toBe(true);
      expect(result?.target).toBe("analyst");
      expect(result?.reason).toBeUndefined();
    });
  });

  describe("parseTransferJson", () => {
    it("should parse transfer JSON", () => {
      const response =
        '```json\n{"transfer": true, "target": "analyst", "reason": "data analysis needed"}\n```';
      const result = parseTransferJson(response);
      expect(result?.transfer).toBe(true);
      expect(result?.target).toBe("analyst");
    });

    it("should fallback to legacy [TRANSFER:role] format", () => {
      const result = parseTransferJson("[TRANSFER:coder] Need implementation");
      expect(result).toEqual({ transfer: true, target: "coder", reason: "Need implementation" });
    });

    it("should return null when no transfer", () => {
      expect(parseTransferJson("Final answer: 42")).toBeNull();
    });

    it("should return null when transfer is false", () => {
      expect(parseTransferJson('{"transfer": false, "target": "nobody"}')).toBeNull();
    });

    it("should parse inline transfer JSON", () => {
      const result = parseTransferJson('{"transfer": true, "target": "researcher", "reason": "needs research"}');
      expect(result?.transfer).toBe(true);
      expect(result?.target).toBe("researcher");
      expect(result?.reason).toBe("needs research");
    });
  });

  describe("parseManagerDecisionJson", () => {
    it("should parse assign decision", () => {
      const response =
        '```json\n{"decision": "assign", "assignments": [{"agent": "coder", "task": "implement feature"}]}\n```';
      const result = parseManagerDecisionJson(response);
      expect(result?.decision).toBe("assign");
      expect(result?.assignments).toHaveLength(1);
    });

    it("should parse complete decision", () => {
      const result = parseManagerDecisionJson('{"decision": "complete", "summary": "All done"}');
      expect(result?.decision).toBe("complete");
      expect(result?.summary).toBe("All done");
    });

    it("should parse revise decision", () => {
      const result = parseManagerDecisionJson(
        '{"decision": "revise", "revision": "Please improve the introduction"}',
      );
      expect(result?.decision).toBe("revise");
      expect(result?.revision).toBe("Please improve the introduction");
    });

    it("should return null when no valid decision found", () => {
      expect(parseManagerDecisionJson("I need more time to think")).toBeNull();
    });

    it("should return null for invalid decision type", () => {
      expect(parseManagerDecisionJson('{"decision": "unknown"}')).toBeNull();
    });
  });

  describe("parseBidJson", () => {
    it("should parse bid response", () => {
      const result = parseBidJson(
        '{"confidence": 0.85, "approach": "I can solve this using ML", "estimatedSteps": 3}',
      );
      expect(result?.confidence).toBe(0.85);
      expect(result?.approach).toBe("I can solve this using ML");
    });

    it("should default confidence to 0.5 on parse failure", () => {
      const result = parseBidJson("I can probably help with this");
      expect(result?.confidence).toBe(0.5);
      expect(result?.approach).toBe("I can probably help with this");
    });

    it("should parse bid from JSON code block", () => {
      const result = parseBidJson(
        '```json\n{"confidence": 0.9, "approach": "step by step", "estimatedSteps": 5}\n```',
      );
      expect(result?.confidence).toBe(0.9);
      expect(result?.estimatedSteps).toBe(5);
    });

    it("should clamp confidence to [0, 1]", () => {
      const high = parseBidJson('{"confidence": 1.5, "approach": "overly confident"}');
      expect(high.confidence).toBe(1);

      const low = parseBidJson('{"confidence": -0.5, "approach": "negative confidence"}');
      expect(low.confidence).toBe(0);
    });

    it("should always return a result even on empty input", () => {
      const result = parseBidJson("");
      expect(result).toBeDefined();
      expect(result.confidence).toBe(0.5);
    });
  });
});
