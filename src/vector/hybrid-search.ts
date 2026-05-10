/**
 * Hybrid Search Service
 *
 * Combines vector similarity search (Qdrant) with full-text search (MySQL)
 * to provide more accurate and comprehensive search results.
 */

import { getMySQLAdapter, MySQLAdapter } from '../db/mysql-adapter.js';
import { getQdrantClient, QdrantVectorClient } from './qdrant-client.js';
import { log } from '../utils/logger.js';
import type { ContentType } from './types.js';

export interface HybridSearchParams {
  /** Original query text */
  query: string;
  /** Query vector embedding */
  embedding: number[];
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Filter by document IDs */
  docIds?: string[];
  /** Filter by content types */
  contentTypes?: ContentType[];
  /** Optional knowledge graph search callback for enriching results */
  graphSearch?: (query: string, params: { limit: number; docIds?: string[] }) => Promise<Array<{ doc_id: string; score: number }>>;
}

export interface HybridSearchResult {
  /** Unique chunk ID */
  id: string;
  /** Document ID that this chunk belongs to */
  doc_id: string;
  /** Chunk index within the document */
  chunk_index: number;
  /** Chunk content */
  content: string;
  /** Type of content */
  content_type: ContentType;
  /** Optional page number (for PDFs/documents) */
  page_number?: number;
  /** Vector similarity score (0-1) */
  vector_score: number;
  /** Knowledge graph boost score (0-1) */
  graph_boost?: number;
  /** Metadata from MySQL */
  metadata: Record<string, unknown>;
}

/** MySQL chunk metadata row */
interface ChunkMetadataRow {
  id: string;
  doc_id: string;
  chunk_index: number;
  content: string;
  content_type: ContentType;
  page_number?: number;
  created_at?: Date;
  updated_at?: Date;
}

/** Vector search result with score */
interface VectorSearchResult {
  id: string;
  score: number;
  payload: {
    doc_id: string;
    chunk_index: number;
    content_type: ContentType;
    page_number?: number;
  };
}

/**
 * Hybrid Search Service
 * Combines vector similarity and keyword-based search
 */
export class HybridSearchService {
  private mysql: MySQLAdapter;
  private qdrant: QdrantVectorClient;

  constructor(mysql?: MySQLAdapter, qdrant?: QdrantVectorClient) {
    this.mysql = mysql || getMySQLAdapter();
    this.qdrant = qdrant || getQdrantClient();
  }

  /**
   * Perform hybrid search combining vector and full-text search
   * @param params - Search parameters
   * @returns Ranked search results
   */
  async search(params: HybridSearchParams): Promise<HybridSearchResult[]> {
    const startTime = Date.now();
    const limit = params.limit ?? 10;
    const recallLimit = limit * 3; // Expand recall 3x for better results

    log('info', 'hybrid_search_start', {
      query: params.query,
      limit,
      recallLimit,
      hasDocIds: !!params.docIds?.length,
      hasContentTypes: !!params.contentTypes?.length,
    });

    try {
      // Step 1: Qdrant vector search with expanded recall
      const vectorResults = await this.performVectorSearch(params, recallLimit);

      if (vectorResults.length === 0) {
        log('info', 'hybrid_search_no_vector_results', {
          query: params.query,
          duration: Date.now() - startTime,
        });
        return [];
      }

      // Step 2: Fetch metadata from MySQL
      const metadata = await this.fetchMetadata(vectorResults.map((r) => r.id));

      // Step 3: Merge and rank results
      let results = this.mergeAndRank(vectorResults, metadata);

      // Step 4: Enrich with knowledge graph results if provided
      if (params.graphSearch) {
        try {
          const graphResults = await params.graphSearch(params.query, {
            limit: params.limit ?? 10,
            docIds: params.docIds,
          });

          if (graphResults.length > 0) {
            const existingDocIds = new Set(results.map((r) => r.doc_id));
            const missingGraphResults = graphResults.filter(
              (gr) => !existingDocIds.has(gr.doc_id)
            );

            if (missingGraphResults.length > 0) {
              const graphDocIds = missingGraphResults.map((gr) => gr.doc_id);
              const graphScoreMap = new Map(
                missingGraphResults.map((gr) => [gr.doc_id, gr.score])
              );

              const graphChunks = await this.fetchMetadataByDocIds(graphDocIds);

              const graphResultsMapped: HybridSearchResult[] = graphChunks.map((chunk) => ({
                id: String(chunk.id),
                doc_id: chunk.doc_id,
                chunk_index: chunk.chunk_index,
                content: chunk.content,
                content_type: chunk.content_type,
                page_number: chunk.page_number,
                vector_score: 0,
                graph_boost: graphScoreMap.get(chunk.doc_id) ?? 0,
                metadata: {
                  source: 'graph_search',
                },
              }));

              results = [...results, ...graphResultsMapped];
            }
          }
        } catch (graphError) {
          log('warn', 'hybrid_search_graph_error', {
            query: params.query,
            error: graphError instanceof Error ? graphError.message : String(graphError),
          });
        }
      }

      // Step 5: Re-sort combined results by total score and apply final limit
      results.sort((a, b) => {
        const scoreA = a.vector_score + (a.graph_boost ?? 0);
        const scoreB = b.vector_score + (b.graph_boost ?? 0);
        return scoreB - scoreA;
      });

      const finalResults = results.slice(0, limit);

      log('info', 'hybrid_search_complete', {
        query: params.query,
        vectorResults: vectorResults.length,
        metadataFound: metadata.length,
        finalResults: finalResults.length,
        duration: Date.now() - startTime,
      });

      return finalResults;
    } catch (error) {
      log('error', 'hybrid_search_error', {
        query: params.query,
        error: error instanceof Error ? (error as Error).message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Perform full-text search using MySQL
   * @param query - Search query text
   * @param limit - Maximum number of results
   * @returns Search results from full-text index
   */
  async fullTextSearch(query: string, limit: number = 10): Promise<HybridSearchResult[]> {
    const startTime = Date.now();

    log('info', 'fulltext_search_start', {
      query,
      limit,
    });

    try {
      // Use MySQL full-text search on content column
      // Assuming kb_chunks table has a FULLTEXT index on content
      const sql = `
        SELECT 
          id, doc_id, chunk_index, content, content_type, page_number,
          MATCH(content) AGAINST(? IN BOOLEAN MODE) as relevance_score
        FROM kb_chunks
        WHERE MATCH(content) AGAINST(? IN BOOLEAN MODE)
        ORDER BY relevance_score DESC
        LIMIT ?
      `;

      const rows = await this.mysql.query<ChunkMetadataRow & { relevance_score: number }>(sql, [
        query,
        query,
        limit,
      ]);

      const results: HybridSearchResult[] = rows.map((row) => ({
        id: row.id,
        doc_id: row.doc_id,
        chunk_index: row.chunk_index,
        content: row.content,
        content_type: row.content_type,
        page_number: row.page_number,
        vector_score: 0, // Full-text search doesn't have vector score
        metadata: {
          relevance_score: row.relevance_score,
          source: 'fulltext',
        },
      }));

      log('info', 'fulltext_search_complete', {
        query,
        results: results.length,
        duration: Date.now() - startTime,
      });

      return results;
    } catch (error) {
      // If full-text search fails (e.g., no FULLTEXT index), fall back to LIKE
      log('warn', 'fulltext_search_fallback', {
        query,
        error: error instanceof Error ? (error as Error).message : String(error),
      });

      return this.fallbackTextSearch(query, limit);
    }
  }

  /**
   * Fallback text search using LIKE when full-text index is not available
   */
  private async fallbackTextSearch(query: string, limit: number): Promise<HybridSearchResult[]> {
    const sql = `
      SELECT id, doc_id, chunk_index, content, content_type, page_number
      FROM kb_chunks
      WHERE content LIKE ?
      LIMIT ?
    `;

    const rows = await this.mysql.query<ChunkMetadataRow>(sql, [`%${query}%`, limit]);

    return rows.map((row) => ({
      id: row.id,
      doc_id: row.doc_id,
      chunk_index: row.chunk_index,
      content: row.content,
      content_type: row.content_type,
      page_number: row.page_number,
      vector_score: 0,
      metadata: {
        source: 'fallback_like',
      },
    }));
  }

  /**
   * Perform vector search with filters
   */
  private async performVectorSearch(
    params: HybridSearchParams,
    limit: number
  ): Promise<VectorSearchResult[]> {
    // Build filter for Qdrant - we search without complex filters
    // since the current Qdrant client only supports single-value filters.
    // Post-filtering will be done based on results.
    
    // If single docId is specified, use it as filter
    const filter: Record<string, unknown> = {};
    
    if (params.docIds && params.docIds.length === 1) {
      filter.doc_id = params.docIds[0];
    }
    
    if (params.contentTypes && params.contentTypes.length === 1) {
      filter.content_type = params.contentTypes[0];
    }

    const results = await this.qdrant.search({
      vector: params.embedding,
      limit,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    // Post-filter results if multiple docIds or contentTypes are specified
    let filteredResults = results;
    
    if (params.docIds && params.docIds.length > 1) {
      filteredResults = filteredResults.filter((r) => 
        params.docIds!.includes(r.payload.doc_id)
      );
    }
    
    if (params.contentTypes && params.contentTypes.length > 1) {
      filteredResults = filteredResults.filter((r) => 
        params.contentTypes!.includes(r.payload.content_type)
      );
    }

    return filteredResults.map((r) => ({
      id: r.id,
      score: r.score,
      payload: r.payload,
    }));
  }

  /**
   * Fetch metadata for chunk IDs from MySQL
   */
  private async fetchMetadata(ids: string[]): Promise<ChunkMetadataRow[]> {
    if (ids.length === 0) {
      return [];
    }

    // Use placeholders for IN clause
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT id, doc_id, chunk_index, content, content_type, page_number, created_at, updated_at
      FROM kb_chunks
      WHERE id IN (${placeholders})
    `;

    return await this.mysql.query<ChunkMetadataRow>(sql, ids);
  }

  /**
   * Fetch metadata for doc IDs from MySQL
   */
  private async fetchMetadataByDocIds(docIds: string[]): Promise<ChunkMetadataRow[]> {
    if (docIds.length === 0) {
      return [];
    }

    const placeholders = docIds.map(() => '?').join(',');
    const sql = `
      SELECT id, doc_id, chunk_index, content, content_type, page_number, created_at, updated_at
      FROM kb_chunks
      WHERE doc_id IN (${placeholders})
    `;

    return await this.mysql.query<ChunkMetadataRow>(sql, docIds);
  }

  /**
   * Merge vector results with MySQL metadata and rank
   */
  private mergeAndRank(
    vectorResults: VectorSearchResult[],
    metadata: ChunkMetadataRow[]
  ): HybridSearchResult[] {
    // Create metadata lookup map
    const metadataMap = new Map<string, ChunkMetadataRow>();
    for (const row of metadata) {
      metadataMap.set(row.id, row);
    }

    const merged: HybridSearchResult[] = [];

    for (const vectorResult of vectorResults) {
      const meta = metadataMap.get(vectorResult.id);

      if (!meta) {
        // Log missing metadata but still include result with payload info
        log('warn', 'hybrid_search_missing_metadata', {
          chunkId: vectorResult.id,
        });

        // Use payload from vector result if available
        merged.push({
          id: vectorResult.id,
          doc_id: vectorResult.payload.doc_id,
          chunk_index: vectorResult.payload.chunk_index,
          content: '', // Content not available
          content_type: vectorResult.payload.content_type,
          page_number: vectorResult.payload.page_number,
          vector_score: vectorResult.score,
          metadata: {
            missing: true,
          },
        });
        continue;
      }

      merged.push({
        id: vectorResult.id,
        doc_id: meta.doc_id,
        chunk_index: meta.chunk_index,
        content: meta.content,
        content_type: meta.content_type,
        page_number: meta.page_number,
        vector_score: vectorResult.score,
        metadata: {
          created_at: meta.created_at,
          updated_at: meta.updated_at,
        },
      });
    }

    // Sort by vector score (descending)
    // Higher cosine similarity = better match
    return merged.sort((a, b) => b.vector_score - a.vector_score);
  }
}

// Singleton instance
let hybridSearchInstance: HybridSearchService | null = null;

/**
 * Get the singleton Hybrid Search Service instance
 */
export function getHybridSearchService(): HybridSearchService {
  if (!hybridSearchInstance) {
    hybridSearchInstance = new HybridSearchService();
  }
  return hybridSearchInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetHybridSearchService(): void {
  hybridSearchInstance = null;
}

/**
 * Configure the hybrid search service with custom dependencies
 * @param mysql - Custom MySQL adapter
 * @param qdrant - Custom Qdrant client
 */
export function configureHybridSearchService(
  mysql?: MySQLAdapter,
  qdrant?: QdrantVectorClient
): HybridSearchService {
  hybridSearchInstance = new HybridSearchService(mysql, qdrant);
  return hybridSearchInstance;
}
