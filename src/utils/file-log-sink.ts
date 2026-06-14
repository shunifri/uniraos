import fs from "fs";
import path from "path";
import type { LogEntry, LogSink } from "./logger.js";

export interface FileSinkOptions {
  /** 日志目录，必须可写 */
  dir: string;
  /** 基础文件名，默认 raos.log */
  filename?: string;
  /** 单文件最大字节数，默认 10MB */
  maxSize?: number;
  /** 保留文件数上限，默认 7 */
  maxFiles?: number;
  /** 是否按天轮转，默认 true */
  rotateDaily?: boolean;
}

class FileLogSinkInternal {
  private dir: string;
  private baseName: string;
  private maxSize: number;
  private maxFiles: number;
  private rotateDaily: boolean;
  private currentDate: string;
  private fd: number;
  private currentSize: number;
  private currentPath: string;

  constructor(options: FileSinkOptions) {
    this.dir = options.dir;
    this.baseName = options.filename || "raos.log";
    this.maxSize = options.maxSize ?? 10 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 7;
    this.rotateDaily = options.rotateDaily ?? true;

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }

    this.currentDate = this.formatDate(new Date());
    this.currentPath = this.buildPath();
    this.currentSize = this.getExistingSize(this.currentPath);
    this.fd = fs.openSync(this.currentPath, "a");
  }

  write(entry: LogEntry): void {
    const now = new Date();
    const today = this.formatDate(now);

    // 按天轮转
    if (this.rotateDaily && today !== this.currentDate) {
      this.rotate(today);
    }

    const { timestamp, level, event, ...rest } = entry;
    const fields = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
    const levelStr = level.toUpperCase().padEnd(5);
    const line = `${timestamp} [${levelStr}] ${event}${fields}\n`;
    const buf = Buffer.from(line, "utf-8");

    // 按大小轮转
    if (this.currentSize + buf.length > this.maxSize) {
      this.rotate(today);
    }

    fs.writeSync(this.fd, buf);
    this.currentSize += buf.length;
  }

  close(): void {
    fs.closeSync(this.fd);
  }

  private rotate(newDate: string): void {
    fs.closeSync(this.fd);
    this.currentDate = newDate;

    // 重命名当前文件为带序号的归档名
    const archivePath = this.findNextArchivePath();
    try {
      fs.renameSync(this.currentPath, archivePath);
    } catch {
      // 若重命名失败（如文件不存在），继续创建新文件
    }

    this.currentPath = this.buildPath();
    this.currentSize = 0;
    this.fd = fs.openSync(this.currentPath, "a");
    this.cleanup();
  }

  private buildPath(): string {
    return path.join(this.dir, this.baseName);
  }

  private findNextArchivePath(): string {
    const ext = path.extname(this.baseName); // .log
    const name = path.basename(this.baseName, ext); // raos
    const date = this.currentDate; // YYYY-MM-DD

    let idx = 1;
    while (idx < 1000) {
      const candidate = path.join(this.dir, `${name}-${date}.${idx}${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
      idx++;
    }
    return path.join(this.dir, `${name}-${date}.999${ext}`);
  }

  private cleanup(): void {
    const ext = path.extname(this.baseName);
    const name = path.basename(this.baseName, ext);
    const pattern = new RegExp(`^${name}-\\d{4}-\\d{2}-\\d{2}\\.\\d+${ext.replace(".", "\\.")}$`);

    try {
      const files = fs
        .readdirSync(this.dir)
        .filter((f) => pattern.test(f))
        .map((f) => ({
          name: f,
          path: path.join(this.dir, f),
          mtime: fs.statSync(path.join(this.dir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // 保留最近的 maxFiles 个，删除其余
      for (let i = this.maxFiles; i < files.length; i++) {
        try {
          fs.unlinkSync(files[i].path);
        } catch {
          // 忽略清理失败
        }
      }
    } catch {
      // 目录读取失败时静默处理
    }
  }

  private formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  private getExistingSize(filePath: string): number {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }
}

/**
 * 创建文件日志 Sink。
 * 自动按天轮转，超出大小后按序号归档，保留最近 N 个归档文件。
 */
export function createFileSink(options: FileSinkOptions): LogSink {
  const sink = new FileLogSinkInternal(options);
  return (entry: LogEntry) => sink.write(entry);
}
