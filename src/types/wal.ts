/** WAL 条目状态 */
export type WALStatus = "pending" | "completed" | "failed";

/** WAL 条目 */
export interface WALEntry {
  id: string;
  traceId: string;
  skillName: string;
  params: Record<string, unknown>;
  status: WALStatus;
  timestamp: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  parentEntryId?: string;
}

/** WAL 存储后端接口 */
export interface WALStore {
  append(entry: WALEntry): void;
  markCompleted(id: string, result?: unknown): void;
  markFailed(id: string, error: string): void;
  getIncomplete(): WALEntry[];
  getAll(): WALEntry[];
  clear(): void;
}
