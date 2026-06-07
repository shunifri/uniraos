/**
 * 全局文档处理队列
 *
 * 提供两类队列：
 * - IngestQueue: 旧版 process-global 串行队列, 保留向后兼容 (kg-extraction-queue 在用)
 * - MultiTenantIngestQueue: ROADMAP Q3 item #4 新版, 支持 per-user FIFO + global concurrency 上限
 *
 * MultiTenantIngestQueue 特性:
 * - 全局并发上限 (default 3)
 * - 单用户并发上限 (default 1, 保证同用户不并发, 避免冲突的文档写操作)
 * - 每用户内部 FIFO 顺序
 * - 单任务超时 (default 15 分钟)
 * - 任务状态可查 (queue length, running count, per-user breakdown)
 * - 任务失败不影响其他任务
 * - 进度点上报由 task 内部 callback 负责 (5/30/60/90/100%), queue 不关心
 */

export interface QueueTask {
  id: string;
  docId: string;
  userId: string;
  name: string;
  status: "pending" | "running" | "done" | "failed";
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

interface QueueItem {
  task: () => Promise<void>;
  meta: QueueTask;
}

export class IngestQueue {
  private concurrency: number;
  private timeoutMs: number;
  private running = 0;
  private queue: Array<QueueItem> = [];
  private taskMap = new Map<string, QueueTask>();
  private maxTaskMapSize = 1000;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: { concurrency?: number; timeoutMs?: number }) {
    this.concurrency = opts?.concurrency ?? 1;
    this.timeoutMs = opts?.timeoutMs ?? 900_000; // 15 分钟
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
  }

  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  enqueue(task: () => Promise<void>, meta: Omit<QueueTask, "status" | "enqueuedAt">): string {
    const taskId = meta.id;
    const queueTask: QueueTask = {
      ...meta,
      status: "pending",
      enqueuedAt: Date.now(),
    };
    this.taskMap.set(taskId, queueTask);
    this.trimTaskMap();
    this.queue.push({
      task: async () => {
        queueTask.status = "running";
        queueTask.startedAt = Date.now();
        try {
          await this.runWithTimeout(task);
          queueTask.status = "done";
        } catch (err: any) {
          queueTask.status = "failed";
          queueTask.error = err?.message || String(err);
          console.error(`[IngestQueue] Task ${taskId} failed:`, err);
        } finally {
          queueTask.finishedAt = Date.now();
          this.running--;
          this.process();
        }
      },
      meta: queueTask,
    });
    this.process();
    return taskId;
  }

  private async process() {
    if (this.running >= this.concurrency) return;
    const item = this.queue.shift();
    if (!item) return;
    this.running++;
    item.task().catch((err) => {
      console.error("[IngestQueue] Unexpected task error:", err);
      this.running = Math.max(0, this.running - 1);
      this.process();
    });
  }

  private runWithTimeout(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      task()
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private heartbeat() {
    if (this.running <= 0) return;
    const now = Date.now();
    const runningTasks = Array.from(this.taskMap.values()).filter((t) => t.status === "running");
    const staleTasks = runningTasks.filter((t) => {
      const elapsed = t.startedAt ? now - t.startedAt : 0;
      return elapsed > this.timeoutMs + 10_000;
    });
    if (staleTasks.length > 0) {
      console.warn(
        `[IngestQueue] Heartbeat detected ${staleTasks.length} stale running tasks (running=${this.running}), resetting`
      );
      for (const t of staleTasks) {
        t.status = "failed";
        t.error = t.error || "Task timed out (heartbeat recovery)";
        t.finishedAt = now;
      }
      this.running = Math.max(0, this.running - staleTasks.length);
      this.process();
    }
  }

  private trimTaskMap() {
    if (this.taskMap.size <= this.maxTaskMapSize) return;
    const entries = Array.from(this.taskMap.entries());
    entries.sort((a, b) => (a[1].enqueuedAt || 0) - (b[1].enqueuedAt || 0));
    const toDelete = entries.slice(0, entries.length - this.maxTaskMapSize);
    for (const [key] of toDelete) {
      this.taskMap.delete(key);
    }
  }

  getStatus() {
    const tasks = Array.from(this.taskMap.values());
    return {
      concurrency: this.concurrency,
      running: this.running,
      pending: this.queue.length,
      total: tasks.length,
      tasks: tasks.slice(-50),
    };
  }

  getTask(taskId: string): QueueTask | undefined {
    return this.taskMap.get(taskId);
  }
}

/**
 * 多租户 ingest 队列
 *
 * 调度规则:
 * 1. globalRunning < globalConcurrency 时才允许新任务启动
 * 2. userRunning[userId] < perUserConcurrency 时该用户可启动下一个任务
 * 3. 每个用户内部严格 FIFO (Array.shift 取队首)
 * 4. 选择下一个要启动的用户: 扫所有 userQueues, 找第一个满足 (user 维度 slot 空) 的
 *
 * 失败/完成: 释放 globalRunning + userRunning, 触发 dispatch
 *
 * 复杂度: dispatch O(U) where U = 活跃用户数, 实际 < 100
 */
export class MultiTenantIngestQueue {
  private globalConcurrency: number;
  private perUserConcurrency: number;
  private timeoutMs: number;
  private globalRunning = 0;
  private userRunning = new Map<string, number>();
  private userQueues = new Map<string, Array<QueueItem>>();
  private userOrder: string[] = []; // 维持 enqueue 顺序, 调度时按此顺序扫
  private taskMap = new Map<string, QueueTask>();
  /**
   * 跟踪当前正在运行的 task 的 userId, 用于 heartbeat 准确回收 stale task 的 user slot.
   * taskMap 里的 QueueTask 不存 userId (向后兼容), 所以单独维护.
   */
  private runningUserByTask = new Map<string, string>();
  private maxTaskMapSize = 1000;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: {
    globalConcurrency?: number;
    perUserConcurrency?: number;
    timeoutMs?: number;
  }) {
    this.globalConcurrency = opts?.globalConcurrency ?? 3;
    this.perUserConcurrency = opts?.perUserConcurrency ?? 1;
    this.timeoutMs = opts?.timeoutMs ?? 900_000; // 15 分钟
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
  }

  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** 提交任务, 返回 taskId. task 内部负责 5/30/60/90/100% 进度上报. */
  enqueue(task: () => Promise<void>, meta: Omit<QueueTask, "status" | "enqueuedAt">): string {
    const taskId = meta.id;
    const userId = meta.userId;
    const queueTask: QueueTask = {
      ...meta,
      status: "pending",
      enqueuedAt: Date.now(),
    };
    this.taskMap.set(taskId, queueTask);
    this.trimTaskMap();

    // 加入用户队列 (FIFO)
    let userQueue = this.userQueues.get(userId);
    if (!userQueue) {
      userQueue = [];
      this.userQueues.set(userId, userQueue);
      this.userOrder.push(userId);
    }
    userQueue.push({
      task: async () => {
        queueTask.status = "running";
        queueTask.startedAt = Date.now();
        this.runningUserByTask.set(taskId, userId);
        try {
          await this.runWithTimeout(task);
          queueTask.status = "done";
        } catch (err: any) {
          queueTask.status = "failed";
          queueTask.error = err?.message || String(err);
          console.error(`[MultiTenantIngestQueue] Task ${taskId} failed:`, err);
        } finally {
          queueTask.finishedAt = Date.now();
          this.runningUserByTask.delete(taskId);
          this.globalRunning = Math.max(0, this.globalRunning - 1);
          const ur = this.userRunning.get(userId) ?? 0;
          this.userRunning.set(userId, Math.max(0, ur - 1));
          this.dispatch();
        }
      },
      meta: queueTask,
    });

    this.dispatch();
    return taskId;
  }

  /**
   * 调度循环: 在 global slot 和 user slot 都允许时, 启动尽可能多的任务.
   * 每轮只启动一个新任务, 避免一次 enqueue 触发整批用户都被无脑启动.
   * (后续 task 完成会再调用 dispatch)
   */
  private dispatch() {
    if (this.globalRunning >= this.globalConcurrency) return;
    for (const userId of this.userOrder) {
      const userQueue = this.userQueues.get(userId);
      if (!userQueue || userQueue.length === 0) continue;
      const userRunning = this.userRunning.get(userId) ?? 0;
      if (userRunning >= this.perUserConcurrency) continue;
      const item = userQueue.shift()!;
      this.globalRunning++;
      this.userRunning.set(userId, userRunning + 1);
      // 不 await, 让任务独立运行
      item.task().catch((err) => {
        console.error("[MultiTenantIngestQueue] Unexpected task error:", err);
        this.runningUserByTask.delete(item.meta.id);
        this.globalRunning = Math.max(0, this.globalRunning - 1);
        const ur = this.userRunning.get(userId) ?? 0;
        this.userRunning.set(userId, Math.max(0, ur - 1));
        this.dispatch();
      });
      // 一轮只启动一个, 等 task 完成 / 新 enqueue 再来一轮
      // 除非还有 global slot, 继续循环
      if (this.globalRunning >= this.globalConcurrency) return;
    }
  }

  private runWithTimeout(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      task()
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private heartbeat() {
    if (this.globalRunning <= 0) return;
    const now = Date.now();
    const runningTasks = Array.from(this.taskMap.values()).filter((t) => t.status === "running");
    const staleTasks = runningTasks.filter((t) => {
      const elapsed = t.startedAt ? now - t.startedAt : 0;
      return elapsed > this.timeoutMs + 10_000;
    });
    if (staleTasks.length > 0) {
      console.warn(
        `[MultiTenantIngestQueue] Heartbeat detected ${staleTasks.length} stale running tasks (globalRunning=${this.globalRunning}), resetting`
      );
      // 修正 globalRunning: 按 stale 数
      this.globalRunning = Math.max(0, this.globalRunning - staleTasks.length);
      // 修正 userRunning: 走 runningUserByTask 准确定位 userId
      const affectedUsers = new Set<string>();
      for (const t of staleTasks) {
        const uid = this.runningUserByTask.get(t.id);
        if (uid) {
          affectedUsers.add(uid);
          this.runningUserByTask.delete(t.id);
        }
        t.status = "failed";
        t.error = t.error || "Task timed out (heartbeat recovery)";
        t.finishedAt = now;
      }
      for (const userId of affectedUsers) {
        const ur = this.userRunning.get(userId) ?? 0;
        this.userRunning.set(userId, Math.max(0, ur - 1));
      }
      this.dispatch();
    }
  }

  private trimTaskMap() {
    if (this.taskMap.size <= this.maxTaskMapSize) return;
    const entries = Array.from(this.taskMap.entries());
    entries.sort((a, b) => (a[1].enqueuedAt || 0) - (b[1].enqueuedAt || 0));
    const toDelete = entries.slice(0, entries.length - this.maxTaskMapSize);
    for (const [key] of toDelete) {
      this.taskMap.delete(key);
    }
  }

  getStatus() {
    const tasks = Array.from(this.taskMap.values());
    const perUserPending: Record<string, number> = {};
    const perUserRunning: Record<string, number> = {};
    for (const [userId, queue] of this.userQueues.entries()) {
      perUserPending[userId] = queue.length;
    }
    for (const [userId, count] of this.userRunning.entries()) {
      perUserRunning[userId] = count;
    }
    return {
      globalConcurrency: this.globalConcurrency,
      perUserConcurrency: this.perUserConcurrency,
      globalRunning: this.globalRunning,
      globalPending: tasks.filter((t) => t.status === "pending").length,
      perUserPending,
      perUserRunning,
      totalTracked: tasks.length,
      tasks: tasks.slice(-50),
    };
  }

  getTask(taskId: string): QueueTask | undefined {
    return this.taskMap.get(taskId);
  }
}

/**
 * 全局多租户 ingest 队列单例
 *
 * 配置 via env:
 * - INGEST_GLOBAL_CONCURRENCY (default 3)
 * - INGEST_PER_USER_CONCURRENCY (default 1)
 * - INGEST_TIMEOUT_MS (default 900000 = 15 分钟)
 */
function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const ingestQueue = new MultiTenantIngestQueue({
  globalConcurrency: readEnvInt("INGEST_GLOBAL_CONCURRENCY", 3),
  perUserConcurrency: readEnvInt("INGEST_PER_USER_CONCURRENCY", 1),
  timeoutMs: readEnvInt("INGEST_TIMEOUT_MS", 900_000),
});
