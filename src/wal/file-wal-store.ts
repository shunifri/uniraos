import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { WALEntry, WALStore } from "../types/wal.js";

/**
 * 基于 JSON Lines 的文件 WAL 存储
 * 每行一个 JSON 对象，append-only 写入
 */
export class FileWALStore implements WALStore {
  private entries = new Map<string, WALEntry>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.loadFromFile();
  }

  append(entry: WALEntry): void {
    this.entries.set(entry.id, { ...entry });
    this.appendLine({ op: "append", entry });
  }

  markCompleted(id: string, result?: unknown): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.status = "completed";
      entry.completedAt = Date.now();
      entry.result = result;
      this.appendLine({ op: "complete", id, result, completedAt: entry.completedAt });
    }
  }

  markFailed(id: string, error: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.status = "failed";
      entry.completedAt = Date.now();
      entry.error = error;
      this.appendLine({ op: "fail", id, error, completedAt: entry.completedAt });
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
    writeFileSync(this.filePath, "", "utf-8");
  }

  /** 压缩：将当前状态重写为干净文件 */
  compact(): void {
    const lines = [...this.entries.values()]
      .map((e) => JSON.stringify({ op: "append", entry: e }))
      .join("\n");
    writeFileSync(this.filePath, lines + "\n", "utf-8");
  }

  private appendLine(data: unknown): void {
    appendFileSync(this.filePath, JSON.stringify(data) + "\n", "utf-8");
  }

  private loadFromFile(): void {
    if (!existsSync(this.filePath)) return;

    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.op === "append" && record.entry) {
          this.entries.set(record.entry.id, record.entry);
        } else if (record.op === "complete") {
          const entry = this.entries.get(record.id);
          if (entry) {
            entry.status = "completed";
            entry.completedAt = record.completedAt;
            entry.result = record.result;
          }
        } else if (record.op === "fail") {
          const entry = this.entries.get(record.id);
          if (entry) {
            entry.status = "failed";
            entry.completedAt = record.completedAt;
            entry.error = record.error;
          }
        }
      } catch {
        // 跳过损坏的行
      }
    }
  }
}
