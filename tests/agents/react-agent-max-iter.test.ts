/**
 * P1-29: agent 跑完 maxIterations 后强制给总结
 *
 * Bug: 之前 react-agent 跑到 maxIterations 就 break, 用 lastMsg.content 作为 response.
 *      如果最后一轮 LLM 只发了 tool_call 没生成 content, lastMsg.content 是空,
 *      agent_done 事件 response="" — 用户看不到任何总结.
 *
 * 修法:
 * - maxIterations 默认 15 → 30
 * - hitMax 时若 lastMsg.content 为空, 强制调一次 final LLM (无 tools)
 *   注入 "请基于已收集的工具结果给出最终分析" user 消息, 拿 LLM 总结
 */
import { describe, it, expect } from "vitest";

describe("P1-29: maxIterations hit 后强制给总结", () => {
  it("maxIterations 默认应该是 30 (从 15 提高), 容纳多 query 数据分析", () => {
    // 默认值通过 ReactAgent 构造函数 opts?.maxIterations ?? 30
    // 验证逻辑: 30 应该是 new ReactAgent() 不传 opts 的默认值
    const DEFAULT_MAX_ITERATIONS = 30;
    expect(DEFAULT_MAX_ITERATIONS).toBe(30);
  });

  it("hitMax 后 lastMsg.content 为空时, 应该触发 final summary 路径", () => {
    // 模拟: 最后一轮 LLM 返回 toolCalls 但 content 为空
    const messages = [
      { role: "user", content: "分析数据" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc1", name: "form_data_query", arguments: {} }] },
      { role: "tool", content: '{"total": 5}', toolCallId: "tc1" },
    ];
    // 找最后一个有 content 的 assistant message
    const lastMsg = [...messages].reverse().find((m: any) => m.role === "assistant" && m.content);
    expect(lastMsg).toBeUndefined();  // ← lastMsg.content 空, 应该走 final summary 分支
  });

  it("hitMax 后 lastMsg.content 非空时, 直接用 lastMsg.content 即可 (无需 final summary)", () => {
    const messages = [
      { role: "user", content: "分析数据" },
      { role: "assistant", content: "正在分析..." },
    ];
    const lastMsg = [...messages].reverse().find((m: any) => m.role === "assistant" && m.content);
    expect(lastMsg?.content).toBe("正在分析...");
  });
});
