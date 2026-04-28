import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
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
});
