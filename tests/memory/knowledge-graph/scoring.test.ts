import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { identifyGodNodes, scoreSurprise } from "../../../src/memory/knowledge-graph/scoring.js";

function makeStore(): { store: GraphStore; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-test-"));
  const storePath = path.join(tmpDir, "graph.json");
  const store = new GraphStore(storePath);
  return { store, tmpDir };
}

function addNode(store: GraphStore, id: string, type: "entity" | "concept" | "ltm" | "kb_document" = "entity", communityId?: number) {
  return store.addNode({
    id,
    label: id,
    type,
    tags: [],
    properties: {},
    createdAt: Date.now(),
    communityId,
  });
}

function connect(store: GraphStore, a: string, b: string, type: "EXTRACTED" | "INFERRED" | "TEMPORAL" = "EXTRACTED") {
  return store.addEdge(a, b, type, "link", 1.0);
}

describe("identifyGodNodes", () => {
  let tmpDir: string;
  let store: GraphStore;

  beforeEach(() => {
    const s = makeStore();
    store = s.store;
    tmpDir = s.tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for empty graph", () => {
    const result = identifyGodNodes(store, 5);
    expect(result).toHaveLength(0);
  });

  it("returns all nodes if fewer than topN", () => {
    addNode(store, "N1");
    addNode(store, "N2");
    const result = identifyGodNodes(store, 10);
    expect(result).toHaveLength(2);
  });

  it("returns top-N nodes by degree", () => {
    // Hub node with 4 connections
    addNode(store, "hub");
    addNode(store, "a");
    addNode(store, "b");
    addNode(store, "c");
    addNode(store, "d");
    // Peripheral node with 1 connection
    addNode(store, "leaf");

    connect(store, "hub", "a");
    connect(store, "hub", "b");
    connect(store, "hub", "c");
    connect(store, "hub", "d");
    connect(store, "leaf", "a");

    const top2 = identifyGodNodes(store, 2);
    expect(top2).toHaveLength(2);
    expect(top2[0].id).toBe("hub");
    // "a" has degree 2 (hub + leaf), should be second
    expect(top2[1].id).toBe("a");
  });

  it("respects topN limit", () => {
    for (let i = 0; i < 20; i++) addNode(store, `N${i}`);
    const result = identifyGodNodes(store, 5);
    expect(result).toHaveLength(5);
  });

  it("highest-degree node is first", () => {
    addNode(store, "big");
    addNode(store, "small");
    addNode(store, "x1");
    addNode(store, "x2");
    addNode(store, "x3");

    connect(store, "big", "x1");
    connect(store, "big", "x2");
    connect(store, "big", "x3");
    connect(store, "small", "x1");

    const gods = identifyGodNodes(store, 3);
    expect(gods[0].id).toBe("big");
  });
});

describe("scoreSurprise", () => {
  let tmpDir: string;
  let store: GraphStore;

  beforeEach(() => {
    const s = makeStore();
    store = s.store;
    tmpDir = s.tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns score 0 with no reasons for isolated node", () => {
    const node = addNode(store, "solo");
    const { score, reasons } = scoreSurprise(node, store);
    expect(score).toBe(0);
    expect(reasons).toHaveLength(0);
  });

  it("cross-type connections adds to score", () => {
    const pivot = addNode(store, "pivot", "entity");
    addNode(store, "e1", "entity");
    addNode(store, "c1", "concept");

    connect(store, "pivot", "e1");
    connect(store, "pivot", "c1");

    const { score, reasons } = scoreSurprise(pivot, store);
    // neighborTypes.size = 2, so 2 * 0.5 = 1.0
    expect(score).toBeGreaterThanOrEqual(1.0);
    expect(reasons.some(r => r.includes("different types"))).toBe(true);
  });

  it("no cross-type bonus when all neighbors are same type", () => {
    const pivot = addNode(store, "pivot", "entity");
    addNode(store, "e1", "entity");
    addNode(store, "e2", "entity");

    connect(store, "pivot", "e1");
    connect(store, "pivot", "e2");

    const { score, reasons } = scoreSurprise(pivot, store);
    expect(reasons.some(r => r.includes("different types"))).toBe(false);
    // Only the same-type connections, no cross-type bonus
    expect(score).toBe(0);
  });

  it("community bridge bonus when neighbors span multiple communities", () => {
    // Set communityId manually to simulate post-detection state
    const pivot = addNode(store, "pivot", "entity", undefined);
    const n1 = addNode(store, "n1", "entity", 0);
    const n2 = addNode(store, "n2", "entity", 1);

    connect(store, "pivot", "n1");
    connect(store, "pivot", "n2");

    // Manually set communityId on neighbors (simulating post-detectCommunities)
    n1.communityId = 0;
    n2.communityId = 1;

    const { score, reasons } = scoreSurprise(pivot, store);
    // neighborComms.size = 2, so (2-1) * 1.5 = 1.5
    expect(score).toBeGreaterThanOrEqual(1.5);
    expect(reasons.some(r => r.includes("bridges"))).toBe(true);
  });

  it("no community bridge bonus when neighbors are in same community", () => {
    const pivot = addNode(store, "pivot", "entity");
    const n1 = addNode(store, "n1", "entity", 0);
    const n2 = addNode(store, "n2", "entity", 0);

    n1.communityId = 0;
    n2.communityId = 0;

    connect(store, "pivot", "n1");
    connect(store, "pivot", "n2");

    const { score, reasons } = scoreSurprise(pivot, store);
    expect(reasons.some(r => r.includes("bridges"))).toBe(false);
  });

  it("peripheral-to-hub bonus when low-degree node connects to high-degree node", () => {
    // Create a hub with 5 connections
    addNode(store, "hub");
    addNode(store, "h1");
    addNode(store, "h2");
    addNode(store, "h3");
    addNode(store, "h4");
    addNode(store, "h5");
    connect(store, "hub", "h1");
    connect(store, "hub", "h2");
    connect(store, "hub", "h3");
    connect(store, "hub", "h4");
    connect(store, "hub", "h5");

    // Peripheral node with only 1 connection to hub
    const peripheral = addNode(store, "peripheral");
    connect(store, "peripheral", "hub");

    const { score, reasons } = scoreSurprise(peripheral, store);
    expect(score).toBeGreaterThanOrEqual(2.0);
    expect(reasons.some(r => r.includes("peripheral connected to hub"))).toBe(true);
  });

  it("no peripheral-to-hub bonus when node has high degree itself", () => {
    const bigNode = addNode(store, "bigNode");
    addNode(store, "hub");
    addNode(store, "h1");
    addNode(store, "h2");
    addNode(store, "h3");
    addNode(store, "h4");
    addNode(store, "h5");
    connect(store, "hub", "h1");
    connect(store, "hub", "h2");
    connect(store, "hub", "h3");
    connect(store, "hub", "h4");
    connect(store, "hub", "h5");

    // bigNode has degree > 3
    connect(store, "bigNode", "hub");
    connect(store, "bigNode", "h1");
    connect(store, "bigNode", "h2");
    connect(store, "bigNode", "h3");

    const { reasons } = scoreSurprise(bigNode, store);
    expect(reasons.some(r => r.includes("peripheral connected to hub"))).toBe(false);
  });

  it("inferred edge bonus for INFERRED type edges", () => {
    const node = addNode(store, "inferred_node");
    addNode(store, "target1");
    addNode(store, "target2");

    connect(store, "inferred_node", "target1", "INFERRED");
    connect(store, "inferred_node", "target2", "INFERRED");

    const { score, reasons } = scoreSurprise(node, store);
    // 2 inferred edges * 0.3 = 0.6
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(reasons.some(r => r.includes("inferred connections"))).toBe(true);
  });

  it("no inferred edge bonus when all edges are EXTRACTED", () => {
    const node = addNode(store, "node");
    addNode(store, "target");
    connect(store, "node", "target", "EXTRACTED");

    const { reasons } = scoreSurprise(node, store);
    expect(reasons.some(r => r.includes("inferred connections"))).toBe(false);
  });

  it("score accumulates multiple bonuses", () => {
    // Node that gets cross-type + inferred bonuses
    const pivot = addNode(store, "pivot", "entity");
    addNode(store, "concept_n", "concept");
    addNode(store, "entity_n", "entity");

    connect(store, "pivot", "concept_n", "INFERRED");
    connect(store, "pivot", "entity_n", "EXTRACTED");

    const { score, reasons } = scoreSurprise(pivot, store);
    // cross-type: 2 types * 0.5 = 1.0
    // inferred: 1 * 0.3 = 0.3
    expect(score).toBeGreaterThanOrEqual(1.3);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });
});
