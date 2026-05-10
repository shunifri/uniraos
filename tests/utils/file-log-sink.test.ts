import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createFileSink, type FileSinkOptions } from "../../src/utils/file-log-sink";
import type { LogEntry } from "../../src/utils/logger";

describe("file-log-sink", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raos-log-test-"));
  });

  afterEach(() => {
    // 清理临时目录
    try {
      const entries = fs.readdirSync(tmpDir);
      for (const entry of entries) {
        fs.unlinkSync(path.join(tmpDir, entry));
      }
      fs.rmdirSync(tmpDir);
    } catch {
      // ignore cleanup errors
    }
  });

  function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level: "info",
      event: "test.event",
      ...overrides,
    };
  }

  it("should create log file and write entries", () => {
    const sink = createFileSink({ dir: tmpDir, filename: "test.log" });
    sink(makeEntry({ event: "hello.world" }));

    const logPath = path.join(tmpDir, "test.log");
    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("hello.world");
    expect(content).toContain("[INFO ]");
  });

  it("should rotate when file exceeds maxSize", () => {
    const sink = createFileSink({
      dir: tmpDir,
      filename: "small.log",
      maxSize: 200,
      maxFiles: 10,
      rotateDaily: false,
    });

    // 每条日志约 45 字节，写 6 条应触发轮转
    for (let i = 0; i < 6; i++) {
      sink(makeEntry({ event: `line-${i}` }));
    }

    const files = fs.readdirSync(tmpDir).sort();
    expect(files.length).toBeGreaterThanOrEqual(2); // 当前 + 至少 1 个归档

    const current = path.join(tmpDir, "small.log");
    const currentContent = fs.readFileSync(current, "utf-8");
    expect(currentContent).toContain("line-5");

    // 归档文件应包含前面的日志
    const archives = files.filter((f) => f.startsWith("small-") && f !== "small.log");
    expect(archives.length).toBeGreaterThanOrEqual(1);
  });

  it("should cleanup old archives exceeding maxFiles", () => {
    const sink = createFileSink({
      dir: tmpDir,
      filename: "rotate.log",
      maxSize: 50,
      maxFiles: 2,
      rotateDaily: false,
    });

    // 强制触发多次轮转，产生多个归档
    for (let i = 0; i < 10; i++) {
      sink(makeEntry({ event: `batch-${i}` }));
    }

    const files = fs.readdirSync(tmpDir);
    const archives = files.filter((f) => f.startsWith("rotate-") && f !== "rotate.log");

    // 归档文件不应超过 maxFiles
    expect(archives.length).toBeLessThanOrEqual(2);
  });

  it("should create directory if not exists", () => {
    const nested = path.join(tmpDir, "deep", "nested");
    const sink = createFileSink({ dir: nested, filename: "deep.log" });
    sink(makeEntry());

    expect(fs.existsSync(path.join(nested, "deep.log"))).toBe(true);
  });

  it("should format extra fields as JSON", () => {
    const sink = createFileSink({ dir: tmpDir, filename: "fields.log" });
    sink(makeEntry({ event: "user.action", userId: "42", role: "admin" }));

    const content = fs.readFileSync(path.join(tmpDir, "fields.log"), "utf-8");
    expect(content).toContain('"userId":"42"');
    expect(content).toContain('"role":"admin"');
  });
});
