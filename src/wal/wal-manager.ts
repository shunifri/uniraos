import type { WALEntry, WALStore } from "../types/wal.js";
import { InMemoryWALStore } from "./wal-store.js";

/** 恢复计划 */
export interface RecoveryPlan {
  entries: WALEntry[];
  description: string;
}

/** 单条重放结果 */
export interface ReplayResult {
  entryId: string;
  skillName: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

/** 完整重放结果 */
export interface RecoveryResult {
  replayed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: ReplayResult[];
  durationMs: number;
}

export class WALManager {
  private store: WALStore;
  private lastRecoveryResult: RecoveryResult | null = null;

  constructor(store?: WALStore) {
    this.store = store ?? new InMemoryWALStore();
  }

  /** 开始记录一个 Skill 执行 */
  begin(
    traceId: string,
    skillName: string,
    params: Record<string, unknown>,
    parentEntryId?: string,
  ): string {
    const id = crypto.randomUUID();
    const entry: WALEntry = {
      id,
      traceId,
      skillName,
      params,
      status: "pending",
      timestamp: Date.now(),
      parentEntryId,
    };
    this.store.append(entry);
    return id;
  }

  /** 标记完成 */
  complete(id: string, result?: unknown): void {
    this.store.markCompleted(id, result);
  }

  /** 标记失败 */
  fail(id: string, error: string): void {
    this.store.markFailed(id, error);
  }

  /** 获取未完成的条目 */
  getIncomplete(): WALEntry[] {
    return this.store.getIncomplete();
  }

  /** 获取所有条目 */
  getAll(): WALEntry[] {
    return this.store.getAll();
  }

  /** 生成恢复计划 */
  recover(): RecoveryPlan {
    const incomplete = this.store.getIncomplete();
    return {
      entries: incomplete,
      description:
        incomplete.length === 0
          ? "No incomplete entries"
          : `${incomplete.length} skill(s) need re-execution: ${incomplete.map((e) => e.skillName).join(", ")}`,
    };
  }

  /**
   * 自动重放未完成的 WAL 条目
   *
   * 按拓扑顺序执行：先重放没有 parentEntryId 的顶层条目，
   * 子条目在父条目重放时会由递归引擎自动处理，因此跳过。
   */
  async replay(engine: { execute: (skillName: string, params: Record<string, unknown>) => Promise<unknown> }): Promise<RecoveryResult> {
    const startTime = Date.now();
    const plan = this.recover();
    const results: ReplayResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    if (plan.entries.length === 0) {
      const result: RecoveryResult = {
        replayed: 0, succeeded: 0, failed: 0, skipped: 0,
        results: [], durationMs: 0,
      };
      this.lastRecoveryResult = result;
      return result;
    }

    // 只重放顶层条目（无 parentEntryId 的），子条目由递归引擎自动处理
    const topLevel = plan.entries.filter((e) => !e.parentEntryId);
    const childEntries = plan.entries.filter((e) => e.parentEntryId);

    // 将子条目标记为跳过（会在父重放时自动执行）
    for (const child of childEntries) {
      this.store.markFailed(child.id, "skipped: will be replayed as part of parent");
      skipped++;
    }

    for (const entry of topLevel) {
      const entryStart = Date.now();
      try {
        await engine.execute(entry.skillName, entry.params);
        // 标记原始 WAL 条目完成
        this.store.markCompleted(entry.id, { replayed: true });
        succeeded++;
        results.push({
          entryId: entry.id,
          skillName: entry.skillName,
          success: true,
          durationMs: Date.now() - entryStart,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? (err as Error).message : String(err);
        this.store.markFailed(entry.id, `replay failed: ${errorMsg}`);
        failed++;
        results.push({
          entryId: entry.id,
          skillName: entry.skillName,
          success: false,
          error: errorMsg,
          durationMs: Date.now() - entryStart,
        });
      }
    }

    const result: RecoveryResult = {
      replayed: topLevel.length,
      succeeded,
      failed,
      skipped,
      results,
      durationMs: Date.now() - startTime,
    };
    this.lastRecoveryResult = result;
    return result;
  }

  /** 获取上次恢复结果 */
  getLastRecoveryResult(): RecoveryResult | null {
    return this.lastRecoveryResult;
  }

  /** 清空 WAL */
  clear(): void {
    this.store.clear();
  }

  /** 压缩 WAL：移除已完成/已失败的条目，只保留未完成的条目 */
  compact(): { removedEntries: number; remainingEntries: number } {
    if ("compact" in this.store && typeof (this.store as any).compact === "function") {
      return (this.store as any).compact();
    }
    // 对于不支持压缩的存储后端（如 InMemoryWALStore），返回空结果
    const all = this.store.getAll();
    const incomplete = this.store.getIncomplete();
    return {
      removedEntries: all.length - incomplete.length,
      remainingEntries: incomplete.length,
    };
  }
}
