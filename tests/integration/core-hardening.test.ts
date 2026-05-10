import { describe, it, expect, beforeAll } from "vitest";
import { SkillRegistry } from "../../src/registry/index.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/index.js";
import { skillsToTools } from "../../src/llm/tool-bridge.js";
import { defineSkill } from "../../src/types/index.js";
import { parseHandoffJson } from "../../src/agents/protocols/parse-helpers.js";
import { RecallContextSkill } from "../../src/memory/recall-context.js";
import { MemoryGarbageCollector } from "../../src/memory/gc-collect.js";
import { ShortTermMemory } from "../../src/memory/stm.js";

describe("Core Hardening Integration", () => {
  let registry: SkillRegistry;
  let engine: ExecutionEngine;

  beforeAll(() => {
    registry = new SkillRegistry();
    const wal = new WALManager();
    engine = new ExecutionEngine(registry, wal);
  });

  it("typed skill should generate proper tool definition and validate params", async () => {
    const skill = defineSkill({
      name: "integration_search",
      description: "Search integration test",
      handler: async (params) => ({
        success: true,
        data: { query: params.query, results: [] },
      }),
      paramSchema: {
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results" },
        },
        required: ["query"],
      },
    });

    registry.register(skill);

    // Tool Bridge generates typed definition
    const tools = skillsToTools([skill]);
    expect(tools[0].function.parameters.properties).toHaveProperty("query");
    expect(tools[0].function.parameters.required).toContain("query");

    // Execution validates params
    const result = await engine.execute("integration_search", { query: "test" });
    expect(result.success).toBe(true);

    // Missing required param throws
    await expect(engine.execute("integration_search", {})).rejects.toThrow(/query/);
  });

  it("protocol parsers handle both JSON and legacy formats", () => {
    // JSON format
    const jsonHandoff = parseHandoffJson('```json\n{"handoff": true, "target": "coder"}\n```');
    expect(jsonHandoff?.target).toBe("coder");

    // Legacy format
    const legacyHandoff = parseHandoffJson("[HANDOFF:researcher] analyze data");
    expect(legacyHandoff?.target).toBe("researcher");

    // No handoff
    expect(parseHandoffJson("I'll answer directly.")).toBeNull();
  });

  it("recall_context and gc_collect work together", async () => {
    const stm = new ShortTermMemory({ maxEntries: 100 });
    const mockLtm = {
      search: async () => [{ key: "mem1", value: "recalled data", tags: [] }],
      list: () => [
        { key: "active", value: "v", accessCount: 10, lastAccessedAt: Date.now(), createdAt: Date.now() },
        { key: "stale", value: "v", accessCount: 0, lastAccessedAt: Date.now() - 90 * 86400_000, createdAt: Date.now() - 200 * 86400_000 },
      ],
      archive: async () => ({ archived: 1 }),
    };

    // recall_context injects into STM
    const recall = new RecallContextSkill(stm, mockLtm);
    await recall.recall("test_skill", { key: "value" });
    expect(stm.list().some(e => e.key === "recall:mem1")).toBe(true);

    // gc_collect cleans up
    const gc = new MemoryGarbageCollector(stm as any, mockLtm as any);
    const report = await gc.collect();
    expect(report.stmCleaned).toBeGreaterThanOrEqual(0);
    expect(report.ltmArchived).toBeGreaterThanOrEqual(0);
  });
});
