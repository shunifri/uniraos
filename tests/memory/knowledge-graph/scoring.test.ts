import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { identifyGodNodes, scoreSurprise } from "../../../src/memory/knowledge-graph/scoring.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";

async function setupUser(owner: string) {
  const adapter = getMySQLAdapter();
  try {
    await adapter.execute(
      `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE username = VALUES(username)`,
      [owner, `${owner}_user`, "test_hash", 1]
    );
  } catch (err: any) {
    if (err.code !== "ER_NO_SUCH_TABLE") throw err;
  }
}

async function cleanup(owner: string) {
  try {
    const store = new GraphStore(owner);
    await store.clearGraph();
  } catch { /* ignore */ }
}

describe.sequential("identifyGodNodes", () => {
  const OWNER = "score_god_owner";

  beforeAll(() => setupUser(OWNER));
  afterEach(() => cleanup(OWNER));

  it("returns empty array for empty graph", async () => {
    const store = new GraphStore(OWNER);
    const result = await identifyGodNodes(store, 5);
    expect(result).toEqual([]);
  });

  it("returns top-N nodes by degree", async () => {
    const store = new GraphStore(OWNER);
    const hub = await store.addNode({ id: "hub", label: "Hub", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    for (let i = 0; i < 5; i++) {
      const n = await store.addNode({ id: `n${i}`, label: `N${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(hub.id, n.id, "EXTRACTED", "link");
    }
    const gods = await identifyGodNodes(store, 3);
    expect(gods.length).toBe(1);
    expect(gods[0].id).toBe("hub");
  });

  it("highest-degree node is first", async () => {
    const store = new GraphStore(OWNER);
    await store.addNode({ id: "a", label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "b", label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "c", label: "C", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("a", "b", "EXTRACTED", "link");
    await store.addEdge("a", "c", "EXTRACTED", "link");

    const gods = await identifyGodNodes(store, 3);
    expect(gods[0].id).toBe("a");
  });

  it("respects topN limit", async () => {
    const store = new GraphStore(OWNER);
    for (let i = 0; i < 10; i++) {
      await store.addNode({ id: `n${i}`, label: `N${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    }
    const gods = await identifyGodNodes(store, 3);
    expect(gods.length).toBeLessThanOrEqual(3);
  });

  it("returns all nodes if fewer than topN", async () => {
    const store = new GraphStore(OWNER);
    await store.addNode({ id: "a", label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "b", label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const gods = await identifyGodNodes(store, 10);
    expect(gods.length).toBe(2);
  });
});

describe.sequential("scoreSurprise", () => {
  const OWNER = "score_surprise_owner";

  beforeAll(() => setupUser(OWNER));
  afterEach(() => cleanup(OWNER));

  it("returns score 0 with no reasons for isolated node", async () => {
    const store = new GraphStore(OWNER);
    const node = await store.addNode({ id: "iso", label: "Iso", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const { score, reasons } = await scoreSurprise(node, store);
    expect(score).toBe(0);
    expect(reasons).toHaveLength(0);
  });

  it("cross-type connections adds to score", async () => {
    const store = new GraphStore(OWNER);
    const center = await store.addNode({ id: "center", label: "Center", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const e1 = await store.addNode({ id: "e1", label: "E1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const e2 = await store.addNode({ id: "e2", label: "E2", type: "ltm", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge(center.id, e1.id, "EXTRACTED", "link");
    await store.addEdge(center.id, e2.id, "EXTRACTED", "link");

    const { score, reasons } = await scoreSurprise(center, store);
    expect(score).toBeGreaterThanOrEqual(1.0);
    expect(reasons.some(r => r.includes("different types"))).toBe(true);
  });

  it("no cross-type bonus when all neighbors are same type", async () => {
    const store = new GraphStore(OWNER);
    const center = await store.addNode({ id: "center", label: "Center", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const e1 = await store.addNode({ id: "e1", label: "E1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const e2 = await store.addNode({ id: "e2", label: "E2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge(center.id, e1.id, "EXTRACTED", "link");
    await store.addEdge(center.id, e2.id, "EXTRACTED", "link");

    const { reasons } = await scoreSurprise(center, store);
    expect(reasons.some(r => r.includes("different types"))).toBe(false);
  });

  it("peripheral-to-hub bonus when low-degree node connects to high-degree node", async () => {
    const store = new GraphStore(OWNER);
    const hub = await store.addNode({ id: "hub", label: "Hub", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    for (let i = 0; i < 5; i++) {
      const n = await store.addNode({ id: `peer${i}`, label: `P${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(hub.id, n.id, "EXTRACTED", "link");
    }
    const peripheral = await store.addNode({ id: "peri", label: "Peri", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge(peripheral.id, hub.id, "EXTRACTED", "link");

    const { score, reasons } = await scoreSurprise(peripheral, store);
    expect(score).toBeGreaterThanOrEqual(2.0);
    expect(reasons.some(r => r.includes("peripheral connected to hub"))).toBe(true);
  });

  it("no peripheral-to-hub bonus when node has high degree itself", async () => {
    const store = new GraphStore(OWNER);
    const hub = await store.addNode({ id: "hub", label: "Hub", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const bigNode = await store.addNode({ id: "big", label: "Big", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    for (let i = 0; i < 5; i++) {
      const n = await store.addNode({ id: `extra${i}`, label: `X${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      await store.addEdge(bigNode.id, n.id, "EXTRACTED", "link");
    }
    await store.addEdge(bigNode.id, hub.id, "EXTRACTED", "link");

    const { reasons } = await scoreSurprise(bigNode, store);
    expect(reasons.some(r => r.includes("peripheral connected to hub"))).toBe(false);
  });

  it("inferred edge bonus for INFERRED type edges", async () => {
    const store = new GraphStore(OWNER);
    const node = await store.addNode({ id: "n1", label: "N1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const n2 = await store.addNode({ id: "n2", label: "N2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const n3 = await store.addNode({ id: "n3", label: "N3", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge(node.id, n2.id, "INFERRED", "link1");
    await store.addEdge(node.id, n3.id, "INFERRED", "link2");

    const { score, reasons } = await scoreSurprise(node, store);
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(reasons.some(r => r.includes("inferred connections"))).toBe(true);
  });

  it("no inferred edge bonus when all edges are EXTRACTED", async () => {
    const store = new GraphStore(OWNER);
    const node = await store.addNode({ id: "n1", label: "N1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const n2 = await store.addNode({ id: "n2", label: "N2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge(node.id, n2.id, "EXTRACTED", "link");

    const { reasons } = await scoreSurprise(node, store);
    expect(reasons.some(r => r.includes("inferred connections"))).toBe(false);
  });

  it("community bridge bonus when neighbors span multiple communities", async () => {
    const store = new GraphStore(OWNER);
    const bridge = await store.addNode({ id: "bridge", label: "Bridge", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const c1 = await store.addNode({ id: "c1", label: "C1", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 1 });
    const c2 = await store.addNode({ id: "c2", label: "C2", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 2 });
    await store.addEdge(bridge.id, c1.id, "EXTRACTED", "link");
    await store.addEdge(bridge.id, c2.id, "EXTRACTED", "link");

    const { score, reasons } = await scoreSurprise(bridge, store);
    expect(score).toBeGreaterThanOrEqual(1.5);
    expect(reasons.some(r => r.includes("bridges"))).toBe(true);
  });

  it("no community bridge bonus when neighbors are in same community", async () => {
    const store = new GraphStore(OWNER);
    const center = await store.addNode({ id: "center", label: "Center", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const c1 = await store.addNode({ id: "c1", label: "C1", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 1 });
    const c2 = await store.addNode({ id: "c2", label: "C2", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 1 });
    await store.addEdge(center.id, c1.id, "EXTRACTED", "link");
    await store.addEdge(center.id, c2.id, "EXTRACTED", "link");

    const { reasons } = await scoreSurprise(center, store);
    expect(reasons.some(r => r.includes("bridges"))).toBe(false);
  });

  it("score accumulates multiple bonuses", async () => {
    const store = new GraphStore(OWNER);
    const center = await store.addNode({ id: "center", label: "Center", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
    const e1 = await store.addNode({ id: "e1", label: "E1", type: "entity", tags: [], properties: {}, createdAt: Date.now(), communityId: 1 });
    const e2 = await store.addNode({ id: "e2", label: "E2", type: "ltm", tags: [], properties: {}, createdAt: Date.now(), communityId: 2 });
    await store.addEdge(center.id, e1.id, "INFERRED", "link1");
    await store.addEdge(center.id, e2.id, "INFERRED", "link2");

    const { score, reasons } = await scoreSurprise(center, store);
    expect(score).toBeGreaterThanOrEqual(1.3);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });
});
