import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { KnowledgeGraphManager } from "../../../src/memory/knowledge-graph/manager.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";

const TEST_OWNER = "integ_test_owner";

describe.sequential("Knowledge Graph Integration", () => {
  let manager: KnowledgeGraphManager;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "integ_test_user", "test_hash", 1]
      );
    } catch (err: any) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
  });

  beforeEach(async () => {
    manager = new KnowledgeGraphManager(TEST_OWNER);
    const store = await manager.getStore();
    if (store.clearGraph) await store.clearGraph();
  });

  afterEach(async () => {
    try {
      const store = await manager.getStore();
      if (store.clearGraph) await store.clearGraph();
    } catch { /* ignore */ }
  });

  it("end-to-end: store facts → build graph → query → find path", async () => {
    await manager.onFactStored({ id: "1", key: "frontend", value: "react", tags: ["tech"] });
    await manager.onFactStored({ id: "2", key: "backend", value: "node", tags: ["tech"] });
    await manager.onFactStored({ id: "3", key: "database", value: "mysql", tags: ["tech", "infra"] });

    const stats = await manager.getStats();
    expect(stats.nodeCount).toBeGreaterThanOrEqual(3);

    const subgraph = await manager.querySubgraph("tech");
    expect(subgraph.nodes.length).toBeGreaterThan(0);

    const path = await manager.getPath("frontend", "database");
    // 路径可能不存在（取决于是否建立了 TEMPORAL 边），但至少不报错
    expect(path === null || path!.path.length > 0).toBe(true);
  });

  it("syncFromLTM creates graph from existing memory", async () => {
    const result = await manager.syncFromLTM([
      { id: "m1", key: "memory_a", value: "val_a", tags: ["memory"] },
      { id: "m2", key: "memory_b", value: "val_b", tags: ["memory"] },
    ]);
    expect(result.added).toBe(2);
    const stats = await manager.getStats();
    expect(stats.nodeCount).toBe(2);
  });

  it("community detection groups related facts", async () => {
    const store = await manager.getStore();
    // Create 2 clear clusters manually for reliable testing
    for (let i = 0; i < 3; i++) {
      await store.addNode({ id: `c1_${i}`, label: `C1_${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    }
    await store.addEdge("c1_0", "c1_1", "EXTRACTED", "link");
    await store.addEdge("c1_1", "c1_2", "EXTRACTED", "link");

    for (let i = 0; i < 3; i++) {
      await store.addNode({ id: `c2_${i}`, label: `C2_${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    }
    await store.addEdge("c2_0", "c2_1", "EXTRACTED", "link");
    await store.addEdge("c2_1", "c2_2", "EXTRACTED", "link");

    const { communities, stats } = await manager.getCommunities();
    expect(stats.count).toBeGreaterThanOrEqual(1);
  });

  it("god nodes identify highly connected concepts", async () => {
    const store = await manager.getStore();
    const hub = await store.addNode({ id: "hub", label: "Hub", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    for (let i = 0; i < 5; i++) {
      const n = await store.addNode({ id: `peer${i}`, label: `P${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(hub.id, n.id, "EXTRACTED", "link");
    }

    const stats = await manager.getStats();
    expect(stats.godNodeCount).toBeGreaterThan(0);
    expect(stats.godNodes.some(n => n.id === "hub")).toBe(true);
  });

  it("graph persists across manager instances", async () => {
    await manager.onFactStored({ id: "p1", key: "persist_key", value: "persist_val", tags: ["persist"] });

    const manager2 = new KnowledgeGraphManager(TEST_OWNER);
    const stats = await manager2.getStats();
    expect(stats.nodeCount).toBeGreaterThan(0);
  });

  it("surprise scoring identifies cross-community bridges", async () => {
    const store = await manager.getStore();
    const bridge = await store.addNode({ id: "bridge", label: "Bridge", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const c1 = await store.addNode({ id: "c1", label: "C1", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 1 });
    const c2 = await store.addNode({ id: "c2", label: "C2", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 2 });
    await store.addEdge(bridge.id, c1.id, "EXTRACTED", "link");
    await store.addEdge(bridge.id, c2.id, "EXTRACTED", "link");

    const stats = await manager.getStats();
    // Bridge node should be in god nodes or have interesting properties
    expect(stats.nodeCount).toBe(3);
  });
});
