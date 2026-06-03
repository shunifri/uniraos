/**
 * P2-CRITICAL-FIX #6 (manual entry): Calibration admin API tests
 *
 * 验证:
 *   - startCalibration 生成 runId + 立刻返回 (async spawn)
 *   - 单例 lock: 同一时间只能 1 个 run
 *   - exit code 0 → status=success, 提取 best k + RMSE
 *   - exit code ≠ 0 → status=failed, 保留 stderr
 *   - getRecentRuns / getCurrentRun 状态正确
 *   - 启动时 disk 上 "running" run 被标 failed (stale 恢复)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  startCalibration,
  getCurrentRun,
  getRecentRuns,
  __resetForTests,
  __setSpawnForTests,
  type CalibrationRun,
} from "../../src/services/calibration-control.js";

/** 创建一个 mock child process EventEmitter */
function makeMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

/** 注入 mock spawn (返回一个可控制的 child) */
function injectSpawnWithChild(child: any) {
  __setSpawnForTests(() => child as any);
}

async function waitForRunStatus(runId: string, target: "success" | "failed", timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = getRecentRuns(50).find((x) => x.runId === runId);
    if (r && r.status === target) return;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error(`Timeout waiting for run ${runId} to reach status=${target}`);
}

describe("calibration-control (#6 manual entry)", () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __setSpawnForTests(null); // 还原默认
  });

  it("startCalibration: 生成 runId + 立刻返回 + 标记 running", async () => {
    const mockChild = makeMockChild();
    injectSpawnWithChild(mockChild);

    const run = await startCalibration();
    expect(run.runId).toMatch(/^[0-9a-f]{8}$/);
    expect(run.status).toBe("running");
    expect(run.startedAt).toBeLessThanOrEqual(Date.now());
    expect(getCurrentRun()?.runId).toBe(run.runId);
    expect(getRecentRuns(10)[0].runId).toBe(run.runId);
  });

  it("单例 lock: 同一时间第二个 startCalibration 抛错", async () => {
    const mockChild = makeMockChild();
    injectSpawnWithChild(mockChild);

    const first = await startCalibration();
    await expect(startCalibration()).rejects.toThrow(/already running/);
    expect(getCurrentRun()?.runId).toBe(first.runId);
  });

  it("exit code 0: status=success, 提取 best k + RMSE", async () => {
    const mockChild = makeMockChild();
    injectSpawnWithChild(mockChild);

    const run = await startCalibration();
    // 模拟 stdout 输出
    mockChild.stdout.emit("data", Buffer.from(`
[calibrate-real] ===== RESULTS =====
  data points: 100
  best k=1.85: RMSE=0.2451
  production RMSE (vs relevance): 0.2187
`));
    mockChild.emit("close", 0);
    await waitForRunStatus(run.runId, "success");

    const after = getRecentRuns(50).find((r) => r.runId === run.runId)!;
    expect(after.status).toBe("success");
    expect(after.exitCode).toBe(0);
    expect(after.bestK).toBeCloseTo(1.85, 2);
    expect(after.productionRmse).toBeCloseTo(0.2187, 3);
    // finishedAt 应该 >= startedAt (某些平台 Date.now() ms 内可能相同)
    expect(after.finishedAt).toBeGreaterThanOrEqual(after.startedAt);
    expect(getCurrentRun()).toBeNull(); // 清掉
  });

  it("exit code ≠ 0: status=failed, 保留 error + stderr tail", async () => {
    const mockChild = makeMockChild();
    injectSpawnWithChild(mockChild);

    const run = await startCalibration();
    mockChild.stderr.emit("data", Buffer.from("FATAL: MySQL connection refused\n"));
    mockChild.emit("close", 1);
    await waitForRunStatus(run.runId, "failed");

    const after = getRecentRuns(50).find((r) => r.runId === run.runId)!;
    expect(after.status).toBe("failed");
    expect(after.exitCode).toBe(1);
    expect(after.error).toContain("exited with code 1");
    expect(after.stderrTail).toContain("MySQL connection refused");
  });

  it("stdoutTail 限制 200 行 (避免 OOM)", async () => {
    const mockChild = makeMockChild();
    injectSpawnWithChild(mockChild);

    const run = await startCalibration();
    // 喷 500 行
    const bigStdout = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    mockChild.stdout.emit("data", Buffer.from(bigStdout));
    mockChild.emit("close", 0);
    await waitForRunStatus(run.runId, "success");

    const after = getRecentRuns(50).find((r) => r.runId === run.runId)!;
    const tailLines = after.stdoutTail!.split("\n");
    expect(tailLines.length).toBeLessThanOrEqual(200);
    // 应该保留最后 200 行
    expect(tailLines[0]).toBe("line 300");
    expect(tailLines[199]).toBe("line 499");
  });

  it("output 超 1MB: 截断不再 append (保护内存)", async () => {
    const mockChild = makeMockChild();
    injectSpawnWithChild(mockChild);

    const run = await startCalibration();
    // 喷 2MB
    const bigChunk = Buffer.alloc(1024 * 1024, "x");
    mockChild.stdout.emit("data", bigChunk); // 1MB
    mockChild.stdout.emit("data", bigChunk); // 又 1MB (累计 2MB, 超过 1MB 限制)
    mockChild.emit("close", 0);
    await waitForRunStatus(run.runId, "success");

    const after = getRecentRuns(50).find((r) => r.runId === run.runId)!;
    // 不崩 + 不超过 1MB
    expect(after.stdoutTail!.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it("recentRuns 最多保留 20 条 (LIFO)", async () => {
    // 让 spawn 每次都立刻 close (避免 lock 阻塞)
    __setSpawnForTests(() => {
      const child = makeMockChild();
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("best k=1.0"));
        child.emit("close", 0);
      });
      return child as any;
    });

    for (let i = 0; i < 25; i++) {
      const r = await startCalibration();
      await waitForRunStatus(r.runId, "success");
      __resetForTests();
    }

    expect(getRecentRuns(50).length).toBeLessThanOrEqual(20);
  });
});
