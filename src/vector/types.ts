/**
 * Vector database types for Qdrant integration
 */

/** Content types supported for vector chunks */
export type ContentType = 'text' | 'image' | 'video' | 'audio';

/** Payload stored with each vector point */
export interface VectorPayload {
  /** Document ID that this chunk belongs to */
  doc_id: string;
  /** Chunk index within the document */
  chunk_index: number;
  /** Type of content */
  content_type: ContentType;
  /** Optional page number (for PDFs/documents) */
  page_number?: number;
}

/** Vector point for storage in Qdrant */
export interface VectorPoint {
  /** Unique identifier for the point */
  id: string;
  /** Vector embedding (1536 dimensions for OpenAI) */
  vector: number[];
  /** Payload metadata */
  payload: VectorPayload;
}

/** Filter condition for vector search */
export interface VectorFilter {
  /** Filter by document ID */
  doc_id?: string;
  /** Filter by content type */
  content_type?: ContentType;
  /** Filter by page number */
  page_number?: number;
}

/** Parameters for similarity search */
export interface SearchParams {
  /** Query vector */
  vector: number[];
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Filter conditions */
  filter?: VectorFilter;
}

/** Search result from Qdrant */
export interface SearchResult {
  /** Point ID */
  id: string;
  /** Similarity score (higher is better for cosine similarity) */
  score: number;
  /** Vector payload */
  payload: VectorPayload;
}

/** Collection statistics */
export interface CollectionStats {
  /** Total number of points in collection */
  points_count: number;
  /** Vector dimension */
  vector_dimension: number;
}

/** Qdrant client configuration */
export interface QdrantConfig {
  /** Qdrant server URL */
  url: string;
  /** Optional API key */
  apiKey?: string;
  /** Collection name (default: 'kb_chunks') */
  collectionName?: string;
  /** Vector dimension (default: 1536) */
  vectorDimension?: number;
  /** Distance metric (default: 'Cosine') */
  distance?: 'Cosine' | 'Euclid' | 'Dot';
  /** Replication factor (default: 2) */
  replicationFactor?: number;
}

export interface VectorDocument {
  id: string;
  vector: number[];
  payload: VectorPayload;
}

export interface VectorSearchOptions {
  embedding?: number[];
  limit?: number;
  filter?: VectorFilter;
  docIds?: string[];
  contentTypes?: string[];
}

export interface VectorSearchProvider {
  health(): Promise<boolean>;
  upsert(documents: VectorDocument[]): Promise<void>;
  delete(documentId: string): Promise<void>;
  search(query: string, options: VectorSearchOptions): Promise<SearchResult[]>;
  getDocumentCount?(): number;
  clear?(): void;
}
