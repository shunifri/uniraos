import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { SkillRegistry } from "../../src/registry/index.js";
import { WALManager } from "../../src/wal/index.js";
import { defineSkill } from "../../src/types/index.js";

describe("EmergenceDetector Integration", () => {
  let engine: ExecutionEngine;
  let registry: SkillRegistry;
  let mockDetector: any;

  beforeEach(() => {
    registry = new SkillRegistry();
    const wal = new WALManager();
    engine = new ExecutionEngine(registry, wal);
    mockDetector = { record: vi.fn() };
    engine.setEmergenceDetector(mockDetector);

    registry.register(defineSkill({
      name: "test_skill",
      handler: async () => ({ success: true, data: "ok" }),
    }));
    registry.register(defineSkill({
      name: "failing_skill",
      handler: async () => { throw new Error("intentional"); },
    }));
  });

  it("should call detector.record() on successful execution", async () => {
    await engine.execute("test_skill", {});
    expect(mockDetector.record).toHaveBeenCalledWith(
      "test_skill",
      expect.objectContaining({ success: true }),
    );
  });

  it("should call detector.record() on failed execution", async () => {
    try { await engine.execute("failing_skill", {}); } catch { /* noop */ }
    expect(mockDetector.record).toHaveBeenCalledWith(
      "failing_skill",
      expect.objectContaining({ success: false }),
    );
  });
});
