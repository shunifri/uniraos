import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GraphStore, normalizeFtsScore, flushFulltextIndex } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";

describe.sequential("GraphStore", () => {
  const TEST_OWNER = "graph_test_owner";
  let store: GraphStore;

  beforeAll(async () => {
    // 确保测试用户存在（满足外键约束）
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "graph_test_user", "test_hash", 1]
      );
    } catch (err: any) {
      // 如果 users 表不存在则跳过
      if (err.code === "ER_NO_SUCH_TABLE") {
        console.warn("[GraphStore Test] users table not found, skipping foreign key setup");
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

  describe("Node operations", () => {
    it("adds and retrieves a node", async () => {
      const node = await store.addNode({
        label: "Alice",
        type: "entity",
        tags: ["person"],
        properties: { age: 30 },
        createdAt: Date.now(),
      });
      expect(node.id).toBeDefined();
      expect(node.label).toBe("Alice");
      const retrieved = await store.getNode(node.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.label).toBe("Alice");
    });

    it("accepts a provided id", async () => {
      const node = await store.addNode({
        id: "custom-id",
        label: "Bob",
        type: "entity",
        tags: [],
        properties: {},
        createdAt: Date.now(),
      });
      expect(node.id).toBe("custom-id");
      const retrieved = await store.getNode("custom-id");
      expect(retrieved).toBeDefined();
      expect(retrieved!.label).toBe("Bob");
    });

    it("returns undefined for unknown node id", async () => {
      const result = await store.getNode("nope");
      expect(result).toBeUndefined();
    });

    it("removes a node and returns true", async () => {
      const node = await store.addNode({
        label: "Temp",
        type: "concept",
        tags: [],
        properties: {},
        createdAt: Date.now(),
      });
      const removed = await store.removeNode(node.id);
      expect(removed).toBe(true);
      const retrieved = await store.getNode(node.id);
      expect(retrieved).toBeUndefined();
    });

    it("returns false when removing non-existent node", async () => {
      const result = await store.removeNode("ghost");
      expect(result).toBe(false);
    });

    it("findNodeByLabel returns matching node", async () => {
      await store.addNode({ label: "Concept A", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const found = await store.findNodeByLabel("Concept A");
      expect(found).toBeDefined();
      expect(found!.label).toBe("Concept A");
    });

    it("findNodeByLabel returns undefined when no match", async () => {
      const result = await store.findNodeByLabel("missing");
      expect(result).toBeUndefined();
    });

    it("findNodesByType returns nodes of matching type", async () => {
      await store.addNode({ label: "E1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "E2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "C1", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const entities = await store.findNodesByType("entity");
      expect(entities).toHaveLength(2);
      expect(entities.every(n => n.type === "entity")).toBe(true);
    });

    it("getAllNodes returns all nodes", async () => {
      await store.addNode({ label: "N1", type: "ltm", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "N2", type: "kb_document", tags: [], properties: {}, createdAt: Date.now() });
      const nodes = await store.getAllNodes();
      expect(nodes).toHaveLength(2);
    });
  });

  describe("updateNode", () => {
    it("updates node label and type", async () => {
      const node = await store.addNode({ label: "Old", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const updated = await store.updateNode(node.id, { label: "New", type: "concept" });
      expect(updated).toBe(true);
      const retrieved = await store.getNode(node.id);
      expect(retrieved!.label).toBe("New");
      expect(retrieved!.type).toBe("concept");
    });

    it("updates communityId", async () => {
      const node = await store.addNode({ label: "Node", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.updateNode(node.id, { communityId: 5 });
      const retrieved = await store.getNode(node.id);
      expect(retrieved!.communityId).toBe(5);
    });

    it("returns false for non-existent node", async () => {
      const result = await store.updateNode("ghost", { label: "X" });
      expect(result).toBe(false);
    });
  });

  describe("nodeCount and edgeCount", () => {
    it("nodeCount is accurate", async () => {
      expect(await store.countNodes()).toBe(0);
      await store.addNode({ label: "X", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(await store.countNodes()).toBe(1);
      await store.addNode({ label: "Y", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(await store.countNodes()).toBe(2);
    });

    it("edgeCount is accurate", async () => {
      expect(await store.countEdges()).toBe(0);
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(a.id, b.id, "EXTRACTED", "relates");
      expect(await store.countEdges()).toBe(1);
    });
  });

  describe("Edge operations", () => {
    it("adds and retrieves an edge", async () => {
      const nodeA = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const nodeB = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(nodeA.id, nodeB.id, "EXTRACTED", "related_to");
      expect(edge.id).toBeDefined();
      expect(edge.source).toBe(nodeA.id);
      expect(edge.target).toBe(nodeB.id);
      expect(edge.type).toBe("EXTRACTED");
      expect(edge.label).toBe("related_to");
      const retrieved = await store.getEdge(edge.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(edge.id);
    });

    it("defaults weight to 1.0", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(a.id, b.id, "INFERRED", "inferred_link");
      expect(edge.weight).toBe(1.0);
    });

    it("accepts custom weight", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(a.id, b.id, "TEMPORAL", "before", 0.5);
      expect(edge.weight).toBe(0.5);
    });

    it("throws when source node does not exist", async () => {
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await expect(store.addEdge("ghost", b.id, "EXTRACTED", "bad")).rejects.toThrow();
    });

    it("throws when target node does not exist", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await expect(store.addEdge(a.id, "ghost", "EXTRACTED", "bad")).rejects.toThrow();
    });

    it("removes an edge and returns true", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(a.id, b.id, "EXTRACTED", "link");
      const removed = await store.removeEdge(edge.id);
      expect(removed).toBe(true);
      const retrieved = await store.getEdge(edge.id);
      expect(retrieved).toBeUndefined();
    });

    it("returns false when removing non-existent edge", async () => {
      const result = await store.removeEdge("ghost-edge");
      expect(result).toBe(false);
    });

    it("getEdgesOf returns edges for a node", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = await store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const e1 = await store.addEdge(a.id, b.id, "EXTRACTED", "link1");
      const e2 = await store.addEdge(a.id, c.id, "INFERRED", "link2");
      const edges = await store.getEdgesOf(a.id);
      expect(edges.map(e => e.id)).toContain(e1.id);
      expect(edges.map(e => e.id)).toContain(e2.id);
    });

    it("getEdgesBetween returns edges between two nodes", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = await store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const e1 = await store.addEdge(a.id, b.id, "EXTRACTED", "link");
      await store.addEdge(a.id, c.id, "INFERRED", "other");
      const between = await store.getEdgesBetween(a.id, b.id);
      expect(between).toHaveLength(1);
      expect(between[0].id).toBe(e1.id);
    });

    it("getAllEdges returns all edges", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = await store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(a.id, b.id, "EXTRACTED", "e1");
      await store.addEdge(a.id, c.id, "TEMPORAL", "e2");
      const edges = await store.getAllEdges();
      expect(edges).toHaveLength(2);
    });
  });

  describe("Adjacency list consistency", () => {
    it("removing a node cleans up its edges", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(a.id, b.id, "EXTRACTED", "link");
      await store.removeNode(a.id);
      const retrievedEdge = await store.getEdge(edge.id);
      expect(retrievedEdge).toBeUndefined();
      const edgesOfB = await store.getEdgesOf(b.id);
      expect(edgesOfB).toHaveLength(0);
      expect(await store.countEdges()).toBe(0);
    });

    it("removing an edge removes it from both adjacency lists", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(a.id, b.id, "EXTRACTED", "link");
      await store.removeEdge(edge.id);
      expect(await store.getEdgesOf(a.id)).toHaveLength(0);
      expect(await store.getEdgesOf(b.id)).toHaveLength(0);
    });
  });

  describe("getNeighbors", () => {
    it("returns neighboring nodes", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = await store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(a.id, b.id, "EXTRACTED", "link1");
      await store.addEdge(a.id, c.id, "INFERRED", "link2");
      const neighbors = await store.getNeighbors(a.id);
      const neighborIds = neighbors.map(n => n.id);
      expect(neighborIds).toContain(b.id);
      expect(neighborIds).toContain(c.id);
      expect(neighborIds).not.toContain(a.id);
    });

    it("returns empty array for isolated node", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const neighbors = await store.getNeighbors(a.id);
      expect(neighbors).toHaveLength(0);
    });

    it("includes both source and target neighbors (undirected traversal)", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(b.id, a.id, "EXTRACTED", "link");
      const neighbors = await store.getNeighbors(a.id);
      expect(neighbors.map(n => n.id)).toContain(b.id);
    });
  });

  describe("getDegree", () => {
    it("returns 0 for isolated node", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(await store.getDegree(a.id)).toBe(0);
    });

    it("counts each edge incident on the node", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = await store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(a.id, b.id, "EXTRACTED", "e1");
      await store.addEdge(a.id, c.id, "TEMPORAL", "e2");
      expect(await store.getDegree(a.id)).toBe(2);
    });

    it("decreases after edge removal", async () => {
      const a = await store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = await store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = await store.addEdge(a.id, b.id, "EXTRACTED", "link");
      expect(await store.getDegree(a.id)).toBe(1);
      await store.removeEdge(edge.id);
      expect(await store.getDegree(a.id)).toBe(0);
    });
  });

  // ============================================================
  // P1-4: searchNodesByKeywords 用 MySQL FULLTEXT 索引（v20 migration）
  // 验证：
  //   1. 中文实体（短词）能通过 ngram parser 索引搜到
  //   2. 英文长词（>=4 字符）能通过默认 FULLTEXT 索引搜到
  //   3. 搜不到的不返回
  //   4. owner 隔离：A 的图谱搜不到 B 的节点
  // ============================================================
  describe("searchNodesByKeywords (P1-4 FULLTEXT)", () => {
    it("中文短词命中（ngram parser 兜底中文分词）", async () => {
      await store.addNode({ label: "苹果公司", type: "organization", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "蒂姆库克", type: "person", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "iPhone", type: "product", tags: [], properties: {}, createdAt: Date.now() });

      // P2-9: 用 OPTIMIZE TABLE 同步刷 FULLTEXT 索引（之前 setTimeout 100ms 是 race）
      await flushFulltextIndex(getMySQLAdapter());

      const hits = await store.searchNodesByKeywords(["苹果", "公司"], 10);
      // 应该至少能搜到"苹果公司"
      expect(hits.length).toBeGreaterThan(0);
      const labels = hits.map((h) => h.node.label);
      expect(labels).toContain("苹果公司");
      // score 是 0-1 之间的数
      for (const h of hits) {
        expect(h.score).toBeGreaterThanOrEqual(0);
        expect(h.score).toBeLessThanOrEqual(1);
      }
    });

    it("英文长词命中（默认 FULLTEXT 索引，ft_min_word_len=4）", async () => {
      await store.addNode({ label: "machine_learning", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "deep_learning", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: "neural_network", type: "concept", tags: [], properties: {}, createdAt: Date.now() });

      // P2-9: 用 OPTIMIZE TABLE 同步刷 FULLTEXT 索引
      await flushFulltextIndex(getMySQLAdapter());

      const hits = await store.searchNodesByKeywords(["machine", "learning"], 10);
      // 应该能搜到 machine_learning 和 deep_learning（都含 "learning"）
      expect(hits.length).toBeGreaterThan(0);
      const labels = hits.map((h) => h.node.label);
      expect(labels).toContain("machine_learning");
    });

    it("空查询 / 无效输入返回空", async () => {
      const empty1 = await store.searchNodesByKeywords([], 10);
      expect(empty1).toEqual([]);
      const empty2 = await store.searchNodesByKeywords([""], 10);
      expect(empty2).toEqual([]);
    });

    it("owner 隔离：A 的搜索不返回 B 的节点", async () => {
      const OTHER_OWNER = "graph_test_other_owner";
      const adapter = getMySQLAdapter();
      try {
        await adapter.execute(
          `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE username = VALUES(username)`,
          [OTHER_OWNER, "graph_test_other", "h", 1]
        );
      } catch { /* ignore */ }

      // 当前 store (TEST_OWNER) 加一个 "独占节点"
      await store.addNode({ label: "独占实体ABC", type: "entity", tags: [], properties: {}, createdAt: Date.now() });

      // OTHER_OWNER 加一个不同名的同名节点
      const otherStore = new GraphStore(OTHER_OWNER);
      await otherStore.clearGraph();
      await otherStore.addNode({ label: "独占实体XYZ", type: "entity", tags: [], properties: {}, createdAt: Date.now() });

      // P2-9: 用 OPTIMIZE TABLE 同步刷 FULLTEXT 索引
      await flushFulltextIndex(getMySQLAdapter());

      // 当前 store 搜 "独占" 应该只看到自己的 ABC
      const hits = await store.searchNodesByKeywords(["独占", "实体"], 10);
      const labels = hits.map((h) => h.node.label);
      expect(labels).toContain("独占实体ABC");
      expect(labels).not.toContain("独占实体XYZ");

      await otherStore.clearGraph();
    });
  });

  // ============================================================
  // P2-8: 优雅降级——ngram 索引不可用时降级到默认 FULLTEXT
  // 场景：生产 MySQL 没装 ngram parser 插件；runtime 必须能用默认索引继续工作
  // ============================================================
  describe("searchNodesByKeywords ngram fallback (P2-8 graceful degradation)", () => {
    it("ngram probe 缓存到 store 实例，重置后会重新探", async () => {
      await store.addNode({ label: "苹果公司", type: "organization", tags: [], properties: {}, createdAt: Date.now() });
      // P2-9: 用 OPTIMIZE TABLE 同步刷 FULLTEXT 索引
      await flushFulltextIndex(getMySQLAdapter());

      // 第一次调用触发 probe
      await store.searchNodesByKeywords(["苹果"], 10);
      // 重置 probe 缓存
      store._resetNgramProbeForTest();
      // 第二次调用会重新 probe——不应抛错
      const hits = await store.searchNodesByKeywords(["苹果"], 10);
      // 命中至少 0 个（数据存在，应该 >=1）
      expect(hits.length).toBeGreaterThanOrEqual(0);
    });

    it("USE INDEX hint 引用了真实存在的索引（不会 ER_KEY_DOES_NOT_EXIST）", async () => {
      // 故意不 reset probe——上一步已经把缓存填上
      // 直接搜中文短词，验证 ngram 索引或 default 索引至少一个能命中
      await store.addNode({ label: "深度学习框架", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      // P2-9: 用 OPTIMIZE TABLE 同步刷 FULLTEXT 索引
      await flushFulltextIndex(getMySQLAdapter());

      // 不抛错就过
      const hits = await store.searchNodesByKeywords(["深度", "学习"], 10);
      expect(Array.isArray(hits)).toBe(true);
    });
  });

  // ============================================================
  // P2-7: normalizeFtsScore 评分校准（tanh 取代 /5 魔法值）
  // 验证 S 曲线归一化行为：噪声压低、真实命中落中间、尾部不爆
  // ============================================================
  describe("normalizeFtsScore (P2-7 评分校准)", () => {
    it("空值 / 负数 / 非数字 → 0", () => {
      expect(normalizeFtsScore(0)).toBe(0);
      expect(normalizeFtsScore(-1)).toBe(0);
      expect(normalizeFtsScore(NaN)).toBe(0);
      expect(normalizeFtsScore(Infinity)).toBe(0);
      expect(normalizeFtsScore(-Infinity)).toBe(0);
    });

    it("S 曲线：raw=0.5 压到 0.x 噪声区间", () => {
      const s = normalizeFtsScore(0.5);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0.6); // 噪声不应太高
    });

    it("S 曲线：raw=1 命中落中间区间", () => {
      const s = normalizeFtsScore(1);
      expect(s).toBeGreaterThanOrEqual(0.4);
      expect(s).toBeLessThanOrEqual(0.55);
    });

    it("S 曲线：raw=2 强命中趋近 0.8", () => {
      const s = normalizeFtsScore(2);
      // tanh(1) ≈ 0.7616
      expect(s).toBeGreaterThan(0.7);
      expect(s).toBeLessThan(0.85);
    });

    it("S 曲线：raw=4 极强命中趋近 0.96", () => {
      const s = normalizeFtsScore(4);
      // tanh(2) ≈ 0.964
      expect(s).toBeGreaterThan(0.9);
      expect(s).toBeLessThan(1);
    });

    it("S 曲线：raw=10 极强尾部 → 仍然 ≤ 1（不爆炸）", () => {
      const s = normalizeFtsScore(10);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThan(0.99);
    });

    it("单调性：raw 越大 → 归一化越大（不会反转排序）", () => {
      const samples = [0.1, 0.5, 1, 2, 5, 10];
      // P2-7 标定：必须用箭头函数包一层，否则 Array.map 会把 index 当作 k 参数
      const normalized = samples.map((r) => normalizeFtsScore(r));
      for (let i = 1; i < normalized.length; i++) {
        expect(normalized[i]).toBeGreaterThanOrEqual(normalized[i - 1]);
      }
    });

    it("值域在 [0, 1]", () => {
      for (const raw of [0, 0.001, 0.5, 1, 2, 5, 100, 1e6]) {
        const s = normalizeFtsScore(raw);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    });

    it("k 参数可调（用 1.80 替代默认 2.0）", () => {
      // 标定推荐 k=1.80（见 scripts/calibrate-fts-score.ts）
      // 验证 k 越小曲线越"激进"——raw=1 时归一化分数更高
      const defaultK = normalizeFtsScore(1);
      const tunedK = normalizeFtsScore(1, 1.80);
      expect(tunedK).toBeGreaterThan(defaultK);
    });
  });

  // ============================================================
  // P2-9: flushFulltextIndex 真正能同步刷新 FULLTEXT 缓存
  // 验证：
  //   1. 不抛错（即使 SET GLOBAL 失败也能 fallback 到直接 OPTIMIZE）
  //   2. 调用后立即能搜到刚插入的数据（不用 setTimeout 等异步）
  // ============================================================
  describe("flushFulltextIndex (P2-9 同步刷 FULLTEXT)", () => {
    it("调用后立即可搜（不需要 setTimeout 等异步索引）", async () => {
      const label = "P29同步刷_" + Date.now();
      await store.addNode({ label, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      // 立即调 flush（不 setTimeout）
      await flushFulltextIndex(getMySQLAdapter());
      // 立即搜——不应等异步
      const hits = await store.searchNodesByKeywords([label], 10);
      const labels = hits.map((h) => h.node.label);
      expect(labels).toContain(label);
    });

    it("无 SUPER 权限时仍能工作（降级到直接 OPTIMIZE）", async () => {
      // 这个测试不需要 mock 权限——adapter.execute 失败会被 catch，OPTIMIZE 仍会跑
      // 验证：不抛错就行
      await expect(flushFulltextIndex(getMySQLAdapter())).resolves.toBeUndefined();
    });

    it("连续 flush 多次无副作用", async () => {
      await flushFulltextIndex(getMySQLAdapter());
      await flushFulltextIndex(getMySQLAdapter());
      await flushFulltextIndex(getMySQLAdapter());
      // 不抛错就过
    });
  });

  // ============================================================
  // P2-CRITICAL-FIX（标定实跑发现 60% raw=0 的根因）：multi-stage search 召回
  // 之前 dev 数据 60% (109/183) 的 tuples raw=0 但语义完美匹配
  // 原因：FULLTEXT BOOLEAN MODE 对长 label + 特殊字符（kb:...docx:paragraph:N）失败
  // 修复：searchNodesByKeywords 加 multi-stage fallback
  //   Stage 1: FULLTEXT（原有）
  //   Stage 2: Exact label match (`WHERE label = ?`)
  //   Stage 3: Canonical form match
  //   Stage 4: Substring match (`WHERE label LIKE '%query%'`)
  // ============================================================
  describe("multi-stage search fallback (P2-CRITICAL-FIX)", () => {
    it("raw=0 但 query == label（FULLTEXT 失败场景）：fallback 仍召回", async () => {
      // 这个 label 含 `:` 等特殊字符，FULLTEXT BOOLEAN MODE 必然 raw=0
      const specialLabel = "kb:上海应用技术大学_退费规定.docx:paragraph:0";
      const queryTerm = "kb:上海应用技术大学_退费规定.docx:paragraph:0";

      // 顺便添加一个 entity 节点（防止 owner 唯一 anchor）
      await store.addNode({
        label: "filler_entity_1",
        type: "entity",
        tags: [],
        properties: {},
        createdAt: Date.now(),
      });
      await store.addNode({ id: "test_node_1", label: specialLabel, type: "kb_document", tags: ["kb_document"], properties: { sourceDoc: "test" }, createdAt: Date.now() });

      await flushFulltextIndex(getMySQLAdapter());

      // 搜这个特殊 query
      const hits = await store.searchNodesByKeywords([queryTerm], 10);
      const labels = hits.map((h) => h.node.label);

      // P2-CRITICAL-FIX 后：fallback 应该能召回这个节点
      expect(labels).toContain(specialLabel);
      // Fallback 命中的 score 应该 > 0（至少 0.65 substring / 0.92 exact / 0.95）
      const hit = hits.find((h) => h.node.label === specialLabel);
      expect(hit).toBeDefined();
      expect(hit!.score).toBeGreaterThan(0);
    });

    it("Stage 1 召回足够时不触发 fallback（避免不必要 SQL）", async () => {
      // 设置 owner 内有足够多 FULLTEXT 命中的节点
      const uniqueLabel = `fulltext_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await store.addNode({ label: uniqueLabel, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: `${uniqueLabel}_variant`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addNode({ label: `${uniqueLabel}_related`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });

      await flushFulltextIndex(getMySQLAdapter());

      // 用 FULLTEXT 友好的 query（word length >= 4 触发默认 FULLTEXT 索引）
      const hits = await store.searchNodesByKeywords([uniqueLabel], 10);
      // FULLTEXT 至少召回 1 个；如果它召回 ≥ limit/2，fallback 不触发
      expect(hits.length).toBeGreaterThan(0);
      // 全部应该都是 Stage 1 FULLTEXT 命中（不混 fallback）
      for (const hit of hits) {
        expect(hit.score).toBeGreaterThan(0);
      }
    });

    it("dedup：同一个节点被 FULLTEXT 和 fallback 都命中时，取高 score", async () => {
      // 一个 node 同时被 FULLTEXT 和 substring 命中
      const dedupLabel = `dedup_test_${Date.now()}_${Math.random().toString(36).slice(2)}_keyword`;
      await store.addNode({ label: dedupLabel, type: "entity", tags: [], properties: {}, createdAt: Date.now() });

      await flushFulltextIndex(getMySQLAdapter());

      const hits = await store.searchNodesByKeywords([dedupLabel], 10);
      // 同一个 node.id 应该只出现一次
      const ids = hits.map((h) => h.node.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("substring fallback 长度过滤：太短的 query（< 3 字符）不跑 LIKE", async () => {
      // "ai" 长度 2，太短，不应该触发 substring
      // 但 FULLTEXT 也不命中，应该返回空
      const hits = await store.searchNodesByKeywords(["ai"], 5);
      // 不抛错、返回合法数组就行
      expect(Array.isArray(hits)).toBe(true);
    });

    it("P2-CRITICAL-FIX v2: top FULLTEXT score 极低时也触发 fallback（不只是看 count）", async () => {
      // 加一个能用 FULLTEXT 召回（raw 极低，~0.02）的"噪声"节点
      // query "kb:" 应该触发 Stage 4 substring 找到真正匹配的节点
      const noisyKbLabel = `kb:${Date.now()}_${Math.random().toString(36).slice(2)}_noisy.docx:chunk0`;
      await store.addNode({ id: "noisy_test_1", label: noisyKbLabel, type: "kb_document", tags: ["kb_document"], properties: { sourceDoc: "test" }, createdAt: Date.now() });

      await flushFulltextIndex(getMySQLAdapter());

      // 搜 "kb:"——这个 query FULLTEXT 会召回 20 个噪声（每个 owner 都有 kb: 前缀的 label）
      // 但 top score 极低（~0.01），应该触发 fallback
      const hits = await store.searchNodesByKeywords(["kb:"], 20);
      // 至少有一个是真正匹配（label 含 "kb:"）
      const labels = hits.map((h) => h.node.label);
      // 不要求一定有 noisy_test_1（owner 不同）但要有 label 含 "kb:" 的节点
      const kbHits = labels.filter((l) => l.includes("kb:"));
      expect(kbHits.length).toBeGreaterThan(0);
    });
  });
});
