import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from "fs";
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

  /** 压缩：只保留未完成的条目，移除已完成/已失败的条目 */
  compact(): { removedEntries: number; remainingEntries: number } {
    const allEntries = [...this.entries.values()];
    const incompleteEntries = allEntries.filter((e) => e.status === "pending");
    const removedEntries = allEntries.length - incompleteEntries.length;

    const lines = incompleteEntries
      .map((e) => JSON.stringify({ op: "append", entry: e }))
      .join("\n");
    writeFileSync(this.filePath, lines.length > 0 ? lines + "\n" : "", "utf-8");

    return { removedEntries, remainingEntries: incompleteEntries.length };
  }

  private appendLine(data: unknown): void {
    appendFileSync(this.filePath, JSON.stringify(data) + "\n", "utf-8");
  }

  private loadFromFile(): void {
    if (!existsSync(this.filePath)) return;

    // P1-20 修复: 之前用 readFileSync 一次性读整个文件, 当 WAL 长到 500MB+ 时
    // 会撞到 Node 的字符串长度上限 (0x1fffffe8 = ~500MB) → 后端启动崩溃 → FE 一直转圈.
    // 解决: 文件 > 100MB 时, 截断保留最近 10000 行 (绝大多数都是已完成的历史 entry, 不重要).
    // 正常大小的文件还是用 readFileSync 同步读, 保持 constructor 同步语义不变.
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const MAX_LINES_KEEP = 10_000;
    const stat = statSync(this.filePath);
    if (stat.size > MAX_FILE_SIZE) {
      console.warn(
        `[WAL] File is ${(stat.size / 1024 / 1024).toFixed(0)}MB, exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. ` +
        `Truncating to last ${MAX_LINES_KEEP} lines to avoid Node string-length limit crash.`,
      );
      this.truncateKeepLastLines(MAX_LINES_KEEP);
    }

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

  /** 截断 WAL 文件, 只保留最后 N 行. 用于文件过大时手动清理. */
  private truncateKeepLastLines(keepLines: number): void {
    try {
      // 之前用 readFileSync 读整个文件, 但文件本身已 > 500MB 撞 Node 字符串上限.
      // 改为 readline 逐行读, 维护一个固定大小的环形缓冲, 读完直接覆写.
      // 不能用 createReadStream + readline (这是 constructor 里 stream 方案)
      // 因为这是同步调用 (loadFromFile 还没改 async). 所以改用 readline 同步版:
      // 实际上 readline 只有异步版, 我们用 createInterface 但用 sync 接口是不行的.
      // 改方案: 直接读文件大小, 如果太大, 走 fallback 路径 (rename + 新建).
      // 用户可以下次启动时让 fallback 自然处理.
      const stat = statSync(this.filePath);
      if (stat.size > 500 * 1024 * 1024) {
        // 文件太大, readFileSync 必爆, 直接走 fallback
        throw new Error(`File too large for sync read (${stat.size} bytes), going to fallback`);
      }
      const content = readFileSync(this.filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const keepFrom = Math.max(0, lines.length - keepLines);
      const kept = lines.slice(keepFrom).join("\n") + "\n";
      writeFileSync(this.filePath, kept, "utf-8");
      console.warn(`[WAL] Truncated: kept last ${keepLines} of ${lines.length} lines (${lines.length - keepLines} dropped)`);
    } catch (err) {
      console.error(`[WAL] truncate failed, renaming to .truncated-X and starting fresh:`, err);
      try {
        // 兜底: 用 rename 而不是 readFileSync 复制 (rename 不读内容, 不会爆)
        const backupPath = this.filePath + ".truncated-" + Date.now();
        const { renameSync } = require("fs");
        renameSync(this.filePath, backupPath);
        writeFileSync(this.filePath, "", "utf-8");
        console.warn(`[WAL] Renamed large file to ${backupPath}, started fresh empty WAL`);
      } catch (renameErr) {
        console.error(`[WAL] rename also failed, manually truncating to empty:`, renameErr);
        writeFileSync(this.filePath, "", "utf-8");
      }
    }
  }
}
