/**
 * P2-CRITICAL-FIX #6 (manual entry): Calibration control service
 *
 * 手动触发 calibration 的服务层：
 *   - 单一进程内只允许 1 个 run (lock)
 *   - runId 生成 + 状态跟踪
 *   - spawn child process 跑 scripts/calibrate-from-real-data.ts
 *   - 结果写到 .raos/calibration/{runId}.json
 *
 * 为什么不直接用 cron：
 *   - 触发时机由 ops 决定 (acceptance rate 跌了/数据更新了/LLM 升完级)
 *   - 需要可视化看 run history + 错误信息
 *   - 不需要 CI infra
 *
 * 简单替代 #6 (CI/CD auto-calibration):
 *   - ops 点一下按钮 → run → 看结果
 *   - 没有 auto-merge 风险
 *   - 缺：没主动 drift 检测 (需配合 #7 acceptance alerting)
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** spawn 类型签名 (test 注入用) */
type SpawnFn = (
  command: string,
  args: readonly string[],
  options: import("node:child_process").SpawnOptions
) => ChildProcess;

/** 默认 spawn = node 真实实现；单测可注入 mock */
let spawnImpl: SpawnFn = nodeSpawn;

export type RunStatus = "running" | "success" | "failed";

export interface CalibrationRun {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  exitCode?: number;
  /** 最后 200 行 stdout（成功时含 RESULTS / failed 时含错误） */
  stdoutTail?: string;
  stderrTail?: string;
  /** 标定结果 json path (relative to project root) */
  resultJsonPath?: string;
  /** Best k 推荐 */
  bestK?: number;
  /** Production RMSE (vs relevance) */
  productionRmse?: number;
  /** 错误信息（如果 status=failed） */
  error?: string;
}

/** Calibration 数据目录：.raos/calibration/ */
const DATA_DIR = resolve(process.cwd(), ".raos", "calibration");

/** 进程内单例：同一时间只能有 1 个 run */
let currentRun: CalibrationRun | null = null;
/** 最近 N 次 run 的 metadata (in-memory cache) */
const recentRuns: CalibrationRun[] = [];
const RECENT_LIMIT = 20;

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadRecentFromDisk(): Promise<void> {
  // 启动时把磁盘上的历史读进 recentRuns (best-effort, 不影响主流程)
  if (!existsSync(DATA_DIR)) return;
  try {
    const files = (await readdir(DATA_DIR))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, RECENT_LIMIT);
    for (const f of files) {
      try {
        const content = await readFile(join(DATA_DIR, f), "utf-8");
        const run = JSON.parse(content) as CalibrationRun;
        if (run.status === "running") {
          // 启动时发现 running —— 进程已死，标成 failed
          run.status = "failed";
          run.error = "Process restarted while run was in progress";
          run.finishedAt = Date.now();
        }
        recentRuns.push(run);
      } catch {
        // 损坏 json 跳过
      }
    }
  } catch {
    // 忽略
  }
}
loadRecentFromDisk();

/** 找 calibration 脚本的绝对路径（dev: scripts/, prod: bundled） */
function findCalibrationScript(): string {
  const candidates = [
    resolve(process.cwd(), "scripts", "calibrate-from-real-data.ts"),
    resolve(process.cwd(), "dist", "scripts", "calibrate-from-real-data.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("Calibration script not found in scripts/ or dist/scripts/");
}

function addToRecent(run: CalibrationRun): void {
  recentRuns.unshift(run);
  if (recentRuns.length > RECENT_LIMIT) recentRuns.length = RECENT_LIMIT;
}

function extractSummaryFromOutput(stdout: string): { bestK?: number; productionRmse?: number } {
  const bestKMatch = stdout.match(/best k[\s:=]+([\d.]+)/i);
  const rmseMatch = stdout.match(/production RMSE[\s\S]*?([\d.]+)/i);
  return {
    bestK: bestKMatch ? parseFloat(bestKMatch[1]) : undefined,
    productionRmse: rmseMatch ? parseFloat(rmseMatch[1]) : undefined,
  };
}

export async function startCalibration(): Promise<CalibrationRun> {
  if (currentRun && currentRun.status === "running") {
    throw new Error(`Calibration already running (runId=${currentRun.runId})`);
  }

  await ensureDataDir();
  const runId = randomUUID().slice(0, 8);
  const resultJsonPath = join(DATA_DIR, `${runId}-ground-truth.json`);
  const stateFilePath = join(DATA_DIR, `${runId}.json`);

  const run: CalibrationRun = {
    runId,
    startedAt: Date.now(),
    status: "running",
    resultJsonPath,
  };
  currentRun = run;
  addToRecent(run);

  const scriptPath = findCalibrationScript();
  // 用 npx tsx 跑 (dev); 产线如果脚本编译了 dist 也会用 node 直接跑
  const isTsScript = scriptPath.endsWith(".ts");
  const cmd = isTsScript ? "npx" : "node";
  const args = isTsScript
    ? ["tsx", scriptPath, "--out", resultJsonPath]
    : [scriptPath, "--out", resultJsonPath];

  const child = spawnImpl(cmd, args, {
    env: { ...process.env },
    cwd: process.cwd(),
  });

  // 捕获输出 (限制 buffer 防止 OOM)
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutChunks.reduce((s, c) => s + c.length, 0) < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk);
      }
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrChunks.reduce((s, c) => s + c.length, 0) < MAX_OUTPUT_BYTES) {
        stderrChunks.push(chunk);
      }
    });
  }

  // 异步等结果，不阻塞 HTTP response
  child.on("close", (code) => {
    const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
    const stderr = Buffer.concat(stderrChunks).toString("utf-8");
    run.finishedAt = Date.now();
    run.exitCode = code ?? -1;
    run.status = code === 0 ? "success" : "failed";
    // 截尾 200 行
    const tailLines = (s: string) => s.split("\n").slice(-200).join("\n");
    run.stdoutTail = tailLines(stdout);
    run.stderrTail = tailLines(stderr);
    if (code !== 0) {
      run.error = `Process exited with code ${code}. See stderrTail.`;
    } else {
      const summary = extractSummaryFromOutput(stdout);
      run.bestK = summary.bestK;
      run.productionRmse = summary.productionRmse;
    }
    // 持久化
    writeFile(stateFilePath, JSON.stringify(run, null, 2)).catch(() => {});
    currentRun = null;
  });

  // 启动后立刻持久化 (记录 "running" 状态)
  writeFile(stateFilePath, JSON.stringify(run, null, 2)).catch(() => {});

  return run;
}

export function getCurrentRun(): CalibrationRun | null {
  return currentRun;
}

export function getRecentRuns(limit = 10): CalibrationRun[] {
  return recentRuns.slice(0, limit);
}

export function getRunById(runId: string): CalibrationRun | undefined {
  return recentRuns.find((r) => r.runId === runId);
}

/** 单测用：清空进程内 state (currentRun + recentRuns)，不影响磁盘 */
export function __resetForTests(): void {
  currentRun = null;
  recentRuns.length = 0;
}

/** 单测用：注入 mock spawn (返回 fake child) */
export function __setSpawnForTests(fn: SpawnFn | null): void {
  spawnImpl = fn ?? nodeSpawn;
}
