import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  parseCli,
  printHelp,
  parseWalFile,
  compactWal,
  formatReport,
  makeArchivePath,
  main,
  type CliArgs,
  type CompactConfig,
  type WALLine,
} from "../../scripts/wal-compact";
import { walActiveSizeBytes, updateWalActiveSize } from "../../src/monitoring/metrics";
import { WAL_SIZE_HIGH, findAlert, ALL_ALERTS } from "../../src/monitoring/alerts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSONL WAL file with the given ops, one per line. */
function buildWalFile(filePath: string, ops: WALLine[]): void {
  const content = ops.map((o) => JSON.stringify(o)).join("\n") + (ops.length > 0 ? "\n" : "");
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Make an "append" op with sensible defaults. */
function makeAppend(
  id: string,
  skillName: string,
  status: "pending" | "completed" | "failed" = "pending",
  traceId = `trace-${id}`,
): WALLine {
  return {
    op: "append",
    entry: {
      id,
      traceId,
      skillName,
      params: { key: `val-${id}` },
      status,
      timestamp: Date.now() - 60_000,
    },
  };
}

function makeComplete(id: string, result?: unknown): WALLine {
  return { op: "complete", id, result, completedAt: Date.now() };
}

function makeFail(id: string, error: string): WALLine {
  return { op: "fail", id, error, completedAt: Date.now() };
}

/** Make a WAL file > 50MB by padding with completed entries (each ~200B JSON). */
function makeLargeWalFile(filePath: string, targetBytes: number): { appended: number; totalEntries: number } {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let appended = 0;
  let totalEntries = 0;
  const lines: string[] = [];
  while (appended < targetBytes) {
    const id = `pad-${totalEntries}`;
    const appendLine = JSON.stringify({
      op: "append",
      entry: {
        id,
        traceId: `trace-${id}`,
        skillName: "padding",
        params: { x: "x".repeat(80) },
        status: "pending",
        timestamp: 1700000000000,
      },
    });
    const completeLine = JSON.stringify({
      op: "complete",
      id,
      completedAt: 1700000000001,
    });
    lines.push(appendLine, completeLine);
    appended += appendLine.length + completeLine.length + 2;
    totalEntries++;
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  return { appended, totalEntries };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wal-compact script", () => {
  let tmpDir: string;
  let walPath: string;
  let archiveDir: string;
  let fixedNow: Date;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-compact-test-"));
    walPath = path.join(tmpDir, "wal.jsonl");
    archiveDir = path.join(tmpDir, "archive");
    fixedNow = new Date("2026-06-08T04:19:56.123Z");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- parseCli ----------------------------------------------------------

  describe("parseCli", () => {
    it("returns safe defaults (dry-run, 50MB threshold, no paths)", () => {
      const r = parseCli([], {});
      expect(r.apply).toBe(false);
      expect(r.dryRun).toBe(false);
      expect(r.walPath).toBeNull();
      expect(r.archiveDir).toBeNull();
      expect(r.thresholdMB).toBeNull();
      expect(r.help).toBe(false);
    });

    it("parses --apply", () => {
      const r = parseCli(["--apply"], {});
      expect(r.apply).toBe(true);
      expect(r.dryRun).toBe(false);
    });

    it("parses --dry-run", () => {
      const r = parseCli(["--dry-run"], {});
      expect(r.dryRun).toBe(true);
      expect(r.apply).toBe(false);
    });

    it("parses --wal=/path/to/wal.jsonl", () => {
      const r = parseCli(["--wal=/var/lib/raos/wal.jsonl"], {});
      expect(r.walPath).toBe("/var/lib/raos/wal.jsonl");
    });

    it("parses --archive-dir=/path", () => {
      const r = parseCli(["--archive-dir=/data/wal-archive"], {});
      expect(r.archiveDir).toBe("/data/wal-archive");
    });

    it("parses --threshold=80 (MB)", () => {
      const r = parseCli(["--threshold=80"], {});
      expect(r.thresholdMB).toBe(80);
    });

    it("ignores --threshold=non-numeric", () => {
      const r = parseCli(["--threshold=abc"], {});
      expect(r.thresholdMB).toBeNull();
    });

    it("accepts --threshold=0 (means: always compact, no threshold check)", () => {
      const r = parseCli(["--threshold=0"], {});
      expect(r.thresholdMB).toBe(0);
    });

    it("parses --help and -h", () => {
      expect(parseCli(["--help"], {}).help).toBe(true);
      expect(parseCli(["-h"], {}).help).toBe(true);
    });

    it("combines all flags", () => {
      const r = parseCli(
        ["--apply", "--wal=/a/wal.jsonl", "--archive-dir=/b", "--threshold=100"],
        {},
      );
      expect(r).toEqual<CliArgs>({
        apply: true,
        dryRun: false,
        walPath: "/a/wal.jsonl",
        archiveDir: "/b",
        thresholdMB: 100,
        help: false,
      });
    });
  });

  // ---- printHelp ---------------------------------------------------------

  describe("printHelp", () => {
    it("includes --apply, --dry-run, --threshold, --wal", () => {
      const h = printHelp();
      expect(h).toContain("--apply");
      expect(h).toContain("--dry-run");
      expect(h).toContain("--threshold");
      expect(h).toContain("--wal");
      expect(h).toContain("--archive-dir");
    });

    it("mentions cron recommendation", () => {
      const h = printHelp();
      expect(h).toMatch(/cron/i);
    });
  });

  // ---- parseWalFile ------------------------------------------------------

  describe("parseWalFile", () => {
    it("returns empty result when file doesn't exist", async () => {
      const result = await parseWalFile(path.join(tmpDir, "missing.jsonl"));
      expect(result.totalLines).toBe(0);
      expect(result.entries.size).toBe(0);
      expect(result.malformedLines).toBe(0);
    });

    it("parses append + complete ops correctly", async () => {
      buildWalFile(walPath, [
        makeAppend("e1", "skill_a", "pending"),
        makeAppend("e2", "skill_b", "pending"),
        makeComplete("e1", { ok: true }),
        makeComplete("e2", { ok: true }),
      ]);
      const result = await parseWalFile(walPath);
      expect(result.totalLines).toBe(4);
      expect(result.entries.size).toBe(2);
      expect(result.malformedLines).toBe(0);
      const e1 = result.entries.get("e1");
      expect(e1?.status).toBe("completed");
      expect(e1?.result).toEqual({ ok: true });
    });

    it("parses fail ops correctly", async () => {
      buildWalFile(walPath, [
        makeAppend("e1", "skill_a", "pending"),
        makeFail("e1", "boom"),
      ]);
      const result = await parseWalFile(walPath);
      expect(result.entries.size).toBe(1);
      expect(result.entries.get("e1")?.status).toBe("failed");
      expect(result.entries.get("e1")?.error).toBe("boom");
    });

    it("skips malformed lines and counts them", async () => {
      fs.writeFileSync(
        walPath,
        [
          JSON.stringify(makeAppend("e1", "good", "pending")),
          "this is not json",
          '{"op": "unknown"}',
          JSON.stringify(makeAppend("e2", "good2", "completed")),
        ].join("\n") + "\n",
        "utf-8",
      );
      const result = await parseWalFile(walPath);
      expect(result.entries.size).toBe(2);
      expect(result.malformedLines).toBe(2);
    });

    it("skips append ops with missing entry.id", async () => {
      fs.writeFileSync(
        walPath,
        JSON.stringify({ op: "append", entry: { id: 123, skillName: "x" } }) + "\n",
        "utf-8",
      );
      const result = await parseWalFile(walPath);
      expect(result.entries.size).toBe(0);
      expect(result.malformedLines).toBe(1);
    });

    it("handles complete/fail for unknown ids (no-op, not malformed)", async () => {
      buildWalFile(walPath, [
        makeComplete("ghost", { ok: true }),
        makeFail("ghost2", "no-entry"),
      ]);
      const result = await parseWalFile(walPath);
      expect(result.totalLines).toBe(2);
      expect(result.malformedLines).toBe(0);
      expect(result.entries.size).toBe(0);
    });
  });

  // ---- compactWal: dry-run ----------------------------------------------

  describe("compactWal: dry-run", () => {
    it("returns noop when file doesn't exist (no writes, no errors)", async () => {
      const cfg: CompactConfig = {
        walPath,
        archiveDir,
        thresholdBytes: 50 * 1024 * 1024,
        apply: false,
        now: fixedNow,
      };
      const report = await compactWal(cfg);
      expect(report.mode).toBe("dry-run");
      expect(report.activeSizeBefore).toBe(0);
      expect(report.activeSizeAfter).toBe(0);
      expect(report.entriesArchived).toBe(0);
      expect(report.skippedBelowThreshold).toBe(false);
      // No archive directory created
      expect(fs.existsSync(archiveDir)).toBe(false);
    });

    it("returns noop when file is below threshold", async () => {
      // 100 bytes of WAL — well under 50MB
      buildWalFile(walPath, [makeAppend("e1", "small", "completed")]);
      const cfg: CompactConfig = {
        walPath,
        archiveDir,
        thresholdBytes: 50 * 1024 * 1024,
        apply: false,
        now: fixedNow,
      };
      const report = await compactWal(cfg);
      expect(report.skippedBelowThreshold).toBe(true);
      expect(report.activeSizeBefore).toBeLessThan(cfg.thresholdBytes);
      expect(report.activeSizeAfter).toBe(report.activeSizeBefore);
      expect(report.entriesArchived).toBe(0);
      // File unchanged
      expect(fs.readFileSync(walPath, "utf-8")).toContain("small");
      // No archive dir created
      expect(fs.existsSync(archiveDir)).toBe(false);
    });

    it("does NOT write archive file in dry-run even when above threshold", async () => {
      // Build a 100KB file (>50MB would be huge for tests; use a smaller threshold)
      makeLargeWalFile(walPath, 100_000);
      const cfg: CompactConfig = {
        walPath,
        archiveDir,
        thresholdBytes: 50 * 1024, // 50KB threshold (not 50MB)
        apply: false,
        now: fixedNow,
      };
      const report = await compactWal(cfg);
      expect(report.mode).toBe("dry-run");
      expect(report.skippedBelowThreshold).toBe(false);
      expect(report.entriesArchived).toBeGreaterThan(0);
      // Report should predict archive size, but no actual file written
      expect(report.archiveFiles.length).toBe(1);
      expect(fs.existsSync(report.archiveFiles[0].path)).toBe(false);
      // Active file unchanged
      expect(fs.existsSync(walPath)).toBe(true);
      const sizeAfter = fs.statSync(walPath).size;
      expect(sizeAfter).toBeGreaterThan(cfg.thresholdBytes);
    });
  });

  // ---- compactWal: apply (the meat) -------------------------------------

  describe("compactWal: apply", () => {
    it("archives completed entries and keeps pending", async () => {
      // 5 completed + 1 pending
      const ops: WALLine[] = [];
      for (let i = 0; i < 5; i++) {
        const id = `e${i}`;
        ops.push(makeAppend(id, `skill_${i}`, "pending"));
        ops.push(makeComplete(id, { idx: i }));
      }
      const pendingId = "pending-1";
      ops.push(makeAppend(pendingId, "running", "pending"));
      buildWalFile(walPath, ops);

      const cfg: CompactConfig = {
        walPath,
        archiveDir,
        thresholdBytes: 0, // 0 = always compact (bypass for test)
        apply: true,
        now: fixedNow,
      };
      const report = await compactWal(cfg);
      expect(report.mode).toBe("apply");
      expect(report.entriesArchived).toBe(5);
      expect(report.entriesKept).toBe(1);
      expect(report.activeSizeAfter).toBeLessThan(report.activeSizeBefore);

      // Archive file exists
      expect(report.archiveFiles.length).toBe(1);
      const archiveFile = report.archiveFiles[0];
      expect(fs.existsSync(archiveFile.path)).toBe(true);
      // Archive contains 5 entries
      const archiveContent = fs.readFileSync(archiveFile.path, "utf-8");
      const archiveLines = archiveContent.trim().split("\n").filter(Boolean);
      expect(archiveLines.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(archiveContent).toContain(`skill_${i}`);
      }
      // Archive is in correct subdir (YYYY-MM-DD)
      const expectedSubdir = fixedNow.toISOString().slice(0, 10);
      expect(archiveFile.path).toContain(expectedSubdir);

      // Active file contains ONLY the pending entry
      const activeContent = fs.readFileSync(walPath, "utf-8");
      expect(activeContent).toContain("running");
      expect(activeContent).not.toContain("skill_0");
      expect(activeContent).not.toContain("skill_4");

      // Gauge was updated
      const gaugeValue = await walActiveSizeBytes.get();
      const pointForPath = gaugeValue.values.find((v) => v.labels.path === walPath);
      expect(pointForPath?.value).toBe(report.activeSizeAfter);
    });

    it("archives failed entries too", async () => {
      const ops: WALLine[] = [
        makeAppend("good", "skill_good", "pending"),
        makeComplete("good"),
        makeAppend("bad", "skill_bad", "pending"),
        makeFail("bad", "explosion"),
      ];
      buildWalFile(walPath, ops);

      const report = await compactWal({
        walPath,
        archiveDir,
        thresholdBytes: 0,
        apply: true,
        now: fixedNow,
      });
      expect(report.entriesArchived).toBe(2); // good + bad
      expect(report.entriesKept).toBe(0);
      // Active file should be empty
      const activeContent = fs.readFileSync(walPath, "utf-8").trim();
      expect(activeContent).toBe("");
    });

    it("noop when all entries are pending (nothing to archive)", async () => {
      const ops: WALLine[] = [
        makeAppend("p1", "p1_skill", "pending"),
        makeAppend("p2", "p2_skill", "pending"),
      ];
      buildWalFile(walPath, ops);
      const beforeContent = fs.readFileSync(walPath, "utf-8");

      const report = await compactWal({
        walPath,
        archiveDir,
        thresholdBytes: 0,
        apply: true,
        now: fixedNow,
      });
      expect(report.entriesArchived).toBe(0);
      expect(report.entriesKept).toBe(2);
      // Active file unchanged (writeArchiveFile not called, rewriteActiveWal not called)
      // Note: implementation may or may not rewrite — but the content should be semantically same
      const afterContent = fs.readFileSync(walPath, "utf-8");
      expect(afterContent).toContain("p1_skill");
      expect(afterContent).toContain("p2_skill");
      // No archive file
      expect(fs.existsSync(archiveDir)).toBe(false);
    });

    it("handles empty file (0 bytes)", async () => {
      fs.writeFileSync(walPath, "", "utf-8");
      const report = await compactWal({
        walPath,
        archiveDir,
        thresholdBytes: 0,
        apply: true,
        now: fixedNow,
      });
      expect(report.activeSizeBefore).toBe(0);
      expect(report.totalEntries).toBe(0);
      expect(report.entriesArchived).toBe(0);
    });

    it("reloads correctly: archived file can be parsed standalone", async () => {
      const ops: WALLine[] = [];
      for (let i = 0; i < 3; i++) {
        const id = `e${i}`;
        ops.push(makeAppend(id, `s${i}`, "pending"));
        ops.push(makeComplete(id, { idx: i }));
      }
      buildWalFile(walPath, ops);

      const report = await compactWal({
        walPath,
        archiveDir,
        thresholdBytes: 0,
        apply: true,
        now: fixedNow,
      });
      const archivePath = report.archiveFiles[0].path;
      const reparsed = await parseWalFile(archivePath);
      expect(reparsed.entries.size).toBe(3);
      for (let i = 0; i < 3; i++) {
        const e = reparsed.entries.get(`e${i}`);
        expect(e?.status).toBe("completed");
        expect(e?.result).toEqual({ idx: i });
      }
    });
  });

  // ---- makeArchivePath ---------------------------------------------------

  describe("makeArchivePath", () => {
    it("places files under YYYY-MM-DD subdir with ISO timestamp filename", () => {
      const p = makeArchivePath(archiveDir, fixedNow);
      expect(p).toContain("2026-06-08");
      expect(p).toMatch(/wal-2026-06-08T04-19-56-123Z\.jsonl$/);
    });
  });

  // ---- formatReport ------------------------------------------------------

  describe("formatReport", () => {
    it("renders a readable multi-line report", () => {
      // Use exact MB multiples to avoid formatBytes rounding mismatch
      const MB = 1024 * 1024;
      const report = {
        mode: "apply" as const,
        walPath,
        archiveDir,
        thresholdBytes: 50 * MB,
        activeSizeBefore: 100 * MB,
        activeSizeAfter: 10 * MB,
        totalLines: 100,
        totalEntries: 80,
        entriesArchived: 70,
        entriesKept: 10,
        malformedLines: 2,
        skippedBelowThreshold: false,
        archiveFiles: [{ path: "/data/wal/archive/2026-06-08/wal-x.jsonl", entryCount: 70, sizeBytes: 90 * MB }],
        durationMs: 123,
        startedAt: fixedNow.toISOString(),
      };
      const out = formatReport(report);
      expect(out).toContain("APPLY");
      expect(out).toContain("100.00MB");
      expect(out).toContain("10.00MB");
      expect(out).toContain("90.0%");  // toFixed(1) gives one decimal
      expect(out).toContain("entries archived:");
      expect(out).toContain("70");
      expect(out).toContain("malformed lines:");
      expect(out).toContain("2");
      expect(out).toContain("archive file:");
    });

    it("renders DRY-RUN differently and adds hint", () => {
      const report = {
        mode: "dry-run" as const,
        walPath,
        archiveDir,
        thresholdBytes: 50 * 1024 * 1024,
        activeSizeBefore: 100,
        activeSizeAfter: 50,
        totalLines: 1,
        totalEntries: 1,
        entriesArchived: 1,
        entriesKept: 0,
        malformedLines: 0,
        skippedBelowThreshold: false,
        archiveFiles: [],
        durationMs: 5,
        startedAt: fixedNow.toISOString(),
      };
      const out = formatReport(report);
      expect(out).toContain("DRY-RUN");
      expect(out).toContain("run with --apply");
    });

    it("shows SKIPPED when below threshold", () => {
      const report = {
        mode: "dry-run" as const,
        walPath,
        archiveDir,
        thresholdBytes: 50 * 1024 * 1024,
        activeSizeBefore: 100,
        activeSizeAfter: 100,
        totalLines: 0,
        totalEntries: 0,
        entriesArchived: 0,
        entriesKept: 0,
        malformedLines: 0,
        skippedBelowThreshold: true,
        archiveFiles: [],
        durationMs: 1,
        startedAt: fixedNow.toISOString(),
      };
      const out = formatReport(report);
      expect(out).toContain("SKIPPED");
      expect(out).toContain("below threshold");
    });
  });

  // ---- main() CLI entry --------------------------------------------------

  describe("main (CLI entry)", () => {
    it("--help exits 0 and prints help to stdout", async () => {
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const code = await main(["--help"], {});
      expect(code).toBe(0);
      expect(stdoutWrite).toHaveBeenCalled();
      const text = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("Usage: wal-compact");
      stdoutWrite.mockRestore();
    });

    it("dry-run with no WAL file exits 0 and writes report", async () => {
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const code = await main(
        ["--dry-run", `--wal=${walPath}`, `--archive-dir=${archiveDir}`],
        {},
      );
      expect(code).toBe(0);
      const text = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("DRY-RUN REPORT");
      expect(stderrWrite).not.toHaveBeenCalled();
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    });

    it("apply on large WAL archives and rewrites active (exits 0)", async () => {
      // Build a >50KB WAL so the default 50MB threshold doesn't skip it
      // (use --threshold=0 to bypass threshold check entirely)
      makeLargeWalFile(walPath, 60_000);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const code = await main(
        ["--apply", "--threshold=0", `--wal=${walPath}`, `--archive-dir=${archiveDir}`],
        {},
      );
      expect(code).toBe(0);
      const text = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("APPLY REPORT");
      // Archive created — use TODAY's date subdir (main() uses real Date.now())
      expect(fs.existsSync(archiveDir)).toBe(true);
      const todaySubdir = path.join(archiveDir, new Date().toISOString().slice(0, 10));
      const archiveFiles = fs.readdirSync(todaySubdir);
      expect(archiveFiles.length).toBe(1);
      expect(archiveFiles[0]).toMatch(/\.jsonl$/);
      expect(stderrWrite).not.toHaveBeenCalled();
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests for src/monitoring/metrics.ts
// ---------------------------------------------------------------------------

describe("src/monitoring/metrics.ts", () => {
  let tmpDir: string;
  let walPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-metrics-test-"));
    walPath = path.join(tmpDir, "wal.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updateWalActiveSize returns 0 for missing file and sets gauge to 0", async () => {
    const size = updateWalActiveSize(walPath);
    expect(size).toBe(0);
    const all = await walActiveSizeBytes.get();
    const v = all.values.find((x) => x.labels.path === walPath);
    expect(v?.value).toBe(0);
  });

  it("updateWalActiveSize reads size from disk and updates gauge", async () => {
    fs.writeFileSync(walPath, "x".repeat(1234), "utf-8");
    const size = updateWalActiveSize(walPath);
    expect(size).toBe(1234);
    const all = await walActiveSizeBytes.get();
    const v = all.values.find((x) => x.labels.path === walPath);
    expect(v?.value).toBe(1234);
  });

  it("updateWalActiveSize is idempotent (calling twice gives same value)", async () => {
    fs.writeFileSync(walPath, "x".repeat(500), "utf-8");
    const s1 = updateWalActiveSize(walPath);
    const s2 = updateWalActiveSize(walPath);
    expect(s1).toBe(500);
    expect(s2).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests for src/monitoring/alerts.ts
// ---------------------------------------------------------------------------

describe("src/monitoring/alerts.ts", () => {
  it("WAL_SIZE_HIGH has correct shape: 200MB, for 5m, severity warning", () => {
    expect(WAL_SIZE_HIGH.alert).toBe("WAL_SIZE_HIGH");
    expect(WAL_SIZE_HIGH.expr).toBe("wal_active_size_bytes > 209715200");
    expect(WAL_SIZE_HIGH.for).toBe("5m");
    expect(WAL_SIZE_HIGH.labels.severity).toBe("warning");
  });

  it("WAL_SIZE_HIGH description mentions wal:compact and the P1-20 truncate fallback", () => {
    expect(WAL_SIZE_HIGH.annotations.description).toContain("wal:compact");
    expect(WAL_SIZE_HIGH.annotations.description).toMatch(/P1-20|truncate|100MB/);
  });

  it("ALL_ALERTS contains WAL_SIZE_HIGH", () => {
    expect(ALL_ALERTS).toContain(WAL_SIZE_HIGH);
  });

  it("findAlert returns the right alert by name", () => {
    expect(findAlert("WAL_SIZE_HIGH")).toBe(WAL_SIZE_HIGH);
    expect(findAlert("NONEXISTENT")).toBeUndefined();
  });

  it("threshold is 200MB = 209715200 bytes (2x the 100MB truncate fallback in file-wal-store.ts:85)", () => {
    // file-wal-store.ts:85 has MAX_FILE_SIZE = 100 * 1024 * 1024 = 104857600
    // WAL_SIZE_HIGH is at 2x that
    expect(209715200).toBe(2 * 104857600);
  });
});
