/**
 * KG v2 阶段 1 修复 + 字段扩展 e2e 测试
 *
 * 覆盖：
 * - v2 review §2.1: 边去重现在用 e.label 比较（v1 用的 e.relation 字段不存在）
 * - v2 review §2.2: EdgeType 字面量联合支持 PERSONAL / CONTAINS / LLM_EXTRACTED
 * - 字段扩展: GraphNode.version / importance / sourceChunkIds 落库和读回
 * - 字段扩展: GraphEdge.feedbackScore / sourceChunkId / evidence 落库和读回
 * - 统一抽取 pipeline: 幂等性（重复同 (source, target, label) 只一条边）
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";
import { extractRelationsToGraph } from "../../../src/memory/knowledge-graph/extraction-pipeline.js";
import type { LLMProvider } from "../../../src/llm/types.js";

describe.sequential("KG v2 Stage 1 — e2e", () => {
  const TEST_OWNER = "kg_v2_test_owner";
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "kg_v2_test_user", "test_hash", 1]
      );
    } catch (err: any) {
      if (err.code === "ER_NO_SUCH_TABLE") {
        console.warn("[KG v2 Test] users table not found, skipping foreign key setup");
      } else {
        throw err;
      }
    }
  });

  beforeEach(async () => {
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
  });

  afterEach(async () => {
    try {
      await store.clearGraph();
    } catch {
      // ignore
    }
  });

  // ===== 1. v2 review §2.1: 边去重用 e.label，不再读不存在的 e.relation =====
  // 这个修复在统一抽取 pipeline 中验证（见下方 "extractRelationsToGraph idempotency"）。
  // addEdge 本身不做去重（保留底层原语语义），去重是 LLM 抽取层的责任。

  // ===== 2. v2 review §2.2: EdgeType 字面量联合支持新增的 3 种 =====
  describe("EdgeType union accepts all 6 types (v2 §2.2)", () => {
    it("PERSONAL / CONTAINS / LLM_EXTRACTED edges persist correctly", async () => {
      const user = await store.addNode({ label: "user_name", type: "ltm", tags: ["personal"], properties: { value: "Alice" }, createdAt: Date.now() });
      const phone = await store.addNode({ label: "user_phone", type: "ltm", tags: ["contact"], properties: { value: "555-1234" }, createdAt: Date.now() });
      const doc = await store.addNode({ label: "kb:doc.pdf", type: "kb_document", tags: ["kb_document"], properties: {}, createdAt: Date.now() });
      const ent = await store.addNode({ label: "Alice", type: "entity", tags: [], properties: {}, createdAt: Date.now() });

      // 4 种新增的 EdgeType 都能写
      await store.addEdge(user.id, phone.id, "PERSONAL", "contact");
      await store.addEdge(doc.id, ent.id, "CONTAINS", "mentions_in_doc");
      await store.addEdge(ent.id, phone.id, "LLM_EXTRACTED", "related_to");
      await store.addEdge(user.id, ent.id, "EXTRACTED", "related_to");
      await store.addEdge(user.id, ent.id, "TEMPORAL", "shared_tags:personal");

      expect(await store.countEdges()).toBe(5);

      // 读回类型正确
      const edges = await store.getAllEdges();
      const types = new Set(edges.map((e) => e.type));
      expect(types.has("PERSONAL")).toBe(true);
      expect(types.has("CONTAINS")).toBe(true);
      expect(types.has("LLM_EXTRACTED")).toBe(true);
      expect(types.has("EXTRACTED")).toBe(true);
      expect(types.has("TEMPORAL")).toBe(true);
    });
  });

  // ===== 3. 字段扩展: GraphNode 新字段落库和读回 =====
  describe("GraphNode extended fields (version, importance, sourceChunkIds)", () => {
    it("persists and reads back version/importance/sourceChunkIds", async () => {
      const node = await store.addNode({
        label: "EntityWithMeta",
        type: "entity",
        tags: [],
        properties: {},
        createdAt: Date.now(),
        sourceChunkIds: ["chunk_abc_0", "chunk_abc_1"],
        canonicalForm: "entitywithmeta",
        version: 1,
        importance: 0.85,
        firstSeen: 1000,
        lastUpdated: 2000,
      });

      // 缓存清掉重读，确保从 DB 出来
      store.clearCache();
      const reloaded = await store.getNode(node.id);
      expect(reloaded).toBeDefined();
      expect(reloaded!.version).toBe(1);
      expect(reloaded!.importance).toBeCloseTo(0.85, 2);
      expect(reloaded!.sourceChunkIds).toEqual(["chunk_abc_0", "chunk_abc_1"]);
      expect(reloaded!.canonicalForm).toBe("entitywithmeta");
    });

    it("default values applied when fields are not provided", async () => {
      const node = await store.addNode({
        label: "BareEntity",
        type: "entity",
        tags: [],
        properties: {},
        createdAt: Date.now(),
      });

      store.clearCache();
      const reloaded = await store.getNode(node.id);
      expect(reloaded!.version).toBe(1); // 默认值
      expect(reloaded!.importance).toBeCloseTo(0.5, 2); // 默认值
      // sourceChunkIds 未提供时不应该是 undefined-array
      expect(reloaded!.sourceChunkIds).toBeUndefined();
    });
  });

  // ===== 4. 字段扩展: GraphEdge 新字段落库和读回 =====
  describe("GraphEdge extended fields (sourceChunkId, evidence, feedbackScore)", () => {
    it("persists and reads back edge metadata via addEdge options", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });

      await store.addEdge(a.id, b.id, "LLM_EXTRACTED", "related_to", 0.9, {
        sourceChunkId: "chunk_xyz_3",
        evidence: "原文片段：'A 与 B 强相关'",
        feedbackScore: 0.42,
      });

      store.clearCache();
      const edges = await store.getEdgesBetween(a.id, b.id);
      expect(edges).toHaveLength(1);
      expect(edges[0].sourceChunkId).toBe("chunk_xyz_3");
      expect(edges[0].evidence).toBe("原文片段：'A 与 B 强相关'");
      expect(edges[0].feedbackScore).toBeCloseTo(0.42, 2);
      expect(edges[0].version).toBe(1);
    });
  });

  // ===== 5. 统一抽取 pipeline: 幂等性 =====
  describe("extractRelationsToGraph idempotency", () => {
    it("running pipeline twice produces no duplicate edges", async () => {
      const fakeLLM: LLMProvider = {
        name: "fake",
        model: "fake",
        chat: async () => ({
          content: JSON.stringify({
            entities: [
              { label: "苹果公司", type: "organization", importance: 0.9 },
              { label: "蒂姆·库克", type: "person", importance: 0.85 },
              { label: "iPhone", type: "product", importance: 0.7 },
            ],
            relations: [
              { sourceLabel: "苹果公司", targetLabel: "蒂姆·库克", relation: "created_by", confidence: 0.9 },
              { sourceLabel: "苹果公司", targetLabel: "iPhone", relation: "produces", confidence: 0.85 },
            ],
          }),
          toolCalls: [],
          finishReason: "stop" as const,
        }),
      };

      const content = "苹果公司的 CEO 是蒂姆·库克。苹果公司生产 iPhone。";

      // 第一次跑
      const r1 = await extractRelationsToGraph(
        store as any,
        { docId: "doc_test_1", docName: "test.md", content, tags: [] },
        fakeLLM,
        { createDocAnchor: false, callerTag: "test" }
      );
      expect(r1.totalRelations).toBe(2);

      const nodes1 = await store.countNodes();
      const edges1 = await store.countEdges();
      expect(nodes1).toBeGreaterThan(0);
      expect(edges1).toBeGreaterThan(0);

      // 第二次跑同样的内容
      const r2 = await extractRelationsToGraph(
        store as any,
        { docId: "doc_test_1", docName: "test.md", content, tags: [] },
        fakeLLM,
        { createDocAnchor: false, callerTag: "test" }
      );
      expect(r2.totalRelations).toBe(2);

      // 关键断言：节点数和边数都没增长
      expect(await store.countNodes()).toBe(nodes1);
      expect(await store.countEdges()).toBe(edges1);
    });

    it("doc anchor + CONTAINS edges created when createDocAnchor=true", async () => {
      const fakeLLM: LLMProvider = {
        name: "fake",
        model: "fake",
        chat: async () => ({
          content: JSON.stringify({
            entities: [
              { label: "深度学习", type: "concept", importance: 0.85 },
              { label: "神经网络", type: "concept", importance: 0.8 },
            ],
            relations: [
              { sourceLabel: "深度学习", targetLabel: "神经网络", relation: "related_to", confidence: 0.9 },
            ],
          }),
          toolCalls: [],
          finishReason: "stop" as const,
        }),
      };

      await extractRelationsToGraph(
        store as any,
        { docId: "doc_anchor", docName: "ml.md", content: "深度学习和神经网络", tags: ["ml"] },
        fakeLLM,
        { createDocAnchor: true, callerTag: "test" }
      );

      // 应该有 1 个 doc anchor + 2 个 entity = 3 个节点
      const nodes = await store.getAllNodes();
      const docAnchor = nodes.find((n) => n.type === "kb_document");
      expect(docAnchor).toBeDefined();
      expect(docAnchor!.label).toBe("ml.md");

      // 应该至少有 1 个 LLM_EXTRACTED + 2 个 CONTAINS = 3 条边
      const edges = await store.getAllEdges();
      const llmEdges = edges.filter((e) => e.type === "LLM_EXTRACTED");
      const containsEdges = edges.filter((e) => e.type === "CONTAINS");
      expect(llmEdges).toHaveLength(1);
      expect(containsEdges).toHaveLength(2);
    });
  });
});
