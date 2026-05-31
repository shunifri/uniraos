export interface KBDocument {
  id: string;
  name: string;
  tags: string[];
  chunkCount: number;
  tokenCount?: number;
  createdAt: string;
  version?: number;
  shared?: boolean;
  vectorized?: number;
  vectorTotal?: number;
  parsingStatus?: 'pending' | 'processing' | 'success' | 'failed';
  parsingProgress?: number;
  mediaType?: 'document' | 'video' | 'audio' | 'text';
  durationMs?: number;
  collectionId?: string | null;
  owner?: string;
}

export interface SearchResult {
  docName: string;
  docId?: string;
  content: string;
  score: number;
  tags?: string[];
  chunkIndex?: number;
  pageNumber?: number | null;
  bboxes?: Array<{ page: number; bbox: [number, number, number, number] }> | null;
}
