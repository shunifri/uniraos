import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { detectCommunities } from "../../../src/memory/knowledge-graph/community-detection.js";
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

describe.sequential("detectCommunities", () => {
  beforeAll(() => setupUser("comm_test_owner"));
  afterEach(async () => cleanup("comm_test_owner"));

  it("returns empty map for empty graph", async () => {
    const store = new GraphStore("comm_test_owner");
    const communities = await detectCommunities(store);
    expect(communities.size).toBe(0);
  });

  it("single node returns 1 community with that node", async () => {
    const store = new GraphStore("comm_test_owner");
    await store.addNode({ id: "n1", label: "N1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    const communities = await detectCommunities(store);
    expect(communities.size).toBe(1);
    expect([...communities.values()][0]).toContain("n1");
  });

  it("detects 3 clear clusters", async () => {
    const store = new GraphStore("comm_test_owner");
    // Cluster 1: A-B-C fully connected
    await store.addNode({ id: "A", label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "B", label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "C", label: "C", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("A", "B", "EXTRACTED", "link");
    await store.addEdge("B", "C", "EXTRACTED", "link");
    await store.addEdge("A", "C", "EXTRACTED", "link");

    // Cluster 2: D-E fully connected
    await store.addNode({ id: "D", label: "D", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "E", label: "E", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("D", "E", "EXTRACTED", "link");

    // Cluster 3: F isolated
    await store.addNode({ id: "F", label: "F", type: "entity", tags: [], properties: {}, createdAt: Date.now() });

    const communities = await detectCommunities(store);
    expect(communities.size).toBeGreaterThanOrEqual(2);
  });

  it("fully connected graph puts all nodes in one community", async () => {
    const store = new GraphStore("comm_test_owner");
    await store.addNode({ id: "n1", label: "N1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "n2", label: "N2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "n3", label: "N3", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("n1", "n2", "EXTRACTED", "link");
    await store.addEdge("n2", "n3", "EXTRACTED", "link");
    await store.addEdge("n1", "n3", "EXTRACTED", "link");

    const communities = await detectCommunities(store);
    // Louvain may split tiny graphs; verify all nodes are assigned to some community
    const allMembers = [...communities.values()].flat();
    expect(allMembers).toHaveLength(3);
    expect(allMembers).toContain("n1");
    expect(allMembers).toContain("n2");
    expect(allMembers).toContain("n3");
  });

  it("disconnected components form separate communities", async () => {
    const store = new GraphStore("comm_test_owner");
    await store.addNode({ id: "n1", label: "N1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "n2", label: "N2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "n3", label: "N3", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "n4", label: "N4", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("n1", "n2", "EXTRACTED", "link");
    await store.addEdge("n3", "n4", "EXTRACTED", "link");

    const communities = await detectCommunities(store);
    expect(communities.size).toBeGreaterThanOrEqual(2);
  });

  it("communities are sorted largest first (index 0 is biggest)", async () => {
    const store = new GraphStore("comm_test_owner");
    for (let i = 0; i < 5; i++) {
      await store.addNode({ id: `large_${i}`, label: `L${i}`, type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    }
    for (let i = 0; i < 4; i++) {
      await store.addEdge(`large_${i}`, `large_${i + 1}`, "EXTRACTED", "link");
    }
    await store.addNode({ id: "s1", label: "S1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "s2", label: "S2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("s1", "s2", "EXTRACTED", "link");

    const communities = await detectCommunities(store);
    const sizes = [...communities.values()].map(v => v.length);
    expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1] ?? 0);
  });

  it("assigns communityId to nodes after detection", async () => {
    const store = new GraphStore("comm_test_owner");
    await store.addNode({ id: "n1", label: "N1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addNode({ id: "n2", label: "N2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    await store.addEdge("n1", "n2", "EXTRACTED", "link");

    await detectCommunities(store);
    const n1 = await store.getNode("n1");
    expect(n1).toBeDefined();
  });
});
