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
}

export interface WebReference {
  index: number;
  title: string;
  url: string;
  snippet?: string;
}

// ---- Chat message types ----
export interface ChatMsg {
  id?: number; // DB id，用于分页
  role: "user" | "assistant" | "tool" | "system" | "thinking" | "strategy" | "user_confirm";
  content: string;
  skillName?: string;
  isError?: boolean;
  status?: "running" | "done" | "error";
  chartOptions?: Record<string, unknown>[];
  fileDownload?: FileDownloadData;
  kbReferences?: KbReference[];
  webReferences?: WebReference[];
  resultData?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}
