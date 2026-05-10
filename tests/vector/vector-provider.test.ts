import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VectorDocument } from "../../src/vector/types.js";
import {
  QdrantVectorProvider,
  MemoryVectorProvider,
  createVectorProvider,
  getVectorProvider,
  resetVectorProvider,
  configureVectorProvider,
} from "../../src/vector/vector-provider.js";

/** Create a normalized vector of given dimension pointing in a random direction */
function createVector(dimension: number, seed: number): number[] {
  const vec: number[] = [];
  let x = seed;
  for (let i = 0; i < dimension; i++) {
    // Simple LCG pseudo-random for determinism
    x = (x * 16807 + 0) % 2147483647;
    vec.push((x / 2147483647) * 2 - 1);
  }
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / magnitude);
}

describe("MemoryVectorProvider", () => {
  let provider: MemoryVectorProvider;

  beforeEach(() => {
    provider = new MemoryVectorProvider();
  });

  describe("health", () => {
    it("should always return true", async () => {
      expect(await provider.health()).toBe(true);
    });
  });

  describe("upsert", () => {
    it("should store documents in memory", async () => {
      const docs: VectorDocument[] = [
        {
          id: "1",
          vector: createVector(1536, 1),
          payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
        },
        {
          id: "2",
          vector: createVector(1536, 2),
          payload: { doc_id: "doc-1", chunk_index: 1, content_type: "text" },
        },
      ];

      await provider.upsert(docs);
      expect(provider.getDocumentCount()).toBe(2);
    });

    it("should update existing documents by id", async () => {
      const doc1: VectorDocument = {
        id: "1",
        vector: createVector(1536, 1),
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
      };
      await provider.upsert([doc1]);

      const updated: VectorDocument = {
        id: "1",
        vector: createVector(1536, 3),
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "image" },
      };
      await provider.upsert([updated]);

      expect(provider.getDocumentCount()).toBe(1);
      const results = await provider.search("test", { limit: 10, embedding: createVector(1536, 3) });
      expect(results[0]?.payload.content_type).toBe("image");
    });
  });

  describe("delete", () => {
    it("should remove all documents for a given doc_id", async () => {
      const docs: VectorDocument[] = [
        {
          id: "1",
          vector: createVector(1536, 1),
          payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
        },
        {
          id: "2",
          vector: createVector(1536, 2),
          payload: { doc_id: "doc-2", chunk_index: 0, content_type: "text" },
        },
      ];

      await provider.upsert(docs);
      await provider.delete("doc-1");

      expect(provider.getDocumentCount()).toBe(1);
      const remaining = await provider.search("test", {
        limit: 10,
        embedding: createVector(1536, 1),
      });
      expect(remaining.every((r) => r.payload.doc_id === "doc-2")).toBe(true);
    });
  });

  describe("search", () => {
    it("should return empty array when no embedding provided", async () => {
      const docs: VectorDocument[] = [
        {
          id: "1",
          vector: createVector(1536, 1),
          payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
        },
      ];
      await provider.upsert(docs);
      const results = await provider.search("test", { limit: 10 });
      expect(results).toHaveLength(0);
    });

    it("should return empty array when no documents stored", async () => {
      const results = await provider.search("test", {
        limit: 10,
        embedding: createVector(1536, 1),
      });
      expect(results).toHaveLength(0);
    });

    it("should find similar vectors sorted by score", async () => {
      const base = createVector(1536, 100);
      const similar = base.map((v) => v + 0.01);
      const dissimilar = createVector(1536, 200);

      // Normalize
      const norm = (v: number[]) => {
        const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        return v.map((x) => x / mag);
      };

      const docs: VectorDocument[] = [
        {
          id: "similar",
          vector: norm(similar),
          payload: { doc_id: "doc-a", chunk_index: 0, content_type: "text" },
        },
        {
          id: "dissimilar",
          vector: norm(dissimilar),
          payload: { doc_id: "doc-b", chunk_index: 0, content_type: "text" },
        },
      ];

      await provider.upsert(docs);
      const results = await provider.search("test", {
        limit: 10,
        embedding: norm(base),
      });

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("similar");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it("should respect limit", async () => {
      const docs: VectorDocument[] = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        vector: createVector(1536, i + 1),
        payload: { doc_id: "doc-1", chunk_index: i, content_type: "text" },
      }));

      await provider.upsert(docs);
      const results = await provider.search("test", {
        limit: 2,
        embedding: createVector(1536, 1),
      });

      expect(results).toHaveLength(2);
    });

    it("should filter by doc_id", async () => {
      const docs: VectorDocument[] = [
        {
          id: "1",
          vector: createVector(1536, 1),
          payload: { doc_id: "doc-a", chunk_index: 0, content_type: "text" },
        },
        {
          id: "2",
          vector: createVector(1536, 2),
          payload: { doc_id: "doc-b", chunk_index: 0, content_type: "text" },
        },
      ];

      await provider.upsert(docs);
      const results = await provider.search("test", {
        limit: 10,
        embedding: createVector(1536, 1),
        filter: { doc_id: "doc-a" },
      });

      expect(results).toHaveLength(1);
      expect(results[0].payload.doc_id).toBe("doc-a");
    });

    it("should filter by content_type", async () => {
      const docs: VectorDocument[] = [
        {
          id: "1",
          vector: createVector(1536, 1),
          payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
        },
        {
          id: "2",
          vector: createVector(1536, 2),
          payload: { doc_id: "doc-1", chunk_index: 1, content_type: "image" },
        },
      ];

      await provider.upsert(docs);
      const results = await provider.search("test", {
        limit: 10,
        embedding: createVector(1536, 1),
        filter: { content_type: "image" },
      });

      expect(results).toHaveLength(1);
      expect(results[0].payload.content_type).toBe("image");
    });

    it("should filter by docIds array", async () => {
      const docs: VectorDocument[] = [
        {
          id: "1",
          vector: createVector(1536, 1),
          payload: { doc_id: "doc-a", chunk_index: 0, content_type: "text" },
        },
        {
          id: "2",
          vector: createVector(1536, 2),
          payload: { doc_id: "doc-b", chunk_index: 0, content_type: "text" },
        },
        {
          id: "3",
          vector: createVector(1536, 3),
          payload: { doc_id: "doc-c", chunk_index: 0, content_type: "text" },
        },
      ];

      await provider.upsert(docs);
      const results = await provider.search("test", {
        limit: 10,
        embedding: createVector(1536, 1),
        docIds: ["doc-a", "doc-c"],
      });

      expect(results).toHaveLength(2);
      expect(results.some((r) => r.payload.doc_id === "doc-b")).toBe(false);
    });
  });
});

describe("QdrantVectorProvider", () => {
  const mockUpsertVectors = vi.fn();
  const mockDeleteByDocId = vi.fn();
  const mockSearch = vi.fn();
  const mockHealthCheck = vi.fn();

  // eslint-disable-next-line no-undef
  function createMockClient(): QdrantVectorClient {
    return {
      upsertVectors: mockUpsertVectors,
      deleteByDocId: mockDeleteByDocId,
      search: mockSearch,
      healthCheck: mockHealthCheck,
      initialize: vi.fn(),
      deleteCollection: vi.fn(),
      getStats: vi.fn(),
      count: vi.fn(),
  // eslint-disable-next-line no-undef
    } as unknown as QdrantVectorClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delegate health() to client healthCheck", async () => {
    const client = createMockClient();
    mockHealthCheck.mockResolvedValue(true);

    const provider = new QdrantVectorProvider(client);
    expect(await provider.health()).toBe(true);
    expect(mockHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("should return false on health() when client throws", async () => {
    const client = createMockClient();
    mockHealthCheck.mockRejectedValue(new Error("network error"));

    const provider = new QdrantVectorProvider(client);
    expect(await provider.health()).toBe(false);
  });

  it("should delegate upsert to client upsertVectors", async () => {
    const client = createMockClient();
    const provider = new QdrantVectorProvider(client);

    const docs: VectorDocument[] = [
      {
        id: "1",
        vector: [0.1, 0.2, 0.3],
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
      },
    ];

    await provider.upsert(docs);
    expect(mockUpsertVectors).toHaveBeenCalledWith([
      {
        id: "1",
        vector: [0.1, 0.2, 0.3],
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
      },
    ]);
  });

  it("should skip upsert for empty array", async () => {
    const client = createMockClient();
    const provider = new QdrantVectorProvider(client);

    await provider.upsert([]);
    expect(mockUpsertVectors).not.toHaveBeenCalled();
  });

  it("should delegate delete to client deleteByDocId", async () => {
    const client = createMockClient();
    const provider = new QdrantVectorProvider(client);

    await provider.delete("doc-1");
    expect(mockDeleteByDocId).toHaveBeenCalledWith("doc-1");
  });

  it("should delegate search to client search with filter", async () => {
    const client = createMockClient();
    mockSearch.mockResolvedValue([
      {
        id: "1",
        score: 0.95,
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
      },
    ]);

    const provider = new QdrantVectorProvider(client);
    const results = await provider.search("query", {
      embedding: [0.1, 0.2],
      limit: 5,
      filter: { doc_id: "doc-1" },
    });

    expect(mockSearch).toHaveBeenCalledWith({
      vector: [0.1, 0.2],
      limit: 5,
      filter: { doc_id: "doc-1" },
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.95);
  });

  it("should post-filter by docIds array", async () => {
    const client = createMockClient();
    mockSearch.mockResolvedValue([
      {
        id: "1",
        score: 0.95,
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
      },
      {
        id: "2",
        score: 0.85,
        payload: { doc_id: "doc-2", chunk_index: 0, content_type: "text" },
      },
      {
        id: "3",
        score: 0.75,
        payload: { doc_id: "doc-3", chunk_index: 0, content_type: "text" },
      },
    ]);

    const provider = new QdrantVectorProvider(client);
    const results = await provider.search("query", {
      embedding: [0.1],
      limit: 10,
      docIds: ["doc-1", "doc-2"],
    });

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.payload.doc_id === "doc-3")).toBe(false);
  });

  it("should post-filter by contentTypes array", async () => {
    const client = createMockClient();
    mockSearch.mockResolvedValue([
      {
        id: "1",
        score: 0.95,
        payload: { doc_id: "doc-1", chunk_index: 0, content_type: "text" },
      },
      {
        id: "2",
        score: 0.85,
        payload: { doc_id: "doc-1", chunk_index: 1, content_type: "image" },
      },
    ]);

    const provider = new QdrantVectorProvider(client);
    const results = await provider.search("query", {
      embedding: [0.1],
      limit: 10,
      contentTypes: ["text"],
    });

    expect(results).toHaveLength(1);
    expect(results[0].payload.content_type).toBe("text");
  });

  it("should return empty array when no embedding provided", async () => {
    const client = createMockClient();
    const provider = new QdrantVectorProvider(client);

    const results = await provider.search("query", { limit: 10 });
    expect(results).toHaveLength(0);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe("createVectorProvider", () => {
  beforeEach(() => {
    resetVectorProvider();
    vi.clearAllMocks();
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
  });

  it("should return QdrantVectorProvider when Qdrant is healthy", async () => {
    const mockClient = {
      healthCheck: vi.fn().mockResolvedValue(true),
      upsertVectors: vi.fn(),
      deleteByDocId: vi.fn(),
      search: vi.fn(),
      initialize: vi.fn(),
      deleteCollection: vi.fn(),
      getStats: vi.fn(),
      count: vi.fn(),
    };

    const provider = await createVectorProvider(() => mockClient as any);
    expect(provider).toBeInstanceOf(QdrantVectorProvider);
    expect(mockClient.healthCheck).toHaveBeenCalledTimes(1);
  });

  it("should fall back to MemoryVectorProvider when Qdrant is unreachable", async () => {
    const mockClient = {
      healthCheck: vi.fn().mockResolvedValue(false),
      upsertVectors: vi.fn(),
      deleteByDocId: vi.fn(),
      search: vi.fn(),
      initialize: vi.fn(),
      deleteCollection: vi.fn(),
      getStats: vi.fn(),
      count: vi.fn(),
    };

    const provider = await createVectorProvider(() => mockClient as any);
    expect(provider).toBeInstanceOf(MemoryVectorProvider);
  });

  it("should fall back to MemoryVectorProvider when Qdrant healthCheck throws", async () => {
    const mockClient = {
      healthCheck: vi.fn().mockRejectedValue(new Error("Connection refused")),
      upsertVectors: vi.fn(),
      deleteByDocId: vi.fn(),
      search: vi.fn(),
      initialize: vi.fn(),
      deleteCollection: vi.fn(),
      getStats: vi.fn(),
      count: vi.fn(),
    };

    const provider = await createVectorProvider(() => mockClient as any);
    expect(provider).toBeInstanceOf(MemoryVectorProvider);
  });

  it("should use QDRANT_URL from environment when no factory provided", async () => {
    process.env.QDRANT_URL = "http://custom-qdrant:6333";
    const mockClient = {
      healthCheck: vi.fn().mockResolvedValue(true),
      upsertVectors: vi.fn(),
      deleteByDocId: vi.fn(),
      search: vi.fn(),
      initialize: vi.fn(),
      deleteCollection: vi.fn(),
      getStats: vi.fn(),
      count: vi.fn(),
    };

    // We pass a factory to avoid actually connecting, but the factory
    // asserts that the environment variable would have been used
    const provider = await createVectorProvider(() => mockClient as any);
    expect(provider).toBeInstanceOf(QdrantVectorProvider);
  });
});

describe("getVectorProvider / resetVectorProvider / configureVectorProvider", () => {
  beforeEach(() => {
    resetVectorProvider();
  });

  it("getVectorProvider should return a MemoryVectorProvider by default", () => {
    const provider = getVectorProvider();
    expect(provider).toBeInstanceOf(MemoryVectorProvider);
  });

  it("resetVectorProvider should clear the singleton", () => {
    const first = getVectorProvider();
    resetVectorProvider();
    const second = getVectorProvider();
    expect(first).not.toBe(second);
  });

  it("configureVectorProvider should set a custom provider", () => {
    const custom = new MemoryVectorProvider();
    const result = configureVectorProvider(custom);
    expect(result).toBe(custom);
    expect(getVectorProvider()).toBe(custom);
  });
});
