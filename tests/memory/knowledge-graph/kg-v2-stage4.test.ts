/**
 * KG v2 阶段 4 e2e 测试：反馈环路
 *
 * 覆盖：
 * - feedback-store：save / getRecentFeedback / getAcceptanceRate
 * - feedback-pipeline：applyFeedback → 边 feedbackScore + 节点 importance 调整
 * - GraphStore：updateNode（importance / version）+ updateEdge（feedbackScore）
 * - health-metrics：getGraphHealth + checkAcceptanceAlerts
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";
import {
  saveFeedback,
  getRecentFeedback,
  getAcceptanceRate,
} from "../../../src/memory/knowledge-graph/feedback-store.js";
import { applyFeedback } from "../../../src/memory/knowledge-graph/feedback-pipeline.js";
import {
  getGraphHealth,
  checkAcceptanceAlerts,
} from "../../../src/memory/knowledge-graph/health-metrics.js";

describe.sequential("KG v2 Stage 4 — feedback store", () => {
  const SUFFIX = "fbstore_" + Date.now();
  const TEST_USER = "kg_v2_s4_" + SUFFIX;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_USER, "s4_" + SUFFIX, "h", 1]
      );
    } catch (e) { /* ignore */ }
  });

  it("saveFeedback inserts and getRecentFeedback retrieves", async () => {
    const id1 = await saveFeedback({
      userId: TEST_USER,
      queryId: "q_test_1",
      query: "test query 1",
      queryType: "factual",
      accepted: true,
      rating: 5,
      timestamp: Date.now(),
    });
    expect(id1).toBeGreaterThan(0);

    const id2 = await saveFeedback({
      userId: TEST_USER,
      queryId: "q_test_2",
      query: "test query 2",
      queryType: "relational",
      accepted: false,
      rejectedEntityIds: ["ent_1", "ent_2"],
      timestamp: Date.now() + 1,
    });
    expect(id2).toBeGreaterThan(0);

    const recent = await getRecentFeedback(TEST_USER, 10);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    // 应该有刚插入的两条
    const queries = recent.map((r) => r.query);
    expect(queries).toContain("test query 1");
    expect(queries).toContain("test query 2");
  });

  it("getAcceptanceRate computes per-query-type rate", async () => {
    const rate = await getAcceptanceRate("factual", 50);
    expect(rate.total).toBeGreaterThan(0);
    expect(rate.rate).toBeGreaterThanOrEqual(0);
    expect(rate.rate).toBeLessThanOrEqual(1);
  });

  it("saveFeedback gracefully handles malformed data (no throw)", async () => {
    // 用户给空 query 应该不抛错（saveFeedback 内部 try/catch）
    const result = await saveFeedback({
      userId: TEST_USER,
      queryId: "q_broken",
      query: "broken",
      timestamp: Date.now(),
    } as any);
    // 失败时返回 -1
    expect(typeof result).toBe("number");
  });
});

describe.sequential("KG v2 Stage 4 — applyFeedback pipeline", () => {
  const SUFFIX = "fbpipe_" + Date.now();
  const TEST_OWNER = "kg_v2_s4_pipe_" + SUFFIX;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "s4p_" + SUFFIX, "h", 1]
      );
    } catch (e) { /* ignore */ }
  });

  beforeEach(async () => {
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();

    // 建一个简单的 KG：entityA -related_to-> entityB
    const a = await store.addNode({
      label: "entityA", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "entityA",
      version: 1, importance: 0.5,
    });
    const b = await store.addNode({
      label: "entityB", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "entityB",
      version: 1, importance: 0.5,
    });
    await store.addEdge(a.id, b.id, "EXTRACTED", "related_to", 0.8);
  });

  afterEach(async () => {
    try { await store.clearGraph(); } catch { /* ignore */ }
  });

  it("accepted feedback bumps edge feedbackScore", async () => {
    const a = (await store.getAllNodes()).find((n) => n.label === "entityA")!;
    const b = (await store.getAllNodes()).find((n) => n.label === "entityB")!;
    const edge = (await store.getEdgesBetween(a.id, b.id))[0];

    const before = edge.feedbackScore ?? 0;
    await applyFeedback(
      {
        userId: TEST_OWNER,
        queryId: "q_1",
        query: "test",
        queryType: "factual",
        accepted: true,
        recallSnapshot: JSON.stringify({ seedEntities: [a.id], edges: [edge.id] }),
        timestamp: Date.now(),
      },
      store as any
    );

    const reloaded = (await store.getEdgesBetween(a.id, b.id))[0];
    expect(reloaded.feedbackScore).toBeGreaterThan(before);
  });

  it("rejected feedback decreases node importance", async () => {
    const a = (await store.getAllNodes()).find((n) => n.label === "entityA")!;
    const before = a.importance ?? 0.5;

    await applyFeedback(
      {
        userId: TEST_OWNER,
        queryId: "q_2",
        query: "test",
        accepted: false,
        rejectedEntityIds: [a.id],
        recallSnapshot: JSON.stringify({ seedEntities: [a.id], edges: [] }),
        timestamp: Date.now(),
      },
      store as any
    );

    const reloaded = await store.getNode(a.id);
    expect(reloaded!.importance).toBeLessThan(before);
  });

  it("accepted feedback bumps node importance", async () => {
    const a = (await store.getAllNodes()).find((n) => n.label === "entityA")!;
    const before = a.importance ?? 0.5;

    await applyFeedback(
      {
        userId: TEST_OWNER,
        queryId: "q_3",
        query: "test",
        accepted: true,
        recallSnapshot: JSON.stringify({ seedEntities: [a.id], edges: [] }),
        timestamp: Date.now(),
      },
      store as any
    );

    const reloaded = await store.getNode(a.id);
    expect(reloaded!.importance).toBeGreaterThan(before);
  });

  it("updateEdge clamps weight and feedbackScore to safe ranges", async () => {
    const a = (await store.getAllNodes()).find((n) => n.label === "entityA")!;
    const b = (await store.getAllNodes()).find((n) => n.label === "entityB")!;
    const edge = (await store.getEdgesBetween(a.id, b.id))[0];

    // 极端的 delta
    await store.updateEdge(edge.id, { weightDelta: 100, feedbackScoreDelta: 100 });
    const reloaded = (await store.getEdgesBetween(a.id, b.id))[0];
    expect(reloaded.weight).toBeLessThanOrEqual(1.0);
    expect(reloaded.feedbackScore).toBeLessThanOrEqual(5);

    // 负向 delta
    await store.updateEdge(edge.id, { weightDelta: -100, feedbackScoreDelta: -100 });
    const reloaded2 = (await store.getEdgesBetween(a.id, b.id))[0];
    expect(reloaded2.weight).toBeGreaterThanOrEqual(0);
    expect(reloaded2.feedbackScore).toBeGreaterThanOrEqual(-5);
  });
});

describe.sequential("KG v2 Stage 4 — health metrics", () => {
  const SUFFIX = "health_" + Date.now();
  const TEST_OWNER = "kg_v2_s4_health_" + SUFFIX;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "s4h_" + SUFFIX, "h", 1]
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

  it("getGraphHealth returns full health snapshot", async () => {
    // 建 3 个节点 + 2 条边
    const a = await store.addNode({ label: "a", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const b = await store.addNode({ label: "b", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const c = await store.addNode({ label: "c", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge(a.id, b.id, "EXTRACTED", "x");
    await store.addEdge(b.id, c.id, "EXTRACTED", "y");

    const health = await getGraphHealth(TEST_OWNER);
    expect(health.nodeCount).toBe(3);
    expect(health.edgeCount).toBe(2);
    expect(health.avgDegree).toBeGreaterThan(0);
    // a 和 c 是孤立节点（度数为 1）... wait, a 连接 b，度数 1。b 连接 a 和 c，度数 2。
    // 题目里说 isolatedNodeCount = degree === 0，所以应该是 0
    expect(health.isolatedNodeCount).toBe(0);
    expect(health.communityCount).toBeGreaterThan(0);
  });

  it("getGraphHealth counts truly isolated nodes", async () => {
    // 一个孤立的，没有边
    await store.addNode({ label: "lonely", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const health = await getGraphHealth(TEST_OWNER);
    expect(health.isolatedNodeCount).toBe(1);
  });

  it("checkAcceptanceAlerts returns empty for healthy data", async () => {
    // 没有反馈数据，应当不告警
    const alerts = await checkAcceptanceAlerts(TEST_OWNER);
    expect(alerts).toHaveLength(0);
  });

  it("P1-5: getGraphHealth 暴露 tokenizer backend 字段", async () => {
    const health = await getGraphHealth(TEST_OWNER);
    expect(health.tokenizer).toBeDefined();
    expect(["nodejieba", "heuristic"]).toContain(health.tokenizer.backend);
    // 正常环境应加载 nodejieba（KG v2 阶段 6 已集成）
    // 注：测试环境下 nodejieba 应当已加载；若失败会有 note 字段提示
    if (health.tokenizer.backend === "heuristic") {
      expect(health.tokenizer.note).toBeDefined();
      expect(health.tokenizer.note!.length).toBeGreaterThan(0);
    }
  });
});
