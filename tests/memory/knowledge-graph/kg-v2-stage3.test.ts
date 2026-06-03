/**
 * KG v2 阶段 3 e2e 测试：KG-first 检索
 *
 * 覆盖：
 * - query-understanding：classify + tokenize + entity linking（含跨语言 alias）
 * - recall：seed 发现 + 子图扩展 + 路径召回
 * - chunk-expander：把 sourceChunkIds 反查为 KB chunks
 * - 端到端：seed entity → recall → expand → KB chunks
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";
import {
  understandQuery,
  tokenizeQuery,
  _clearQueryCache as clearQueryCache,
} from "../../../src/memory/knowledge-graph/query-understanding.js";
import { recall } from "../../../src/memory/knowledge-graph/recall.js";
import { expandToChunks } from "../../../src/memory/knowledge-graph/chunk-expander.js";

describe.sequential("KG v2 Stage 3 — query understanding", () => {
  it("tokenizeQuery extracts Chinese / English tokens", () => {
    const tokens = tokenizeQuery("苹果公司 和 Apple 的关系是什么");
    // 行为：连续中文字符作为一个 token，连续英文字母作为一个 token
    expect(tokens).toContain("苹果公司");
    expect(tokens).toContain("apple");
    // 关系会被"的关系是什么"整段吃下，作为单 token（这是预期的，不是 bug）
    expect(tokens.some((t) => t.includes("关系"))).toBe(true);
  });

  it("understandQuery classifies relational queries", async () => {
    const result = await understandQuery("苹果和微软的关系", null);
    expect(result.queryType).toBe("relational");
  });

  it("understandQuery classifies factual queries", async () => {
    const result = await understandQuery("什么是知识图谱", null);
    expect(result.queryType).toBe("factual");
  });

  it("understandQuery classifies discovery queries", async () => {
    const result = await understandQuery("还有什么新发现", null);
    expect(result.queryType).toBe("discovery");
  });

  it("understandQuery returns empty entities when no store", async () => {
    const result = await understandQuery("苹果公司", null);
    expect(result.entities.length).toBeGreaterThan(0); // tokens are still extracted
    expect(result.entities.every((e) => e.matchedNodeIds.length === 0)).toBe(true);
  });

  it("understandQuery links entities via store.findNodeByLabel", async () => {
    clearQueryCache();
    const adapter = getMySQLAdapter();
    const TEST_USER = "kg_v2_s3_qu_user_" + Date.now();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_USER, "s3_qu_" + Date.now(), "h", 1]
      );
    } catch (e) { /* ignore */ }
    const store = new GraphStore(TEST_USER);
    await store.clearGraph();
    try {
      // 建一个 canonical 节点
      await store.addNode({
        label: "apple_inc",
        type: "entity",
        tags: [],
        properties: {},
        createdAt: Date.now(),
        canonicalForm: "apple_inc",
        version: 1,
        importance: 0.5,
      });

      const result = await understandQuery("苹果公司 和 Apple", store as any);
      const appleEntity = result.entities.find((e) => e.canonicalForm === "apple_inc");
      expect(appleEntity).toBeDefined();
      expect(appleEntity!.matchedNodeIds.length).toBeGreaterThan(0);
    } finally {
      await store.clearGraph();
    }
  });
});

describe.sequential("KG v2 Stage 3 — recall", () => {
  const SUFFIX = "recall_" + Date.now();
  const TEST_OWNER = "kg_v2_s3_recall_" + SUFFIX;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "s3_" + SUFFIX, "h", 1]
      );
    } catch (e) { /* ignore */ }
  });

  beforeEach(async () => {
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
    clearQueryCache(); // 关键：清缓存避免污染

    // 构建一个小型 KG：
    //   Apple_inc -- created_by --> Tim_cook
    //   Apple_inc -- produces --> iPhone
    //   Tim_cook -- manages --> Apple_inc
    const apple = await store.addNode({
      label: "apple_inc", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "apple_inc", version: 1, importance: 0.8,
    });
    const tim = await store.addNode({
      label: "tim_cook", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "tim_cook", version: 1, importance: 0.7,
    });
    const iphone = await store.addNode({
      label: "iphone", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "iphone", version: 1, importance: 0.6,
    });
    await store.addEdge(apple.id, tim.id, "EXTRACTED", "created_by");
    await store.addEdge(apple.id, iphone.id, "EXTRACTED", "produces");
    await store.addEdge(tim.id, apple.id, "EXTRACTED", "manages");
  });

  afterEach(async () => {
    try { await store.clearGraph(); } catch { /* ignore */ }
  });

  it("recall finds seed entities for matching query", async () => {
    const understanding = await understandQuery("苹果公司", store as any);
    const result = await recall(understanding, store as any, { maxDepth: 2, maxEntities: 20 });
    expect(result.seedEntities.length).toBeGreaterThan(0);
    // 应该找到 Apple_inc 节点
    const seedLabels = result.seedEntities.map((n) => n.label);
    expect(seedLabels).toContain("apple_inc");
  });

  it("recall expands to related entities via BFS", async () => {
    const understanding = await understandQuery("苹果公司", store as any);
    const result = await recall(understanding, store as any, { maxDepth: 2, maxEntities: 20 });
    // 1-hop 应该有 tim_cook 和 iphone
    const relatedLabels = result.relatedEntities.map((n) => n.label);
    expect(relatedLabels.length).toBeGreaterThan(0);
  });

  it("recall finds path between two entities (relational query)", async () => {
    // 阶段 3 的 tokenizer 不做中文分词，需要英文标签或带空格的查询
    const understanding = await understandQuery("apple_inc tim_cook relation", store as any);
    understanding.queryType = "relational";
    const result = await recall(understanding, store as any, {
      maxDepth: 2,
      includePaths: true,
    });
    // 至少应该召回两个 seed
    expect(result.seedEntities.length).toBeGreaterThanOrEqual(2);
    // 路径应该被找到（apple -> tim 直接边）
    expect(result.paths.length).toBeGreaterThan(0);
  });

  it("recall with no matching entities returns empty", async () => {
    const understanding = await understandQuery("完全不相关的词xyz", store as any);
    const result = await recall(understanding, store as any);
    expect(result.seedEntities.length).toBe(0);
  });
});

describe.sequential("KG v2 Stage 3 — chunk expander (KG → KB)", () => {
  const SUFFIX = "expand_" + Date.now();
  const TEST_OWNER = "kg_v2_s3_expand_" + SUFFIX;
  const TEST_DOC_ID = "doc_s3_" + SUFFIX;
  const TEST_DOC_NAME = `s3_${SUFFIX}.md`;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "s3_" + SUFFIX, "h", 1]
      );
      // 创建文档
      await adapter.execute(
        `INSERT INTO kb_documents (doc_id, name, source, owner_id, chunk_count, total_tokens, ingested_at, content_hash)
         VALUES (?, ?, '', ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [TEST_DOC_ID, TEST_DOC_NAME, TEST_OWNER, 2, 100, Date.now(), "hash_" + SUFFIX]
      );
      // 创建 chunks
      await adapter.execute(
        `INSERT INTO kb_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE content = VALUES(content)`,
        [TEST_DOC_ID, 0, "苹果公司的 CEO 是蒂姆·库克。"]
      );
      await adapter.execute(
        `INSERT INTO kb_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE content = VALUES(content)`,
        [TEST_DOC_ID, 1, "苹果公司生产 iPhone 手机。"]
      );
    } catch (e) { /* ignore */ }
  });

  beforeEach(async () => {
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
  });

  afterEach(async () => {
    try { await store.clearGraph(); } catch { /* ignore */ }
  });

  afterAll(async () => {
    // 清理测试数据
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(`DELETE FROM kb_chunks WHERE doc_id = ?`, [TEST_DOC_ID]);
      await adapter.execute(`DELETE FROM kb_documents WHERE doc_id = ?`, [TEST_DOC_ID]);
    } catch { /* ignore */ }
  });

  it("expandToChunks resolves sourceChunkIds to KB chunks", async () => {
    // 创建一个 entity 节点，带 sourceChunkIds 指向真实 KB chunks
    const entity = await store.addNode({
      label: "tim_cook",
      type: "entity",
      tags: [],
      properties: {},
      createdAt: Date.now(),
      canonicalForm: "tim_cook",
      version: 1,
      importance: 0.7,
      sourceChunkIds: [`${TEST_DOC_ID}_chunk_0`],
    });

    const expanded = await expandToChunks([entity], { maxChunks: 10 });
    expect(expanded.length).toBe(1);
    expect(expanded[0].docId).toBe(TEST_DOC_ID);
    expect(expanded[0].chunkIndex).toBe(0);
    expect(expanded[0].content).toContain("蒂姆·库克");
    expect(expanded[0].graphSignal.relatedEntities.length).toBe(1);
  });

  it("expandToChunks dedupes by (docId, chunkIndex)", async () => {
    // 两个 entity 都引用同一个 chunk
    const a = await store.addNode({
      label: "苹果", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), sourceChunkIds: [`${TEST_DOC_ID}_chunk_1`],
    });
    const b = await store.addNode({
      label: "iphone", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), sourceChunkIds: [`${TEST_DOC_ID}_chunk_1`],
    });

    const expanded = await expandToChunks([a, b]);
    expect(expanded.length).toBe(1); // 去重
    expect(expanded[0].graphSignal.relatedEntities.length).toBe(2);
  });

  it("expandToChunks returns empty for entities with no sourceChunkIds", async () => {
    const entity = await store.addNode({
      label: "no_source", type: "entity", tags: [], properties: {},
      createdAt: Date.now(),
    });
    const expanded = await expandToChunks([entity]);
    expect(expanded.length).toBe(0);
  });
});
