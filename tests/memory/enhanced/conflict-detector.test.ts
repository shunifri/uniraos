import { describe, it, expect, vi } from "vitest";
import { ConflictDetector } from "../../../src/memory/enhanced/conflict-detector.js";
import type { LLMProvider } from "../../../src/llm/types.js";
import type { LTMEntry } from "../../../src/memory/ltm.js";

const mockLLM = (content: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue({ content }),
} as any);

const mockEntry = (key: string, value: any): LTMEntry => ({
  id: `id-${key}`,
  key,
  value,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  accessCount: 1,
  lastAccessedAt: Date.now(),
});

describe("ConflictDetector", () => {
  it("should detect conflicts", async () => {
    const detector = new ConflictDetector();
    const response = JSON.stringify([
      {
        existingId: "candidate_0",
        existingKey: "old_name",
        description: "Name has changed",
        severity: "medium",
      },
    ]);

    const conflicts = await detector.detect(
      { key: "name", value: "New Name" },
      [mockEntry("old_name", "Old Name")],
      mockLLM(response)
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("medium");
  });

  it("should return empty array when no candidates", async () => {
    const detector = new ConflictDetector();
    const conflicts = await detector.detect(
      { key: "name", value: "Value" },
      [],
      mockLLM("[]")
    );
    expect(conflicts).toEqual([]);
  });

  it("should handle markdown code fences", async () => {
    const detector = new ConflictDetector();
    const response = `\`\`\`json
[{"existingId": "c_0", "existingKey": "k", "description": "conflict", "severity": "high"}]
\`\`\``;

    const conflicts = await detector.detect(
      { key: "key", value: "value" },
      [mockEntry("k", "v")],
      mockLLM(response)
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("high");
  });

  it("should filter invalid conflicts", async () => {
    const detector = new ConflictDetector();
    const response = JSON.stringify([
      {
        existingId: "c_0",
        existingKey: "k",
        description: "ok",
        severity: "low",
      },
      {
        existingId: "c_1",
        description: "missing key",
        severity: "medium",
      } as any,
    ]);

    const conflicts = await detector.detect(
      { key: "key", value: "value" },
      [mockEntry("k", "v")],
      mockLLM(response)
    );

    expect(conflicts).toHaveLength(1);
  });
});
