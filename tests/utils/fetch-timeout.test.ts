import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTimeoutSignal } from "../../src/utils/fetch-timeout.js";

describe("fetch-timeout", () => {
  describe("createTimeoutSignal", () => {
    let originalTimeout: any;

    beforeEach(() => {
      originalTimeout = (AbortSignal as any).timeout;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalTimeout) {
        (AbortSignal as any).timeout = originalTimeout;
      } else {
        delete (AbortSignal as any).timeout;
      }
    });

    it("should use AbortSignal.timeout when available", () => {
      const mockSignal = new AbortController().signal;
      (AbortSignal as any).timeout = vi.fn().mockReturnValue(mockSignal);

      const signal = createTimeoutSignal(5000);
      expect((AbortSignal as any).timeout).toHaveBeenCalledWith(5000);
      expect(signal).toBe(mockSignal);
    });

    it("should fallback to AbortController + setTimeout when AbortSignal.timeout is unavailable", () => {
      delete (AbortSignal as any).timeout;

      const signal = createTimeoutSignal(100);
      expect(signal.aborted).toBe(false);
    });

    it("should abort after the specified timeout using fallback", async () => {
      delete (AbortSignal as any).timeout;

      const signal = createTimeoutSignal(50);
      expect(signal.aborted).toBe(false);

      await new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          expect(signal.aborted).toBe(true);
          resolve(undefined);
        });
      });
    });

    it("should include timeout error message in fallback abort", async () => {
      delete (AbortSignal as any).timeout;

      const signal = createTimeoutSignal(50);
      const reason = await new Promise<Error>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve(signal.reason as Error);
        });
      });
      expect(reason.message).toBe("Request timeout after 50ms");
    });

    it("should create a signal that is not initially aborted", () => {
      delete (AbortSignal as any).timeout;

      const signal = createTimeoutSignal(1000);
      expect(signal.aborted).toBe(false);
      expect(typeof signal.addEventListener).toBe("function");
    });
  });
});
