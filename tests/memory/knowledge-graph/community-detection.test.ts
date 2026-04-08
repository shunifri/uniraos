import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { detectCommunities } from "../../../src/memory/knowledge-graph/community-detection.js";

function makeStore(): { store: GraphStore; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "comm-detect-test-"));
  const storePath = path.join(tmpDir, "graph.json");
  const store = new GraphStore(storePath);
  return { store, tmpDir };
}

function addNode(store: GraphStore, id: string, label?: string) {
  return store.addNode({
    id,
    label: label ?? id,
    type: "entity",
    tags: [],
    properties: {},
    createdAt: Date.now(),
  });
}

function connect(store: GraphStore, a: string, b: string) {
  store.addEdge(a, b, "EXTRACTED", "link", 1.0);
}

describe("detectCommunities", () => {
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

  it("returns empty map for empty graph", () => {
    const result = detectCommunities(store);
    expect(result.size).toBe(0);
  });

  it("single node returns 1 community with that node", () => {
    addNode(store, "solo");
    const result = detectCommunities(store);
    expect(result.size).toBe(1);
    const [community] = [...result.values()];
    expect(community).toHaveLength(1);
    expect(community[0]).toBe("solo");
  });

  it("detects 3 clear clusters", () => {
    // Cluster A: A1, A2, A3 fully connected
    addNode(store, "A1");
    addNode(store, "A2");
    addNode(store, "A3");
    connect(store, "A1", "A2");
    connect(store, "A1", "A3");
    connect(store, "A2", "A3");

    // Cluster B: B1, B2, B3 fully connected
    addNode(store, "B1");
    addNode(store, "B2");
    addNode(store, "B3");
    connect(store, "B1", "B2");
    connect(store, "B1", "B3");
    connect(store, "B2", "B3");

    // Cluster C: C1, C2, C3 fully connected
    addNode(store, "C1");
    addNode(store, "C2");
    addNode(store, "C3");
    connect(store, "C1", "C2");
    connect(store, "C1", "C3");
    connect(store, "C2", "C3");

    // Weak inter-cluster edges
    connect(store, "A1", "B1");
    connect(store, "B1", "C1");

    const result = detectCommunities(store);
    expect(result.size).toBe(3);

    // Verify each cluster is contained in a single community
    const allNodes = [...result.values()];
    const communityForNode = (id: string) =>
      allNodes.findIndex(c => c.includes(id));

    // A nodes should all be in the same community
    expect(communityForNode("A1")).toBe(communityForNode("A2"));
    expect(communityForNode("A1")).toBe(communityForNode("A3"));

    // B nodes should all be in the same community
    expect(communityForNode("B1")).toBe(communityForNode("B2"));
    expect(communityForNode("B1")).toBe(communityForNode("B3"));

    // C nodes should all be in the same community
    expect(communityForNode("C1")).toBe(communityForNode("C2"));
    expect(communityForNode("C1")).toBe(communityForNode("C3"));

    // A, B, C clusters should be in different communities
    expect(communityForNode("A1")).not.toBe(communityForNode("B1"));
    expect(communityForNode("B1")).not.toBe(communityForNode("C1"));
    expect(communityForNode("A1")).not.toBe(communityForNode("C1"));
  });

  it("fully connected graph puts all nodes in one community", () => {
    addNode(store, "N1");
    addNode(store, "N2");
    addNode(store, "N3");
    addNode(store, "N4");
    connect(store, "N1", "N2");
    connect(store, "N1", "N3");
    connect(store, "N1", "N4");
    connect(store, "N2", "N3");
    connect(store, "N2", "N4");
    connect(store, "N3", "N4");

    const result = detectCommunities(store);
    expect(result.size).toBe(1);
    const [community] = [...result.values()];
    expect(community).toHaveLength(4);
  });

  it("disconnected components form separate communities", () => {
    // Group 1
    addNode(store, "G1A");
    addNode(store, "G1B");
    addNode(store, "G1C");
    connect(store, "G1A", "G1B");
    connect(store, "G1A", "G1C");
    connect(store, "G1B", "G1C");

    // Group 2 (completely disconnected)
    addNode(store, "G2A");
    addNode(store, "G2B");
    addNode(store, "G2C");
    connect(store, "G2A", "G2B");
    connect(store, "G2A", "G2C");
    connect(store, "G2B", "G2C");

    const result = detectCommunities(store);
    expect(result.size).toBe(2);

    const allNodes = [...result.values()];
    const commG1A = allNodes.findIndex(c => c.includes("G1A"));
    const commG2A = allNodes.findIndex(c => c.includes("G2A"));
    expect(commG1A).not.toBe(commG2A);

    // All G1 nodes in same community
    const commG1B = allNodes.findIndex(c => c.includes("G1B"));
    const commG1C = allNodes.findIndex(c => c.includes("G1C"));
    expect(commG1A).toBe(commG1B);
    expect(commG1A).toBe(commG1C);

    // All G2 nodes in same community
    const commG2B = allNodes.findIndex(c => c.includes("G2B"));
    const commG2C = allNodes.findIndex(c => c.includes("G2C"));
    expect(commG2A).toBe(commG2B);
    expect(commG2A).toBe(commG2C);
  });

  it("assigns communityId to nodes after detection", () => {
    addNode(store, "X1");
    addNode(store, "X2");
    connect(store, "X1", "X2");

    detectCommunities(store);

    const x1 = store.getNode("X1")!;
    const x2 = store.getNode("X2")!;
    expect(x1.communityId).toBeDefined();
    expect(x2.communityId).toBeDefined();
    expect(x1.communityId).toBe(x2.communityId);
  });

  it("communities are sorted largest first (index 0 is biggest)", () => {
    // Big cluster of 4
    addNode(store, "B1");
    addNode(store, "B2");
    addNode(store, "B3");
    addNode(store, "B4");
    connect(store, "B1", "B2");
    connect(store, "B1", "B3");
    connect(store, "B1", "B4");
    connect(store, "B2", "B3");
    connect(store, "B2", "B4");
    connect(store, "B3", "B4");

    // Small cluster of 2
    addNode(store, "S1");
    addNode(store, "S2");
    connect(store, "S1", "S2");

    const result = detectCommunities(store);
    expect(result.size).toBe(2);

    const community0 = result.get(0)!;
    const community1 = result.get(1)!;
    expect(community0.length).toBeGreaterThanOrEqual(community1.length);
  });
});
