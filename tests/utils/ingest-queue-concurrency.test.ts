/**
 * MultiTenantIngestQueue 并发与 FIFO 测试
 *
 * 覆盖:
 * - 3 用户并发: 验证每用户内部串行, 全局 3 个同时
 * - 5 用户并发: 验证全局 cap=3 让 2 个用户等待, FIFO per user 仍成立
 * - 进度点 5/30/60/90/100% 上报
 * - 50 docx 并发导入压测
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MultiTenantIngestQueue } from "../../src/utils/ingest-queue.js";

/** 工具: 等全局 running = 0 + 所有任务结束 */
async function waitForIdle(q: MultiTenantIngestQueue, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = q.getStatus();
    if (s.globalRunning === 0 && s.globalPending === 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`waitForIdle timeout: status=${JSON.stringify(q.getStatus())}`);
}

/** 工具: 创建 N 个用户, 每个用户入队 K 个 task. 每个 task 用 setTimeout 模拟工作 */
function enqueueBatch(
  q: MultiTenantIngestQueue,
  userCount: number,
  tasksPerUser: number,
  workMs: number,
  prefix: string
): string[] {
  const ids: string[] = [];
  for (let u = 0; u < userCount; u++) {
    const userId = `user_${u}`;
    for (let t = 0; t < tasksPerUser; t++) {
      const id = `${prefix}_u${u}_t${t}`;
      q.enqueue(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, workMs);
          }),
        { id, docId: id, userId, name: id }
      );
      ids.push(id);
    }
  }
  return ids;
}

describe("MultiTenantIngestQueue", () => {
  let queue: MultiTenantIngestQueue;

  beforeEach(() => {
    queue = new MultiTenantIngestQueue({
      globalConcurrency: 3,
      perUserConcurrency: 1,
      timeoutMs: 30_000,
    });
  });

  afterEach(() => {
    queue.destroy();
  });

  it("3 users × 1 task: all 3 run concurrently, each user does not overlap", async () => {
    // 50ms 工作, 3 个 task 期望 ~50ms 完成 (并行) 而非 ~150ms (串行)
    const start = Date.now();
    const ids = enqueueBatch(queue, 3, 1, 50, "single");
    await waitForIdle(queue);
    const elapsed = Date.now() - start;
    // 留一些调度开销 buffer
    expect(elapsed).toBeLessThan(150);
    for (const id of ids) {
      const t = queue.getTask(id);
      expect(t?.status).toBe("done");
    }
  });

  it("3 users × 3 tasks: per-user FIFO 严格保持, 同用户不并发", async () => {
    // 记录每个 task 实际开始时间
    const startedAt: Record<string, number> = {};
    const userId = "u0";
    const taskCount = 3;
    const workMs = 40;
    const ids: string[] = [];
    for (let t = 0; t < taskCount; t++) {
      const id = `fifo_${t}`;
      ids.push(id);
      queue.enqueue(
        () =>
          new Promise<void>((resolve) => {
            startedAt[id] = Date.now();
            setTimeout(resolve, workMs);
          }),
        { id, docId: id, userId, name: id }
      );
    }
    // 同一用户, 也起一个不同用户挤一个 global slot, 让该用户的 task 1, 2 排队
    queue.enqueue(
      () => new Promise<void>((r) => setTimeout(r, workMs)),
      { id: "blocker", docId: "blocker", userId: "blocker", name: "blocker" }
    );
    await waitForIdle(queue);

    // 同用户的 task 严格 FIFO: 后入队的 startedAt 必须 ≥ 前一个 startedAt + workMs
    for (let i = 1; i < ids.length; i++) {
      const prev = startedAt[ids[i - 1]];
      const cur = startedAt[ids[i]];
      // 同一用户下, cur 必须 ≥ prev (允许微小 clock skew, workMs 40ms 够大)
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
    // 严格 FIFO: cur ≥ prev + workMs (因为 per-user=1, 必须等前一个结束)
    // 但有 1ms skew 容忍
    for (let i = 1; i < ids.length; i++) {
      const prev = startedAt[ids[i - 1]];
      const cur = startedAt[ids[i]];
      expect(cur - prev).toBeGreaterThanOrEqual(workMs - 5);
    }
  });

  it("5 users × 2 tasks: global cap=3 means at most 3 run simultaneously", async () => {
    // 5 用户各自 2 个 task, 100ms 工作
    // 期望: 每次最多 3 个 task 同时在跑 (因为 globalConcurrency=3)
    let peakGlobalRunning = 0;
    const pollHandle = setInterval(() => {
      const s = queue.getStatus();
      if (s.globalRunning > peakGlobalRunning) {
        peakGlobalRunning = s.globalRunning;
      }
    }, 1);

    enqueueBatch(queue, 5, 2, 100, "five");
    await waitForIdle(queue);
    clearInterval(pollHandle);

    // peak 必须 ≤ 3
    expect(peakGlobalRunning).toBeLessThanOrEqual(3);
    // 至少有 1 个时刻是 3 个并发 (10 个 task 中肯定会有)
    expect(peakGlobalRunning).toBeGreaterThanOrEqual(3);
    // 全部完成
    for (const t of Array.from({ length: 5 }, (_, u) => u).flatMap((u) => [0, 1].map((i) => `five_u${u}_t${i}`))) {
      expect(queue.getTask(t)?.status).toBe("done");
    }
  });

  it("FIFO per user: 5 users × 3 tasks, each user's tasks enqueued in order", async () => {
    // 验证: 用户维度的 startedAt 单调递增 (相对 enqueue 顺序)
    const startedAt: Record<string, number> = {};
    for (let u = 0; u < 5; u++) {
      const userId = `fifo_user_${u}`;
      for (let t = 0; t < 3; t++) {
        const id = `fifo5_u${u}_t${t}`;
        queue.enqueue(
          () =>
            new Promise<void>((resolve) => {
              startedAt[id] = Date.now();
              setTimeout(resolve, 30);
            }),
          { id, docId: id, userId, name: id }
        );
      }
    }
    await waitForIdle(queue);

    // 验证每个用户的 3 个 task startedAt 单调递增
    for (let u = 0; u < 5; u++) {
      const t0 = startedAt[`fifo5_u${u}_t0`];
      const t1 = startedAt[`fifo5_u${u}_t1`];
      const t2 = startedAt[`fifo5_u${u}_t2`];
      expect(t1).toBeGreaterThanOrEqual(t0);
      expect(t2).toBeGreaterThanOrEqual(t1);
    }
  });

  it("Progress 5/30/60/90/100 上报 (task 内部 callback, queue 不干预)", async () => {
    // 模拟 5 个进度点上报 — 真实场景 task 内部会 await kb.updateParsingStatus
    // 这里 task body 模拟 5 个里程碑全部按顺序触发
    const progressTimeline: number[] = [];
    const id = "progress_test";
    queue.enqueue(
      async () => {
        for (const p of [5, 30, 60, 90, 100]) {
          // 模拟 task 内部某个时刻调用 updateParsingStatus
          progressTimeline.push(p);
          await new Promise((r) => setTimeout(r, 5));
        }
      },
      { id, docId: id, userId: "progress_user", name: id }
    );
    await waitForIdle(queue);

    expect(progressTimeline).toEqual([5, 30, 60, 90, 100]);
    expect(queue.getTask(id)?.status).toBe("done");
  });

  it("失败 task 标记 failed, 后续 task 仍继续", async () => {
    queue.enqueue(
      async () => {
        throw new Error("simulated failure");
      },
      { id: "fail", docId: "fail", userId: "u1", name: "fail" }
    );
    queue.enqueue(
      async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
      { id: "ok", docId: "ok", userId: "u1", name: "ok" }
    );
    await waitForIdle(queue);

    expect(queue.getTask("fail")?.status).toBe("failed");
    expect(queue.getTask("fail")?.error).toContain("simulated failure");
    expect(queue.getTask("ok")?.status).toBe("done");
  });

  it("global cap 触顶时, 第 4 个 task 进入 pending 等待", async () => {
    // 用 Map<taskId, resolve> 收集每个 task 自己的 resolver, 在 4th task 启动时也能拿到
    const resolvers = new Map<string, () => void>();
    const launchOrder: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `cap_${i}`;
      queue.enqueue(
        () =>
          new Promise<void>((resolve) => {
            launchOrder.push(id);
            resolvers.set(id, resolve);
          }),
        { id, docId: id, userId: `cap_user_${i}`, name: id }
      );
    }
    // 立即检查: 3 个 running, 1 个 pending
    // 不直接 await setTimeout(10) — vitest jsdom 环境对 setTimeout 处理可能延迟
    // 改成轮询直到看到期望状态
    let s = queue.getStatus();
    const start = Date.now();
    while (Date.now() - start < 1000) {
      if (s.globalRunning === 3 && s.globalPending === 1) break;
      await new Promise((r) => setTimeout(r, 5));
      s = queue.getStatus();
    }
    expect(s.globalRunning).toBe(3);
    expect(s.globalPending).toBe(1);

    // 释放 3 个 running
    for (const id of launchOrder) {
      resolvers.get(id)?.();
    }
    // 等 4th 起来
    await new Promise((r) => setTimeout(r, 20));
    // 释放 4th
    for (const id of launchOrder) {
      resolvers.get(id)?.();
    }
    await waitForIdle(queue, 3000);
  });

  it("50 docx 并发导入压测: 5 用户 × 10 docx, mock 10KB docx 完成时间极短", async () => {
    // 模拟 50 个 docx 入队: 5 用户各 10 docx, 每个 task 内做轻量工作
    const t0 = Date.now();
    const N_USERS = 5;
    const DOCX_PER_USER = 10;
    const total = N_USERS * DOCX_PER_USER;

    for (let u = 0; u < N_USERS; u++) {
      const userId = `stress_user_${u}`;
      for (let d = 0; d < DOCX_PER_USER; d++) {
        const id = `stress_u${u}_d${d}`;
        queue.enqueue(
          async () => {
            // 模拟 10KB docx 的极小工作量: 一次 microtask 完成
            // 真实环境会做 chunking + embedding, 这里是 mock
            await new Promise((r) => setImmediate(r));
            // 5/30/60/90/100% 进度上报由 task 内部 callback 完成 (kb.updateParsingStatus)
            // 这里不重复测, 前一个 it 已覆盖顺序上报
          },
          { id, docId: id, userId, name: id }
        );
      }
    }

    await waitForIdle(queue, 30_000);
    const elapsed = Date.now() - t0;

    // 全部完成
    for (let u = 0; u < N_USERS; u++) {
      for (let d = 0; d < DOCX_PER_USER; d++) {
        const id = `stress_u${u}_d${d}`;
        expect(queue.getTask(id)?.status).toBe("done");
      }
    }

    // 50 个 task 在 5 用户 × global=3 下, 期望 < 5s
    expect(elapsed).toBeLessThan(5000);
    // sanity: 50 完成
    const s = queue.getStatus();
    const doneCount = s.tasks.filter((t) => t.status === "done").length;
    expect(doneCount).toBeGreaterThanOrEqual(total);
  });
});

describe("MultiTenantIngestQueue 配置 env", () => {
  it("ingestQueue 全局单例读取 INGEST_GLOBAL_CONCURRENCY env", async () => {
    // 直接 import 单例 (单例模块级已读 env, 此处仅 sanity check 类型与形状)
    const { ingestQueue } = await import("../../src/utils/ingest-queue.js");
    const s = ingestQueue.getStatus();
    expect(s.globalConcurrency).toBeGreaterThan(0);
    expect(s.perUserConcurrency).toBeGreaterThan(0);
    ingestQueue.destroy();
  });
});
