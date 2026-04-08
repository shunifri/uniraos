import { describe, it, expect } from "vitest";
import { MetricsCollector } from "../../src/engine/metrics.js";

describe("MetricsCollector Degradation Detection", () => {
  it("should detect sharp success rate drop", () => {
    const metrics = new MetricsCollector();

    // 10 successful calls
    for (let i = 0; i < 10; i++) {
      metrics.record("test_skill", 100, true);
    }
    // 10 failed calls
    for (let i = 0; i < 10; i++) {
      metrics.record("test_skill", 100, false, "Error");
    }

    const degraded = metrics.checkDegradation(0.3);
    expect(degraded.length).toBe(1);
    expect(degraded[0].skillName).toBe("test_skill");
    expect(degraded[0].recentDrop).toBeGreaterThan(0.3);
  });

  it("should not flag stable metrics", () => {
    const metrics = new MetricsCollector();
    for (let i = 0; i < 20; i++) {
      metrics.record("stable_skill", 100, true);
    }

    const degraded = metrics.checkDegradation(0.3);
    expect(degraded.length).toBe(0);
  });

  it("should ignore skills with too few calls", () => {
    const metrics = new MetricsCollector();
    for (let i = 0; i < 5; i++) {
      metrics.record("new_skill", 100, false, "Error");
    }

    const degraded = metrics.checkDegradation(0.3);
    expect(degraded.length).toBe(0);
  });
});
