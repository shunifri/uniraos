/**
 * AutoConsolidator: Automatically promotes frequently accessed STM entries to LTM
 *
 * Criteria for promotion:
 * - accessCount >= threshold (default: 3)
 * - entry has been in STM for at least minAgeMs (default: 5 minutes)
 * - key doesn't start with "recall:" (those are transient recall_context injections)
 */
import type { ShortTermMemory } from "./stm.js";

interface LTMStorable {
  store(key: string, value: unknown, options?: { tags?: string[]; source?: string }): Promise<void>;
}

export interface ConsolidatorConfig {
  accessThreshold: number;    // min access count to promote (default: 3)
  minAgeMs: number;           // min time in STM before promotion (default: 300000 = 5 min)
  intervalMs: number;         // check interval (default: 60000 = 1 min)
  excludePrefixes: string[];  // prefixes to skip (default: ["recall:"])
}

export class AutoConsolidator {
  private stm: ShortTermMemory;
  private ltm: LTMStorable;
  private config: ConsolidatorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private promoted = new Set<string>(); // track already-promoted keys

  constructor(stm: ShortTermMemory, ltm: LTMStorable, config?: Partial<ConsolidatorConfig>) {
    this.stm = stm;
    this.ltm = ltm;
    this.config = {
      accessThreshold: config?.accessThreshold ?? 3,
      minAgeMs: config?.minAgeMs ?? 300000,
      intervalMs: config?.intervalMs ?? 60000,
      excludePrefixes: config?.excludePrefixes ?? ["recall:"],
      ...config,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.consolidate(), this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async consolidate(): Promise<{ promoted: string[] }> {
    const entries = this.stm.list();
    const now = Date.now();
    const promotedKeys: string[] = [];

    for (const entry of entries) {
      // Skip excluded prefixes
      if (this.config.excludePrefixes.some(p => entry.key.startsWith(p))) continue;
      // Skip already promoted
      if (this.promoted.has(entry.key)) continue;
      // Check criteria
      const age = now - entry.createdAt;
      if (entry.accessCount >= this.config.accessThreshold && age >= this.config.minAgeMs) {
        try {
          await this.ltm.store(entry.key, entry.value, {
            tags: ["consolidated", "from_stm"],
            source: "auto_consolidator",
          });
          this.promoted.add(entry.key);
          promotedKeys.push(entry.key);
        } catch {
          // Best effort
        }
      }
    }

    return { promoted: promotedKeys };
  }
}
