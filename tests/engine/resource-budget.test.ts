import { describe, it, expect } from "vitest";
import { EvolutionController } from "../../src/engine/evolution-controller.js";

describe("Resource Budget", () => {
  it("should allow actions within budget", () => {
    const controller = new EvolutionController();
    expect(controller.hasBudget("generate")).toBe(true);
  });

  it("should block actions when budget exhausted", () => {
    const controller = new EvolutionController();
    // Consume all budget
    for (let i = 0; i < 10; i++) {
      controller.consumeBudget("generate"); // 10 * 10 = 100
    }
    expect(controller.hasBudget("generate")).toBe(false);
  });

  it("should report budget status", () => {
    const controller = new EvolutionController();
    const status = controller.getBudgetStatus();
    expect(status.total).toBe(100);
    expect(status.remaining).toBe(100);
  });
});
