/**
 * Evolution Controller SQLite 持久化测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EvolutionController } from "../../src/engine/evolution-controller.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const testDbDir = join(process.cwd(), ".test-raos");
const testDbPath = join(testDbDir, "test-evolution.db");

beforeEach(() => {
  if (existsSync(testDbDir)) {
    rmSync(testDbDir, { recursive: true });
  }
  mkdirSync(testDbDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDbDir)) {
    rmSync(testDbDir, { recursive: true });
  }
});

describe("EvolutionController Persistence", () => {
  it("should initialize database on creation with dbPath", () => {
    const controller = new EvolutionController(undefined, testDbPath);

    expect(existsSync(testDbPath)).toBe(true);
    controller.close();
  });

  it("should persist skill generation to database", () => {
    const controller = new EvolutionController(undefined, testDbPath);

    controller.recordGeneration("skill_gen_1", "root_skill");
    controller.recordGeneration("skill_gen_2", "root_skill");

    controller.close();

    // Create new controller with same db path - should restore data
    const controller2 = new EvolutionController(undefined, testDbPath);
    const history = controller2.getGenerationHistory();

    expect(history).toHaveLength(2);
    expect(history[0].name).toBe("skill_gen_1");
    expect(history[1].name).toBe("skill_gen_2");
    expect(history[0].generatedBy).toBe("root_skill");

    controller2.close();
  });

  it("should persist red line violations to database", () => {
    const controller = new EvolutionController(undefined, testDbPath);

    // Trigger a violation
    controller.checkRedLines({
      skillName: "bad_skill",
      generatedBy: "parent",
      capabilities: ["network:outbound:tcp"],
      depth: 1,
    });

    controller.close();

    // Create new controller with same db path
    const controller2 = new EvolutionController(undefined, testDbPath);
    const violations = controller2.getViolations();

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].skillName).toBe("bad_skill");

    controller2.close();
  });

  it("should persist pending approvals to database", () => {
    const controller = new EvolutionController({
      requireHumanApproval: true,
    }, testDbPath);

    const id = controller.submitForApproval(
      "new_skill",
      "A new skill",
      "async function() { return 42; }",
      ["read"],
      "generator_skill"
    );

    controller.close();

    // Create new controller with same db path
    const controller2 = new EvolutionController(
      { requireHumanApproval: true },
      testDbPath
    );
    const pending = controller2.getPendingApprovals();

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].name).toBe("new_skill");

    controller2.close();
  });

  it("should restore full state across restarts", () => {
    const controller = new EvolutionController(undefined, testDbPath);

    // Generate some skills
    controller.recordGeneration("skill_a", "root");
    controller.recordGeneration("skill_b", "skill_a");
    controller.recordGeneration("skill_c", "skill_a");

    // Trigger a violation
    controller.checkRedLines({
      skillName: "bad_skill",
      generatedBy: "root",
      capabilities: ["network:outbound:tcp"],
      depth: 1,
    });

    controller.close();

    // Create new controller and verify state
    const controller2 = new EvolutionController(undefined, testDbPath);

    // Check generations
    const history = controller2.getGenerationHistory();
    expect(history).toHaveLength(3);

    // Check violations
    const violations = controller2.getViolations();
    expect(violations.length).toBeGreaterThan(0);

    // Check genealogy
    const ancestors = controller2.getAncestry("skill_b");
    expect(ancestors).toContain("skill_b");
    expect(ancestors).toContain("skill_a");
    expect(ancestors).toContain("root");

    controller2.close();
  });

  it("should work without database when dbPath is undefined", () => {
    const controller = new EvolutionController();

    controller.recordGeneration("skill_x", "root");

    const history = controller.getGenerationHistory();
    expect(history).toHaveLength(1);
    expect(history[0].name).toBe("skill_x");

    controller.close();
  });

  it("should handle database close gracefully", () => {
    const controller = new EvolutionController(undefined, testDbPath);

    controller.recordGeneration("skill_test", "root");

    // Close should not throw
    expect(() => {
      controller.close();
    }).not.toThrow();

    // Second close should not throw
    expect(() => {
      controller.close();
    }).not.toThrow();
  });
});
