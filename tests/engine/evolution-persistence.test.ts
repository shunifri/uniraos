/**
 * Evolution Controller 基础功能测试（内存逻辑，不涉及数据库持久化）
 * 持久化逻辑已迁移至 EvolutionRepository
 */
import { describe, it, expect } from "vitest";
import { EvolutionController } from "../../src/engine/evolution-controller.js";

describe("EvolutionController Memory Logic", () => {
  it("should record generations in memory", async () => {
    const controller = new EvolutionController();

    await controller.recordGeneration("skill_gen_1", "root_skill");
    await controller.recordGeneration("skill_gen_2", "root_skill");

    const history = controller.getGenerationHistory();

    expect(history).toHaveLength(2);
    expect(history[0].name).toBe("skill_gen_1");
    expect(history[1].name).toBe("skill_gen_2");
    expect(history[0].generatedBy).toBe("root_skill");
  });

  it("should track red line violations in memory", () => {
    const controller = new EvolutionController();

    // Trigger a violation
    controller.checkRedLines({
      skillName: "bad_skill",
      generatedBy: "parent",
      capabilities: ["network:outbound:tcp"],
      depth: 1,
    });

    const violations = controller.getViolations();

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].skillName).toBe("bad_skill");
  });

  it("should track pending approvals in memory", async () => {
    const controller = new EvolutionController({
      requireHumanApproval: true,
    });

    const id = await controller.submitForApproval(
      "new_skill",
      "A new skill",
      "async function() { return 42; }",
      ["read"],
      "generator_skill"
    );

    const pending = controller.getPendingApprovals();

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].name).toBe("new_skill");
  });

  it("should track full state (generations + violations + approvals)", async () => {
    const controller = new EvolutionController();

    // Generate some skills
    await controller.recordGeneration("skill_a", "root");
    await controller.recordGeneration("skill_b", "skill_a");
    await controller.recordGeneration("skill_c", "skill_a");

    // Trigger a violation
    controller.checkRedLines({
      skillName: "bad_skill",
      generatedBy: "root",
      capabilities: ["network:outbound:tcp"],
      depth: 1,
    });

    // Check generations
    const history = controller.getGenerationHistory();
    expect(history).toHaveLength(3);

    // Check violations
    const violations = controller.getViolations();
    expect(violations.length).toBeGreaterThan(0);

    // Check genealogy
    const ancestors = controller.getAncestry("skill_b");
    expect(ancestors).toContain("skill_b");
    expect(ancestors).toContain("skill_a");
    expect(ancestors).toContain("root");
  });

  it("should work without init (memory-only mode)", async () => {
    const controller = new EvolutionController();

    await controller.recordGeneration("skill_x", "root");

    const history = controller.getGenerationHistory();
    expect(history).toHaveLength(1);
    expect(history[0].name).toBe("skill_x");
  });
});
