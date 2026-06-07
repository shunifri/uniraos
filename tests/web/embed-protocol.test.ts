/**
 * Embed Protocol 单测 (ROADMAP-Q3 item #2)
 *
 *覆盖:
 *1.父页面 snippet mock: Vitest + jsdom,模拟 window.parent接收子消息并回 ACK
 *2.3s 超时 fallback: vi.useFakeTimers(),验证父不 ACK → 子3s 后 navigate() 调用
 *3. ACK匹配 requestId: 发2 个并发 RAOS_NAVIGATE (不同 requestId),父页面只 ACK 第1 个,
 *验证子页面只清第1 个的 timer, 第2 个走超时降级
 *
 * 同时测试:
 * - 非嵌入场景 (window.parent === window): 直接 navigate, 无 postMessage
 * - origin校验 (父页面侧伪造 origin 的 ACK 不应被接受)
 * - source / meta扩展字段透传
 *
 * 设计说明: 本测试只覆盖纯函数 `sendEmbedNavigate`, 不测试 React hook 版本.
 * `useEmbedNavigate` 是 sendEmbedNavigate + useCallback 的薄包装, 无新增业务逻辑.
 * 这样测试不需要 react-router-dom依赖,可在根 vitest 配置下直接运行.
 *
 *跑法: `npx vitest run tests/web/embed-protocol.test.ts --repeat=3`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
 sendEmbedNavigate,
 RAOS_MSG,
 DEFAULT_ACK_TIMEOUT_MS,
 type RaosNavigateMessage,
} from "../../web/src/hooks/useEmbedNavigate";

// ============================================================================
// helpers
// ============================================================================

/**
 *统一的"父页面"模拟器:
 * - 把 window.parent替换成 spy,捕获所有 postMessage 调用
 * - `sendAck`方法模拟父页面通过 `iframe.contentWindow.postMessage` 向子页面回 ACK
 * (子页面监听的是 window 上的 message事件, 所以直接 dispatch 到 window)
 */
interface FakeParentHandle {
 receivedMessages: RaosNavigateMessage[];
 start: () => void;
 stop: () => void;
 sendAck: (requestId: string, status: "ok" | "rejected", reason?: string) => void;
 /** 直接 dispatch 一个 ACK事件 (origin可指定, 用于测试伪造场景) */
 dispatchAckEvent: (
 requestId: string,
 status: "ok" | "rejected",
 origin: string,
 reason?: string
 ) => void;
}

function createFakeParent(): FakeParentHandle {
 const received: RaosNavigateMessage[] = [];
 const postMessageSpy = vi.fn((_message: any, _targetOrigin: string) => {
 //真实父页面 postMessage不会触发子页面 window 上的 message事件
 // jsdom 中这里是同一进程,父页面调用 postMessage 只是写到自己的 message queue
 });
 const fakeParent = { postMessage: postMessageSpy };

 const original = Object.getOwnPropertyDescriptor(window, "parent");
 Object.defineProperty(window, "parent", {
 configurable: true,
 get: () => fakeParent,
 });

 const dispatchAckEvent = (
 requestId: string,
 status: "ok" | "rejected",
 origin: string,
 reason?: string
 ) => {
 window.dispatchEvent(
 new MessageEvent("message", {
 data: { type: RAOS_MSG.NAVIGATE_ACK, requestId, status, reason },
 origin,
 })
 );
 };

 return {
 receivedMessages: received,
 start: () => {
 // jsdom: postMessage 调用会进入父窗口的 message queue
 // 我们 hook 它:在 spy 上提取消息
 // 由于 jsdom 不直接触发子页面 window 上的 message事件,
 // 我们在 spy 中手动 dispatch 到 window (模拟"父页面处理完后再 postMessage 回子")
 const realSpy = fakeParent.postMessage as ReturnType<typeof vi.fn>;
 realSpy.mockImplementation((message: any, _origin: string) => {
 if (message?.type === RAOS_MSG.NAVIGATE) {
 received.push(message as RaosNavigateMessage);
 }
 });
 },
 stop: () => {
 if (original) {
 Object.defineProperty(window, "parent", original);
 }
 },
 sendAck: (requestId, status, reason) =>
 dispatchAckEvent(requestId, status, window.location.origin, reason),
 dispatchAckEvent,
 };
}

/**
 * 直接 dispatch 一个 ACK消息事件 (用于不通过 FakeParent 的场景).
 */
function dispatchAck(
 requestId: string,
 status: "ok" | "rejected" = "ok",
 reason?: string,
 origin: string = window.location.origin
) {
 window.dispatchEvent(
 new MessageEvent("message", {
 data: { type: RAOS_MSG.NAVIGATE_ACK, requestId, status, reason },
 origin,
 })
 );
}

// ============================================================================
// tests
// ============================================================================

describe("Embed Protocol (ROADMAP-Q3 item #2)", () => {
 beforeEach(() => {
 vi.useRealTimers();
 });

 afterEach(() => {
 vi.restoreAllMocks();
 vi.useRealTimers();
 });

 // --------------------------------------------------------------------------
 //1.父页面 snippet mock
 // --------------------------------------------------------------------------
 describe("sendEmbedNavigate:父页面 snippet集成", () => {
 it("嵌入场景下应发出 RAOS_NAVIGATE 含 url + UUID v4 requestId", () => {
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?autoMessage=test");
 expect(parent.receivedMessages).toHaveLength(1);
 const msg = parent.receivedMessages[0];
 expect(msg.type).toBe(RAOS_MSG.NAVIGATE);
 expect(msg.url).toBe("/chat?autoMessage=test");
 // UUID v4格式校验
 expect(msg.requestId).toMatch(
 /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
 );
 } finally {
 parent.stop();
 }
 });

 it("父页面 snippet:收到 RAOS_NAVIGATE 后正确回 ACK", () => {
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?foo=bar");
 expect(parent.receivedMessages).toHaveLength(1);
 expect(parent.receivedMessages[0].url).toBe("/chat?foo=bar");
 const reqId = parent.receivedMessages[0].requestId;

 //父页面按 snippet 处理 —回 ACK
 parent.sendAck(reqId, "ok");
 expect(navigate).not.toHaveBeenCalled(); // ACK 已到, 不走 fallback
 } finally {
 parent.stop();
 }
 });

 it("父页面拒绝 (path-not-allowed): 应回 ACK status=rejected", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/admin/dangerous");
 const reqId = parent.receivedMessages[0].requestId;
 parent.sendAck(reqId, "rejected", "path-not-allowed");
 //父页面拒绝后, 子页面不应走 fallback (ACK已到)
 vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS);
 expect(navigate).not.toHaveBeenCalled();
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });
 });

 // --------------------------------------------------------------------------
 //2.3s 超时 fallback (核心修复)
 // --------------------------------------------------------------------------
 describe("sendEmbedNavigate:3s ACK 超时 fallback", () => {
 it("父页面未集成 / 未 ACK →3000ms 后自动 navigate(url) fallback", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?autoMessage=fallback");

 //1.立刻验证: postMessage 已发, navigate 未调用
 expect(parent.receivedMessages).toHaveLength(1);
 expect(parent.receivedMessages[0].type).toBe(RAOS_MSG.NAVIGATE);
 expect(navigate).not.toHaveBeenCalled();

 //2.推进到2999ms:仍未 fallback
 vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS -1);
 expect(navigate).not.toHaveBeenCalled();

 //3.推进到3000ms: fallback触发
 vi.advanceTimersByTime(1);
 expect(navigate).toHaveBeenCalledTimes(1);
 expect(navigate).toHaveBeenCalledWith("/chat?autoMessage=fallback");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });

 it("ACK 在3s 内到达 → 不走 fallback, 清 timer", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?autoMessage=ok");

 const reqId = parent.receivedMessages[0].requestId;

 //1.5s 后父页面 ACK
 vi.advanceTimersByTime(1500);
 parent.sendAck(reqId, "ok");
 expect(navigate).not.toHaveBeenCalled();

 // 再推进2s (远超3s) — 不应触发 fallback (timer已被 ACK 清掉)
 vi.advanceTimersByTime(2000);
 expect(navigate).not.toHaveBeenCalled();
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });

 it("可配置 ackTimeoutMs (e.g.500ms)", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat", { ackTimeoutMs:500 });

 vi.advanceTimersByTime(499);
 expect(navigate).not.toHaveBeenCalled();

 vi.advanceTimersByTime(1);
 expect(navigate).toHaveBeenCalledWith("/chat");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });

 it("每次 sendEmbedNavigate 调用应独立计时 (不会共享 timer)", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?a=1");
 vi.advanceTimersByTime(2000); //第1 个 timer还在等待
 sendEmbedNavigate(navigate, "/chat?b=2");
 vi.advanceTimersByTime(999); //第1 个还差1ms, 第2 个还差2001ms
 expect(navigate).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1); //第1 个触发
 expect(navigate).toHaveBeenCalledTimes(1);
 expect(navigate).toHaveBeenLastCalledWith("/chat?a=1");
 vi.advanceTimersByTime(2000); //第2 个触发
 expect(navigate).toHaveBeenCalledTimes(2);
 expect(navigate).toHaveBeenLastCalledWith("/chat?b=2");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });
 });

 // --------------------------------------------------------------------------
 //3. ACK匹配 requestId
 // --------------------------------------------------------------------------
 describe("sendEmbedNavigate: ACK requestId匹配", () => {
 it("ACK 的 requestId 不匹配 →忽略,走 fallback", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?foo=1");
 const realReqId = parent.receivedMessages[0].requestId;

 //父页面错配: 用错的 requestId 回 ACK
 const wrongId = "00000000-0000-4000-8000-000000000000";
 expect(wrongId).not.toBe(realReqId);
 dispatchAck(wrongId, "ok");

 // 即使有 ACK到达, 因为 requestId 不匹配, 子页面忽略
 vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS);
 expect(navigate).toHaveBeenCalledWith("/chat?foo=1");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });

 it("并发2 个 RAOS_NAVIGATE:父只 ACK 第1 个, 第2 个走超时 fallback", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?req=1");
 sendEmbedNavigate(navigate, "/skills?req=2");

 expect(parent.receivedMessages).toHaveLength(2);
 const reqId1 = parent.receivedMessages[0].requestId;
 const reqId2 = parent.receivedMessages[1].requestId;
 expect(reqId1).not.toBe(reqId2);

 //父页面只 ACK 第1 个 (req=1)
 vi.advanceTimersByTime(1500);
 parent.sendAck(reqId1, "ok");

 //推进到超时
 vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS);
 // 第1 个被 ACK, timer 清; 第2 个超时 → fallback
 expect(navigate).toHaveBeenCalledTimes(1);
 expect(navigate).toHaveBeenCalledWith("/skills?req=2");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });

 it("ACK来自错误 origin →忽略,走 fallback (防伪造)", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?secure=1");
 const reqId = parent.receivedMessages[0].requestId;

 //模拟恶意 iframe伪造 origin
 dispatchAck(reqId, "ok", undefined, "https://evil.example.com");

 vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS);
 expect(navigate).toHaveBeenCalledWith("/chat?secure=1");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });

 it("ACK消息 type 不是 RAOS_NAVIGATE_ACK →忽略,走 fallback", () => {
 vi.useFakeTimers();
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?typecheck=1");
 const reqId = parent.receivedMessages[0].requestId;

 //父页面错发:用了 RAOS_EVENT type (应是 RAOS_NAVIGATE_ACK)
 window.dispatchEvent(
 new MessageEvent("message", {
 data: { type: "RAOS_EVENT", requestId: reqId, status: "ok", event: "message_sent" },
 origin: window.location.origin,
 })
 );

 vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS);
 expect(navigate).toHaveBeenCalledWith("/chat?typecheck=1");
 } finally {
 parent.stop();
 vi.useRealTimers();
 }
 });
 });

 // --------------------------------------------------------------------------
 //4. 非嵌入场景
 // --------------------------------------------------------------------------
 describe("sendEmbedNavigate: 非嵌入场景", () => {
 it("window.parent === window → 直接 navigate, 不发 postMessage", () => {
 const originalParent = Object.getOwnPropertyDescriptor(window, "parent");
 Object.defineProperty(window, "parent", {
 configurable: true,
 get: () => window, // 让 window.parent === window
 });
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat?direct=1");
 expect(navigate).toHaveBeenCalledTimes(1);
 expect(navigate).toHaveBeenCalledWith("/chat?direct=1");
 } finally {
 if (originalParent) {
 Object.defineProperty(window, "parent", originalParent);
 }
 }
 });
 });

 // --------------------------------------------------------------------------
 //5. source / meta扩展字段透传
 // --------------------------------------------------------------------------
 describe("sendEmbedNavigate:扩展字段", () => {
 it("source + meta 应随 RAOS_NAVIGATE一起发出", () => {
 const parent = createFakeParent();
 parent.start();
 try {
 const navigate = vi.fn();
 sendEmbedNavigate(navigate, "/chat", {
 source: "AppDesignCard",
 meta: { designId: "abc-123" },
 });
 expect(parent.receivedMessages[0].source).toBe("AppDesignCard");
 expect(parent.receivedMessages[0].meta).toEqual({ designId: "abc-123" });
 } finally {
 parent.stop();
 }
 });
 });
});
