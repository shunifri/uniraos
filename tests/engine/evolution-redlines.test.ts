import { describe, it, expect, beforeEach } from "vitest";
import { EvolutionController } from "../../src/engine/evolution-controller.js";

describe("EvolutionController RedLines", () => {
  let ctrl: EvolutionController;

  beforeEach(() => {
    ctrl = new EvolutionController();
  });

  it("should have built-in red lines", () => {
    const redLines = ctrl.getRedLines();
    expect(redLines.length).toBeGreaterThanOrEqual(4);

    const ids = redLines.map((r) => r.id);
    expect(ids).toContain("core_skill_protection");
    expect(ids).toContain("network_capability");
    expect(ids).toContain("sandbox_file_write");
    expect(ids).toContain("max_generation_depth");
  });

  it("should block core skill overwrite", () => {
    const result = ctrl.canGenerate("stm_store", "some_parent", []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("stm_store");
  });

  it("should block ltm_ prefixed core skill overwrite", () => {
    const result = ctrl.canGenerate("ltm_search", "some_parent", []);
    expect(result.allowed).toBe(false);
  });

  it("should block recall_context overwrite", () => {
    const result = ctrl.canGenerate("recall_context", "some_parent", []);
    expect(result.allowed).toBe(false);
  });

  it("should block network:outbound capability", () => {
    const result = ctrl.canGenerate("safe_skill", "parent", ["network:outbound:tcp"]);
    expect(result.allowed).toBe(false);
  });

  it("should block filesystem:write capability", () => {
    const result = ctrl.canGenerate("writer_skill", "parent", ["filesystem:write:/etc"]);
    expect(result.allowed).toBe(false);
  });

  it("should allow safe skill generation", () => {
    const result = ctrl.canGenerate("my_custom_skill", "root", ["read"]);
    expect(result.allowed).toBe(true);
  });

  it("should add and remove custom red lines", () => {
    ctrl.addRedLine({
      id: "custom_test",
      description: "Test red line",
      blocking: true,
      check: (ctx) => ctx.skillName.startsWith("bad_") ? "Bad prefix" : null,
    });

    expect(ctrl.getRedLines().some((r) => r.id === "custom_test")).toBe(true);

    const result = ctrl.canGenerate("bad_skill", "root", []);
    expect(result.allowed).toBe(false);

    ctrl.removeRedLine("custom_test");
    expect(ctrl.getRedLines().some((r) => r.id === "custom_test")).toBe(false);

    const result2 = ctrl.canGenerate("bad_skill", "root", []);
    expect(result2.allowed).toBe(true);
  });

  it("should track violations", () => {
    ctrl.canGenerate("stm_store", "parent", []);

    const violations = ctrl.getViolations();
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].blocking).toBe(true);
  });

  it("should filter violations by time", () => {
    const before = Date.now();
    ctrl.canGenerate("stm_store", "parent", []);

    const recent = ctrl.getViolations({ since: before });
    expect(recent.length).toBeGreaterThan(0);

    const future = ctrl.getViolations({ since: Date.now() + 10000 });
    expect(future.length).toBe(0);
  });
});

describe("EvolutionController Genealogy", () => {
  let ctrl: EvolutionController;

  beforeEach(() => {
    ctrl = new EvolutionController();

    // Build a tree: root -> child1, child2; child1 -> grandchild1
    ctrl.recordGeneration("child1", "root");
    ctrl.recordGeneration("child2", "root");
    ctrl.recordGeneration("grandchild1", "child1");
  });

  it("should get ancestry", () => {
    const ancestry = ctrl.getAncestry("grandchild1");
    expect(ancestry).toEqual(["root", "child1", "grandchild1"]);
  });

  it("should get descendants", () => {
    const descendants = ctrl.getDescendants("root");
    expect(descendants).toContain("child1");
    expect(descendants).toContain("child2");
    expect(descendants).toContain("grandchild1");
  });

  it("should get siblings", () => {
    const siblings = ctrl.getSiblings("child1");
    expect(siblings).toContain("child2");
    expect(siblings).not.toContain("child1");
  });

  it("should get genealogy tree", () => {
    const tree = ctrl.getGenealogyTree();
    expect(tree.length).toBeGreaterThan(0);
  });

  it("should get genealogy stats", () => {
    const stats = ctrl.getGenealogyStats();
    expect(stats.totalGenerated).toBe(3);
    expect(stats.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it("should return empty ancestry for unknown skill", () => {
    const ancestry = ctrl.getAncestry("nonexistent");
    expect(ancestry).toEqual(["nonexistent"]);
  });

  it("should return empty descendants for leaf skill", () => {
    const descendants = ctrl.getDescendants("grandchild1");
    expect(descendants).toEqual([]);
  });
});
