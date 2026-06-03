/**
 * KG v2 阶段 5 集成测试：Neo4j 原生化能力
 *
 * 这些测试不能连真实 Neo4j（CI 没有该服务），
 * 所以用 mock store 验证 scoreNodes 走 searchNodesByKeywords 优先路径。
 */
import { describe, it, expect, vi } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";

describe.sequential("KG v2 Stage 5 — scoreNodes backend-aware dispatch", () => {
  it("prefers searchNodesByKeywords when available (Stage 5 native fast path)", async () => {
    // 模拟一个实现了 searchNodesByKeywords 的 store
    const backendHits = [
      { node: { id: "n1", label: "apple", type: "entity", tags: [], properties: {}, createdAt: 1 }, score: 0.95 },
      { node: { id: "n2", label: "iphone", type: "entity", tags: [], properties: {}, createdAt: 2 }, score: 0.7 },
    ];
    const store = {
      searchNodesByKeywords: vi.fn().mockResolvedValue(backendHits),
      getAllNodes: vi.fn().mockResolvedValue([]), // 不应被调用
      getNode: vi.fn().mockImplementation((id) => Promise.resolve(backendHits.find((h) => h.node.id === id)?.node)),
      getEdgesOf: vi.fn().mockResolvedValue([]),
    };

    // 这里直接 import 内部 scoreNodes 比较麻烦，改用 bfs-extractor 的公开 API
    const { extractSubgraph } = await import(
      "../../../src/memory/knowledge-graph/bfs-extractor.js"
    );
    const result = await extractSubgraph(store as any, "apple iphone", {
      maxSeeds: 5,
      maxDepth: 0, // 不扩展
      maxNodes: 10,
    });

    // 验证 native path 被命中
    expect((store.searchNodesByKeywords as any).mock.calls.length).toBe(1);
    // 验证 fallback 没被调用
    expect((store.getAllNodes as any).mock.calls.length).toBe(0);
    // seedNodes 返回的是 id 列表；通过 result.nodes 验证实际节点
    expect(result.seedNodes.length).toBe(2);
    expect(result.nodes.map((n) => n.label).sort()).toEqual(["apple", "iphone"]);
  });

  it("falls back to getAllNodes when searchNodesByKeywords is missing (MySQL path)", async () => {
    // 不实现 searchNodesByKeywords，模拟 MySQL store
    const fakeNode = { id: "n1", label: "fallback", type: "entity", tags: [], properties: {}, createdAt: 1 };
    const store = {
      getAllNodes: vi.fn().mockResolvedValue([fakeNode]),
      getNode: vi.fn().mockResolvedValue(fakeNode),
      getEdgesOf: vi.fn().mockResolvedValue([]),
      getEdgesBetween: vi.fn().mockResolvedValue([]),
    };

    const { extractSubgraph } = await import(
      "../../../src/memory/knowledge-graph/bfs-extractor.js"
    );
    const result = await extractSubgraph(store as any, "fallback", {
      maxSeeds: 5,
      maxDepth: 0,
      maxNodes: 10,
    });

    expect((store.getAllNodes as any).mock.calls.length).toBeGreaterThan(0);
    expect(result.seedNodes.length).toBeGreaterThan(0);
  });

  it("falls back to getAllNodes when searchNodesByKeywords throws (resilience)", async () => {
    const fakeNode = { id: "n1", label: "resilience", type: "entity", tags: [], properties: {}, createdAt: 1 };
    const store = {
      searchNodesByKeywords: vi.fn().mockRejectedValue(new Error("index not ready")),
      getAllNodes: vi.fn().mockResolvedValue([fakeNode]),
      getNode: vi.fn().mockResolvedValue(fakeNode),
      getEdgesOf: vi.fn().mockResolvedValue([]),
      getEdgesBetween: vi.fn().mockResolvedValue([]),
    };

    const { extractSubgraph } = await import(
      "../../../src/memory/knowledge-graph/bfs-extractor.js"
    );
    const result = await extractSubgraph(store as any, "resilience", {
      maxSeeds: 5,
      maxDepth: 0,
      maxNodes: 10,
    });

    // 即便 searchNodesByKeywords 抛错，fallback 让整体不挂
    expect((store.searchNodesByKeywords as any).mock.calls.length).toBe(1);
    expect((store.getAllNodes as any).mock.calls.length).toBeGreaterThan(0);
    expect(result.seedNodes.length).toBeGreaterThan(0);
  });
});

describe.sequential("KG v2 Stage 5 — Neo4jGraphStore source structure", () => {
  // 仅做源码静态检查（真实 Neo4j 需要起服务）
  it("Neo4jGraphStore exposes searchNodesByKeywords method", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const src = await fs.readFile(
      path.resolve(__dirname, "../../../src/memory/knowledge-graph/neo4j-store.ts"),
      "utf-8"
    );
    expect(src).toMatch(/async\s+searchNodesByKeywords/);
    expect(src).toMatch(/CREATE FULLTEXT INDEX node_search/);
  });

  it("Neo4jGraphStore uses connection pool config", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const src = await fs.readFile(
      path.resolve(__dirname, "../../../src/memory/knowledge-graph/neo4j-store.ts"),
      "utf-8"
    );
    expect(src).toMatch(/maxConnectionPoolSize/);
    expect(src).toMatch(/connectionAcquisitionTimeout/);
  });
});
