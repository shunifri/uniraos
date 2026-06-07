/**
 * Reflection 工具函数
 *
 * ROADMAP-Q3 item #7 (2026-06-08): Reflection 4 步全链路最小化版 — loop-detection 算法.
 * 完整 stream events / maxReflections 上限 / LLM 反思提示等仍入 ROADMAP-Q3 next backlog.
 *
 * 设计要点:
 * - 检测"同一 tool_call (同名 + 同参) 连续 3 次"作为 loop 信号
 * - 检测"同一 assistant text 连续 3 次"作为无进展信号
 * - threshold=3 (默认) 可由调用方覆盖, 但不要 < 2 (正常 retry pattern)
 */
import type { Message } from "../llm/types.js";

/**
 * 提取消息中的"指纹" — 用于比对是否同一 tool/响应重复.
 *
 * 同名 tool 但参数不同时, 视为不同 (e.g. retry with corrected params = 不同指纹).
 * 纯文本响应: 归一化空白后取前 80 字符, 防止长文微差干扰.
 */
export function fingerprintOf(msg: Message): string {
  // Tool call: 同名 + 同参 JSON
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    const tc = msg.toolCalls[0];
    return `tool:${tc.name}:${stableStringify(tc.arguments)}`;
  }
  // 纯文本响应
  if (msg.content && typeof msg.content === "string") {
    const normalized = msg.content.replace(/\s+/g, " ").trim().slice(0, 80);
    return `text:${normalized}`;
  }
  return `role:${msg.role}:empty`;
}

/**
 * 检测消息历史中是否存在"loop" — 同一指纹连续 N 次出现.
 *
 * 默认 threshold=3: 连续 3 次相同 tool_call 或相同 response 文本视为 loop.
 *
 * 返回 true 表示检测到 loop, false 表示没有.
 *
 * 边界:
 * - 历史 < threshold 时永远返回 false
 * - 只考虑 assistant 消息 (含 tool_calls 或纯文本), 跳过 system / user / tool messages
 *   — 这些是上下文噪音, 不应打断 loop 判定
 * - 从尾部向前取 fingerprint 链, 第一个非 assistant 就停止
 */
export function detectLoop(messages: Message[], threshold: number = 3): boolean {
  if (threshold < 2) throw new Error("detectLoop threshold must be >= 2");

  // 过滤: 只看 assistant 消息
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  if (assistantMessages.length < threshold) return false;

  // 从尾部向前取 fingerprint 链
  let lastFp: string | undefined;
  let runLength = 0;
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const fp = fingerprintOf(assistantMessages[i]);
    if (lastFp === undefined) {
      lastFp = fp;
      runLength = 1;
      continue;
    }
    if (fp === lastFp) {
      runLength++;
      if (runLength >= threshold) return true;
    } else {
      return false;
    }
  }
  return false;
}

/**
 * 稳定的 JSON 字符串化 — key 排序, 保证 {a:1,b:2} 和 {b:2,a:1} 同 fingerprint.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}