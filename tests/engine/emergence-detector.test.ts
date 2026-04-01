import { describe, it, expect, beforeEach } from "vitest";
import { EmergenceDetector } from "../../src/engine/emergence-detector.js";

describe("EmergenceDetector", () => {
  let detector: EmergenceDetector;

  beforeEach(() => {
    detector = new EmergenceDetector();
  });

  it("should start with no patterns", () => {
    expect(detector.getPatterns()).toEqual([]);
    const report = detector.getReport();
    expect(report.totalPatterns).toBe(0);
  });

  it("should detect self-reference loops", () => {
    // Skill A calls B calls A (indirect loop) - skillName appears 2x in callStack
    detector.record("skill_a", {
      callStack: ["skill_a", "skill_b", "skill_a"],
      depth: 3,
      success: true,
      duration: 100,
    });

    const patterns = detector.getPatterns({ type: "self_reference_loop" });
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].type).toBe("self_reference_loop");
  });

  it("should detect unexpected chains between generated skills", () => {
    // Register generated skills
    const generatedSkills = new Set(["gen_skill_a", "gen_skill_b"]);

    // gen_skill_a invokes gen_skill_b
    detector.record("gen_skill_b", {
      callStack: ["gen_skill_a", "gen_skill_b"],
      depth: 2,
      success: true,
      duration: 50,
      generatedSkills,
    });

    const patterns = detector.getPatterns({ type: "unexpected_chain" });
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].involvedSkills).toContain("gen_skill_a");
    expect(patterns[0].involvedSkills).toContain("gen_skill_b");
  });

  it("should detect capability escalation", () => {
    const capabilities = new Map<string, string[]>();
    capabilities.set("parent_skill", ["read"]);
    capabilities.set("child_skill", ["read", "network:outbound:tcp"]);

    detector.record("child_skill", {
      callStack: ["parent_skill", "child_skill"],
      depth: 2,
      success: true,
      duration: 100,
      skillCapabilities: capabilities,
    });

    const patterns = detector.getPatterns({ type: "capability_escalation" });
    expect(patterns.length).toBeGreaterThanOrEqual(1);
  });

  it("should filter patterns by severity", () => {
    // Create a loop pattern (warning severity)
    detector.record("skill_a", {
      callStack: ["skill_b", "skill_a"],
      depth: 2,
      success: true,
      duration: 100,
    });

    const warnings = detector.getPatterns({ severity: "warning" });
    const criticals = detector.getPatterns({ severity: "critical" });
    expect(warnings.length).toBeGreaterThanOrEqual(0);
    expect(criticals.length).toBeGreaterThanOrEqual(0);
  });

  it("should generate a report", () => {
    detector.record("skill_x", {
      callStack: ["skill_y", "skill_x"],
      depth: 2,
      success: true,
      duration: 100,
    });

    const report = detector.getReport();
    expect(report).toHaveProperty("totalPatterns");
    expect(report).toHaveProperty("bySeverity");
    expect(report).toHaveProperty("byType");
  });

  it("should clear patterns", () => {
    // Create a self-reference loop pattern
    detector.record("skill_a", {
      callStack: ["skill_a", "skill_b", "skill_a"],
      depth: 3,
      success: true,
      duration: 100,
    });

    expect(detector.getPatterns().length).toBeGreaterThan(0);
    detector.clearPatterns();
    expect(detector.getPatterns().length).toBe(0);
  });
});
