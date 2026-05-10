/**
 * Unified Vector Search Provider
 *
 * Provides a common interface for vector search with multiple backends:
 * - QdrantVectorProvider: scalable Qdrant backend
 * - MemoryVectorProvider: in-memory fallback with cosine similarity
 */

import { log } from "../utils/logger.js";
import { cosineSimilarity } from "../memory/embedding-provider.js";
import {
  QdrantVectorClient,
  getQdrantClient,
} from "./qdrant-client.js";
import type {
  VectorDocument,
  VectorSearchOptions,
  VectorSearchProvider,
  SearchResult,
} from "./types.js";

/** Qdrant-based vector search provider */
export class QdrantVectorProvider implements VectorSearchProvider {
  private client: QdrantVectorClient;

  constructor(client?: QdrantVectorClient) {
    this.client = client || getQdrantClient();
  }

  async health(): Promise<boolean> {
    try {
      return await this.client.healthCheck();
    } catch {
      return false;
    }
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;

    const points = documents.map((d) => ({
      id: d.id,
      vector: d.vector,
      payload: d.payload,
    }));

    await this.client.upsertVectors(points);
  }

  async delete(documentId: string): Promise<void> {
    await this.client.deleteByDocId(documentId);
  }

  async search(
    _query: string,
    options: VectorSearchOptions,
  ): Promise<SearchResult[]> {
    if (!options.embedding) {
      return [];
    }

    // For single doc_id filter, pass to Qdrant; arrays handled via post-filter
    const filter = options.filter;

    const results = await this.client.search({
      vector: options.embedding,
      limit: options.limit ?? 10,
      filter,
    });

    // Post-filter for docIds/contentTypes arrays
    let filtered = results;
    if (options.docIds && options.docIds.length > 0) {
      filtered = filtered.filter((r) =>
        options.docIds!.includes(r.payload.doc_id),
      );
    }
    if (options.contentTypes && options.contentTypes.length > 0) {
      filtered = filtered.filter((r) =>
        options.contentTypes!.includes(r.payload.content_type),
      );
    }

    return filtered;
  }
}

/** In-memory vector search provider using cosine similarity */
export class MemoryVectorProvider implements VectorSearchProvider {
  private documents = new Map<string, VectorDocument>();

  async health(): Promise<boolean> {
    return true;
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
  }

  async delete(documentId: string): Promise<void> {
    for (const [id, doc] of this.documents.entries()) {
      if (doc.payload.doc_id === documentId) {
        this.documents.delete(id);
      }
    }
  }

  async search(
    _query: string,
    options: VectorSearchOptions,
  ): Promise<SearchResult[]> {
    if (!options.embedding || this.documents.size === 0) {
      return [];
    }

    const limit = options.limit ?? 10;
    const results: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      // Apply filters
      if (
        options.filter?.doc_id &&
        doc.payload.doc_id !== options.filter.doc_id
      ) {
        continue;
      }
      if (
        options.filter?.content_type &&
        doc.payload.content_type !== options.filter.content_type
      ) {
        continue;
      }
      if (
        options.filter?.page_number !== undefined &&
        doc.payload.page_number !== options.filter.page_number
      ) {
        continue;
      }
      if (
        options.docIds &&
        !options.docIds.includes(doc.payload.doc_id)
      ) {
        continue;
      }
      if (
        options.contentTypes &&
        !options.contentTypes.includes(doc.payload.content_type)
      ) {
        continue;
      }

      const score = cosineSimilarity(options.embedding, doc.vector);
      results.push({
        id: doc.id,
        score,
        payload: doc.payload,
      });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Get the number of documents in memory */
  getDocumentCount(): number {
    return this.documents.size;
  }

  /** Clear all documents (useful for testing) */
  clear(): void {
    this.documents.clear();
  }
}

/** Singleton instance cache */
let vectorProviderInstance: VectorSearchProvider | null = null;

/**
 * Create the best available vector provider.
 * Tries Qdrant first, falls back to in-memory provider.
 * @param clientFactory - Optional factory for Qdrant client (for testing)
 */
export async function createVectorProvider(
  clientFactory?: () => QdrantVectorClient,
): Promise<VectorSearchProvider> {
  if (vectorProviderInstance) {
    return vectorProviderInstance;
  }

  const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

  const qdrantClient = clientFactory
    ? clientFactory()
    : new QdrantVectorClient({
        url: qdrantUrl,
        apiKey: process.env.QDRANT_API_KEY,
        collectionName: process.env.QDRANT_COLLECTION || "kb_chunks",
        vectorDimension: parseInt(
          process.env.QDRANT_VECTOR_DIMENSION || "1536",
        ),
      });

  try {
    const isHealthy = await qdrantClient.healthCheck();
    if (isHealthy) {
      log("info", "vector_provider_qdrant_selected", { url: qdrantUrl });
      vectorProviderInstance = new QdrantVectorProvider(qdrantClient);
      return vectorProviderInstance;
    }
    log("warn", "vector_provider_qdrant_unhealthy", { url: qdrantUrl });
  } catch (err) {
    log("warn", "vector_provider_qdrant_unavailable", {
      url: qdrantUrl,
      error: err instanceof Error ? (err as Error).message : String(err),
    });
  }

  log("info", "vector_provider_memory_fallback", {
    reason: "qdrant_unavailable",
  });
  vectorProviderInstance = new MemoryVectorProvider();
  return vectorProviderInstance;
}

/**
 * Get the singleton vector provider instance.
 * Returns a memory provider if none has been created yet.
 */
export function getVectorProvider(): VectorSearchProvider {
  if (!vectorProviderInstance) {
    vectorProviderInstance = new MemoryVectorProvider();
  }
  return vectorProviderInstance;
}

/** Reset the singleton instance (useful for testing) */
export function resetVectorProvider(): void {
  vectorProviderInstance = null;
}

/** Configure the vector provider with a custom instance */
export function configureVectorProvider(
  provider: VectorSearchProvider,
): VectorSearchProvider {
  vectorProviderInstance = provider;
  return vectorProviderInstance;
}
