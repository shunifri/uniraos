import { describe, it, expect } from "vitest";
import { runInSandbox } from "../../src/engine/worker-sandbox.js";

describe("Worker Thread Sandbox", () => {
  it("executes simple code and returns result", async () => {
    const result = await runInSandbox(
      `return { success: true, data: { sum: params.a + params.b } };`,
      { a: 3, b: 5 },
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true, data: { sum: 8 } });
  });

  it("catches errors in sandboxed code", async () => {
    const result = await runInSandbox(
      `throw new Error("sandbox boom");`,
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("sandbox boom");
  });

  it("enforces timeout", async () => {
    const result = await runInSandbox(
      `while(true) {}; return { success: true };`,
      {},
      { timeout: 200 },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
    expect(result.durationMs).toBeLessThan(1000);
  }, 5000);

  it("reports duration", async () => {
    const result = await runInSandbox(
      `return { success: true, data: "fast" };`,
      {},
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it("isolates from main thread globals", async () => {
    const result = await runInSandbox(
      `return { success: true, data: typeof globalThis.__orchestrator };`,
      {},
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true, data: "undefined" });
  });
});
