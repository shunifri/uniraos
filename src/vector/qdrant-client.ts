/**
 * Qdrant Vector Database Client
 * 
 * Provides vector storage and similarity search capabilities using Qdrant.
 */
import { QdrantClient } from "@qdrant/qdrant-js";
import type {
  VectorPoint,
  VectorPayload,
  VectorFilter,
  SearchParams,
  SearchResult,
  CollectionStats,
  QdrantConfig,
} from "./types.js";

/** Default configuration values */
const DEFAULT_CONFIG: Required<Omit<QdrantConfig, 'apiKey'>> = {
  url: "http://localhost:6333",
  collectionName: "kb_chunks",
  vectorDimension: 1536,
  distance: "Cosine",
  replicationFactor: 1,  // Single node deployment default
};

/** Qdrant Vector Client for managing vector embeddings */
export class QdrantVectorClient {
  private client: QdrantClient;
  private config: QdrantConfig & Required<Omit<QdrantConfig, 'apiKey'>>;

  constructor(config?: QdrantConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.client = new QdrantClient({
      url: this.config.url,
      apiKey: this.config.apiKey,
      timeout: 10, // P1 修复：10 秒超时（Qdrant 单位：秒）
    });
  }

  /**
   * Initialize the Qdrant collection
   * Creates the collection if it doesn't exist and sets up indexes
   */
  async initialize(): Promise<void> {
    const { collectionName, vectorDimension, distance, replicationFactor } = this.config;

    // Check if collection exists
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === collectionName
    );

    if (!exists) {
      // Create collection with proper configuration
      await this.client.createCollection(collectionName, {
        vectors: {
          size: vectorDimension,
          distance,
        },
        replication_factor: replicationFactor,
      });

      // Create indexes for filtering
      await this.createIndexes();
    }
  }

  /**
   * Create payload indexes for efficient filtering
   */
  private async createIndexes(): Promise<void> {
    const { collectionName } = this.config;

    // Index for doc_id (keyword type for exact match)
    await this.client.createPayloadIndex(collectionName, {
      field_name: "doc_id",
      field_schema: "keyword",
    });

    // Index for content_type (keyword type for exact match)
    await this.client.createPayloadIndex(collectionName, {
      field_name: "content_type",
      field_schema: "keyword",
    });

    // Index for chunk_index (integer type for range queries)
    await this.client.createPayloadIndex(collectionName, {
      field_name: "chunk_index",
      field_schema: "integer",
    });
  }

  /**
   * Upsert vectors in batch
   * @param points - Array of vector points to insert or update
   */
  async upsertVectors(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;

    const { collectionName } = this.config;

    const qdrantPoints = points.map((point) => ({
      id: point.id,
      vector: point.vector,
      payload: point.payload as unknown as Record<string, unknown>,
    }));

    await this.client.upsert(collectionName, {
      points: qdrantPoints,
    });
  }

  /**
   * Build Qdrant filter from VectorFilter
   */
  private buildFilter(filter?: VectorFilter): Record<string, unknown> | undefined {
    if (!filter) return undefined;

    const conditions: Record<string, unknown>[] = [];

    if (filter.doc_id) {
      conditions.push({
        key: "doc_id",
        match: { value: filter.doc_id },
      });
    }

    if (filter.content_type) {
      conditions.push({
        key: "content_type",
        match: { value: filter.content_type },
      });
    }

    if (filter.page_number !== undefined) {
      conditions.push({
        key: "page_number",
        match: { value: filter.page_number },
      });
    }

    if (conditions.length === 0) return undefined;

    return conditions.length === 1
      ? { must: conditions }
      : { must: conditions };
  }

  /**
   * Search for similar vectors
   * @param params - Search parameters
   * @returns Array of search results sorted by similarity
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const { collectionName } = this.config;
    const limit = params.limit ?? 10;

    const response = await this.client.search(collectionName, {
      vector: params.vector,
      limit,
      filter: this.buildFilter(params.filter),
      with_payload: true,
    });

    return response.map((result) => ({
      id: String(result.id),
      score: result.score,
      payload: result.payload as unknown as VectorPayload,
    }));
  }

  /**
   * Delete all vectors for a document
   * @param docId - Document ID to delete
   */
  async deleteByDocId(docId: string): Promise<void> {
    const { collectionName } = this.config;

    await this.client.delete(collectionName, {
      filter: {
        must: [
          {
            key: "doc_id",
            match: { value: docId },
          },
        ],
      },
    });
  }

  /**
   * Get collection statistics
   * @returns Collection stats including point count
   */
  async getStats(): Promise<CollectionStats> {
    const { collectionName } = this.config;

    const info = await this.client.getCollection(collectionName);

    return {
      points_count: info.points_count ?? 0,
      vector_dimension: this.config.vectorDimension,
    };
  }

  /**
   * Check if Qdrant server is healthy
   * @returns true if healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to list collections to verify connectivity
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete the entire collection (use with caution)
   */
  async deleteCollection(): Promise<void> {
    const { collectionName } = this.config;
    await this.client.deleteCollection(collectionName);
  }

  /**
   * Count points matching a filter
   * @param filter - Optional filter conditions
   * @returns Number of matching points
   */
  async count(filter?: VectorFilter): Promise<number> {
    const { collectionName } = this.config;

    const result = await this.client.count(collectionName, {
      filter: this.buildFilter(filter),
    });

    return result.count;
  }
}

/** Singleton instance cache */
let clientInstance: QdrantVectorClient | null = null;

/**
 * Get the singleton Qdrant client instance
 * @returns QdrantVectorClient instance
 */
export function getQdrantClient(): QdrantVectorClient {
  if (!clientInstance) {
    clientInstance = new QdrantVectorClient({
      url: process.env.QDRANT_URL || DEFAULT_CONFIG.url,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName: process.env.QDRANT_COLLECTION || DEFAULT_CONFIG.collectionName,
      vectorDimension: parseInt(process.env.QDRANT_VECTOR_DIMENSION || String(DEFAULT_CONFIG.vectorDimension)),
    });
  }
  return clientInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetQdrantClient(): void {
  clientInstance = null;
}

/**
 * Configure the Qdrant client with custom settings
 * @param config - Qdrant configuration
 * @returns QdrantVectorClient instance
 */
export function configureQdrantClient(config: QdrantConfig): QdrantVectorClient {
  clientInstance = new QdrantVectorClient(config);
  return clientInstance;
}
