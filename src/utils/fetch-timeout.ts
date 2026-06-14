/**
 * Create an AbortSignal that aborts after the given milliseconds.
 * Falls back to AbortController + setTimeout on older runtimes.
 */
export function createTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (AbortSignal as any).timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timeout after ${ms}ms`));
  }, ms);
  // Clean up timer if the request completes before timeout
  const cleanup = () => clearTimeout(timer);
  controller.signal.addEventListener("abort", cleanup, { once: true });
  return controller.signal;
}
