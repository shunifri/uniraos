import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoConsolidator } from "../../src/memory/auto-consolidator.js";
import { ShortTermMemory } from "../../src/memory/stm.js";

describe("AutoConsolidator", () => {
  let stm: ShortTermMemory;
  let mockLtm: any;

  beforeEach(() => {
    stm = new ShortTermMemory({ maxEntries: 100 });
    mockLtm = { store: vi.fn().mockResolvedValue(undefined) };
  });

  it("should promote hot STM entries to LTM", async () => {
    // Create an entry and access it multiple times
    stm.set("important_fact", "user likes dark mode", "test");
    stm.get("important_fact");
    stm.get("important_fact");
    stm.get("important_fact"); // 3+ accesses

    const consolidator = new AutoConsolidator(stm, mockLtm, {
      accessThreshold: 3,
      minAgeMs: 0, // skip age check for test
    });

    const result = await consolidator.consolidate();
    expect(result.promoted).toContain("important_fact");
    expect(mockLtm.store).toHaveBeenCalledWith(
      "important_fact",
      "user likes dark mode",
      expect.objectContaining({ tags: ["consolidated", "from_stm"] }),
    );
  });

  it("should skip entries with low access count", async () => {
    stm.set("one_time", "value", "test");

    const consolidator = new AutoConsolidator(stm, mockLtm, {
      accessThreshold: 3,
      minAgeMs: 0,
    });

    const result = await consolidator.consolidate();
    expect(result.promoted).toHaveLength(0);
  });

  it("should skip recall: prefixed entries", async () => {
    stm.set("recall:mem1", "recalled data", "recall_context");
    stm.get("recall:mem1");
    stm.get("recall:mem1");
    stm.get("recall:mem1");

    const consolidator = new AutoConsolidator(stm, mockLtm, {
      accessThreshold: 3,
      minAgeMs: 0,
    });

    const result = await consolidator.consolidate();
    expect(result.promoted).toHaveLength(0);
  });

  it("should not promote same entry twice", async () => {
    stm.set("fact", "value", "test");
    for (let i = 0; i < 5; i++) stm.get("fact");

    const consolidator = new AutoConsolidator(stm, mockLtm, {
      accessThreshold: 3,
      minAgeMs: 0,
    });

    await consolidator.consolidate();
    await consolidator.consolidate();
    expect(mockLtm.store).toHaveBeenCalledTimes(1);
  });
});
