/**
 * Reflection 工具单测
 *
 * ROADMAP-Q3 item #7 (2026-06-08): 验证 detectLoop 算法 + fingerprintOf 稳定性.
 */
import { describe, it, expect } from "vitest";
import { detectLoop, fingerprintOf } from "../../src/agents/reflection-utils.js";
import type { Message } from "../../src/llm/types.js";

function toolMsg(name: string, args: Record<string, unknown>, id: string): Message {
  return {
    role: "assistant",
    content: "...",
    toolCalls: [{ id, name, arguments: args }],
  };
}

function textMsg(role: "assistant" | "user" | "system", text: string): Message {
  return { role, content: text };
}

describe("fingerprintOf", () => {
  it("differentiates tool calls by name + sorted args", () => {
    const a = toolMsg("search", { q: "hello" }, "t1");
    const b = toolMsg("search", { q: "world" }, "t2");
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });

  it("treats same-name same-args tool calls as identical regardless of key order", () => {
    const a = toolMsg("search", { a: 1, b: 2 }, "t1");
    const b = toolMsg("search", { b: 2, a: 1 }, "t2");
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it("normalizes whitespace in text content", () => {
    const a = textMsg("assistant", "Hello   world\n");
    const b = textMsg("assistant", "Hello world");
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it("truncates long text to 80 chars", () => {
    const a = textMsg("assistant", "x".repeat(200));
    const b = textMsg("assistant", "x".repeat(200) + "tail");
    // both truncated to first 80, so identical fingerprint
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });
});

describe("detectLoop", () => {
  it("returns false for empty history", () => {
    expect(detectLoop([])).toBe(false);
  });

  it("returns false when history is shorter than threshold", () => {
    const history = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "x" }, "t2"),
    ];
    expect(detectLoop(history, 3)).toBe(false);
  });

  it("detects loop when same tool called 3 times consecutively", () => {
    const history = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "x" }, "t2"),
      toolMsg("search", { q: "x" }, "t3"),
    ];
    expect(detectLoop(history)).toBe(true);
  });

  it("does not detect loop when tool calls differ", () => {
    const history = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "y" }, "t2"),
      toolMsg("search", { q: "x" }, "t3"),
    ];
    expect(detectLoop(history)).toBe(false);
  });

  it("detects loop for repeated identical text response", () => {
    const history = [
      textMsg("assistant", "I am stuck"),
      textMsg("assistant", "I am stuck"),
      textMsg("assistant", "I am stuck"),
    ];
    expect(detectLoop(history)).toBe(true);
  });

  it("respects custom threshold (2)", () => {
    const history = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "x" }, "t2"),
    ];
    expect(detectLoop(history, 2)).toBe(true);
    expect(detectLoop(history, 3)).toBe(false);
  });

  it("respects custom threshold (4) and boundary", () => {
    const h4 = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "x" }, "t2"),
      toolMsg("search", { q: "x" }, "t3"),
      toolMsg("search", { q: "x" }, "t4"),
    ];
    expect(detectLoop(h4, 4)).toBe(true);
    const h3 = h4.slice(0, 3);
    expect(detectLoop(h3, 4)).toBe(false);
  });

  it("rejects threshold < 2", () => {
    expect(() => detectLoop([], 1)).toThrow();
  });

  it("treats interleaved runs as no-loop when tail run < threshold", () => {
    const history = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "y" }, "t2"),
      toolMsg("search", { q: "x" }, "t3"),
      toolMsg("search", { q: "x" }, "t4"),
    ];
    // tail 是 y, x, x → y 打断前一个 run, x,x 只有 2 次相同 → no loop
    expect(detectLoop(history)).toBe(false);
  });

  it("detects loop only at the tail, not in earlier runs", () => {
    const history = [
      toolMsg("search", { q: "x" }, "t1"),
      toolMsg("search", { q: "x" }, "t2"),
      toolMsg("search", { q: "x" }, "t3"),
      toolMsg("search", { q: "y" }, "t4"),
    ];
    // tail 是 y (单一), 不是 3 次相同 → false
    expect(detectLoop(history)).toBe(false);
  });
});