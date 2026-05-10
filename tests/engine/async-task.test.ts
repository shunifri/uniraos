import { describe, it, expect } from "vitest";
import { AsyncTaskManager } from "../../src/engine/async-task-manager.js";
import { TaskStatus } from "../../src/types/index.js";

describe("AsyncTaskManager", () => {
  it("should create a task with PENDING status", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    expect(task.taskId).toBeDefined();
    expect(task.status).toBe(TaskStatus.PENDING);
    expect(task.progress).toBe(0);
    expect(mgr.size).toBe(1);
  });

  it("should transition through lifecycle: PENDING → RUNNING → COMPLETED", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    mgr.start(task.taskId);
    expect(mgr.get(task.taskId)!.status).toBe(TaskStatus.RUNNING);

    mgr.complete(task.taskId, { url: "http://example.com/image.png" });
    const final = mgr.get(task.taskId)!;
    expect(final.status).toBe(TaskStatus.COMPLETED);
    expect(final.progress).toBe(100);
    expect(final.result).toEqual({ url: "http://example.com/image.png" });
  });

  it("should handle failure", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    mgr.start(task.taskId);
    mgr.fail(task.taskId, "API error");

    const final = mgr.get(task.taskId)!;
    expect(final.status).toBe(TaskStatus.FAILED);
    expect(final.error).toBe("API error");
  });

  it("should cancel a task", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    mgr.start(task.taskId);
    mgr.cancel(task.taskId);

    expect(mgr.get(task.taskId)!.status).toBe(TaskStatus.CANCELLED);
  });

  it("should update progress", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    mgr.start(task.taskId);
    mgr.progress(task.taskId, 50);
    expect(mgr.get(task.taskId)!.progress).toBe(50);

    mgr.progress(task.taskId, 75, Date.now() + 10000);
    const t = mgr.get(task.taskId)!;
    expect(t.progress).toBe(75);
    expect(t.estimatedCompletionAt).toBeGreaterThan(0);
  });

  it("should clamp progress to 0-100", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    mgr.progress(task.taskId, -10);
    expect(mgr.get(task.taskId)!.progress).toBe(0);

    mgr.progress(task.taskId, 150);
    expect(mgr.get(task.taskId)!.progress).toBe(100);
  });

  it("should list tasks by status", () => {
    const mgr = new AsyncTaskManager();
    const t1 = mgr.create();
    const t2 = mgr.create();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    const t3 = mgr.create();

    mgr.start(t1.taskId);
    mgr.start(t2.taskId);
    mgr.complete(t2.taskId, "done");

    expect(mgr.list({ status: TaskStatus.RUNNING }).length).toBe(1);
    expect(mgr.list({ status: TaskStatus.COMPLETED }).length).toBe(1);
    expect(mgr.list({ status: TaskStatus.PENDING }).length).toBe(1);
    expect(mgr.list().length).toBe(3);
  });

  it("should fire callback on completion", async () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    let callbackResult: unknown = null;
    mgr.onComplete(task.taskId, (t) => {
      callbackResult = t.result;
    });

    mgr.start(task.taskId);
    mgr.complete(task.taskId, { data: "hello" });

    expect(callbackResult).toEqual({ data: "hello" });
  });

  it("should waitFor resolve on completion", async () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    // 模拟异步完成
    setTimeout(() => {
      mgr.start(task.taskId);
      mgr.complete(task.taskId, "result");
    }, 10);

    const result = await mgr.waitFor(task.taskId, 1000);
    expect(result.status).toBe(TaskStatus.COMPLETED);
    expect(result.result).toBe("result");
  });

  it("should waitFor reject on timeout", async () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();

    await expect(mgr.waitFor(task.taskId, 50)).rejects.toThrow("Task timeout");
  });

  it("should waitFor resolve immediately if already completed", async () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create();
    mgr.complete(task.taskId, "done");

    const result = await mgr.waitFor(task.taskId);
    expect(result.status).toBe(TaskStatus.COMPLETED);
  });

  it("should cleanup old completed tasks", () => {
    const mgr = new AsyncTaskManager();

    for (let i = 0; i < 10; i++) {
      const t = mgr.create();
      mgr.complete(t.taskId, `result_${i}`);
    }

    expect(mgr.size).toBe(10);
    const removed = mgr.cleanup(3);
    expect(removed).toBe(7);
    expect(mgr.size).toBe(3);
  });

  it("should return null for nonexistent task", () => {
    const mgr = new AsyncTaskManager();
    expect(mgr.get("nonexistent")).toBeNull();
    expect(mgr.update("nonexistent", { status: TaskStatus.RUNNING })).toBeNull();
  });

  it("should accept custom taskId", () => {
    const mgr = new AsyncTaskManager();
    const task = mgr.create("my-custom-id");
    expect(task.taskId).toBe("my-custom-id");
    expect(mgr.get("my-custom-id")).not.toBeNull();
  });
});
