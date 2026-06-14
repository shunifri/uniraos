/**
 * 异步任务管理器
 * 管理耗时 Skill 的异步执行生命周期：提交 → 执行 → 轮询 → 完成/失败
 */
import { TaskStatus } from "../types/index.js";
import type { AsyncTaskHandle } from "../types/index.js";

export type TaskCallback = (task: AsyncTaskHandle) => void;

export class AsyncTaskManager {
  private tasks = new Map<string, AsyncTaskHandle>();
  private callbacks = new Map<string, TaskCallback[]>();

  /** 创建一个新的异步任务 */
  create(taskId?: string): AsyncTaskHandle {
    const id = taskId ?? crypto.randomUUID();
    const now = Date.now();
    const task: AsyncTaskHandle = {
      taskId: id,
      status: TaskStatus.PENDING,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  /** 更新任务状态 */
  update(taskId: string, updates: Partial<Pick<AsyncTaskHandle, "status" | "progress" | "result" | "error" | "estimatedCompletionAt">>): AsyncTaskHandle | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: Date.now() });

    // 任务完成/失败时触发回调
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      this.fireCallbacks(taskId, task);
    }

    return task;
  }

  /** 标记任务开始运行 */
  start(taskId: string): AsyncTaskHandle | null {
    return this.update(taskId, { status: TaskStatus.RUNNING });
  }

  /** 标记任务完成 */
  complete(taskId: string, result: unknown): AsyncTaskHandle | null {
    return this.update(taskId, { status: TaskStatus.COMPLETED, progress: 100, result });
  }

  /** 标记任务失败 */
  fail(taskId: string, error: string): AsyncTaskHandle | null {
    return this.update(taskId, { status: TaskStatus.FAILED, error });
  }

  /** 取消任务 */
  cancel(taskId: string): AsyncTaskHandle | null {
    return this.update(taskId, { status: TaskStatus.CANCELLED });
  }

  /** 更新进度 */
  progress(taskId: string, progress: number, estimatedCompletionAt?: number): AsyncTaskHandle | null {
    return this.update(taskId, { progress: Math.min(100, Math.max(0, progress)), estimatedCompletionAt });
  }

  /** 查询任务状态 */
  get(taskId: string): AsyncTaskHandle | null {
    return this.tasks.get(taskId) ?? null;
  }

  /** 列出所有任务 */
  list(filter?: { status?: TaskStatus }): AsyncTaskHandle[] {
    const all = [...this.tasks.values()];
    if (filter?.status) {
      return all.filter((t) => t.status === filter.status);
    }
    return all;
  }

  /** 等待任务完成 */
  waitFor(taskId: string, timeoutMs?: number): Promise<AsyncTaskHandle> {
    const task = this.tasks.get(taskId);
    if (!task) return Promise.reject(new Error(`Task not found: ${taskId}`));

    // 已经完成了
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      return Promise.resolve(task);
    }

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cb: TaskCallback = (finishedTask) => {
        if (timer) clearTimeout(timer);
        resolve(finishedTask);
      };

      this.onComplete(taskId, cb);

      if (timeoutMs) {
        timer = setTimeout(() => {
          // 移除回调
          const cbs = this.callbacks.get(taskId);
          if (cbs) {
            const idx = cbs.indexOf(cb);
            if (idx >= 0) cbs.splice(idx, 1);
          }
          reject(new Error(`Task timeout: ${taskId}`));
        }, timeoutMs);
      }
    });
  }

  /** 注册任务完成回调 */
  onComplete(taskId: string, callback: TaskCallback): void {
    if (!this.callbacks.has(taskId)) {
      this.callbacks.set(taskId, []);
    }
    this.callbacks.get(taskId)!.push(callback);
  }

  /** 清理已完成的任务（保留最近 N 个） */
  cleanup(keepRecent: number = 100): number {
    const completed = [...this.tasks.entries()]
      .filter(([, t]) => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.FAILED || t.status === TaskStatus.CANCELLED)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);

    let removed = 0;
    for (let i = keepRecent; i < completed.length; i++) {
      this.tasks.delete(completed[i][0]);
      this.callbacks.delete(completed[i][0]);
      removed++;
    }
    return removed;
  }

  get size(): number {
    return this.tasks.size;
  }

  private fireCallbacks(taskId: string, task: AsyncTaskHandle): void {
    const cbs = this.callbacks.get(taskId);
    if (!cbs) return;
    for (const cb of cbs) {
      try {
        cb(task);
      } catch {
        // 回调异常不影响核心流程
      }
    }
    this.callbacks.delete(taskId);
  }
}
