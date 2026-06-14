// ---- File download types ----
export interface FileDownloadInfo {
  name: string;
  path: string;
  size: number;
  ext: string;
  downloadUrl: string;
  contentUrl?: string;
}

export interface FileDownloadData {
  files: FileDownloadInfo[];
  zipDownloadUrl?: string;
  zipName?: string;
  zipPaths?: string[];
}

// ---- KB Reference types ----
export interface KbReference {
  index: number;
  docId: string;
  docName: string;
  chunkIndex: number;
  content: string;
  score: number;
  pageNumber: number | null;
  bboxes: Array<{ page: number; bbox: [number, number, number, number] }> | null;
  docMindTaskId?: string | null; // Document Mind 解析的文档标记
}

export interface WebReference {
  index: number;
  title: string;
  url: string;
  snippet?: string;
}

// ---- Chat message types ----
export interface ChatAttachment {
  name: string;
  path: string;
  size?: number;
  type?: string;
  status?: "done" | "error" | "uploading";
}

export interface ChatMsg {
  id?: number; // DB id，用于分页
  role: "user" | "assistant" | "tool" | "system" | "thinking" | "strategy" | "user_confirm";
  content: string;
  skillName?: string;
  isError?: boolean;
  status?: "running" | "done" | "error" | "streaming";
  chartOptions?: Record<string, unknown>[];
  fileDownload?: FileDownloadData;
  kbReferences?: KbReference[];
  webReferences?: WebReference[];
  resultData?: Record<string, unknown>;
  /** 预解析的 user_confirm 数据（避免每次渲染 JSON.parse） */
  parsedData?: Record<string, unknown>;
  /** 计划进度消息关联的计划 ID */
  planId?: string;
  /** 用户消息附带的附件元数据（持久化后刷新可恢复） */
  attachments?: ChatAttachment[];
  /** 该 user message 关联的 server streamId, 用于刷新/切页面后重连 in-flight stream */
  streamId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}
