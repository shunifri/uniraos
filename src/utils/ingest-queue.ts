/**
 * 全局文档处理队列 — 串行执行 ingest + vectorize，避免并发死锁和 API 限流
 *
 * 特性：
 * - 串行执行（默认 1 个并发）
 * - 单任务超时（默认 5 分钟）
 * - 队列状态监控（长度、当前任务、等待任务）
 * - 任务失败不影响后续任务
 * - 支持外部查询队列状态
 * - 内存安全（taskMap 上限 + 定时兜底）
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

export class IngestQueue {
  private concurrency: number;
  private timeoutMs: number;
  private running = 0;
  private queue: Array<{ task: () => Promise<void>; meta: QueueTask }> = [];
  private taskMap = new Map<string, QueueTask>();
  private maxTaskMapSize = 1000;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: { concurrency?: number; timeoutMs?: number }) {
    this.concurrency = opts?.concurrency ?? 1;
    this.timeoutMs = opts?.timeoutMs ?? 300_000; // 5 分钟
    // 每 30 秒检查一次 running 状态，兜底恢复
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
  }

  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** 提交任务，返回 taskId */
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
    // 不 await，让任务独立运行
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

  /** 心跳检查：兜底恢复 running 计数器 */
  private heartbeat() {
    if (this.running <= 0) return;
    const now = Date.now();
    const runningTasks = Array.from(this.taskMap.values()).filter((t) => t.status === "running");
    // 检查是否有任意 running 任务已超时（容错：超过超时时间 10 秒）
    const staleTasks = runningTasks.filter((t) => {
      const elapsed = t.startedAt ? now - t.startedAt : 0;
      return elapsed > this.timeoutMs + 10_000;
    });
    if (staleTasks.length > 0) {
      console.warn(`[IngestQueue] Heartbeat detected ${staleTasks.length} stale running tasks (running=${this.running}), resetting`);
      // 将超时任务标记为 failed
      for (const t of staleTasks) {
        t.status = "failed";
        t.error = t.error || "Task timed out (heartbeat recovery)";
        t.finishedAt = now;
      }
      // 修正 running 计数器：减去已确认超时的任务数
      this.running = Math.max(0, this.running - staleTasks.length);
      // 触发后续任务处理（如果有 pending 任务）
      this.process();
    }
  }

  /** 限制 taskMap 大小，防止内存泄漏 */
  private trimTaskMap() {
    if (this.taskMap.size <= this.maxTaskMapSize) return;
    // 按 enqueuedAt 排序，删除最早的
    const entries = Array.from(this.taskMap.entries());
    entries.sort((a, b) => (a[1].enqueuedAt || 0) - (b[1].enqueuedAt || 0));
    const toDelete = entries.slice(0, entries.length - this.maxTaskMapSize);
    for (const [key] of toDelete) {
      this.taskMap.delete(key);
    }
  }

  /** 获取队列状态 */
  getStatus() {
    const tasks = Array.from(this.taskMap.values());
    return {
      concurrency: this.concurrency,
      running: this.running,
      pending: this.queue.length,
      total: tasks.length,
      tasks: tasks.slice(-50), // 只保留最近 50 条
    };
  }

  /** 根据 taskId 获取任务状态 */
  getTask(taskId: string): QueueTask | undefined {
    return this.taskMap.get(taskId);
  }
}

/** 全局单例 */
export const ingestQueue = new IngestQueue({ concurrency: 1, timeoutMs: 300_000 });
