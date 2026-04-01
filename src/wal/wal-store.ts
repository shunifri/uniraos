import type { WALEntry, WALStore } from "../types/wal.js";

/** 内存 WAL 存储实现（MVP 用） */
export class InMemoryWALStore implements WALStore {
  private entries = new Map<string, WALEntry>();

  append(entry: WALEntry): void {
    this.entries.set(entry.id, { ...entry });
  }

  markCompleted(id: string, result?: unknown): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.status = "completed";
      entry.completedAt = Date.now();
      entry.result = result;
    }
  }

  markFailed(id: string, error: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.status = "failed";
      entry.completedAt = Date.now();
      entry.error = error;
    }
  }

  getIncomplete(): WALEntry[] {
    return [...this.entries.values()].filter((e) => e.status === "pending");
  }

  getAll(): WALEntry[] {
    return [...this.entries.values()];
  }

  clear(): void {
    this.entries.clear();
  }
}
