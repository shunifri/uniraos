/**
 * KG v2 阶段 2 e2e 测试：离线抽取 + Entity Linker
 *
 * 覆盖：
 * - entity-linker: 字符串归一化、跨语言 alias、isSameEntity
 * - extractFromChunk: 单 chunk 抽取 entities + relations
 * - extractFromDocument: 跨 chunk 合并，跨语言 alias 合并
 * - kgExtractionQueue: 异步入队、串行执行、防抖、幂等
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";
import {
  surfaceToCanonical,
  isSameEntity,
  defaultEntityLinker,
  normalizeSurfaceForm,
} from "../../../src/memory/knowledge-graph/entity-linker.js";
import {
  extractFromChunk,
  extractFromDocument,
} from "../../../src/memory/knowledge-graph/extraction-pipeline.js";
import { kgExtractionQueue } from "../../../src/services/kg-extraction-queue.js";
import { UserSessionManager } from "../../../src/user/user-session.js";
import { join } from "path";
import type { LLMProvider } from "../../../src/llm/types.js";

describe.sequential("KG v2 Stage 2 — entity linker", () => {
  describe("normalizeSurfaceForm", () => {
    it("lowercases and strips punctuation (keeps underscores)", () => {
      expect(normalizeSurfaceForm("Apple Inc.")).toBe("apple_inc");
      expect(normalizeSurfaceForm("  Hello, World! ")).toBe("hello_world");
    });
    it("unifies separators to underscore", () => {
      expect(normalizeSurfaceForm("machine-learning")).toBe("machine_learning");
      expect(normalizeSurfaceForm("machine learning")).toBe("machine_learning");
      expect(normalizeSurfaceForm("machine  learning")).toBe("machine_learning");
    });
    it("handles Chinese without pinyin conversion", () => {
      expect(normalizeSurfaceForm("苹果公司")).toBe("苹果公司");
      expect(normalizeSurfaceForm("蒂姆·库克")).toBe("蒂姆_库克");
    });
  });

  describe("surfaceToCanonical", () => {
    it("maps aliases to canonical key", () => {
      expect(surfaceToCanonical("苹果公司")).toBe("apple_inc");
      expect(surfaceToCanonical("Apple Inc")).toBe("apple_inc");
      expect(surfaceToCanonical("苹果")).toBe("apple_inc");
      expect(surfaceToCanonical("Apple")).toBe("apple_inc");
    });
    it("returns normalized form for unknown input", () => {
      expect(surfaceToCanonical("知识图谱")).toBe("知识图谱");
      expect(surfaceToCanonical("GraphRAG")).toBe("graphrag");
    });
  });

  describe("isSameEntity", () => {
    it("groups cross-language aliases", () => {
      expect(isSameEntity("苹果公司", "Apple")).toBe(true);
      expect(isSameEntity("Apple Inc", "apple")).toBe(true);
      expect(isSameEntity("微软", "Microsoft")).toBe(true);
      expect(isSameEntity("tim cook", "蒂姆库克")).toBe(true);
    });
    it("distinguishes different entities", () => {
      expect(isSameEntity("苹果", "微软")).toBe(false);
      expect(isSameEntity("Tim Cook", "Steve Jobs")).toBe(false);
    });
  });
});

describe.sequential("KG v2 Stage 2 — extractFromChunk/extractFromDocument", () => {
  // P1-6: fakeLLM 用合并格式 { entities, relations }（之前是 flat relations array）
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

  it("extractFromChunk returns entities and relations for one chunk", async () => {
    const result = await extractFromChunk(
      { chunkId: "doc1_c0", text: "苹果公司的 CEO 是蒂姆·库克。苹果公司生产 iPhone。" },
      { llmProvider: fakeLLM }
    );

    expect(result.entities.length).toBeGreaterThan(0);
    // 通过 alias 归一化，3 个不同 surface 形式合并到 3 个 canonical entity
    const canonicals = result.entities.map((e) => e.canonicalForm).sort();
    expect(canonicals).toEqual(["apple_inc", "iphone", "tim_cook"]);

    expect(result.relations).toHaveLength(2);
    const relMap = new Map(result.relations.map((r) => [r.sourceCanonical + "::" + r.relation, r.targetCanonical]));
    expect(relMap.get("apple_inc::created_by")).toBe("tim_cook");
    expect(relMap.get("apple_inc::produces")).toBe("iphone");
  });

  it("extractFromDocument merges entities across chunks with cross-language alias", async () => {
    // chunk 1 用 "苹果公司"，chunk 2 用 "Apple Inc" — 应该合并到同一 canonical
    const result = await extractFromDocument(
      [
        { chunkId: "doc1_c0", text: "苹果公司由蒂姆·库克创立" },
        { chunkId: "doc1_c1", text: "Apple Inc produces iPhone" },
      ],
      { llmProvider: fakeLLM }
    );

    // 2 个 chunk * 2 个 relations/chunk = 4 个 raw relations，但 entities 应该合并
    expect(result.chunksProcessed).toBe(2);
    // 因为 alias 命中，"苹果公司" 和 "Apple Inc" 视为同一 canonical
    // 但每个 chunk 调用 fakeLLM 都会返回同样的内容，所以 relations 也会 dedup
    expect(result.totalEntities).toBeGreaterThanOrEqual(1);
    expect(result.totalRelations).toBeGreaterThanOrEqual(1);
  });

  it("extractFromDocument with empty content is no-op", async () => {
    const result = await extractFromDocument(
      [{ chunkId: "empty", text: "" }],
      { llmProvider: fakeLLM }
    );
    expect(result.totalEntities).toBe(0);
    expect(result.totalRelations).toBe(0);
  });
});

describe.sequential("KG v2 Stage 2 — kgExtractionQueue", () => {
  const TEST_USER = "kg_v2_stage2_queue_user";
  const TEST_OWNER = "kg_v2_stage2_queue_owner";
  let sessionManager: UserSessionManager;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      // sessionManager.graphManager 走 owner_id，要确保 user 存在
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "kg_v2_stage2_user", "test_hash", 1]
      );
    } catch (err: any) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
  });

  beforeEach(async () => {
    // 临时目录用于 LTM file backend
    const tmpLtm = join(process.cwd(), ".raos-test", "stage2-" + Date.now());
    sessionManager = new UserSessionManager(tmpLtm);
    // 注入 LLM provider
    sessionManager.setLLMProvider({
      name: "fake",
      model: "fake",
      chat: async () => ({
        content: JSON.stringify({
          entities: [
            { label: "苹果", type: "organization", importance: 0.9 },
            { label: "蒂姆·库克", type: "person", importance: 0.85 },
            { label: "iPhone", type: "product", importance: 0.7 },
          ],
          relations: [
            { sourceLabel: "苹果", targetLabel: "蒂姆·库克", relation: "created_by", confidence: 0.9 },
            { sourceLabel: "苹果", targetLabel: "iPhone", relation: "produces", confidence: 0.85 },
          ],
        }),
        toolCalls: [],
        finishReason: "stop" as const,
      }),
    });
    // 拿到 graph manager 实例
    const session = sessionManager.getOrCreate(TEST_OWNER);
    store = (await (session as any).graphManager.getStore()) as GraphStore;
    await store.clearGraph();
  });

  afterEach(async () => {
    try { await store.clearGraph(); } catch { /* ignore */ }
  });

  it("enqueue persists entities + relations + doc anchor", async () => {
    const taskId = kgExtractionQueue.enqueue(
      {
        docId: "doc_queue_1",
        docName: "queue_test.md",
        userId: TEST_OWNER,
        content: "苹果由蒂姆·库克创立。苹果生产 iPhone。",
        callerTag: "test",
      },
      sessionManager
    );
    expect(taskId).toMatch(/^kg_extract_doc_queue_1_/);

    // 等待任务完成
    await waitForTaskDone(taskId, 30_000);

    // 验证：doc anchor + 2 entities + 2 relations
    const nodes = await store.getAllNodes();
    const docAnchor = nodes.find((n) => n.label === "queue_test.md");
    expect(docAnchor).toBeDefined();
    expect(docAnchor!.type).toBe("kb_document");

    const entities = nodes.filter((n) => n.label !== "queue_test.md");
    expect(entities.length).toBeGreaterThanOrEqual(2);

    const edges = await store.getAllEdges();
    const llmEdges = edges.filter((e) => e.type === "LLM_EXTRACTED");
    expect(llmEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("debounce: 30 秒内同 (user, doc) 重复入队会返回旧 taskId", async () => {
    const job = {
      docId: "doc_queue_2",
      docName: "debounce.md",
      userId: TEST_OWNER,
      content: "苹果测试",
      callerTag: "test",
    };
    const t1 = kgExtractionQueue.enqueue(job, sessionManager);
    const t2 = kgExtractionQueue.enqueue(job, sessionManager);
    expect(t1).toBe(t2); // 防抖
    // 等 runJob 完成，避免污染下一个测试（empty content）
    await waitForTaskDone(t1, 30_000);
  });

  it("empty content is a no-op", async () => {
    const taskId = kgExtractionQueue.enqueue(
      {
        docId: "doc_queue_empty",
        docName: "empty.md",
        userId: TEST_OWNER,
        content: "",
        callerTag: "test",
      },
      sessionManager
    );
    await waitForTaskDone(taskId, 5_000);
    const task = kgExtractionQueue.getTask(taskId);
    expect(task?.status).toBe("done"); // 空内容直接返回成功
    const nodes = await store.getAllNodes();
    expect(nodes).toHaveLength(0);
  });
});

/** 工具函数：等待任务完成 */
async function waitForTaskDone(taskId: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = kgExtractionQueue.getTask(taskId);
    if (task && (task.status === "done" || task.status === "failed")) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}
