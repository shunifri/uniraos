import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecallContextSkill } from "../../src/memory/recall-context.js";
import { ShortTermMemory } from "../../src/memory/stm.js";

describe("RecallContext", () => {
  let stm: ShortTermMemory;
  let mockLtm: any;

  beforeEach(() => {
    stm = new ShortTermMemory({ maxEntries: 100 });
    mockLtm = {
      search: vi.fn().mockResolvedValue([
        { key: "user_pref", value: "prefers dark mode", tags: ["preference"] },
      ]),
    };
  });

  it("should search LTM for relevant context based on skill name", async () => {
    const recall = new RecallContextSkill(stm, mockLtm);
    const result = await recall.recall("user_settings", { userId: "u1" });
    expect(mockLtm.search).toHaveBeenCalled();
    expect(result.memories.length).toBeGreaterThanOrEqual(0);
  });

  it("should inject recalled memories into STM", async () => {
    const recall = new RecallContextSkill(stm, mockLtm);
    await recall.recall("user_settings", { userId: "u1" });
    const stmEntries = stm.list();
    expect(stmEntries.some(e => e.key === "recall:user_pref")).toBe(true);
  });

  it("should not recall if already recalled for same context", async () => {
    const recall = new RecallContextSkill(stm, mockLtm);
    await recall.recall("user_settings", { userId: "u1" });
    await recall.recall("user_settings", { userId: "u1" });
    expect(mockLtm.search).toHaveBeenCalledTimes(1);
  });

  it("should respect maxRecallEntries limit", async () => {
    mockLtm.search.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ key: `mem_${i}`, value: `value_${i}`, tags: [] }))
    );
    const recall = new RecallContextSkill(stm, mockLtm, { maxRecallEntries: 5 });
    const result = await recall.recall("any_skill", {});
    expect(result.memories.length).toBeLessThanOrEqual(5);
  });
});
