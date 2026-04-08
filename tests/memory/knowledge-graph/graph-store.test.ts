import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";

describe("GraphStore", () => {
  let tmpDir: string;
  let storePath: string;
  let store: GraphStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-store-test-"));
    storePath = path.join(tmpDir, "graph.json");
    store = new GraphStore(storePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Node operations", () => {
    it("adds and retrieves a node", () => {
      const node = store.addNode({
        label: "Alice",
        type: "entity",
        tags: ["person"],
        properties: { age: 30 },
        createdAt: Date.now(),
      });
      expect(node.id).toBeDefined();
      expect(node.label).toBe("Alice");
      expect(store.getNode(node.id)).toEqual(node);
    });

    it("accepts a provided id", () => {
      const node = store.addNode({
        id: "custom-id",
        label: "Bob",
        type: "entity",
        tags: [],
        properties: {},
        createdAt: Date.now(),
      });
      expect(node.id).toBe("custom-id");
      expect(store.getNode("custom-id")).toEqual(node);
    });

    it("returns undefined for unknown node id", () => {
      expect(store.getNode("nope")).toBeUndefined();
    });

    it("removes a node and returns true", () => {
      const node = store.addNode({
        label: "Temp",
        type: "concept",
        tags: [],
        properties: {},
        createdAt: Date.now(),
      });
      expect(store.removeNode(node.id)).toBe(true);
      expect(store.getNode(node.id)).toBeUndefined();
    });

    it("returns false when removing non-existent node", () => {
      expect(store.removeNode("ghost")).toBe(false);
    });

    it("findNodeByLabel returns matching node", () => {
      store.addNode({ label: "Concept A", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const found = store.findNodeByLabel("Concept A");
      expect(found).toBeDefined();
      expect(found!.label).toBe("Concept A");
    });

    it("findNodeByLabel returns undefined when no match", () => {
      expect(store.findNodeByLabel("missing")).toBeUndefined();
    });

    it("findNodesByType returns nodes of matching type", () => {
      store.addNode({ label: "E1", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      store.addNode({ label: "E2", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      store.addNode({ label: "C1", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const entities = store.findNodesByType("entity");
      expect(entities).toHaveLength(2);
      expect(entities.every(n => n.type === "entity")).toBe(true);
    });

    it("getAllNodes returns all nodes", () => {
      store.addNode({ label: "N1", type: "ltm", tags: [], properties: {}, createdAt: Date.now() });
      store.addNode({ label: "N2", type: "kb_document", tags: [], properties: {}, createdAt: Date.now() });
      expect(store.getAllNodes()).toHaveLength(2);
    });
  });

  describe("nodeCount and edgeCount", () => {
    it("nodeCount is accurate", () => {
      expect(store.nodeCount).toBe(0);
      store.addNode({ label: "X", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(store.nodeCount).toBe(1);
      store.addNode({ label: "Y", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(store.nodeCount).toBe(2);
    });

    it("edgeCount is accurate", () => {
      expect(store.edgeCount).toBe(0);
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(a.id, b.id, "EXTRACTED", "relates");
      expect(store.edgeCount).toBe(1);
    });
  });

  describe("Edge operations", () => {
    let nodeA: ReturnType<GraphStore["addNode"]>;
    let nodeB: ReturnType<GraphStore["addNode"]>;

    beforeEach(() => {
      nodeA = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      nodeB = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
    });

    it("adds and retrieves an edge", () => {
      const edge = store.addEdge(nodeA.id, nodeB.id, "EXTRACTED", "related_to");
      expect(edge.id).toBeDefined();
      expect(edge.source).toBe(nodeA.id);
      expect(edge.target).toBe(nodeB.id);
      expect(edge.type).toBe("EXTRACTED");
      expect(edge.label).toBe("related_to");
      expect(store.getEdge(edge.id)).toEqual(edge);
    });

    it("defaults weight to 1.0", () => {
      const edge = store.addEdge(nodeA.id, nodeB.id, "INFERRED", "inferred_link");
      expect(edge.weight).toBe(1.0);
    });

    it("accepts custom weight", () => {
      const edge = store.addEdge(nodeA.id, nodeB.id, "TEMPORAL", "before", 0.5);
      expect(edge.weight).toBe(0.5);
    });

    it("throws when source node does not exist", () => {
      expect(() => store.addEdge("ghost", nodeB.id, "EXTRACTED", "bad")).toThrow();
    });

    it("throws when target node does not exist", () => {
      expect(() => store.addEdge(nodeA.id, "ghost", "EXTRACTED", "bad")).toThrow();
    });

    it("removes an edge and returns true", () => {
      const edge = store.addEdge(nodeA.id, nodeB.id, "EXTRACTED", "link");
      expect(store.removeEdge(edge.id)).toBe(true);
      expect(store.getEdge(edge.id)).toBeUndefined();
    });

    it("returns false when removing non-existent edge", () => {
      expect(store.removeEdge("ghost-edge")).toBe(false);
    });

    it("getEdgesOf returns edges for a node", () => {
      const e1 = store.addEdge(nodeA.id, nodeB.id, "EXTRACTED", "link1");
      const nodeC = store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      const e2 = store.addEdge(nodeA.id, nodeC.id, "INFERRED", "link2");
      const edges = store.getEdgesOf(nodeA.id);
      expect(edges.map(e => e.id)).toContain(e1.id);
      expect(edges.map(e => e.id)).toContain(e2.id);
    });

    it("getEdgesBetween returns edges between two nodes", () => {
      const e1 = store.addEdge(nodeA.id, nodeB.id, "EXTRACTED", "link");
      const nodeC = store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(nodeA.id, nodeC.id, "INFERRED", "other");
      const between = store.getEdgesBetween(nodeA.id, nodeB.id);
      expect(between).toHaveLength(1);
      expect(between[0].id).toBe(e1.id);
    });

    it("getAllEdges returns all edges", () => {
      store.addEdge(nodeA.id, nodeB.id, "EXTRACTED", "e1");
      const nodeC = store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(nodeA.id, nodeC.id, "TEMPORAL", "e2");
      expect(store.getAllEdges()).toHaveLength(2);
    });
  });

  describe("Adjacency list consistency", () => {
    it("removing a node cleans up its edges", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = store.addEdge(a.id, b.id, "EXTRACTED", "link");
      store.removeNode(a.id);
      expect(store.getEdge(edge.id)).toBeUndefined();
      expect(store.getEdgesOf(b.id)).toHaveLength(0);
      expect(store.edgeCount).toBe(0);
    });

    it("removing an edge removes it from both adjacency lists", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = store.addEdge(a.id, b.id, "EXTRACTED", "link");
      store.removeEdge(edge.id);
      expect(store.getEdgesOf(a.id)).toHaveLength(0);
      expect(store.getEdgesOf(b.id)).toHaveLength(0);
    });
  });

  describe("getNeighbors", () => {
    it("returns neighboring nodes", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(a.id, b.id, "EXTRACTED", "link1");
      store.addEdge(a.id, c.id, "INFERRED", "link2");
      const neighbors = store.getNeighbors(a.id);
      const neighborIds = neighbors.map(n => n.id);
      expect(neighborIds).toContain(b.id);
      expect(neighborIds).toContain(c.id);
      expect(neighborIds).not.toContain(a.id);
    });

    it("returns empty array for isolated node", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(store.getNeighbors(a.id)).toHaveLength(0);
    });

    it("includes both source and target neighbors (undirected traversal)", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(b.id, a.id, "EXTRACTED", "link");
      const neighbors = store.getNeighbors(a.id);
      expect(neighbors.map(n => n.id)).toContain(b.id);
    });
  });

  describe("getDegree", () => {
    it("returns 0 for isolated node", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      expect(store.getDegree(a.id)).toBe(0);
    });

    it("counts each edge incident on the node", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const c = store.addNode({ label: "C", type: "concept", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(a.id, b.id, "EXTRACTED", "e1");
      store.addEdge(a.id, c.id, "TEMPORAL", "e2");
      expect(store.getDegree(a.id)).toBe(2);
    });

    it("decreases after edge removal", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const edge = store.addEdge(a.id, b.id, "EXTRACTED", "link");
      expect(store.getDegree(a.id)).toBe(1);
      store.removeEdge(edge.id);
      expect(store.getDegree(a.id)).toBe(0);
    });
  });

  describe("Persistence", () => {
    it("save and reload preserves nodes and edges", () => {
      const a = store.addNode({ label: "Persist A", type: "entity", tags: ["x"], properties: { val: 42 }, createdAt: 1000 });
      const b = store.addNode({ label: "Persist B", type: "concept", tags: [], properties: {}, createdAt: 2000 });
      const edge = store.addEdge(a.id, b.id, "EXTRACTED", "relates", 0.8);

      store.save();

      const store2 = new GraphStore(storePath);
      expect(store2.getNode(a.id)).toEqual(a);
      expect(store2.getNode(b.id)).toEqual(b);
      expect(store2.getEdge(edge.id)).toEqual(edge);
      expect(store2.nodeCount).toBe(2);
      expect(store2.edgeCount).toBe(1);
    });

    it("reload preserves adjacency lists", () => {
      const a = store.addNode({ label: "A", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      const b = store.addNode({ label: "B", type: "entity", tags: [], properties: {}, createdAt: Date.now() });
      store.addEdge(a.id, b.id, "INFERRED", "link");
      store.save();

      const store2 = new GraphStore(storePath);
      expect(store2.getNeighbors(a.id)).toHaveLength(1);
      expect(store2.getDegree(a.id)).toBe(1);
    });

    it("starts with empty state when file does not exist", () => {
      expect(store.nodeCount).toBe(0);
      expect(store.edgeCount).toBe(0);
    });

    it("toJSON returns graph data", () => {
      const n = store.addNode({ label: "N", type: "ltm", tags: [], properties: {}, createdAt: Date.now() });
      const data = store.toJSON();
      expect(data.version).toBe(1);
      expect(data.nodes[n.id]).toBeDefined();
    });
  });
});
