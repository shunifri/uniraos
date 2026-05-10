import { describe, it, expect } from "vitest";
import { loadExampleSkills } from "../../src/server/skill-bootstrap.js";
import { SkillRegistry } from "../../src/registry/skill-registry.js";

describe("skill-bootstrap calculate", () => {
  it("should evaluate safe math expressions", async () => {
    const registry = new SkillRegistry();
    loadExampleSkills(registry);
    const skill = registry.get("calculate");
    expect(skill).toBeDefined();

    const result = await skill!.handler({ expression: "2 + 3 * 4" });
    expect(result.success).toBe(true);
    expect((result.data as any).result).toBe(14);
  });

  it("should reject invalid characters", async () => {
    const registry = new SkillRegistry();
    loadExampleSkills(registry);
    const skill = registry.get("calculate");

    const result = await skill!.handler({ expression: "process.exit(1)" });
    expect(result.success).toBe(false);
  });

  it("should reject empty expression", async () => {
    const registry = new SkillRegistry();
    loadExampleSkills(registry);
    const skill = registry.get("calculate");

    const result = await skill!.handler({ expression: "" });
    expect(result.success).toBe(false);
  });
});
