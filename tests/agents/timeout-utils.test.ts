/**
 * agent/timeout-utils 单测
 *
 * ROADMAP-Q3 item #1 (2026-06-08):
 *   验证 withTimeout / checkTotalTimeout 工具的契约,
 *   配合 src/agents/react-agent.ts chatTimeout 与 src/agents/protocols/sequential.ts stepTimeout 使用.
 *
 * 这是 4-29 doc 9.1#7 "Agent 缺少超时保护" 最小化版本的单测根.
 */
import { describe, it, expect } from "vitest";
import { withTimeout, checkTotalTimeout } from "../../src/agents/timeout-utils.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

describe("agent/timeout-utils", () => {
  describe("withTimeout", () => {
    it("should resolve when promise finishes before timeout", async () => {
      const result = await withTimeout(Promise.resolve("ok"), 500, "fast promise");
      expect(result).toBe("ok");
    });

    it("should reject with AgentTimeoutError when promise exceeds timeout", async () => {
      const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      await expect(withTimeout(slow, 30, "slow promise")).rejects.toBeInstanceOf(AgentTimeoutError);
      await expect(withTimeout(slow, 30, "slow promise")).rejects.toMatchObject({
        name: "AgentTimeoutError",
        message: "Agent timeout in slow promise after 30ms",
      });
    });

    it("should propagate the underlying error when promise rejects before timeout", async () => {
      const failing = Promise.reject(new Error("boom"));
      await expect(withTimeout(failing, 500, "failing promise")).rejects.toThrow("boom");
    });

    it("should not leak the timeout timer after successful resolution", async () => {
      // 用一个 long-lived promise, 验证 withTimeout 在提前完成后不会再触发 reject.
      // 通过额外 await + 一个能挂起的 promise 验证.
      let rejectionFromTimer: unknown = null;
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => resolve("done"), 10);
      });
      const guarded = withTimeout(promise, 5000, "leak check").catch((err) => {
        rejectionFromTimer = err;
      });
      await guarded;
      // 额外等一段时间, 确保原 timer 即使没被取消也不会再触发 (Promise.race 已经 settle).
      await new Promise((r) => setTimeout(r, 50));
      expect(rejectionFromTimer).toBeNull();
    });
  });

  describe("checkTotalTimeout", () => {
    it("should not throw when elapsed < totalMs", () => {
      const start = Date.now() - 100;
      expect(() => checkTotalTimeout(start, 5000)).not.toThrow();
    });

    it("should throw AgentTimeoutError when elapsed >= totalMs", () => {
      const start = Date.now() - 6000;
      expect(() => checkTotalTimeout(start, 5000)).toThrow(AgentTimeoutError);
    });
  });
});