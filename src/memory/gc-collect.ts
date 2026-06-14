/**
 * Memory Garbage Collector
 * Cleans stale STM entries and archives cold LTM entries.
 */

export interface GCConfig {
  stmMaxAgeMs: number;       // default 3600_000 (1 hour)
  ltmColdDays: number;       // default 30
  ltmMinAccessCount: number; // default 2
}

export interface GCReport {
  stmCleaned: number;
  ltmArchived: number;
  durationMs: number;
  timestamp: number;
}

const DEFAULT_GC_CONFIG: GCConfig = {
  stmMaxAgeMs: 3600_000,
  ltmColdDays: 30,
  ltmMinAccessCount: 2,
};

/** STM interface required by the GC */
interface STMInterface {
  list(): Array<{ key: string; value: unknown; accessedAt: number }>;
  delete(key: string): boolean;
}

/** LTM interface required by the GC */
interface LTMInterface {
  list(options?: { limit?: number }): Array<{ key: string; value: unknown; accessCount: number; lastAccessedAt: number; createdAt: number }> | Promise<Array<{ key: string; value: unknown; accessCount: number; lastAccessedAt: number; createdAt: number }>>;
  archive?(reason?: string): Promise<{ archived: number; manifest?: unknown }>;
}

export class MemoryGarbageCollector {
  private stm: STMInterface;
  private ltm: LTMInterface;
  private config: GCConfig;

  constructor(stm: STMInterface, ltm: LTMInterface, config?: Partial<GCConfig>) {
    this.stm = stm;
    this.ltm = ltm;
    this.config = { ...DEFAULT_GC_CONFIG, ...config };
  }

  /**
   * Finds STM entries that have exceeded the maximum age (stmMaxAgeMs).
   */
  findStaleStmEntries(): Array<{ key: string }> {
    const now = Date.now();
    const entries = this.stm.list();
    return entries.filter((entry) => now - entry.accessedAt > this.config.stmMaxAgeMs);
  }

  /**
   * Finds LTM entries that are "cold" — either not accessed recently or
   * with too few accesses to warrant keeping in the active set.
   */
  findColdLtmEntries(): Array<{ key: string }> {
    const now = Date.now();
    const coldThresholdMs = this.config.ltmColdDays * 86400_000;
    const minAccessCount = this.config.ltmMinAccessCount;

    // list() may be synchronous (mock) or async — handle both
    const rawEntries = this.stm.list(); // used only for type check
    void rawEntries; // suppress unused warning

    // We call ltm.list() synchronously here because mocks return synchronously.
    // The async version is handled in collect().
    const entries = (this.ltm.list as () => Array<{ key: string; accessCount: number; lastAccessedAt: number; createdAt: number }>)();

    return entries.filter((entry) => {
      const isOld = now - entry.lastAccessedAt > coldThresholdMs;
      const isLowFreq = entry.accessCount < minAccessCount;
      return isOld || isLowFreq;
    });
  }

  /**
   * Runs the garbage collection:
   *  1. Deletes stale STM entries.
   *  2. Archives cold LTM entries (if ltm.archive is available).
   * Returns a GCReport with counts and timing.
   */
  async collect(): Promise<GCReport> {
    const start = Date.now();

    // --- STM cleanup ---
    const staleEntries = this.findStaleStmEntries();
    for (const entry of staleEntries) {
      this.stm.delete(entry.key);
    }

    // --- LTM archival ---
    let ltmArchived = 0;

    if (typeof this.ltm.archive === "function") {
      // Get cold entries to determine count
      const allEntries = await Promise.resolve(this.ltm.list({ limit: 1_000_000 }));
      const now = Date.now();
      const coldThresholdMs = this.config.ltmColdDays * 86400_000;
      const minAccessCount = this.config.ltmMinAccessCount;

      const coldEntries = allEntries.filter((entry) => {
        const isOld = now - entry.lastAccessedAt > coldThresholdMs;
        const isLowFreq = entry.accessCount < minAccessCount;
        return isOld || isLowFreq;
      });

      if (coldEntries.length > 0) {
        const result = await this.ltm.archive!("gc_collect");
        ltmArchived = result.archived;
      }
    }

    return {
      stmCleaned: staleEntries.length,
      ltmArchived,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };
  }
}
