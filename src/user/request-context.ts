/**
 * 请求上下文：通过 AsyncLocalStorage 传递当前请求的 userId
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  userId: string;
  userName?: string;
  userDisplayName?: string;
  departmentId?: string;
  requestId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** 获取当前请求的 userId，无上下文时降级为 "default" */
export function getCurrentUserId(): string {
  return requestContext.getStore()?.userId ?? "default";
}

/** 获取当前请求的完整用户信息 */
export function getCurrentUser(): RequestContext | undefined {
  return requestContext.getStore();
}
