/**
 * VersionChain - 版本链管理模块
 * 管理同 key 记忆的版本历史链，纯逻辑模块，不做 I/O
 */

import type { LTMEntry } from "../ltm.js";

/** 版本关系类型 */
export type VersionRelation = "creates" | "updates" | "extends" | "derives";

/** 增强版 LTMEntry，包含版本链和遗忘相关字段 */
export interface EnhancedLTMEntry extends LTMEntry {
  // Version chain fields
  version: number;
  parentId: string | null;
  rootId: string | null;
  relation: VersionRelation;
  isLatest: boolean;

  // Smart forgetting fields
  forgotten: boolean;
  forgottenAt?: number;
  forgottenReason?: string;
  expiresAt?: number;
}

/** createVersion 返回的版本字段（不含完整 entry，由调用方合并） */
export interface VersionFields {
  version: number;
  parentId: string | null;
  rootId: string | null;
  relation: VersionRelation;
  isLatest: boolean;
  forgotten: boolean;
}

/** getRelated 返回的上下文信息 */
export interface VersionContext {
  entry: EnhancedLTMEntry;
  parents: EnhancedLTMEntry[];
  children: EnhancedLTMEntry[];
  relationTypes: VersionRelation[];
}

/**
 * 获取同 key 的所有版本，按 version 降序排列
 */
function getVersionsForKey(
  key: string,
  entries: EnhancedLTMEntry[],
): EnhancedLTMEntry[] {
  return entries
    .filter((e) => e.key === key && !e.forgotten)
    .sort((a, b) => b.version - a.version);
}

/**
 * 查找同 key 的当前最新版本
 */
function findLatestVersion(
  key: string,
  entries: EnhancedLTMEntry[],
): EnhancedLTMEntry | undefined {
  return entries.find((e) => e.key === key && e.isLatest && !e.forgotten);
}

/**
 * 创建新版本的字段。
 * 调用方负责：
 *   1. 用返回的字段构建完整的 EnhancedLTMEntry
 *   2. 将旧版本的 isLatest 设为 false（本函数会标记哪个需要修改）
 *
 * @param key - 记忆 key
 * @param value - 记忆值（仅用于判断是否存在同 key 版本）
 * @param entries - 现有所有记忆条目
 * @param relation - 版本关系，不传则自动推断
 * @param parentId - 父版本 ID，不传则自动使用同 key 最新版本
 * @returns 版本字段 + 需要被标记为非最新的旧条目 ID（如果有）
 */
export function createVersion(
  key: string,
  _value: unknown,
  entries: EnhancedLTMEntry[],
  relation?: VersionRelation,
  parentId?: string,
): { fields: VersionFields; deprecatedId: string | null } {
  const latest = findLatestVersion(key, entries);

  // Determine relation: if same key exists → "updates", otherwise → "creates"
  const resolvedRelation =
    relation ?? (latest ? "updates" : "creates");

  // Determine parent
  let resolvedParentId: string | null = parentId ?? null;
  if (!parentId && latest) {
    resolvedParentId = latest.id;
  }

  // Determine root
  let rootId: string | null = null;
  if (resolvedParentId) {
    const parent = entries.find((e) => e.id === resolvedParentId);
    rootId = parent?.rootId ?? resolvedParentId;
  }
  // rootId stays null for first version (will be set to own id by caller)

  // Version number
  const version = latest ? latest.version + 1 : 1;

  const fields: VersionFields = {
    version,
    parentId: resolvedParentId,
    rootId,
    relation: resolvedRelation,
    isLatest: true,
    forgotten: false,
  };

  return {
    fields,
    deprecatedId: latest?.id ?? null,
  };
}

/**
 * 获取指定 key 的所有版本历史，按 version 降序排列
 *
 * @param key - 记忆 key
 * @param entries - 所有记忆条目
 * @param includeForgotten - 是否包含已遗忘的版本，默认 false
 */
export function getHistory(
  key: string,
  entries: EnhancedLTMEntry[],
  includeForgotten = false,
): EnhancedLTMEntry[] {
  const filtered = includeForgotten
    ? entries.filter((e) => e.key === key)
    : getVersionsForKey(key, entries);

  return filtered.sort((a, b) => b.version - a.version);
}

/**
 * 从任意版本出发，返回完整的 parent→child 链（按 version 升序）
 *
 * @param id - 任意版本的 entry ID
 * @param entries - 所有记忆条目
 */
export function getChain(
  id: string,
  entries: EnhancedLTMEntry[],
): EnhancedLTMEntry[] {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return [];

  // Find root: walk up parent chain
  let root = entry;
  const visited = new Set<string>([root.id]);
  while (root.parentId) {
    const parent = entries.find((e) => e.id === root.parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    root = parent;
  }

  // Collect all entries in same key chain starting from root
  // Use the key from the root to find all versions
  const chainEntries = entries
    .filter((e) => e.key === root.key)
    .sort((a, b) => a.version - b.version);

  return chainEntries;
}

/**
 * 获取指定版本的上下文信息：父版本、子版本、关系类型
 *
 * @param id - entry ID
 * @param entries - 所有记忆条目
 */
export function getRelated(
  id: string,
  entries: EnhancedLTMEntry[],
): VersionContext | null {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;

  // Find direct parents (walk up the parent chain)
  const parents: EnhancedLTMEntry[] = [];
  let current = entry;
  const visitedUp = new Set<string>([current.id]);
  while (current.parentId) {
    const parent = entries.find((e) => e.id === current.parentId);
    if (!parent || visitedUp.has(parent.id)) break;
    visitedUp.add(parent.id);
    parents.push(parent);
    current = parent;
  }

  // Find direct children (entries whose parentId is this entry's id)
  const children = entries.filter((e) => e.parentId === id);

  // Collect all unique relation types from this entry + children
  const relationSet = new Set<VersionRelation>();
  relationSet.add(entry.relation);
  for (const child of children) {
    relationSet.add(child.relation);
  }
  for (const parent of parents) {
    relationSet.add(parent.relation);
  }

  return {
    entry,
    parents,
    children,
    relationTypes: [...relationSet],
  };
}

/**
 * VersionChain 类 - 版本链管理的包装器
 * 提供面向对象的接口来访问版本链函数
 */
export class VersionChain {
  createVersion(
    key: string,
    value: unknown,
    entries: EnhancedLTMEntry[],
    relation?: VersionRelation,
    parentId?: string,
  ): { fields: VersionFields; deprecatedId: string | null } {
    return createVersion(key, value, entries, relation, parentId);
  }

  getHistory(key: string, entries: EnhancedLTMEntry[]): EnhancedLTMEntry[] {
    return getHistory(key, entries);
  }

  getChain(id: string, entries: EnhancedLTMEntry[]): EnhancedLTMEntry[] {
    return getChain(id, entries);
  }

  getRelated(id: string, entries: EnhancedLTMEntry[]): VersionContext | null {
    return getRelated(id, entries);
  }
}
