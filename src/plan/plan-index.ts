/**
 * Plan Index — 内存索引加速 conversationId → plan 查找
 *
 * 当前 plan 状态存储在 markdown 文件中，findPlanByConversationId 需要 O(N) 遍历。
 * 该模块提供按用户的惰性构建内存索引，将查找降为 O(1)。
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parsePlan } from "./plan-parser.js";

interface IndexEntry {
  fileName: string;
  updatedAt: number;
}

/** 用户级索引缓存：userId → conversationId → entry */
const indexMap = new Map<string, Map<string, IndexEntry>>();
const indexBuildTime = new Map<string, number>();
const INDEX_TTL_MS = 30_000;

function getUserIndex(userId: string): Map<string, IndexEntry> {
  const now = Date.now();
  const lastBuilt = indexBuildTime.get(userId) || 0;

  if (now - lastBuilt < INDEX_TTL_MS) {
    const cached = indexMap.get(userId);
    if (cached) return cached;
  }

  const dir = join(".raos", "workspace", userId, "plans");
  const newIndex = new Map<string, IndexEntry>();

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const plan = parsePlan(content);
        if (plan.meta.conversationId) {
          newIndex.set(plan.meta.conversationId, {
            fileName: file,
            updatedAt: plan.meta.updatedAt,
          });
        }
      } catch {
        // 跳过损坏文件
      }
    }
  } catch {
    // 目录可能不存在
  }

  indexMap.set(userId, newIndex);
  indexBuildTime.set(userId, now);
  return newIndex;
}

/** 通过 conversationId 查找计划（使用索引） */
export function findPlanByConversationIdIndexed(
  conversationId: string,
  userId?: string
): IndexEntry | undefined {
  const uid = userId || "anonymous";
  return getUserIndex(uid).get(conversationId);
}

/** 使指定用户的索引失效 */
export function invalidateUserIndex(userId?: string): void {
  const uid = userId || "anonymous";
  indexBuildTime.delete(uid);
  indexMap.delete(uid);
}

/** 使所有索引失效 */
export function invalidateAllIndexes(): void {
  indexBuildTime.clear();
  indexMap.clear();
}
