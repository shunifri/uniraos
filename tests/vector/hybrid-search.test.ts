import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HybridSearchService,
  getHybridSearchService,
  resetHybridSearchService,
  configureHybridSearchService,
} from '../../src/vector/hybrid-search.js';
import type { ContentType } from '../../src/vector/types.js';

// Mock MySQL adapter
const mockQuery = vi.fn();
const mockExecute = vi.fn();
const mockMySQLAdapter = {
  query: mockQuery,
  execute: mockExecute,
  queryPrimary: vi.fn(),
  queryWithFields: vi.fn(),
  transaction: vi.fn(),
  healthCheck: vi.fn(),
  close: vi.fn(),
} as any;

// Mock Qdrant client
const mockSearch = vi.fn();
const mockUpsertVectors = vi.fn();
const mockDeleteByDocId = vi.fn();
const mockGetStats = vi.fn();
const mockHealthCheck = vi.fn();
const mockQdrantClient = {
  search: mockSearch,
  upsertVectors: mockUpsertVectors,
  deleteByDocId: mockDeleteByDocId,
  getStats: mockGetStats,
  healthCheck: mockHealthCheck,
  initialize: vi.fn(),
  deleteCollection: vi.fn(),
  count: vi.fn(),
} as any;

describe('HybridSearchService', () => {
  let service: HybridSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetHybridSearchService();
    service = configureHybridSearchService(mockMySQLAdapter, mockQdrantClient);
  });

  describe('search', () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());

    it('should perform hybrid search and return merged results', async () => {
      // Mock Qdrant search results
      mockSearch.mockResolvedValue([
        {
          id: 'chunk-1',
          score: 0.95,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 0,
            content_type: 'text' as ContentType,
            page_number: 1,
          },
        },
        {
          id: 'chunk-2',
          score: 0.85,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 1,
            content_type: 'text' as ContentType,
            page_number: 1,
          },
        },
      ]);

      // Mock MySQL metadata query
      mockQuery.mockResolvedValue([
        {
          id: 'chunk-1',
          doc_id: 'doc-1',
          chunk_index: 0,
          content: 'This is the first chunk content',
          content_type: 'text',
          page_number: 1,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'chunk-2',
          doc_id: 'doc-1',
          chunk_index: 1,
          content: 'This is the second chunk content',
          content_type: 'text',
          page_number: 1,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ]);

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 2,
      });

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('chunk-1');
      expect(results[0].vector_score).toBe(0.95);
      expect(results[0].content).toBe('This is the first chunk content');
      expect(results[1].id).toBe('chunk-2');
      expect(results[1].vector_score).toBe(0.85);

      // Verify Qdrant was called with expanded limit
      expect(mockSearch).toHaveBeenCalledWith({
        vector: mockEmbedding,
        limit: 6, // limit * 3
        filter: undefined,
      });

      // Verify MySQL query was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['chunk-1', 'chunk-2']
      );
    });

    it('should return empty array when no vector results found', async () => {
      mockSearch.mockResolvedValue([]);

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 10,
      });

      expect(results).toHaveLength(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should handle missing metadata gracefully', async () => {
      mockSearch.mockResolvedValue([
        {
          id: 'chunk-1',
          score: 0.95,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 0,
            content_type: 'text' as ContentType,
          },
        },
      ]);

      // Return empty metadata (chunk not in MySQL)
      mockQuery.mockResolvedValue([]);

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('chunk-1');
      expect(results[0].content).toBe(''); // Empty content when metadata missing
      expect(results[0].metadata.missing).toBe(true);
    });

    it('should apply docIds filter', async () => {
      mockSearch.mockResolvedValue([
        {
          id: 'chunk-1',
          score: 0.95,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 0,
            content_type: 'text' as ContentType,
          },
        },
        {
          id: 'chunk-2',
          score: 0.85,
          payload: {
            doc_id: 'doc-2',
            chunk_index: 0,
            content_type: 'text' as ContentType,
          },
        },
        {
          id: 'chunk-3',
          score: 0.75,
          payload: {
            doc_id: 'doc-3',
            chunk_index: 0,
            content_type: 'text' as ContentType,
          },
        },
      ]);

      mockQuery.mockResolvedValue([
        {
          id: 'chunk-1',
          doc_id: 'doc-1',
          chunk_index: 0,
          content: 'content from doc-1',
          content_type: 'text',
        },
        {
          id: 'chunk-2',
          doc_id: 'doc-2',
          chunk_index: 0,
          content: 'content from doc-2',
          content_type: 'text',
        },
      ]);

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 5,
        docIds: ['doc-1', 'doc-2'], // Multiple docIds - should post-filter
      });

      // Verify Qdrant was called without filter (multiple docIds use post-filtering)
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: undefined,
        })
      );

      // Results should only include chunks from doc-1 and doc-2 (not doc-3)
      expect(results).toHaveLength(2);
      expect(results.some((r) => r.doc_id === 'doc-1')).toBe(true);
      expect(results.some((r) => r.doc_id === 'doc-2')).toBe(true);
      expect(results.some((r) => r.doc_id === 'doc-3')).toBe(false);
    });

    it('should apply contentTypes filter', async () => {
      mockSearch.mockResolvedValue([
        {
          id: 'chunk-1',
          score: 0.95,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 0,
            content_type: 'image' as ContentType,
          },
        },
        {
          id: 'chunk-2',
          score: 0.85,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 1,
            content_type: 'text' as ContentType,
          },
        },
        {
          id: 'chunk-3',
          score: 0.75,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 2,
            content_type: 'video' as ContentType,
          },
        },
      ]);

      mockQuery.mockResolvedValue([
        {
          id: 'chunk-1',
          doc_id: 'doc-1',
          chunk_index: 0,
          content: 'image content',
          content_type: 'image',
        },
        {
          id: 'chunk-2',
          doc_id: 'doc-1',
          chunk_index: 1,
          content: 'text content',
          content_type: 'text',
        },
      ]);

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 5,
        contentTypes: ['image', 'text'], // Multiple content types
      });

      // Qdrant called without filter (multiple contentTypes use post-filtering)
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: undefined,
        })
      );

      // Results should only include image and text (not video)
      expect(results).toHaveLength(2);
      expect(results.some((r) => r.content_type === 'image')).toBe(true);
      expect(results.some((r) => r.content_type === 'text')).toBe(true);
      expect(results.some((r) => r.content_type === 'video')).toBe(false);
    });

    it('should sort results by vector score descending', async () => {
      mockSearch.mockResolvedValue([
        {
          id: 'chunk-low',
          score: 0.5,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 0,
            content_type: 'text' as ContentType,
          },
        },
        {
          id: 'chunk-high',
          score: 0.9,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 1,
            content_type: 'text' as ContentType,
          },
        },
        {
          id: 'chunk-mid',
          score: 0.7,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 2,
            content_type: 'text' as ContentType,
          },
        },
      ]);

      mockQuery.mockResolvedValue([
        {
          id: 'chunk-low',
          doc_id: 'doc-1',
          chunk_index: 0,
          content: 'low score content',
          content_type: 'text',
        },
        {
          id: 'chunk-high',
          doc_id: 'doc-1',
          chunk_index: 1,
          content: 'high score content',
          content_type: 'text',
        },
        {
          id: 'chunk-mid',
          doc_id: 'doc-1',
          chunk_index: 2,
          content: 'mid score content',
          content_type: 'text',
        },
      ]);

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 10,
      });

      expect(results[0].id).toBe('chunk-high');
      expect(results[0].vector_score).toBe(0.9);
      expect(results[1].id).toBe('chunk-mid');
      expect(results[1].vector_score).toBe(0.7);
      expect(results[2].id).toBe('chunk-low');
      expect(results[2].vector_score).toBe(0.5);
    });

    it('should apply final limit after merging', async () => {
      // Return more results than limit
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        id: `chunk-${i}`,
        score: 0.9 - i * 0.05,
        payload: {
          doc_id: 'doc-1',
          chunk_index: i,
          content_type: 'text' as ContentType,
        },
      }));

      mockSearch.mockResolvedValue(manyResults);

      mockQuery.mockResolvedValue(
        manyResults.map((r) => ({
          id: r.id,
          doc_id: 'doc-1',
          chunk_index: r.payload.chunk_index,
          content: `content ${r.payload.chunk_index}`,
          content_type: 'text',
        }))
      );

      const results = await service.search({
        query: 'test query',
        embedding: mockEmbedding,
        limit: 5, // Request only 5
      });

      expect(results).toHaveLength(5);
      // Verify Qdrant was called with expanded recall (5 * 3 = 15)
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 15,
        })
      );
    });
  });

  describe('fullTextSearch', () => {
    it('should perform full-text search successfully', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'chunk-1',
          doc_id: 'doc-1',
          chunk_index: 0,
          content: 'This is searchable content',
          content_type: 'text',
          page_number: 1,
          relevance_score: 2.5,
        },
        {
          id: 'chunk-2',
          doc_id: 'doc-1',
          chunk_index: 1,
          content: 'More searchable content here',
          content_type: 'text',
          page_number: 2,
          relevance_score: 1.8,
        },
      ]);

      const results = await service.fullTextSearch('searchable content', 5);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('chunk-1');
      expect(results[0].content).toBe('This is searchable content');
      expect(results[0].vector_score).toBe(0);
      expect(results[0].metadata.relevance_score).toBe(2.5);
      expect(results[0].metadata.source).toBe('fulltext');

      // Verify MySQL full-text query was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('MATCH(content) AGAINST'),
        ['searchable content', 'searchable content', 5]
      );
    });

    it('should fallback to LIKE search when full-text fails', async () => {
      // First call (full-text) fails
      mockQuery.mockRejectedValueOnce(new Error('FULLTEXT index not found'));

      // Fallback query succeeds
      mockQuery.mockResolvedValueOnce([
        {
          id: 'chunk-1',
          doc_id: 'doc-1',
          chunk_index: 0,
          content: 'fallback content',
          content_type: 'text',
        },
      ]);

      const results = await service.fullTextSearch('fallback', 10);

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('fallback content');
      expect(results[0].metadata.source).toBe('fallback_like');

      // Verify both queries were called
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no matches found', async () => {
      mockQuery.mockResolvedValue([]);

      const results = await service.fullTextSearch('nonexistent query', 10);

      expect(results).toHaveLength(0);
    });

    it('should use default limit of 10 when not specified', async () => {
      mockQuery.mockResolvedValue([]);

      await service.fullTextSearch('query');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([10])
      );
    });
  });

  describe('singleton pattern', () => {
    it('getHybridSearchService should return same instance', () => {
      resetHybridSearchService();
      const instance1 = getHybridSearchService();
      const instance2 = getHybridSearchService();
      expect(instance1).toBe(instance2);
    });

    it('configureHybridSearchService should create new instance', () => {
      resetHybridSearchService();
      const instance1 = getHybridSearchService();
      const instance2 = configureHybridSearchService(
        mockMySQLAdapter,
        mockQdrantClient
      );
      expect(instance1).not.toBe(instance2);
    });

    it('resetHybridSearchService should clear instance', () => {
      const instance1 = getHybridSearchService();
      resetHybridSearchService();
      const instance2 = getHybridSearchService();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('error handling', () => {
    it('should throw and log error when Qdrant search fails', async () => {
      mockSearch.mockRejectedValue(new Error('Qdrant connection error'));

      await expect(
        service.search({
          query: 'test',
          embedding: [0.1, 0.2, 0.3],
        })
      ).rejects.toThrow('Qdrant connection error');
    });

    it('should throw and log error when MySQL query fails', async () => {
      mockSearch.mockResolvedValue([
        {
          id: 'chunk-1',
          score: 0.9,
          payload: {
            doc_id: 'doc-1',
            chunk_index: 0,
            content_type: 'text' as ContentType,
          },
        },
      ]);

      mockQuery.mockRejectedValue(new Error('MySQL connection error'));

      await expect(
        service.search({
          query: 'test',
          embedding: [0.1, 0.2, 0.3],
        })
      ).rejects.toThrow('MySQL connection error');
    });
  });
});
