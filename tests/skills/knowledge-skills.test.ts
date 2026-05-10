import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  classifyQuery,
  KnowledgeBase,
  createKnowledgeSkills,
} from "../../src/skills/knowledge-skills.js";
import { KnowledgeGraphManager } from "../../src/memory/knowledge-graph/manager.js";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import type { LLMProvider } from "../../src/llm/types.js";
import type { GraphNode, GraphEdge } from "../../src/memory/knowledge-graph/types.js";

// ===== Module-level mocks =====
const mockQuery = vi.fn().mockResolvedValue([]);
const mockExecute = vi.fn().mockResolvedValue({ affectedRows: 1, insertId: 1 });
const mockTransaction = vi.fn(async (cb: any) => {
  const conn = {
    query: vi.fn().mockResolvedValue([[], []]),
    execute: vi.fn().mockResolvedValue([[], []]),
  };
  return cb(conn);
});

vi.mock("../../src/db/mysql-adapter.js", () => ({
  getMySQLAdapter: vi.fn(() => ({
    query: mockQuery,
    execute: mockExecute,
    queryPrimary: vi.fn().mockResolvedValue([]),
    queryWithFields: vi.fn().mockResolvedValue({ rows: [], fields: [] }),
    transaction: mockTransaction,
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  })),
}));

vi.mock("../../src/user/request-context.js", () => ({
  getCurrentUserId: vi.fn().mockReturnValue("default"),
}));

vi.mock("../../src/services/doc-parser.js", () => ({
  parseDocument: vi.fn().mockResolvedValue({
    content: "parsed content",
    pages: [],
    error: null,
    tags: [],
  }),
}));

vi.mock("../../src/services/parsing-queue.js", () => ({
  getParsingQueue: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/kb-graph-sync.js", () => ({
  syncSharedKBToGraphs: vi.fn(),
  removeKBFromAllGraphs: vi.fn(),
  getSharedKBTargetUsers: vi.fn().mockReturnValue([]),
  removeKBFromUserGraph: vi.fn(),
}));

vi.mock("../../src/db/share-repository.js", () => ({
  ShareRepository: {
    getInstance: vi.fn(() => ({
      getSharedToUser: vi.fn().mockResolvedValue([]),
      getByResource: vi.fn().mockResolvedValue([]),
    })),
  },
}));

vi.mock("../../src/db/user-repository.js", () => ({
  getUserRoles: vi.fn().mockResolvedValue([]),
  getUserById: vi.fn().mockResolvedValue(null),
  getUserDepartment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/db/department-repository.js", () => ({
  getDepartmentById: vi.fn().mockResolvedValue(null),
}));

// ===== Helpers =====
function createMockLLM(responseContent: string): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      toolCalls: [],
      finishReason: "stop" as const,
    }),
  };
}

function makeNode(
  id: string,
  label: string,
  type: string,
  tags: string[],
  properties?: Record<string, unknown>,
  communityId?: number
): GraphNode {
  return {
    id,
    label,
    type: type as GraphNode["type"],
    tags,
    properties: properties ?? {},
    createdAt: Date.now(),
    communityId,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  type: string,
  label: string,
  weight = 1
): GraphEdge {
  return {
    id,
    source,
    target,
    type: type as GraphEdge["type"],
    label,
    weight,
    createdAt: Date.now(),
  };
}

function createMockGraphStore(nodes: GraphNode[] = [], edges: GraphEdge[] = []) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return {
    getAllNodes: vi.fn().mockResolvedValue(nodes),
    getAllEdges: vi.fn().mockResolvedValue(edges),
    getNode: vi.fn((id: string) => Promise.resolve(nodeMap.get(id))),
    getEdgesOf: vi.fn((id: string) =>
      Promise.resolve(edges.filter((e) => e.source === id || e.target === id))
    ),
    getNeighbors: vi.fn((id: string) => {
      const neighborIds = new Set<string>();
      for (const e of edges) {
        if (e.source === id) neighborIds.add(e.target);
        if (e.target === id) neighborIds.add(e.source);
      }
      return Promise.resolve(
        [...neighborIds]
          .map((nid) => nodeMap.get(nid))
          .filter(Boolean) as GraphNode[]
      );
    }),
    getDegree: vi.fn((id: string) => {
      const degree = edges.filter((e) => e.source === id || e.target === id).length;
      return Promise.resolve(degree);
    }),
    getNodesByIds: vi.fn((ids: string[]) =>
      Promise.resolve(ids.map((id) => nodeMap.get(id)).filter(Boolean) as GraphNode[])
    ),
    searchNodesByKeywords: vi.fn((terms: string[]) => {
      const matched = nodes.filter((n) => {
        const label = n.label.toLowerCase();
        const tags = n.tags.join(" ").toLowerCase();
        return terms.some((t: string) => label.includes(t.toLowerCase()) || tags.includes(t.toLowerCase()));
      });
      return Promise.resolve(matched);
    }),
    updateNode: vi.fn().mockResolvedValue(undefined),
    clearGraph: vi.fn().mockResolvedValue(undefined),
    countNodes: vi.fn().mockResolvedValue(nodes.length),
    countEdges: vi.fn().mockResolvedValue(edges.length),
    findNodeByLabel: vi.fn((label: string) => {
      const lower = label.toLowerCase();
      return Promise.resolve(
        nodes.find((n) => n.label.toLowerCase() === lower || n.label.toLowerCase().includes(lower))
      );
    }),
  };
}

function createMockSessionManager(graphManager?: any) {
  return {
    getOrCreate: vi.fn().mockReturnValue({
      graphManager,
      llmProvider: undefined,
    }),
  };
}

// ===== Query Classification =====
describe("classifyQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies factual queries via rule engine (什么是)", async () => {
    const result = await classifyQuery("什么是知识图谱");
    expect(result.type).toBe("factual");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.keywords[0]).toContain("知识图谱");
  });

  it("classifies factual queries via rule engine (定义)", async () => {
    const result = await classifyQuery("请给出机器学习的定义");
    expect(result.type).toBe("factual");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies relational queries via rule engine", async () => {
    const result = await classifyQuery("A和B的关系是什么");
    expect(result.type).toBe("relational");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies relational queries with 区别 keyword", async () => {
    const result = await classifyQuery("苹果和香蕉的区别");
    expect(result.type).toBe("relational");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies discovery queries via rule engine", async () => {
    const result = await classifyQuery("还有哪些新发现");
    expect(result.type).toBe("discovery");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies hybrid when multiple indicators match equally", async () => {
    // 什么是 (factual) + 关系 (relational) → both score 1
    const result = await classifyQuery("什么是关系型数据库");
    expect(result.type).toBe("hybrid");
  });

  it("falls back to LLM when no rule matches", async () => {
    const llm = createMockLLM('{"type":"discovery","confidence":0.82}');
    const result = await classifyQuery("some completely unknown query xyz", llm);
    expect(result.type).toBe("discovery");
    expect(result.confidence).toBe(0.82);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("returns hybrid fallback when LLM provider is unavailable", async () => {
    const result = await classifyQuery("xyz unknown phrase abc123");
    expect(result.type).toBe("hybrid");
    expect(result.confidence).toBe(0.5);
  });

  it("handles empty query string", async () => {
    const result = await classifyQuery("");
    expect(result.type).toBe("hybrid");
    expect(result.confidence).toBe(0.5);
    expect(result.keywords).toEqual([]);
  });

  it("handles very short query", async () => {
    const result = await classifyQuery("是");
    expect(result.type).toBe("hybrid");
    expect(result.confidence).toBe(0.5);
  });
});

// ===== Result Merging =====
describe("mergeAndRescoreResults", () => {
  let kb: KnowledgeBase;

  beforeEach(() => {
    kb = new KnowledgeBase("test-owner");
  });

  it("performs RRF merge of keyword and semantic results", () => {
    const keywordResults = [{ docId: "d1", chunkIndex: 0, content: "a" }];
    const semanticResults = [{ docId: "d2", chunkIndex: 0, content: "b" }];

    const results = (kb as any).mergeAndRescoreResults(
      keywordResults,
      semanticResults,
      [],
      "factual"
    );

    expect(results).toHaveLength(2);
    expect(results[0].matchType).toBeOneOf(["keyword", "semantic"]);
    expect(results.every((r: any) => typeof r.score === "number")).toBe(true);
  });

  it("deduplicates overlapping results and marks as hybrid", () => {
    const keywordResults = [{ docId: "d1", chunkIndex: 0, content: "a" }];
    const semanticResults = [{ docId: "d1", chunkIndex: 0, content: "a" }];

    const results = (kb as any).mergeAndRescoreResults(
      keywordResults,
      semanticResults,
      [],
      "factual"
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("keyword+semantic");
    // Score = 0.4/61 + 0.6/61
    expect(results[0].score).toBeCloseTo(1 / 61, 6);
  });

  it("applies graph boost for relational queries", () => {
    const keywordResults = [{ docId: "d1", chunkIndex: 0, content: "a" }];
    const graphResults = [
      { docId: "d1", chunkIndex: 0, content: "a", graphContext: { path: [] } },
    ];

    const results = (kb as any).mergeAndRescoreResults(
      keywordResults,
      [],
      graphResults,
      "relational"
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("keyword+graph");
    // relational boost = 1.5, graphScore = (1.5 * 0.5) / 61
    expect(results[0].score).toBeCloseTo(0.4 / 61 + 0.75 / 61, 6);
  });

  it("handles empty inputs gracefully", () => {
    const results = (kb as any).mergeAndRescoreResults([], [], [], "hybrid");
    expect(results).toEqual([]);
  });
});

// ===== Graph Search =====
describe("KnowledgeGraphManager.graphSearch", () => {
  it("returns empty results for empty graph", async () => {
    const manager = new KnowledgeGraphManager("test-empty-graph");
    const mockStore = createMockGraphStore([], []);
    (manager as any).store = mockStore;
    (manager as any).storePromise = Promise.resolve(mockStore);
    (manager as any).precomputed = {
      communities: new Map(),
      godNodes: [],
      lastComputed: Date.now(),
    };

    const results = await manager.graphSearch("test", { limit: 5 });
    expect(results).toHaveLength(0);
  });

  it("finds kb_document nodes without precomputed communities", async () => {
    const docNode = makeNode("kb_doc_d1", "kb:TestDoc.pdf", "kb_document", ["kb_document"], {
      contentPreview: "test content",
    });
    const manager = new KnowledgeGraphManager("test-no-comm");
    await Promise.resolve(); // flush constructor microtask
    const mockStore = createMockGraphStore([docNode], []);
    (manager as any).store = mockStore;
    (manager as any).storePromise = Promise.resolve(mockStore);
    (manager as any).precomputed = {
      communities: new Map(),
      godNodes: [],
      lastComputed: Date.now(),
    };

    const results = await manager.graphSearch("testdoc", { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("d1");
    expect(results[0].matchType).toBe("graph_subgraph");
  });

  it("boosts results with central nodes when available", async () => {
    const godNode = makeNode("god1", "test concept", "concept", ["entity"]);
    const docNode = makeNode("kb_doc_d2", "kb:RelatedDoc.pdf", "kb_document", ["kb_document"], {
      contentPreview: "related",
    });
    const edge = makeEdge("e1", "god1", "kb_doc_d2", "TEMPORAL", "link");

    const manager = new KnowledgeGraphManager("test-god");
    await Promise.resolve(); // flush constructor microtask
    const mockStore = createMockGraphStore([godNode, docNode], [edge]);
    (manager as any).store = mockStore;
    (manager as any).storePromise = Promise.resolve(mockStore);
    (manager as any).precomputed = {
      communities: new Map(),
      godNodes: [godNode],
      lastComputed: Date.now(),
    };

    const results = await manager.graphSearch("test", { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r: any) => r.docId === "d2")).toBe(true);
  });

  it("uses communities to supplement results", async () => {
    const docNode1 = makeNode("kb_doc_d1", "kb:Doc1.pdf", "kb_document", ["kb_document"], {
      contentPreview: "doc1",
    });
    const docNode2 = makeNode("kb_doc_d2", "kb:Doc2.pdf", "kb_document", ["kb_document"], {
      contentPreview: "doc2",
    });
    // docNode1 needs communityId so graphSearch uses it to find community peers
    docNode1.communityId = 0;

    const manager = new KnowledgeGraphManager("test-comm");
    await Promise.resolve(); // flush constructor microtask
    const mockStore = createMockGraphStore([docNode1, docNode2], []);
    (manager as any).store = mockStore;
    (manager as any).storePromise = Promise.resolve(mockStore);
    (manager as any).precomputed = {
      communities: new Map([[0, ["kb_doc_d1", "kb_doc_d2"]]]),
      godNodes: [],
      lastComputed: Date.now(),
    };

    const results = await manager.graphSearch("doc1", { limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // docNode1 should be found; community boost may include docNode2
    const docIds = results.map((r: any) => r.docId);
    expect(docIds).toContain("d1");
  });
});

// ===== kb_search Skill =====
describe("kb_search skill", () => {
  let registry: SkillRegistry;
  let searchSpy: any;
  let getAllDocIdsSpy: any;

  beforeEach(() => {
    registry = new SkillRegistry();
    searchSpy = vi
      .spyOn(KnowledgeBase.prototype, "search")
      .mockResolvedValue([
        {
          docId: "d1",
          docName: "Test.pdf",
          chunkIndex: 0,
          content: "test content",
          score: 0.9,
          matchType: "hybrid",
          shared: false,
          pageNumber: null,
          bboxes: null,
          docMindTaskId: null,
        },
      ]);
    getAllDocIdsSpy = vi
      .spyOn(KnowledgeBase.prototype, "getAllDocIds")
      .mockResolvedValue(["d1"]);
  });

  afterEach(() => {
    searchSpy.mockRestore();
    getAllDocIdsSpy.mockRestore();
  });

  it("returns error when query is missing", async () => {
    createKnowledgeSkills(registry);
    const skill = registry.lookup("kb_search")!;
    const result = await skill.handler({});
    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain("query");
  });

  it("uses mixed search for factual queries without graphManager", async () => {
    createKnowledgeSkills(registry, undefined);
    const skill = registry.lookup("kb_search")!;
    const result = await skill.handler({ query: "什么是知识图谱", limit: 5 });

    expect(result.success).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(
      "什么是知识图谱",
      expect.objectContaining({ limit: 5 })
    );
  });

  it("calls graph search for relational queries when graphManager is available", async () => {
    const mockGraphManager = {
      graphSearch: vi.fn().mockResolvedValue([
        {
          docId: "d1",
          docName: "Test.pdf",
          chunkIndex: 0,
          content: "graph content",
          score: 0.85,
          matchType: "graph_subgraph",
          graphContext: { subgraphSize: 3 },
        },
      ]),
      onFactStored: vi.fn().mockResolvedValue(undefined),
    };
    const sessionManager = createMockSessionManager(mockGraphManager);

    createKnowledgeSkills(registry, sessionManager as any);
    const skill = registry.lookup("kb_search")!;
    const result = await skill.handler({ query: "A和B的关系是什么", limit: 5 });

    expect(result.success).toBe(true);
    expect(mockGraphManager.graphSearch).toHaveBeenCalledWith(
      "A和B的关系是什么",
      expect.objectContaining({ allowedDocIds: ["d1"] })
    );
    expect(searchSpy).toHaveBeenCalledWith(
      "A和B的关系是什么",
      expect.objectContaining({ docIds: ["d1"] })
    );
  });

  it("formats results with success message", async () => {
    createKnowledgeSkills(registry, undefined);
    const skill = registry.lookup("kb_search")!;
    const result = await skill.handler({ query: "测试查询", limit: 5 });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.message).toContain("找到");
    expect(result.data[0]).toMatchObject({
      docId: "d1",
      docName: "Test.pdf",
      content: "test content",
    });
  });

  it("returns empty-message when no results found", async () => {
    searchSpy.mockResolvedValue([]);
    createKnowledgeSkills(registry, undefined);
    const skill = registry.lookup("kb_search")!;
    const result = await skill.handler({ query: "不存在的内容", limit: 5 });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
    expect(result.message).toContain("没有找到");
  });
});

// ===== kb_ingest Skill =====
describe("kb_ingest skill", () => {
  let registry: SkillRegistry;
  let ingestSpy: any;

  beforeEach(() => {
    registry = new SkillRegistry();
    ingestSpy = vi.spyOn(KnowledgeBase.prototype, "ingest").mockResolvedValue({
      docId: "doc_123456",
      chunkCount: 3,
      totalTokens: 150,
      updated: false,
      version: 1,
    });
  });

  afterEach(() => {
    ingestSpy.mockRestore();
  });

  it("returns error when neither content nor path is provided", async () => {
    createKnowledgeSkills(registry);
    const skill = registry.lookup("kb_ingest")!;
    const result = await skill.handler({});

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain("content");
  });

  it("ingests content directly and returns success", async () => {
    createKnowledgeSkills(registry);
    const skill = registry.lookup("kb_ingest")!;
    const result = await skill.handler({
      content: "This is a test document.",
      name: "TestDoc",
      tags: ["test"],
    });

    expect(result.success).toBe(true);
    expect(ingestSpy).toHaveBeenCalledWith(
      "TestDoc",
      "This is a test document.",
      expect.objectContaining({ tags: ["test"] })
    );
    expect(result.data.docName).toBe("TestDoc");
    expect(result.data.chunkCount).toBe(3);
  });

  it("returns error for path security violation", async () => {
    createKnowledgeSkills(registry);
    const skill = registry.lookup("kb_ingest")!;
    const result = await skill.handler({
      path: "../../../etc/passwd",
      name: "bad",
    });

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain("路径安全违规");
    expect(ingestSpy).not.toHaveBeenCalled();
  });
});
