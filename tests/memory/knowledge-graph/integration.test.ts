import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeGraphManager } from "../../../src/memory/knowledge-graph/manager.js";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { extractSubgraph, findShortestPath } from "../../../src/memory/knowledge-graph/bfs-extractor.js";
import { detectCommunities } from "../../../src/memory/knowledge-graph/community-detection.js";
import { identifyGodNodes, scoreSurprise } from "../../../src/memory/knowledge-graph/scoring.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("Knowledge Graph Integration", () => {
  let manager: KnowledgeGraphManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-integration-"));
    manager = new KnowledgeGraphManager(path.join(tmpDir, "graph.json"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("end-to-end: store facts → build graph → query → find path", async () => {
    // 1. Store related facts (simulating ltm_store calls)
    await manager.onFactStored({ id: "1", key: "user_name", value: "Alice", tags: ["user", "identity"] });
    await manager.onFactStored({ id: "2", key: "user_preference", value: "dark mode", tags: ["user", "ui"] });
    await manager.onFactStored({ id: "3", key: "ui_theme", value: "custom dark", tags: ["ui", "theme"] });
    await manager.onFactStored({ id: "4", key: "project_frontend", value: "React app", tags: ["project", "ui"] });

    // 2. Verify graph was built
    const stats = manager.getStats();
    expect(stats.nodeCount).toBe(4);
    expect(stats.edgeCount).toBeGreaterThan(0); // Tag overlaps create edges

    // 3. Query for "user" should find user-related nodes
    const result = manager.querySubgraph("user");
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.some(n => n.label === "user_name")).toBe(true);

    // 4. Find path from user_name to ui_theme (connected via shared tags)
    const pathResult = manager.getPath("user_name", "ui_theme");
    expect(pathResult).not.toBeNull();
    expect(pathResult!.path.length).toBeGreaterThanOrEqual(2);
  });

  it("community detection groups related facts", async () => {
    // Group A: auth-related
    await manager.onFactStored({ id: "a1", key: "auth_method", value: "JWT", tags: ["auth", "security"] });
    await manager.onFactStored({ id: "a2", key: "auth_secret", value: "***", tags: ["auth", "security"] });
    await manager.onFactStored({ id: "a3", key: "auth_expiry", value: "1h", tags: ["auth"] });

    // Group B: db-related
    await manager.onFactStored({ id: "b1", key: "db_host", value: "localhost", tags: ["database", "config"] });
    await manager.onFactStored({ id: "b2", key: "db_port", value: "5432", tags: ["database", "config"] });
    await manager.onFactStored({ id: "b3", key: "db_name", value: "raos", tags: ["database"] });

    const { communities, stats } = manager.getCommunities();
    expect(stats.count).toBeGreaterThanOrEqual(2); // At least 2 clusters
  });

  it("god nodes identify highly connected concepts", async () => {
    // Create a hub node connected to many others
    await manager.onFactStored({ id: "hub", key: "core_config", value: "main", tags: ["a", "b", "c", "d", "e"] });
    await manager.onFactStored({ id: "1", key: "setting_a", value: "v", tags: ["a"] });
    await manager.onFactStored({ id: "2", key: "setting_b", value: "v", tags: ["b"] });
    await manager.onFactStored({ id: "3", key: "setting_c", value: "v", tags: ["c"] });
    await manager.onFactStored({ id: "4", key: "setting_d", value: "v", tags: ["d"] });
    await manager.onFactStored({ id: "5", key: "setting_e", value: "v", tags: ["e"] });

    const godNodes = identifyGodNodes(manager.getStore(), 3);
    expect(godNodes[0].label).toBe("core_config");
  });

  it("surprise scoring identifies cross-community bridges", async () => {
    // Create two communities with one bridge node
    await manager.onFactStored({ id: "1", key: "auth_login", value: "v", tags: ["auth"] });
    await manager.onFactStored({ id: "2", key: "auth_session", value: "v", tags: ["auth"] });
    await manager.onFactStored({ id: "3", key: "bridge_node", value: "v", tags: ["auth", "db"] });
    await manager.onFactStored({ id: "4", key: "db_query", value: "v", tags: ["db"] });
    await manager.onFactStored({ id: "5", key: "db_pool", value: "v", tags: ["db"] });

    // Run community detection first
    manager.rebuildCommunities();

    const bridgeNode = manager.getStore().findNodeByLabel("bridge_node")!;
    const score = scoreSurprise(bridgeNode, manager.getStore());
    // Bridge node should have some surprise score
    expect(score.score).toBeGreaterThan(0);
  });

  it("syncFromLTM creates graph from existing memory", async () => {
    const ltmEntries = [
      { id: "m1", key: "memory_1", value: "hello", tags: ["greeting"] },
      { id: "m2", key: "memory_2", value: "world", tags: ["greeting", "planet"] },
      { id: "m3", key: "memory_3", value: "earth", tags: ["planet", "home"] },
    ];

    const result = await manager.syncFromLTM(ltmEntries);
    expect(result.added).toBe(3);
    expect(manager.getStore().nodeCount).toBe(3);

    // Should have edges from tag overlap
    expect(manager.getStore().edgeCount).toBeGreaterThan(0);

    // Query should work after sync
    const queryResult = manager.querySubgraph("planet");
    expect(queryResult.nodes.length).toBeGreaterThan(0);
  });

  it("graph persists across manager instances", async () => {
    const graphPath = path.join(tmpDir, "persist-test.json");
    const mgr1 = new KnowledgeGraphManager(graphPath);
    await mgr1.onFactStored({ id: "1", key: "persist_test", value: "data", tags: ["test"] });
    mgr1.getStore().save(); // Force save

    // Create new manager with same path
    const mgr2 = new KnowledgeGraphManager(graphPath);
    expect(mgr2.getStore().nodeCount).toBe(1);
    expect(mgr2.getStore().findNodeByLabel("persist_test")).toBeDefined();
  });
});
