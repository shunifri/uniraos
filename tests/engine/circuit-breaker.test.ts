import { describe, it, expect } from "vitest";
import { CircuitBreakerManager, CircuitOpenError } from "../../src/engine/circuit-breaker.js";
import { CircuitState } from "../../src/types/skill.js";

describe("CircuitBreakerManager", () => {
  const config = {
    failureThreshold: 3,
    recoveryTimeMs: 100,
    halfOpenRequests: 2,
  };

  it("starts in CLOSED state", () => {
    const cb = new CircuitBreakerManager();
    expect(cb.getState("test")).toBe(CircuitState.CLOSED);
  });

  it("stays CLOSED under threshold", () => {
    const cb = new CircuitBreakerManager();
    cb.recordFailure("test", config);
    cb.recordFailure("test", config);
    expect(cb.getState("test")).toBe(CircuitState.CLOSED);
    // should not throw
    cb.check("test", config);
  });

  it("opens after reaching failure threshold", () => {
    const cb = new CircuitBreakerManager();
    cb.recordFailure("test", config);
    cb.recordFailure("test", config);
    cb.recordFailure("test", config);
    expect(cb.getState("test")).toBe(CircuitState.OPEN);
    expect(() => cb.check("test", config)).toThrow(CircuitOpenError);
  });

  it("resets failure count on success", () => {
    const cb = new CircuitBreakerManager();
    cb.recordFailure("test", config);
    cb.recordFailure("test", config);
    cb.recordSuccess("test", config);
    cb.recordFailure("test", config);
    // only 1 consecutive failure now, should stay CLOSED
    expect(cb.getState("test")).toBe(CircuitState.CLOSED);
  });

  it("transitions to HALF_OPEN after recovery time", async () => {
    const fastConfig = { ...config, recoveryTimeMs: 20 };
    const cb = new CircuitBreakerManager();
    cb.recordFailure("test", fastConfig);
    cb.recordFailure("test", fastConfig);
    cb.recordFailure("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 30));
    // check should transition to HALF_OPEN
    cb.check("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.HALF_OPEN);
  });

  it("closes after enough HALF_OPEN successes", async () => {
    const fastConfig = { ...config, recoveryTimeMs: 10, halfOpenRequests: 2 };
    const cb = new CircuitBreakerManager();
    cb.recordFailure("test", fastConfig);
    cb.recordFailure("test", fastConfig);
    cb.recordFailure("test", fastConfig);

    await new Promise((r) => setTimeout(r, 15));
    cb.check("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.HALF_OPEN);

    cb.recordSuccess("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.HALF_OPEN);
    cb.recordSuccess("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.CLOSED);
  });

  it("re-opens on failure during HALF_OPEN", async () => {
    const fastConfig = { ...config, recoveryTimeMs: 10 };
    const cb = new CircuitBreakerManager();
    cb.recordFailure("test", fastConfig);
    cb.recordFailure("test", fastConfig);
    cb.recordFailure("test", fastConfig);

    await new Promise((r) => setTimeout(r, 15));
    cb.check("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.HALF_OPEN);

    cb.recordFailure("test", fastConfig);
    expect(cb.getState("test")).toBe(CircuitState.OPEN);
  });

  it("does nothing without config", () => {
    const cb = new CircuitBreakerManager();
    cb.check("test", undefined);
    cb.recordSuccess("test", undefined);
    cb.recordFailure("test", undefined);
    expect(cb.getState("test")).toBe(CircuitState.CLOSED);
  });
});
