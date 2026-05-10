/**
 * 智能体超时工具
 *
 * 为协议执行器和 ReAct 循环提供统一的超时保护。
 */
import { AgentTimeoutError } from "../utils/errors.js";

/**
 * 用 Promise.race 为 Promise 添加超时保护
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  context: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AgentTimeoutError(context, ms)), ms),
    ),
  ]);
}

/**
 * 检查总执行时间是否已超出限制
 */
export function checkTotalTimeout(startTime: number, totalMs: number): void {
  if (Date.now() - startTime > totalMs) {
    throw new AgentTimeoutError("total protocol execution", totalMs);
  }
}
