import { describe, it, expect } from "vitest";
import { CircuitBreakerManager, CircuitOpenError } from "../../src/engine/circuit-breaker.js";
import { CircuitState } from "../../src/types/index.js";

describe("CircuitBreakerManager", () => {
  it("should allow requests when closed", () => {
    const cb = new CircuitBreakerManager();
    cb.check("skill-a", { failureThreshold: 3, recoveryTimeMs: 1000, halfOpenRequests: 2 });
    expect(cb.getState("skill-a")).toBe(CircuitState.CLOSED);
  });

  it("should open after consecutive failures", () => {
    const cb = new CircuitBreakerManager();
    const config = { failureThreshold: 2, recoveryTimeMs: 1000, halfOpenRequests: 1 };
    cb.recordFailure("skill-b", config);
    cb.recordFailure("skill-b", config);
    expect(cb.getState("skill-b")).toBe(CircuitState.OPEN);
    expect(() => cb.check("skill-b", config)).toThrow(CircuitOpenError);
  });

  it("should transition to half-open after recovery time", () => {
    const cb = new CircuitBreakerManager();
    const config = { failureThreshold: 1, recoveryTimeMs: 50, halfOpenRequests: 1 };
    cb.recordFailure("skill-c", config);
    expect(cb.getState("skill-c")).toBe(CircuitState.OPEN);

    // 等待恢复时间
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        cb.check("skill-c", config);
        expect(cb.getState("skill-c")).toBe(CircuitState.HALF_OPEN);
        resolve();
      }, 100);
    });
  });

  it("should close after enough half-open successes", () => {
    const cb = new CircuitBreakerManager();
    const config = { failureThreshold: 1, recoveryTimeMs: 50, halfOpenRequests: 2 };
    cb.recordFailure("skill-d", config);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        cb.check("skill-d", config); // -> HALF_OPEN
        cb.recordSuccess("skill-d", config);
        expect(cb.getState("skill-d")).toBe(CircuitState.HALF_OPEN);
        cb.recordSuccess("skill-d", config);
        expect(cb.getState("skill-d")).toBe(CircuitState.CLOSED);
        resolve();
      }, 100);
    });
  });

  it("should track stats", () => {
    const cb = new CircuitBreakerManager();
    const config = { failureThreshold: 5, recoveryTimeMs: 1000, halfOpenRequests: 2 };
    cb.recordSuccess("skill-e", config, 100);
    cb.recordSuccess("skill-e", config, 200);
    cb.recordFailure("skill-e", config, 100);

    const stats = cb.getStats("skill-e");
    expect(stats).not.toBeNull();
    expect(stats!.totalRequests).toBe(3);
    expect(stats!.totalSuccesses).toBe(2);
    expect(stats!.totalFailures).toBe(1);
    expect(stats!.state).toBe(CircuitState.CLOSED);
  });

  it("should count slow calls", () => {
    const cb = new CircuitBreakerManager();
    const config = { failureThreshold: 5, recoveryTimeMs: 1000, halfOpenRequests: 2, slowCallThresholdMs: 100 };
    cb.recordSuccess("skill-f", config, 50);  // fast
    cb.recordSuccess("skill-f", config, 150); // slow
    cb.recordFailure("skill-f", config, 200); // slow failure

    const stats = cb.getStats("skill-f");
    expect(stats!.slowCalls).toBe(2);
  });
});
