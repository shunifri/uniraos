import Database from "better-sqlite3";
import type { AsyncTaskHandle } from "../types/index.js";

export interface TaskPersistence {
  save(task: AsyncTaskHandle): Promise<void>;
  load(): Promise<AsyncTaskHandle[]>;
  remove(taskId: string): Promise<void>;
}

export class SQLiteTaskPersistence implements TaskPersistence {
  private db: Database.Database;

  constructor(dbPath = ".raos/tasks.db") {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS async_tasks (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        result TEXT,
        error TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        estimated_completion_at INTEGER
      )
    `);
  }

  async save(task: AsyncTaskHandle): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO async_tasks
      (task_id, status, progress, result, error, created_at, updated_at, estimated_completion_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.taskId,
      task.status,
      task.progress ?? 0,
      task.result !== undefined ? JSON.stringify(task.result) : null,
      task.error ?? null,
      task.createdAt,
      task.updatedAt,
      task.estimatedCompletionAt ?? null,
    );
  }

  async load(): Promise<AsyncTaskHandle[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = this.db.prepare("SELECT * FROM async_tasks WHERE status IN ('PENDING', 'RUNNING')").all() as any[];
    return rows.map((r) => ({
      taskId: r.task_id,
      status: r.status,
      progress: r.progress,
      result: r.result ? JSON.parse(r.result) : undefined,
      error: r.error ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      estimatedCompletionAt: r.estimated_completion_at ?? undefined,
    }));
  }

  async remove(taskId: string): Promise<void> {
    this.db.prepare("DELETE FROM async_tasks WHERE task_id = ?").run(taskId);
  }
}
