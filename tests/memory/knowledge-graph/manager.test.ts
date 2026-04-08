import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeGraphManager } from "../../../src/memory/knowledge-graph/manager.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("KnowledgeGraphManager", () => {
  let manager: KnowledgeGraphManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-mgr-"));
    manager = new KnowledgeGraphManager(path.join(tmpDir, "graph.json"));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("should create node on onFactStored", async () => {
    await manager.onFactStored({ id: "1", key: "user_pref", value: "dark mode", tags: ["preference"] });
    expect(manager.getStore().nodeCount).toBe(1);
  });

  it("should create EXTRACTED edge when relation is specified", async () => {
    await manager.onFactStored({ id: "1", key: "dark_mode", value: "enabled", tags: ["ui"] });
    await manager.onFactStored({ id: "2", key: "user_theme", value: "custom", tags: ["ui"], relation: "dark_mode" });
    expect(manager.getStore().edgeCount).toBeGreaterThan(0);
    const edges = manager.getStore().getEdgesOf("2");
    expect(edges.some(e => e.type === "EXTRACTED")).toBe(true);
  });

  it("should create TEMPORAL edges based on shared tags", async () => {
    await manager.onFactStored({ id: "1", key: "fact_a", value: "a", tags: ["user", "preference"] });
    await manager.onFactStored({ id: "2", key: "fact_b", value: "b", tags: ["user", "settings"] });
    const edges = manager.getStore().getAllEdges().filter(e => e.type === "TEMPORAL");
    expect(edges.length).toBeGreaterThan(0);
  });

  it("should query subgraph via BFS", async () => {
    await manager.onFactStored({ id: "1", key: "auth_config", value: "jwt", tags: ["auth"] });
    await manager.onFactStored({ id: "2", key: "auth_middleware", value: "express", tags: ["auth"] });
    const result = manager.querySubgraph("auth");
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it("should find shortest path", async () => {
    await manager.onFactStored({ id: "1", key: "A", value: "a", tags: ["x"] });
    await manager.onFactStored({ id: "2", key: "B", value: "b", tags: ["x", "y"] });
    await manager.onFactStored({ id: "3", key: "C", value: "c", tags: ["y"] });
    const result = manager.getPath("A", "C");
    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThanOrEqual(2);
  });

  it("should return stats", async () => {
    await manager.onFactStored({ id: "1", key: "fact1", value: "v", tags: ["t1"] });
    const stats = manager.getStats();
    expect(stats.nodeCount).toBe(1);
  });

  it("should sync from LTM entries", async () => {
    const entries = [
      { id: "1", key: "mem1", value: "v1", tags: ["a"] },
      { id: "2", key: "mem2", value: "v2", tags: ["a", "b"] },
      { id: "3", key: "mem3", value: "v3", tags: ["b"] },
    ];
    const result = await manager.syncFromLTM(entries);
    expect(result.added).toBe(3);
    expect(manager.getStore().nodeCount).toBe(3);
    expect(manager.getStore().edgeCount).toBeGreaterThan(0); // tag overlaps create edges
  });
});
