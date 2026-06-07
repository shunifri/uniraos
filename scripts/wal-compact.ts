#!/usr/bin/env tsx
/**
 * Q3 W3 Item #8: WAL 定期 compact 自动化
 *
 * 背景: P1-20 在 file-wal-store.ts:85 加了 100MB 截断兜底 (保留最后 10000 行) 防 Node 字符串上限崩溃.
 *   但截断会直接丢历史 entry, 不可逆. 长期: 用"归档"替代"截断" —
 *   定期把已完成/已失败的 entry 从 active WAL 抽出, 写到 archive, active 文件瘦身.
 *
 * 目标:
 *   - 把已 commit (complete / fail) 但未 apply 的 entry 写入 archive:
 *       data/wal/archive/{YYYY-MM-DD}/wal-{ISO-timestamp}.jsonl
 *   - 已归档 entry 从 active WAL 移除 (保留 pending = 未完成)
 *   - 默认阈值 50MB (跟 100MB 截断留 buffer)
 *   - 默认 dry-run (不真改), --apply 才真写
 *
 * 用法:
 *   # Dry run (默认, 只打印 report, 不写任何文件)
 *   npx tsx scripts/wal-compact.ts
 *   npx tsx scripts/wal-compact.ts --dry-run
 *
 *   # 真跑 (归档 + 截断)
 *   npx tsx scripts/wal-compact.ts --apply
 *
 *   # 自定义阈值 / 路径
 *   npx tsx scripts/wal-compact.ts --threshold=80 --wal=/path/to/wal.jsonl --apply
 *
 *   # 帮助
 *   npx tsx scripts/wal-compact.ts --help
 *
 * Cron 建议 (运维手动配):
 *   # 每天凌晨 3 点跑一次, WAL>50MB 时自动归档
 *   0 3 * * * cd /opt/raos && /usr/bin/npm run wal:compact >> /var/log/raos/wal-compact.log 2>&1
 *
 * 安全:
 *   - 写 archive 先, 再 rewrite active. active 写失败不会丢数据 (archive 已落地).
 *   - pending entry 永远保留 (即使整个 archive 都丢, 重启也能 recover).
 *   - 流式 read (readline) 处理大文件, 不撞 Node 字符串上限.
 */

import { existsSync, statSync, mkdirSync, createReadStream, writeFileSync, renameSync } from "fs";
import { dirname, join, resolve as resolvePath } from "path";
import { createInterface } from "readline";
import { updateWalActiveSize } from "../src/monitoring/metrics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WAL file line op types — mirror src/wal/file-wal-store.ts */
export type WALOp = "append" | "complete" | "fail";

export interface WALAppendLine {
  op: "append";
  entry: {
    id: string;
    traceId: string;
    skillName: string;
    params: Record<string, unknown>;
    status: "pending" | "completed" | "failed";
    timestamp: number;
    completedAt?: number;
    result?: unknown;
    error?: string;
    parentEntryId?: string;
  };
}

export interface WALCompleteLine {
  op: "complete";
  id: string;
  result?: unknown;
  completedAt: number;
}

export interface WALFailLine {
  op: "fail";
  id: string;
  error: string;
  completedAt: number;
}

export type WALLine = WALAppendLine | WALCompleteLine | WALFailLine;

/** Compact 配置 */
export interface CompactConfig {
  walPath: string;
  archiveDir: string;
  thresholdBytes: number;
  apply: boolean;
  now: Date;
}

/** Single archived batch file (one per compact run) */
export interface ArchiveFile {
  /** absolute path of archive file */
  path: string;
  /** number of entries archived in this file */
  entryCount: number;
  /** bytes written */
  sizeBytes: number;
}

/** Compact result */
export interface CompactReport {
  mode: "dry-run" | "apply";
  walPath: string;
  archiveDir: string;
  thresholdBytes: number;
  activeSizeBefore: number;
  activeSizeAfter: number;
  totalLines: number;
  totalEntries: number;
  entriesArchived: number;
  entriesKept: number;
  malformedLines: number;
  skippedBelowThreshold: boolean;
  archiveFiles: ArchiveFile[];
  durationMs: number;
  /** ISO timestamp when run started */
  startedAt: string;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  apply: boolean;
  dryRun: boolean;
  walPath: string | null;
  archiveDir: string | null;
  thresholdMB: number | null;
  help: boolean;
}

export function parseCli(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): CliArgs {
  const result: CliArgs = {
    apply: false,
    dryRun: false,
    walPath: null,
    archiveDir: null,
    thresholdMB: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg.startsWith("--wal=")) result.walPath = arg.slice("--wal=".length);
    else if (arg.startsWith("--archive-dir=")) result.archiveDir = arg.slice("--archive-dir=".length);
    else if (arg.startsWith("--threshold=")) {
      const v = arg.slice("--threshold=".length);
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) result.thresholdMB = n;
    }
  }

  return result;
}

export function printHelp(): string {
  return `Usage: wal-compact [options]

定期 compact WAL 文件: 把已完成的 entry 归档, 减小 active 文件大小,
避免 P1-20 截断兜底 (100MB 截最后 10000 行) 丢历史.

Options:
  --apply                  真跑 (默认 dry-run)
  --dry-run                只扫描, 不写任何文件 (默认)
  --wal=<path>             WAL 文件路径 (默认 .raos/wal.jsonl)
  --archive-dir=<path>     归档根目录 (默认 data/wal/archive)
  --threshold=<MB>         触发 compact 的 active 文件大小阈值 (默认 50MB)
  -h, --help               显示帮助

Environment:
  RAOS_WAL_PATH            等同 --wal=<path>
  RAOS_WAL_ARCHIVE_DIR     等同 --archive-dir=<path>

Examples:
  # 1) 默认 dev WAL dry-run
  npx tsx scripts/wal-compact.ts

  # 2) 真跑
  npx tsx scripts/wal-compact.ts --apply

  # 3) 自定义阈值 + 路径
  npx tsx scripts/wal-compact.ts --threshold=80 --wal=/var/lib/raos/wal.jsonl --apply

  # 4) Cron 推荐 (运维手动配, 见 OPERATIONS.md §WAL compaction)
  0 3 * * * cd /opt/raos && npm run wal:compact >> /var/log/raos/wal-compact.log 2>&1

Exit codes:
  0   成功 (包括 noop: 文件不存在 / 小于阈值 / 没有可归档 entry)
  1   内部错误 (读/写失败, 见 stderr)
`;
}

function resolveDefaultWalPath(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.RAOS_WAL_PATH) return resolvePath(cwd, env.RAOS_WAL_PATH);
  return resolvePath(cwd, ".raos", "wal.jsonl");
}

function resolveDefaultArchiveDir(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.RAOS_WAL_ARCHIVE_DIR) return resolvePath(cwd, env.RAOS_WAL_ARCHIVE_DIR);
  return resolvePath(cwd, "data", "wal", "archive");
}

// ---------------------------------------------------------------------------
// WAL file parser (streaming, mirrors FileWALStore.loadFromFile semantics)
// ---------------------------------------------------------------------------

export interface ParsedWAL {
  /** id → latest entry state (after replaying complete/fail ops) */
  entries: Map<string, WALAppendLine["entry"]>;
  /** total JSONL lines seen (excl blank) */
  totalLines: number;
  /** lines that failed JSON.parse or had unknown op */
  malformedLines: number;
}

/** Read WAL file via createReadStream + readline to handle large files. */
export async function parseWalFile(walPath: string): Promise<ParsedWAL> {
  const entries = new Map<string, WALAppendLine["entry"]>();
  let totalLines = 0;
  let malformedLines = 0;

  if (!existsSync(walPath)) {
    return { entries, totalLines: 0, malformedLines: 0 };
  }

  const stream = createReadStream(walPath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    totalLines++;
    let rec: WALLine;
    try {
      rec = JSON.parse(line) as WALLine;
    } catch {
      malformedLines++;
      continue;
    }
    if (!rec || typeof rec !== "object" || typeof rec.op !== "string") {
      malformedLines++;
      continue;
    }
    if (rec.op === "append") {
      if (!rec.entry || typeof rec.entry.id !== "string") {
        malformedLines++;
        continue;
      }
      entries.set(rec.entry.id, rec.entry);
    } else if (rec.op === "complete") {
      const e = entries.get(rec.id);
      if (e) {
        e.status = "completed";
        e.completedAt = rec.completedAt;
        e.result = rec.result;
      }
    } else if (rec.op === "fail") {
      const e = entries.get(rec.id);
      if (e) {
        e.status = "failed";
        e.completedAt = rec.completedAt;
        e.error = rec.error;
      }
    } else {
      malformedLines++;
    }
  }

  return { entries, totalLines, malformedLines };
}

// ---------------------------------------------------------------------------
// Archive writer
// ---------------------------------------------------------------------------

function makeArchiveFilename(now: Date): string {
  // ISO timestamp safe for filenames: 2026-06-08T04-19-56-123Z
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `wal-${iso}.jsonl`;
}

function makeArchiveSubdir(now: Date): string {
  // YYYY-MM-DD (UTC) — same day, multiple compact runs all go in same dir
  return now.toISOString().slice(0, 10);
}

/** Build the absolute path for the archive file this run will create. */
export function makeArchivePath(archiveDir: string, now: Date): string {
  return join(archiveDir, makeArchiveSubdir(now), makeArchiveFilename(now));
}

/** Write archived entries to JSONL file. Returns { path, entryCount, sizeBytes }. */
function writeArchiveFile(absPath: string, archivedEntries: WALAppendLine["entry"][]): ArchiveFile {
  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Use writeFileSync (atomic-ish) — archived entries are small (KB), not GB
  const lines = archivedEntries.map((e) => JSON.stringify({ op: "append", entry: e })).join("\n");
  const content = lines.length > 0 ? lines + "\n" : "";
  writeFileSync(absPath, content, "utf-8");
  const stat = statSync(absPath);
  return { path: absPath, entryCount: archivedEntries.length, sizeBytes: stat.size };
}

// ---------------------------------------------------------------------------
// Active file writer (atomic via .tmp + rename)
// ---------------------------------------------------------------------------

/** Rewrite active WAL with only the keep-entries (pending). Atomic via tmp + rename. */
function rewriteActiveWal(walPath: string, keptEntries: WALAppendLine["entry"][]): number {
  const dir = dirname(walPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = walPath + ".compact-tmp";
  const lines = keptEntries.map((e) => JSON.stringify({ op: "append", entry: e })).join("\n");
  const content = lines.length > 0 ? lines + "\n" : "";
  writeFileSync(tmpPath, content, "utf-8");
  // rename is atomic on same filesystem
  renameSync(tmpPath, walPath);
  return statSync(walPath).size;
}

// ---------------------------------------------------------------------------
// Core compact function (pure — used by both CLI and tests)
// ---------------------------------------------------------------------------

/**
 * Compact a WAL file:
 *   1. Parse file (streaming) to get all entries with their final status.
 *   2. Split into archived (completed/failed) and kept (pending).
 *   3. If apply=true, write archive file + rewrite active file.
 *   4. If apply=false, simulate only (return expected report, no writes).
 *   5. Update wal_active_size_bytes gauge (only when apply=true so dashboard doesn't lie).
 *
 * Throws on read/write errors. Caller (CLI) handles exit code.
 */
export async function compactWal(config: CompactConfig): Promise<CompactReport> {
  const startedAt = config.now;
  const startMs = Date.now();
  const report: CompactReport = {
    mode: config.apply ? "apply" : "dry-run",
    walPath: config.walPath,
    archiveDir: config.archiveDir,
    thresholdBytes: config.thresholdBytes,
    activeSizeBefore: 0,
    activeSizeAfter: 0,
    totalLines: 0,
    totalEntries: 0,
    entriesArchived: 0,
    entriesKept: 0,
    malformedLines: 0,
    skippedBelowThreshold: false,
    archiveFiles: [],
    durationMs: 0,
    startedAt: startedAt.toISOString(),
  };

  if (!existsSync(config.walPath)) {
    // Nothing to do — file doesn't exist. Update gauge to 0 and return.
    if (config.apply) updateWalActiveSize(config.walPath);
    report.durationMs = Date.now() - startMs;
    return report;
  }

  report.activeSizeBefore = statSync(config.walPath).size;

  // Threshold check — don't compact small files (unnecessary I/O)
  if (report.activeSizeBefore < config.thresholdBytes) {
    report.skippedBelowThreshold = true;
    report.activeSizeAfter = report.activeSizeBefore;
    if (config.apply) updateWalActiveSize(config.walPath);
    report.durationMs = Date.now() - startMs;
    return report;
  }

  // Parse file (streaming)
  const parsed = await parseWalFile(config.walPath);
  report.totalLines = parsed.totalLines;
  report.totalEntries = parsed.entries.size;
  report.malformedLines = parsed.malformedLines;

  // Split entries: completed/failed → archive, pending → keep
  const archivedEntries: WALAppendLine["entry"][] = [];
  const keptEntries: WALAppendLine["entry"][] = [];
  for (const entry of parsed.entries.values()) {
    if (entry.status === "pending") {
      keptEntries.push(entry);
    } else {
      archivedEntries.push(entry);
    }
  }
  report.entriesArchived = archivedEntries.length;
  report.entriesKept = keptEntries.length;

  if (archivedEntries.length === 0) {
    // Nothing to archive (all pending) — leave file alone
    report.activeSizeAfter = report.activeSizeBefore;
    if (config.apply) updateWalActiveSize(config.walPath);
    report.durationMs = Date.now() - startMs;
    return report;
  }

  // Build archive path
  const archivePath = makeArchivePath(config.archiveDir, startedAt);

  if (!config.apply) {
    // Dry-run: just predict, don't write. Estimate archive size from JSON length.
    const estSize = archivedEntries
      .map((e) => JSON.stringify({ op: "append", entry: e }))
      .join("\n").length + archivedEntries.length; // account for \n
    report.archiveFiles.push({ path: archivePath, entryCount: archivedEntries.length, sizeBytes: estSize });
    // Estimate active size after: kept entries only
    const estKept = keptEntries.map((e) => JSON.stringify({ op: "append", entry: e })).join("\n").length;
    report.activeSizeAfter = estKept + (keptEntries.length > 0 ? 1 : 0);
    report.durationMs = Date.now() - startMs;
    return report;
  }

  // APPLY MODE — write archive first (so a failure here means we can retry),
  // then rewrite active. If active rewrite fails, archive is already on disk
  // and the WAL file is untouched (no data loss).
  const archiveFile = writeArchiveFile(archivePath, archivedEntries);
  report.archiveFiles.push(archiveFile);

  // Now rewrite active WAL with only kept entries
  report.activeSizeAfter = rewriteActiveWal(config.walPath, keptEntries);

  // Update Prometheus gauge (so /prom/metrics reflects the new size)
  updateWalActiveSize(config.walPath);

  report.durationMs = Date.now() - startMs;
  return report;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function formatReport(report: CompactReport): string {
  const lines: string[] = [];
  const mode = report.mode === "apply" ? "APPLY" : "DRY-RUN";
  lines.push(`[wal-compact] === ${mode} REPORT ===`);
  lines.push(`  started at:           ${report.startedAt}`);
  lines.push(`  WAL path:             ${report.walPath}`);
  lines.push(`  archive dir:          ${report.archiveDir}`);
  lines.push(`  threshold:            ${formatBytes(report.thresholdBytes)}`);
  lines.push(`  active size:          ${formatBytes(report.activeSizeBefore)} → ${formatBytes(report.activeSizeAfter)}`);
  const delta = report.activeSizeBefore - report.activeSizeAfter;
  const pct = report.activeSizeBefore > 0 ? (delta / report.activeSizeBefore * 100).toFixed(1) : "0.0";
  lines.push(`  size reduction:       ${formatBytes(delta)} (-${pct}%)`);
  lines.push(`  total lines parsed:   ${report.totalLines}`);
  lines.push(`  unique entries:       ${report.totalEntries}`);
  lines.push(`  entries archived:     ${report.entriesArchived}`);
  lines.push(`  entries kept:         ${report.entriesKept} (pending only)`);
  if (report.malformedLines > 0) {
    lines.push(`  malformed lines:      ${report.malformedLines} (skipped, see WAL warnings)`);
  }
  if (report.skippedBelowThreshold) {
    lines.push(`  SKIPPED:              file is below threshold (${formatBytes(report.activeSizeBefore)} < ${formatBytes(report.thresholdBytes)})`);
  }
  for (const af of report.archiveFiles) {
    lines.push(`  archive file:         ${af.path} (${af.entryCount} entries, ${formatBytes(af.sizeBytes)})`);
  }
  lines.push(`  duration:             ${report.durationMs}ms`);
  if (report.mode === "dry-run") {
    lines.push(`  (run with --apply to actually write)`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const args = parseCli(argv, env);

  if (args.help) {
    process.stdout.write(printHelp() + "\n");
    return 0;
  }

  // --apply and --dry-run are both allowed but only one wins. Default dry-run.
  const apply = args.apply && !args.dryRun;

  const cwd = process.cwd();
  const walPath = args.walPath ? resolvePath(cwd, args.walPath) : resolveDefaultWalPath(cwd, env);
  const archiveDir = args.archiveDir ? resolvePath(cwd, args.archiveDir) : resolveDefaultArchiveDir(cwd, env);
  const thresholdMB = args.thresholdMB ?? 50;
  const thresholdBytes = Math.floor(thresholdMB * 1024 * 1024);

  const config: CompactConfig = {
    walPath,
    archiveDir,
    thresholdBytes,
    apply,
    now: new Date(),
  };

  try {
    const report = await compactWal(config);
    process.stdout.write(formatReport(report) + "\n");
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`[wal-compact] ERROR: ${msg}\n`);
    return 1;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? "")) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`[wal-compact] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
