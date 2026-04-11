import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  QdrantVectorClient,
  getQdrantClient,
  resetQdrantClient,
  configureQdrantClient,
} from "../../src/vector/qdrant-client.js";
import type { VectorPoint, ContentType } from "../../src/vector/types.js";

// Test configuration
const TEST_URL = process.env.QDRANT_URL || "http://localhost:6333";
const TEST_COLLECTION = "test_kb_chunks";

// Helper to create a random vector of given dimension
function createVector(dimension: number): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

// Helper to normalize vector (for cosine similarity)
function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / magnitude);
}

describe("QdrantVectorClient", () => {
  let client: QdrantVectorClient;

  beforeAll(async () => {
    // Configure client for testing
    client = configureQdrantClient({
      url: TEST_URL,
      collectionName: TEST_COLLECTION,
      vectorDimension: 1536,
    });
  });

  beforeEach(async () => {
    // Clean up collection before each test
    try {
      await client.deleteCollection();
    } catch {
      // Collection might not exist
    }
    // Re-initialize
    await client.initialize();
  });

  afterAll(async () => {
    // Clean up
    try {
      await client.deleteCollection();
    } catch {
      // Ignore cleanup errors
    }
    resetQdrantClient();
  });

  describe("healthCheck", () => {
    it("should return true when Qdrant is healthy", async () => {
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should return false when Qdrant is unreachable", async () => {
      const badClient = new QdrantVectorClient({
        url: "http://localhost:19999",
        collectionName: "test",
      });
      const isHealthy = await badClient.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe("initialize", () => {
    it("should create collection if not exists", async () => {
      // Collection already created in beforeEach
      const stats = await client.getStats();
      expect(stats.vector_dimension).toBe(1536);
    });

    it("should not fail if collection already exists", async () => {
      await client.initialize();
      const stats = await client.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe("upsertVectors", () => {
    it("should insert vectors successfully", async () => {
      const points: VectorPoint[] = [
        {
          id: "test-1",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "doc-1",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
        {
          id: "test-2",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "doc-1",
            chunk_index: 1,
            content_type: "text" as ContentType,
          },
        },
      ];

      await client.upsertVectors(points);

      const stats = await client.getStats();
      expect(stats.points_count).toBe(2);
    });

    it("should update existing vectors", async () => {
      const point: VectorPoint = {
        id: "test-update",
        vector: normalizeVector(createVector(1536)),
        payload: {
          doc_id: "doc-update",
          chunk_index: 0,
          content_type: "text" as ContentType,
        },
      };

      await client.upsertVectors([point]);

      // Update with new chunk_index
      const updatedPoint: VectorPoint = {
        ...point,
        payload: { ...point.payload, chunk_index: 1 },
      };
      await client.upsertVectors([updatedPoint]);

      const stats = await client.getStats();
      expect(stats.points_count).toBe(1);
    });

    it("should handle empty array", async () => {
      await client.upsertVectors([]);
      const stats = await client.getStats();
      expect(stats.points_count).toBe(0);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      // Insert test vectors
      const baseVector = normalizeVector(createVector(1536));
      const points: VectorPoint[] = [
        {
          id: "search-1",
          vector: baseVector,
          payload: {
            doc_id: "search-doc",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
        {
          id: "search-2",
          vector: normalizeVector(
            baseVector.map((v) => v + 0.1)
          ), // Similar vector
          payload: {
            doc_id: "search-doc",
            chunk_index: 1,
            content_type: "image" as ContentType,
            page_number: 1,
          },
        },
        {
          id: "search-3",
          vector: normalizeVector(createVector(1536)), // Different vector
          payload: {
            doc_id: "other-doc",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
      ];

      await client.upsertVectors(points);
    });

    it("should return similar vectors", async () => {
      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        limit: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should respect limit parameter", async () => {
      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should filter by doc_id", async () => {
      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        filter: { doc_id: "search-doc" },
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.payload.doc_id === "search-doc")).toBe(
        true
      );
    });

    it("should filter by content_type", async () => {
      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        filter: { content_type: "image" },
      });

      expect(results.every((r) => r.payload.content_type === "image")).toBe(
        true
      );
    });

    it("should combine multiple filters", async () => {
      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        filter: { doc_id: "search-doc", content_type: "image" },
      });

      expect(
        results.every(
          (r) =>
            r.payload.doc_id === "search-doc" &&
            r.payload.content_type === "image"
        )
      ).toBe(true);
    });
  });

  describe("deleteByDocId", () => {
    beforeEach(async () => {
      const points: VectorPoint[] = [
        {
          id: "del-1",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "delete-doc",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
        {
          id: "del-2",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "delete-doc",
            chunk_index: 1,
            content_type: "text" as ContentType,
          },
        },
        {
          id: "del-3",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "keep-doc",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
      ];

      await client.upsertVectors(points);
    });

    it("should delete all vectors for a document", async () => {
      await client.deleteByDocId("delete-doc");

      const stats = await client.getStats();
      expect(stats.points_count).toBe(1);

      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        filter: { doc_id: "keep-doc" },
      });
      expect(results.length).toBe(1);
      expect(results[0].payload.doc_id).toBe("keep-doc");
    });

    it("should not affect other documents", async () => {
      await client.deleteByDocId("delete-doc");

      const queryVector = normalizeVector(createVector(1536));
      const results = await client.search({
        vector: queryVector,
        filter: { doc_id: "keep-doc" },
      });
      expect(results.length).toBe(1);
    });
  });

  describe("getStats", () => {
    it("should return correct point count", async () => {
      const points: VectorPoint[] = [
        {
          id: "stats-1",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "stats-doc",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
        {
          id: "stats-2",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "stats-doc",
            chunk_index: 1,
            content_type: "text" as ContentType,
          },
        },
      ];

      await client.upsertVectors(points);

      const stats = await client.getStats();
      expect(stats.points_count).toBe(2);
      expect(stats.vector_dimension).toBe(1536);
    });

    it("should return zero for empty collection", async () => {
      const stats = await client.getStats();
      expect(stats.points_count).toBe(0);
    });
  });

  describe("count", () => {
    beforeEach(async () => {
      const points: VectorPoint[] = [
        {
          id: "count-1",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "doc-a",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
        {
          id: "count-2",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "doc-a",
            chunk_index: 1,
            content_type: "image" as ContentType,
          },
        },
        {
          id: "count-3",
          vector: normalizeVector(createVector(1536)),
          payload: {
            doc_id: "doc-b",
            chunk_index: 0,
            content_type: "text" as ContentType,
          },
        },
      ];

      await client.upsertVectors(points);
    });

    it("should count all points", async () => {
      const count = await client.count();
      expect(count).toBe(3);
    });

    it("should count with filter", async () => {
      const count = await client.count({ doc_id: "doc-a" });
      expect(count).toBe(2);
    });
  });

  describe("singleton pattern", () => {
    it("getQdrantClient should return same instance", () => {
      resetQdrantClient();
      const client1 = getQdrantClient();
      const client2 = getQdrantClient();
      expect(client1).toBe(client2);
    });

    it("configureQdrantClient should reset instance", () => {
      resetQdrantClient();
      const client1 = getQdrantClient();
      const client2 = configureQdrantClient({
        url: TEST_URL,
        collectionName: "different-collection",
      });
      expect(client1).not.toBe(client2);
    });
  });
});
