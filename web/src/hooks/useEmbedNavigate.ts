/**
 * useEmbedNavigate — RAOS嵌入场景导航 hook (ROADMAP-Q3 item #2)
 *
 *行为:
 *1. **非嵌入场景** (window.parent === window): 直接调用 react-router 的 navigate()
 *2. **嵌入场景** (window.parent !== window):
 * - 生成唯一 requestId (UUID v4)
 * - window.parent.postMessage({ type: "RAOS_NAVIGATE", url, requestId }, window.location.origin)
 * -挂 message listener等待父页面 ACK (RAOS_NAVIGATE_ACK, status: "ok" | "rejected")
 * - ACK requestId 必须匹配, 否则忽略 (防并发请求误清)
 * - **3 秒未收 ACK → 自动 fallback 到内部 navigate()**
 * - 用户体验: 即使父页面未集成监听器,跳转仍会发生 (只是留在 iframe 内)
 *
 *父页面集成规范见 `web/docs/EMBED_PROTOCOL.md` §2.
 */

import { useCallback, useEffect, useRef } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";

/** RAOS嵌入协议消息类型常量 */
export const RAOS_MSG = {
 NAVIGATE: "RAOS_NAVIGATE",
 NAVIGATE_ACK: "RAOS_NAVIGATE_ACK",
 AUTH: "RAOS_AUTH",
 EVENT: "RAOS_EVENT",
} as const;

/** 子 →父 (请求父宿主跳转) */
export interface RaosNavigateMessage {
 type: typeof RAOS_MSG.NAVIGATE;
 url: string;
 requestId: string;
 source?: string;
 meta?: Record<string, unknown>;
}

/**父 → 子 (父回应是否处理) */
export interface RaosNavigateAckMessage {
 type: typeof RAOS_MSG.NAVIGATE_ACK;
 requestId: string;
 status: "ok" | "rejected";
 reason?: string;
}

/** 默认 ACK 超时 (ms) —父页面未集成时降级 */
export const DEFAULT_ACK_TIMEOUT_MS =3000;

/** Hook 返回的导航函数类型 */
export type EmbedNavigate = (url: string, opts?: { source?: string; meta?: Record<string, unknown> }) => void;

/** Hook 选项 */
export interface UseEmbedNavigateOptions {
 /** ACK 超时 (ms), 默认3000 */
 ackTimeoutMs?: number;
 /** 是否输出调试日志 (默认 false) */
 debug?: boolean;
}

/**
 * 在嵌入场景下导航到指定 URL.
 *
 * @example
 * const embedNavigate = useEmbedNavigate();
 * embedNavigate("/chat?autoMessage=帮我修改...");
 */
export function useEmbedNavigate(options: UseEmbedNavigateOptions = {}): EmbedNavigate {
 const { ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS, debug = false } = options;
 const navigate = useNavigate();
 // 在 unmount 时, 清掉所有未完成的 timer + listener, 防内存泄漏
 const pendingRef = useRef<Set<{ timer: number; handler: (e: MessageEvent) => void }>>(new Set());

 //卸载时统一清理
 useEffect(() => {
 return () => {
 const pending = pendingRef.current;
 pending.forEach(({ timer, handler }) => {
 clearTimeout(timer);
 window.removeEventListener("message", handler);
 });
 pending.clear();
 };
 }, []);

 return useCallback<EmbedNavigate>(
 (url, opts) => {
 // 非嵌入场景: 直接走内部 navigate
 if (typeof window === "undefined" || window.parent === window) {
 navigate(url);
 return;
 }

 //嵌入场景: 生成 requestId + 等 ACK + 超时 fallback
 const requestId =
 typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
 ? crypto.randomUUID()
 //兜底: 老浏览器无 crypto.randomUUID
 : `req-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;

 const message: RaosNavigateMessage = {
 type: RAOS_MSG.NAVIGATE,
 url,
 requestId,
 source: opts?.source,
 meta: opts?.meta,
 };

 const targetOrigin = window.location.origin;
 window.parent.postMessage(message, targetOrigin);

 if (debug) {
 console.log("[useEmbedNavigate] sent RAOS_NAVIGATE", { url, requestId });
 }

 let acked = false;
 const handler = (e: MessageEvent) => {
 // ⚠️ 必须 origin校验, 防父页面侧跨域消息伪造
 if (e.origin !== targetOrigin) return;
 if (e.data?.type !== RAOS_MSG.NAVIGATE_ACK) return;
 // ⚠️ requestId 必须匹配, 否则忽略 (并发场景下防误清)
 if (e.data?.requestId !== requestId) return;

 acked = true;
 clearTimeout(timer);
 window.removeEventListener("message", handler);
 pendingRef.current.delete(entry);

 if (debug) {
 console.log("[useEmbedNavigate] received ACK", { requestId, status: e.data?.status });
 }

 if (e.data?.status === "rejected") {
 //父页面拒绝 —业务侧可选择性提示 (这里保持静默,父页面 reason已在控制台)
 if (debug) {
 console.warn("[useEmbedNavigate] parent rejected navigation", e.data?.reason);
 }
 }
 };

 const timer = window.setTimeout(() => {
 if (acked) return;
 window.removeEventListener("message", handler);
 pendingRef.current.delete(entry);
 if (debug) {
 console.warn("[useEmbedNavigate] ACK timeout, falling back to internal navigate", { url, requestId });
 }
 // ⭐核心 fallback:父页面未集成 / 未 ACK →内部 navigate, 用户体验不破
 navigate(url);
 }, ackTimeoutMs);

 const entry = { timer, handler };
 pendingRef.current.add(entry);
 window.addEventListener("message", handler);
 },
 [navigate, ackTimeoutMs, debug]
 );
}

/**
 *纯函数版本 (供非 React上下文使用, 或测试用).
 *
 * 不依赖 react-router, 调用方需自己传入 navigate 函数.
 */
export function sendEmbedNavigate(
 navigate: NavigateFunction,
 url: string,
 opts?: {
 source?: string;
 meta?: Record<string, unknown>;
 ackTimeoutMs?: number;
 debug?: boolean;
 }
): void {
 const ackTimeoutMs = opts?.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
 const debug = opts?.debug ?? false;

 if (typeof window === "undefined" || window.parent === window) {
 navigate(url);
 return;
 }

 const requestId =
 typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
 ? crypto.randomUUID()
 : `req-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;

 const message: RaosNavigateMessage = {
 type: RAOS_MSG.NAVIGATE,
 url,
 requestId,
 source: opts?.source,
 meta: opts?.meta,
 };
 const targetOrigin = window.location.origin;
 window.parent.postMessage(message, targetOrigin);

 if (debug) {
 console.log("[sendEmbedNavigate] sent RAOS_NAVIGATE", { url, requestId });
 }

 let acked = false;
 const handler = (e: MessageEvent) => {
 if (e.origin !== targetOrigin) return;
 if (e.data?.type !== RAOS_MSG.NAVIGATE_ACK) return;
 if (e.data?.requestId !== requestId) return;

 acked = true;
 clearTimeout(timer);
 window.removeEventListener("message", handler);

 if (debug) {
 console.log("[sendEmbedNavigate] received ACK", { requestId, status: e.data?.status });
 }
 };

 const timer = window.setTimeout(() => {
 if (acked) return;
 window.removeEventListener("message", handler);
 if (debug) {
 console.warn("[sendEmbedNavigate] ACK timeout, falling back to internal navigate", { url, requestId });
 }
 navigate(url);
 }, ackTimeoutMs);

 window.addEventListener("message", handler);
}
