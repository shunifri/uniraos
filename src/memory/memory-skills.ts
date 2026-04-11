/**
 * 记忆 Skill 注册
 * 将 STM/LTM 操作包装为 RAOS Skill，实现「记忆即 Skill」
 *
 * 核心设计：记忆 Skill 通过 ExecutionEngine 递归调用其他记忆 Skill，
 * 实现 raos.md 中描述的「记忆的自指性」——记忆 Skill 也需要记忆。
 *
 * 递归层级示例：
 *   第3层：模型调用 ltm_search("预订")
 *     第2层：ltm_search 内部调用 stm_retrieve("_search_cache:预订")
 *       第1层：checkpoint 自动保存执行状态
 *         第0层：实际的文件/向量操作
 *
 * handler 通过 UserSessionManager + AsyncLocalStorage 动态获取当前用户的 STM/LTM 实例
 */
import { defineSkill, defineSystemSkill, Autonomy } from "../types/index.js";
import type { SkillDefinition, ExecutionContext } from "../types/index.js";
import type { UserSessionManager } from "../user/user-session.js";
import type { LLMProvider } from "../llm/types.js";
import { EnhancedLTMBackend } from "./enhanced/enhanced-ltm-backend.js";
import * as VersionChainModule from "./enhanced/version-chain.js";
import { ForgettingManager } from "./enhanced/forgetting-manager.js";
import { getCurrentUserId } from "../user/request-context.js";
import { RecallContextSkill } from "./recall-context.js";
import { MemoryGarbageCollector } from "./gc-collect.js";

/** 可选的引擎引用，用于记忆 Skill 间的递归调用 */
type EngineRef = {
  execute: (skillName: string, params: Record<string, unknown>) => Promise<any>;
} | null;

/** 检查是否可以安全地进行递归调用（防止循环） */
function canRecurse(context: ExecutionContext, targetSkill: string, maxMemoryDepth: number = 3): boolean {
  // 1. 检查调用栈中是否已有目标 Skill（防止直接循环）
  if (context.callStack.includes(targetSkill)) return false;
  // 2. 检查记忆 Skill 的嵌套深度
  const memorySkills = ["stm_store", "stm_retrieve", "stm_forget", "ltm_store", "ltm_search", "ltm_delete", "ltm_consolidate", "recall_context"];
  const memoryDepth = context.callStack.filter((s) => memorySkills.includes(s)).length;
  if (memoryDepth >= maxMemoryDepth) return false;
  // 3. 检查总深度
  if (context.depth >= context.maxDepth - 2) return false;
  return true;
}

/** 获取当前用户的 session（内部辅助） */
function getSession(sm: UserSessionManager) {
  const userId = getCurrentUserId();
  return sm.getOrCreate(userId);
}

export function createMemorySkills(
  sessionManager: UserSessionManager,
  engineRef?: EngineRef,
  llmProvider?: LLMProvider | (() => LLMProvider | null),
): SkillDefinition[] {
  function getLLMProvider(): LLMProvider | null {
    if (!llmProvider) return null;
    return typeof llmProvider === "function" ? llmProvider() : llmProvider;
  }

  return [
    // ===== 短期记忆 Skills（对模型部分可见） =====
    defineSystemSkill({
      name: "stm_store",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "存储到短期记忆。参数: key(string), value(any)",
      paramSchema: {
        properties: {
          key: { type: "string", description: "Memory key" },
          value: { type: "object", description: "Value to store (any type)" },
        },
        required: ["key", "value"],
      },
      handler: async (params) => {
        const { stm } = getSession(sessionManager);
        const { key, value } = params as { key: string; value: unknown };
        if (!key) return { success: false, error: new Error("key is required") };
        stm.set(key, value, "model");
        return { success: true, data: { stored: key, size: stm.size } };
      },
    }),

    defineSystemSkill({
      name: "stm_retrieve",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "从短期记忆检索。参数: key(string) 或 query(string)搜索",
      paramSchema: {
        properties: {
          key: { type: "string", description: "Exact key to retrieve" },
          query: { type: "string", description: "Search query to find matching entries" },
        },
      },
      handler: async (params) => {
        const { stm } = getSession(sessionManager);
        const { key, query } = params as { key?: string; query?: string };
        if (key) {
          const value = stm.get(key);
          return { success: true, data: { key, value, found: value !== undefined } };
        }
        if (query) {
          const results = stm.search(query);
          return { success: true, data: { query, results, count: results.length } };
        }
        const all = stm.list();
        return { success: true, data: { entries: all, count: all.length } };
      },
    }),

    defineSystemSkill({
      name: "stm_forget",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "从短期记忆中删除。参数: key(string)",
      paramSchema: {
        properties: {
          key: { type: "string", description: "Key to delete from short-term memory" },
        },
        required: ["key"],
      },
      handler: async (params) => {
        const { stm } = getSession(sessionManager);
        const { key } = params as { key: string };
        if (!key) return { success: false, error: new Error("key is required") };
        const deleted = stm.delete(key);
        return { success: true, data: { key, deleted } };
      },
    }),

    // ===== 长期记忆 Skills（对模型可见） =====
    defineSystemSkill({
      name: "ltm_store",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "存储到长期记忆（持久化）。参数: key(string), value(any), tags?(string[]), summary?(string), relation?(string), expiresInSec?(number)",
      paramSchema: {
        properties: {
          key: { type: "string", description: "Memory key" },
          value: { type: "object", description: "Value to store (any type)" },
          tags: { type: "array", description: "Tags for categorization", items: { type: "string" } },
          summary: { type: "string", description: "Human-readable summary of the stored value" },
          relation: { type: "string", description: "Relation type when updating an existing key (e.g. 'update', 'supersedes')" },
          expiresInSec: { type: "number", description: "TTL in seconds after which the memory auto-expires" },
        },
        required: ["key", "value"],
      },
      handler: async (params, context) => {
        const { stm, ltm } = getSession(sessionManager);
        const { key, value, tags, summary, relation, expiresInSec } = params as {
          key: string;
          value: unknown;
          tags?: string[];
          summary?: string;
          relation?: string;
          expiresInSec?: number;
        };
        if (!key) return { success: false, error: new Error("key is required") };

        // 为 Enhanced 后端传递额外参数
        const storeOptions: any = { tags, summary, source: "model" };
        if (relation) storeOptions.relation = relation;
        if (expiresInSec) storeOptions.expiresInSec = expiresInSec;

        const id = await ltm.store(key, value, storeOptions);

        // 知识图谱：自动创建节点和关系
        try {
          const session = getSession(sessionManager);
          if ((session as any).graphManager) {
            (session as any).graphManager.onFactStored({
              id, key, value, tags: tags ?? [], relation,
            }).catch(() => {});
          }
        } catch { /* graph integration is best-effort */ }

        // 递归自指：通过 engine 调用 stm_store 同步到短期记忆
        if (engineRef && canRecurse(context, "stm_store")) {
          try {
            await engineRef.execute("stm_store", { key, value });
          } catch {
            // 递归调用失败不影响 LTM 存储
            stm.set(key, value, "ltm_store");
          }
        } else {
          stm.set(key, value, "ltm_store");
        }

        return { success: true, data: { id, key, size: ltm.size } };
      },
    }),

    defineSystemSkill({
      name: "ltm_search",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "搜索长期记忆。参数: query(string), tags?(string[]), limit?(number), semantic?(boolean), rerank?(boolean), filters?(object), includeForgotten?(boolean)",
      paramSchema: {
        properties: {
          query: { type: "string", description: "Search query string" },
          tags: { type: "array", description: "Filter by tags", items: { type: "string" } },
          limit: { type: "number", description: "Maximum number of results to return" },
          semantic: { type: "boolean", description: "Enable semantic (vector) search" },
          rerank: { type: "boolean", description: "Apply re-ranking to improve result order" },
          filters: { type: "object", description: "Additional filter criteria" },
          includeForgotten: { type: "boolean", description: "Include soft-deleted (forgotten) entries in results" },
        },
        required: ["query"],
      },
      handler: async (params, context) => {
        const { ltm } = getSession(sessionManager);
        const { query, tags, limit, semantic, rerank, filters, includeForgotten } = params as {
          query: string;
          tags?: string[];
          limit?: number;
          semantic?: boolean;
          rerank?: boolean;
          filters?: any;
          includeForgotten?: boolean;
        };
        if (!query) return { success: false, error: new Error("query is required") };

        // 递归自指：先通过 engine 查 STM 缓存，避免重复 LTM 搜索
        const cacheKey = `_search_cache:${query}`;
        if (engineRef && canRecurse(context, "stm_retrieve")) {
          try {
            const cached = await engineRef.execute("stm_retrieve", { key: cacheKey });
            if (cached?.data?.found && cached.data.value) {
              return {
                success: true,
                data: { query, results: cached.data.value, count: (cached.data.value as any[]).length, cached: true },
              };
            }
          } catch {
            // 缓存查询失败，继续正常搜索
          }
        }

        // 知识图谱优先搜索：先通过图谱 BFS 检索相关节点
        let graphResults: any[] = [];
        try {
          const session = getSession(sessionManager);
          if ((session as any).graphManager) {
            const subgraph = (session as any).graphManager.querySubgraph(query, { maxNodes: limit ?? 10, maxDepth: 2 });
            graphResults = (subgraph.nodes || []).map((n: any) => ({
              id: n.id,
              key: n.label,
              value: n.properties?.value ?? n.label,
              tags: n.tags || [],
              summary: typeof n.properties?.value === 'string' ? n.properties.value : undefined,
              source: 'graph',
            }));
          }
        } catch { /* 图谱搜索失败不影响主流程 */ }

        // 为 Enhanced 后端传递额外参数
        const searchOptions: any = { tags, limit, semantic };
        if (rerank) searchOptions.rerank = true;
        if (filters) searchOptions.filters = filters;
        if (includeForgotten) searchOptions.includeForgotten = true;

        const ltmResults = await ltm.search(query, searchOptions);
        const ltmMapped = ltmResults.map((r) => ({
          id: r.id,
          key: r.key,
          value: r.value,
          tags: r.tags,
          summary: r.summary,
        }));

        // 合并：图谱结果优先（拓扑关联更精确），再补充 LTM 结果，按 key 去重
        const seenKeys = new Set<string>();
        const merged: any[] = [];
        for (const r of [...graphResults, ...ltmMapped]) {
          if (!seenKeys.has(r.key)) {
            seenKeys.add(r.key);
            merged.push(r);
          }
        }

        // 递归自指：将搜索结果缓存到 STM
        if (engineRef && canRecurse(context, "stm_store") && merged.length > 0) {
          try {
            await engineRef.execute("stm_store", { key: cacheKey, value: merged });
          } catch {
            // 缓存存储失败不影响搜索结果
          }
        }

        return {
          success: true,
          data: { query, results: merged, count: merged.length, cached: false },
        };
      },
    }),

    defineSystemSkill({
      name: "ltm_delete",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "删除长期记忆（支持软删除和硬删除）。参数: key(string) 或 id(string), reason?(string), hard?(boolean)",
      paramSchema: {
        properties: {
          key: { type: "string", description: "Memory key to delete" },
          id: { type: "string", description: "Memory entry ID to delete" },
          reason: { type: "string", description: "Reason for deletion (used for soft-delete audit log)" },
          hard: { type: "boolean", description: "If true, perform hard delete instead of soft delete" },
        },
      },
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { key, id, reason, hard } = params as {
          key?: string;
          id?: string;
          reason?: string;
          hard?: boolean;
        };

        // 对于 Enhanced 后端，优先使用软删除（除非明确指定 hard=true）
        if (isEnhancedBackend(ltm) && !hard) {
          const allEntries = (await ltm.list({ limit: 1000000 })) as any[];
          const fm = new ForgettingManager();

          if (id) {
            const entry = allEntries.find((e) => e.id === id);
            if (!entry) return { success: false, error: new Error("id not found") };
            fm.forget(id, allEntries, reason);
            return { success: true, data: { id, deleted: true, soft: true } };
          }

          if (key) {
            const entries = allEntries.filter((e) => e.key === key);
            if (entries.length === 0) return { success: false, error: new Error("key not found") };
            for (const entry of entries) {
              fm.forget(entry.id, allEntries, reason);
            }
            return { success: true, data: { key, deleted: entries.length, soft: true } };
          }
        }

        // 硬删除或非 Enhanced 后端
        if (id) {
          const deleted = await ltm.delete(id);
          return { success: true, data: { id, deleted, soft: false } };
        }
        if (key) {
          const deleted = await ltm.deleteByKey(key);
          return { success: true, data: { key, deleted, soft: false } };
        }
        return { success: false, error: new Error("key or id is required") };
      },
    }),

    defineSystemSkill({
      name: "ltm_list",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "列出长期记忆。参数: limit?(number), offset?(number)",
      paramSchema: {
        properties: {
          limit: { type: "number", description: "Maximum number of entries to return" },
          offset: { type: "number", description: "Number of entries to skip (for pagination)" },
        },
      },
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { limit, offset } = params as { limit?: number; offset?: number };
        const entries = await ltm.list({ limit, offset });
        const s = await ltm.stats();
        return {
          success: true,
          data: {
            entries: entries.map((e) => ({
              id: e.id,
              key: e.key,
              value: e.value,
              tags: e.tags,
              summary: e.summary,
              updatedAt: new Date(e.updatedAt).toISOString(),
            })),
            total: s.total,
            tags: s.tags,
          },
        };
      },
    }),

    // ===== 短期→长期 迁移 =====
    defineSystemSkill({
      name: "ltm_consolidate",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "将短期记忆中的指定条目迁移到长期记忆。参数: key(string), tags?(string[])",
      handler: async (params, context) => {
        const { stm, ltm } = getSession(sessionManager);
        const { key, tags } = params as { key: string; tags?: string[] };
        if (!key) return { success: false, error: new Error("key is required") };

        // 递归自指：通过 engine 调用 stm_retrieve 获取值
        let value: unknown;
        if (engineRef && canRecurse(context, "stm_retrieve")) {
          try {
            const result = await engineRef.execute("stm_retrieve", { key });
            value = result?.data?.value;
          } catch {
            value = stm.get(key);
          }
        } else {
          value = stm.get(key);
        }

        if (value === undefined) {
          return { success: false, error: new Error(`STM key "${key}" not found`) };
        }

        // 递归自指：通过 engine 调用 ltm_store 存储
        if (engineRef && canRecurse(context, "ltm_store")) {
          try {
            const result = await engineRef.execute("ltm_store", { key, value, tags, summary: `consolidated from STM` });
            return { success: true, data: { id: result?.data?.id, key, consolidated: true, recursive: true } };
          } catch {
            // 回退到直接调用
          }
        }

        const id = await ltm.store(key, value, { tags, source: "consolidate" });
        return { success: true, data: { id, key, consolidated: true } };
      },
    }),

    // ===== 元记忆 Skills（对模型不可见，自动执行） =====
    defineSystemSkill({
      name: "recall_context",
      visible: false,
      autonomy: Autonomy.AUTO_PRE,
      description: "自动在 Skill 执行前注入相关记忆到上下文",
      handler: async (params, _context) => {
        const session = getSession(sessionManager);
        const { stm, ltm } = session;
        const skillName = (params.target as string) || (params.skillName as string) || "";
        if (!skillName) return { success: true, data: { skipped: true } };

        const recallSkill = new RecallContextSkill(stm, ltm, undefined, (session as any).graphManager);
        const { memories, cached } = await recallSkill.recall(skillName, params as Record<string, unknown>);

        return {
          success: true,
          data: { target: skillName, recalled: memories.length, cached },
        };
      },
    }),

    defineSystemSkill({
      name: "memory_stats",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "获取记忆系统统计信息，包括活跃记忆数、归档数、标签分布、版本链数、遗忘数等",
      handler: async () => {
        const { stm, ltm } = getSession(sessionManager);
        const ltmStats = await ltm.stats();

        // 对于 Enhanced 后端，添加额外的统计信息
        const extraStats: any = {};
        if (isEnhancedBackend(ltm)) {
          const allEntries = (await ltm.list({ limit: 1000000 })) as any[];
          const versionChains = new Set(allEntries.map((e) => e.rootId).filter(Boolean)).size;
          const forgottenCount = allEntries.filter((e) => e.forgotten).length;
          const expiredPending = allEntries.filter((e) => e.expiresAt && e.expiresAt <= Date.now() && !e.forgotten).length;

          extraStats.version_chains = versionChains;
          extraStats.forgotten_count = forgottenCount;
          extraStats.expired_pending = expiredPending;
        }

        return {
          success: true,
          data: {
            stm: { size: stm.size, entries: stm.list().map((e) => e.key) },
            ltm: { ...ltmStats, ...extraStats },
            archives: (await ltm.getArchiveManifests()).map((m) => ({
              id: m.id,
              reason: m.reason,
              entryCount: m.entryCount,
              createdAt: new Date(m.createdAt).toISOString(),
              keySummary: m.keySummary.slice(0, 10),
            })),
          },
        };
      },
    }),

    // ===== 归档管理 Skills =====
    defineSystemSkill({
      name: "ltm_archive",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "手动触发记忆归档：将冷记忆移到归档存储。参数: reason?(string)",
      paramSchema: {
        properties: {
          reason: { type: "string", description: "Reason for archiving (default: 'manual')" },
        },
      },
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const reason = (params.reason as string) || "manual";
        const result = await ltm.archive(reason);
        return {
          success: true,
          data: {
            archived: result.archived,
            manifest: result.manifest
              ? {
                  id: result.manifest.id,
                  entryCount: result.manifest.entryCount,
                  keySummary: result.manifest.keySummary,
                }
              : null,
            activeRemaining: ltm.size,
          },
        };
      },
    }),

    defineSystemSkill({
      name: "ltm_archives_list",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "列出所有记忆归档",
      handler: async () => {
        const { ltm } = getSession(sessionManager);
        const manifests = await ltm.getArchiveManifests();
        return {
          success: true,
          data: {
            archives: manifests.map((m) => ({
              id: m.id,
              createdAt: new Date(m.createdAt).toISOString(),
              reason: m.reason,
              entryCount: m.entryCount,
              keySummary: m.keySummary,
              tagSummary: m.tagSummary,
            })),
            totalArchived: manifests.reduce((s, m) => s + m.entryCount, 0),
          },
        };
      },
    }),

    defineSystemSkill({
      name: "ltm_restore",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "从归档恢复记忆到活跃区。参数: archiveId(string), keys?(string[])",
      paramSchema: {
        properties: {
          archiveId: { type: "string", description: "Archive ID to restore from" },
          keys: { type: "array", description: "Specific keys to restore (restores all if omitted)", items: { type: "string" } },
        },
        required: ["archiveId"],
      },
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { archiveId, keys } = params as { archiveId: string; keys?: string[] };
        if (!archiveId) return { success: false, error: new Error("archiveId is required") };
        const restored = await ltm.restoreFromArchive(archiveId, keys);
        return {
          success: true,
          data: { archiveId, restored, activeTotal: ltm.size },
        };
      },
    }),

    defineSystemSkill({
      name: "ltm_schedule_archive",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description:
        "管理定时归档。参数: action('start'|'stop'|'status'), intervalMinutes?(number, 默认60)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { action, intervalMinutes } = params as {
          action: string;
          intervalMinutes?: number;
        };

        if (action === "start") {
          const minutes = intervalMinutes ?? 60;
          ltm.startScheduledArchive(minutes * 60 * 1000);
          return {
            success: true,
            data: { action: "started", intervalMinutes: minutes },
          };
        }

        if (action === "stop") {
          ltm.stopScheduledArchive();
          return { success: true, data: { action: "stopped" } };
        }

        const running = ltm.isScheduledArchiveRunning();
        const lastRun = ltm.getLastScheduledArchiveAt();
        return {
          success: true,
          data: {
            running,
            lastRunAt: lastRun ? new Date(lastRun).toISOString() : null,
          },
        };
      },
    }),

    defineSystemSkill({
      name: "ltm_search_archive",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "搜索归档中的记忆（不恢复到活跃区）。参数: query(string), limit?(number)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { query, limit } = params as { query: string; limit?: number };
        if (!query) return { success: false, error: new Error("query is required") };
        const results = await ltm.search(query, { limit, includeArchive: true });
        return {
          success: true,
          data: {
            query,
            results: results.map((r) => ({
              id: r.id,
              key: r.key,
              value: r.value,
              tags: r.tags,
              summary: r.summary,
              accessCount: r.accessCount,
              lastAccessedAt: new Date(r.lastAccessedAt).toISOString(),
            })),
            count: results.length,
          },
        };
      },
    }),

    // ===== ltm_summarize（通用，两种后端均可用） =====
    defineSystemSkill({
      name: "ltm_summarize",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "生成记忆摘要。参数: query?(string), keys?(string[]), limit?(number=20), persist?(boolean)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { query, keys, limit = 20, persist } = params as {
          query?: string;
          keys?: string[];
          limit?: number;
          persist?: boolean;
        };

        // 收集目标记忆
        let entries: Array<{ key: string; value: unknown; summary?: string }> = [];

        if (keys && keys.length > 0) {
          for (const key of keys) {
            const entry = await ltm.getByKey(key);
            if (entry) entries.push({ key: entry.key, value: entry.value, summary: entry.summary });
          }
        } else if (query) {
          const results = await ltm.search(query, { limit });
          entries = results.map((r) => ({ key: r.key, value: r.value, summary: r.summary }));
        } else {
          const results = await ltm.list({ limit });
          entries = results.map((r) => ({ key: r.key, value: r.value, summary: r.summary }));
        }

        if (entries.length === 0) {
          return { success: true, data: { summary: "No memories found to summarize.", count: 0 } };
        }

        // 使用 LLM 生成摘要
        const provider = getLLMProvider();
        if (!provider) {
          // 无 LLM 时生成简单摘要
          const simpleSummary = entries.map((e) =>
            `- ${e.key}: ${e.summary || (typeof e.value === "string" ? e.value.substring(0, 100) : JSON.stringify(e.value).substring(0, 100))}`
          ).join("\n");

          return {
            success: true,
            data: { summary: simpleSummary, count: entries.length, llm: false },
          };
        }

        const prompt = `Please provide a concise summary of the following ${entries.length} memory entries:\n\n${
          entries.map((e) => `[${e.key}]: ${e.summary || JSON.stringify(e.value).substring(0, 200)}`).join("\n")
        }\n\nProvide a coherent summary highlighting key themes and important facts.`;

        try {
          const resp = await provider.chat([{ role: "user", content: prompt }]);
          const summaryText = resp.content ?? "";

          // 可选持久化存储
          if (persist) {
            const summaryKey = `_summary:${query || "all"}:${Date.now()}`;
            await ltm.store(summaryKey, summaryText, {
              tags: ["summary", "auto-generated"],
              summary: `Summary of ${entries.length} memories`,
              source: "ltm_summarize",
            });
          }

          return {
            success: true,
            data: { summary: summaryText, count: entries.length, llm: true, persisted: !!persist },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      },
    }),

    // ===== 增强 LTM Skills（Enhanced 后端专属） =====

    defineSystemSkill({
      name: "ltm_version_history",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "获取指定 key 的完整版本历史链。参数: key(string), includeForgotten?(boolean)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        if (!isEnhancedBackend(ltm)) {
          return { success: false, error: new Error("ltm_version_history requires Enhanced backend") };
        }

        const { key, includeForgotten } = params as { key: string; includeForgotten?: boolean };
        if (!key) return { success: false, error: new Error("key is required") };

        const allEntries = (await ltm.list({ limit: 1000000 })) as any[];
        const versions = VersionChainModule.getHistory(key, allEntries, includeForgotten);

        return {
          success: true,
          data: {
            key,
            versions: versions.map((v) => ({
              version: v.version,
              id: v.id,
              parentId: v.parentId ?? null,
              rootId: v.rootId ?? null,
              relation: v.relation,
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
              value: v.value,
              summary: v.summary,
              forgotten: v.forgotten,
              forgottenReason: v.forgottenReason,
            })),
            count: versions.length,
          },
        };
      },
    }),

    defineSystemSkill({
      name: "ltm_check_conflicts",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "检测新值与现有记忆的矛盾。参数: key(string), value(unknown), topN?(number)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        if (!isEnhancedBackend(ltm)) {
          return { success: false, error: new Error("ltm_check_conflicts requires Enhanced backend") };
        }

        const { key, value, topN } = params as { key: string; value: unknown; topN?: number };
        if (!key) return { success: false, error: new Error("key is required") };
        if (value === undefined) return { success: false, error: new Error("value is required") };

        try {
          const result = await (ltm as EnhancedLTMBackend).checkConflicts(key, value);
          return {
            success: true,
            data: {
              key,
              hasConflicts: result && result.length > 0,
              conflicts: (result || [])
                .slice(0, topN ?? 10)
                .map((c: any) => ({
                  existingId: c.existingId,
                  existingKey: c.existingKey,
                  existingValue: c.existingValue,
                  description: c.description,
                  severity: c.severity,
                })),
              count: result?.length ?? 0,
            },
          };
        } catch (err) {
          return {
            success: true,
            data: {
              key,
              hasConflicts: false,
              conflicts: [],
              count: 0,
              error: err instanceof Error ? err.message : "conflict detection failed",
            },
          };
        }
      },
    }),

    defineSystemSkill({
      name: "ltm_forgotten_log",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "查询遗忘记录的审计日志。参数: since?(number), limit?(number=50), reason?(string)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        if (!isEnhancedBackend(ltm)) {
          return { success: false, error: new Error("ltm_forgotten_log requires Enhanced backend") };
        }

        const { since, limit = 50, reason } = params as { since?: number; limit?: number; reason?: string };

        const allEntries = (await ltm.list({ limit: 1000000 })) as any[];
        const fm = new ForgettingManager();
        const log = fm.getForgottenLog(allEntries, { since, limit });

        // 按原因过滤（如果指定）
        let filtered = log;
        if (reason) {
          filtered = log.filter((entry) => entry.forgottenReason?.includes(reason));
        }

        return {
          success: true,
          data: {
            entries: filtered.map((entry) => ({
              id: entry.id,
              key: entry.key,
              forgottenAt: entry.forgottenAt,
              forgottenReason: entry.forgottenReason,
              lastValue: undefined, // TODO: 需要保存最后的值
            })),
            total: filtered.length,
          },
        };
      },
    }),

    // ===== Supermemory 专属 Skills（仅 supermemory 后端时可用） =====

    defineSystemSkill({
      name: "ltm_profile",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "获取用户画像（静态事实+动态上下文）。参数: userId?(string), refresh?(boolean)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { userId: paramUserId, refresh } = params as { userId?: string; refresh?: boolean };
        const userId = paramUserId || getCurrentUserId();

        if (isEnhancedBackend(ltm)) {
          // Enhanced 后端的实现
          const profile = await (ltm as EnhancedLTMBackend).getProfile(userId);
          return { success: true, data: { ...profile, generatedAt: Date.now() } };
        }

        if (isSupermemoryBackend(ltm)) {
          // Supermemory 后端的实现（向后兼容）
          const profile = await (ltm as any).getProfile();
          return { success: true, data: profile };
        }

        return { success: false, error: new Error("ltm_profile requires Enhanced or Supermemory backend") };
      },
    }),

    defineSystemSkill({
      name: "ltm_extract_facts",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "从文本中提取结构化事实并存储到 LTM。参数: text(string), entityContext?(string), tags?(string[])。需要 LLM。",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { text, entityContext, tags } = params as {
          text: string;
          entityContext?: string;
          tags?: string[];
        };
        if (!text) return { success: false, error: new Error("text is required") };

        const provider = getLLMProvider();
        if (!provider) {
          return { success: false, error: new Error("LLM provider required for fact extraction") };
        }

        try {
          if (isEnhancedBackend(ltm)) {
            // Enhanced 后端：调用 FactExtractor
            const result = await (ltm as EnhancedLTMBackend).extractFacts(text, entityContext);
            const stored: string[] = [];

            // 存储提取的事实
            for (const f of result) {
              const id = await ltm.store(`fact:${f.key}`, f.fact, {
                tags: [...(tags ?? []), "fact", "extracted", ...(f.tags ?? [])],
                summary: f.fact.substring(0, 100),
                source: "ltm_extract_facts",
              });
              stored.push(id);
            }

            return {
              success: true,
              data: {
                facts: result.map((f) => ({
                  key: f.key,
                  fact: f.fact,
                  confidence: f.confidence,
                  tags: f.tags,
                })),
                extracted: result.length,
                stored: stored.length,
                filtered: result.length,
              },
            };
          }

          // 非 Enhanced 后端：使用通用 LLM 提取
          const prompt = `Extract structured facts from the following text. Return a JSON array of objects with "key" (short identifier), "fact" (the fact statement), and "confidence" (0-1) fields.\n\nText: ${text}\n\nReturn only valid JSON array.`;

          const resp = await provider.chat([{ role: "user", content: prompt }]);
          let facts: Array<{ key: string; fact: string; confidence?: number }>;
          try {
            const jsonMatch = (resp.content ?? "").match(/\[[\s\S]*\]/);
            facts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          } catch {
            facts = [];
          }

          const stored: string[] = [];
          const filtered: string[] = [];

          for (const f of facts) {
            if (f.key && f.fact) {
              // 过滤低置信度的事实（< 0.5）
              if (f.confidence && f.confidence < 0.5) {
                filtered.push(f.key);
                continue;
              }

              const id = await ltm.store(`fact:${f.key}`, f.fact, {
                tags: [...(tags ?? []), "fact", "extracted"],
                summary: f.fact.substring(0, 100),
                source: "ltm_extract_facts",
              });
              stored.push(id);
            }
          }

          return {
            success: true,
            data: { facts, extracted: facts.length, stored: stored.length, filtered: filtered.length },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),

    defineSystemSkill({
      name: "ltm_forget_reason",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "带原因的遗忘（追踪为什么忘记）。参数: key(string)或id(string), reason(string)",
      handler: async (params) => {
        const { ltm } = getSession(sessionManager);
        const { key, id, reason } = params as { key?: string; id?: string; reason: string };
        if (!reason) return { success: false, error: new Error("reason is required") };
        if (!key && !id) return { success: false, error: new Error("key or id is required") };

        if (isEnhancedBackend(ltm)) {
          // Enhanced 后端：调用 ForgettingManager 的 forget 方法
          const allEntries = (await ltm.list({ limit: 1000000 })) as any[];
          const fm = new ForgettingManager();

          if (id) {
            const entry = fm.forget(id, allEntries, reason);
            return { success: true, data: { forgotten: !!entry, reason } };
          }

          if (key) {
            const entries = allEntries.filter((e) => e.key === key);
            for (const entry of entries) {
              fm.forget(entry.id, allEntries, reason);
            }
            return { success: true, data: { forgotten: entries.length > 0, count: entries.length, reason } };
          }
        }

        if (isSupermemoryBackend(ltm)) {
          // Supermemory 后端（向后兼容）
          const target = id || key!;
          const forgotten = await (ltm as any).forgetWithReason(target, reason);
          return { success: true, data: { forgotten, reason } };
        }

        // 文件后端：普通删除 + 记录原因
        if (id) {
          const deleted = await ltm.delete(id);
          return { success: true, data: { forgotten: deleted, reason, backend: "file" } };
        }
        if (key) {
          const deleted = await ltm.deleteByKey(key);
          return { success: true, data: { forgotten: deleted, reason, backend: "file" } };
        }

        return { success: false, error: new Error("unreachable") };
      },
    }),

    defineSystemSkill({
      name: "ltm_set_expiration",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "设置记忆过期时间。参数: key?(string), id?(string), expiresInSec(number)",
      handler: async (params) => {
        const { ltm, stm } = getSession(sessionManager);
        const { key, id, expiresInSec } = params as { key?: string; id?: string; expiresInSec: number };

        if (!expiresInSec || expiresInSec <= 0) {
          return { success: false, error: new Error("expiresInSec must be > 0") };
        }

        const expiresAt = Date.now() + expiresInSec * 1000;

        if (isEnhancedBackend(ltm)) {
          // Enhanced 后端：调用 ForgettingManager 的 setExpiration 方法
          const allEntries = (await ltm.list({ limit: 1000000 })) as any[];
          const fm = new ForgettingManager();

          if (id) {
            const entry = fm.setExpiration(id, allEntries, expiresAt);
            return {
              success: !!entry,
              data: {
                id,
                expiresInSec,
                expiresAt: new Date(expiresAt).toISOString(),
              },
            };
          }

          if (key) {
            const entries = allEntries.filter((e) => e.key === key);
            for (const entry of entries) {
              fm.setExpiration(entry.id, allEntries, expiresAt);
            }
            return {
              success: entries.length > 0,
              data: {
                key,
                count: entries.length,
                expiresInSec,
                expiresAt: new Date(expiresAt).toISOString(),
              },
            };
          }

          return { success: false, error: new Error("key or id is required") };
        }

        // 非 Enhanced 后端：在 STM 中记录过期追踪器
        if (key) {
          stm.set(`_expiry:${key}`, { expiresAt, expiresInSec }, "ltm_set_expiration");
          return {
            success: true,
            data: {
              key,
              expiresInSec,
              expiresAt: new Date(expiresAt).toISOString(),
              backend: "file",
            },
          };
        }

        return { success: false, error: new Error("key or id is required") };
      },
    }),

    // ===== 垃圾回收 Skill（Guardian 级，不对模型可见） =====
    defineSystemSkill({
      name: "gc_collect",
      visible: false,
      autonomy: Autonomy.GUARDIAN,
      description: "运行内存垃圾回收：清理过期 STM 条目，归档冷 LTM 条目。",
      paramSchema: {
        properties: {
          stmMaxAgeMs: { type: "number", description: "STM entry max age in ms (default: 3600000)" },
          ltmColdDays: { type: "number", description: "LTM cold threshold in days (default: 30)" },
          ltmMinAccessCount: { type: "number", description: "LTM min access count to stay active (default: 2)" },
        },
      },
      handler: async (params) => {
        const { stm, ltm } = getSession(sessionManager);
        const { stmMaxAgeMs, ltmColdDays, ltmMinAccessCount } = params as {
          stmMaxAgeMs?: number;
          ltmColdDays?: number;
          ltmMinAccessCount?: number;
        };
        const gcCollector = new MemoryGarbageCollector(stm, ltm as any, {
          ...(stmMaxAgeMs !== undefined && { stmMaxAgeMs }),
          ...(ltmColdDays !== undefined && { ltmColdDays }),
          ...(ltmMinAccessCount !== undefined && { ltmMinAccessCount }),
        });
        const report = await gcCollector.collect();
        return { success: true, data: report };
      },
    }),
  ];
}

/** 检查 LTM 后端是否为 Supermemory */
function isSupermemoryBackend(ltm: any): boolean {
  return ltm instanceof EnhancedLTMBackend === false && typeof ltm.getProfile === "function";
}

/** 检查 LTM 后端是否为 EnhancedLTMBackend */
function isEnhancedBackend(ltm: any): boolean {
  return ltm instanceof EnhancedLTMBackend;
}
