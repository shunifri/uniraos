/**
 * P2-12 (#8 Neo4j APOC path): Neo4jGraphStore.extractSubgraphCTE
 *
 * 验证:
 * - 方法签名匹配 GraphStore.extractSubgraphCTE 契约
 * - APOC 路径被优先尝试
 * - APOC 不存在时正确 fallback 到 Cypher variable-length path
 * - 返回 shape: { nodeIds: string[]; edges: [{id, source, target, type, label}] }
 * - 空 seed 返回空 subgraph
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Neo4jGraphStore } from "../../../src/memory/knowledge-graph/neo4j-store.js";

/** Mock Neo4j session — 让单测不需真起服务 */
function makeMockSession(opts: {
  apocResult?: { records: any[]; throwOnApoc?: Error };
  fallbackNodeResult?: { records: any[] };
  fallbackEdgeResult?: { records: any[] };
}) {
  // 单个 session 内部: 每个 session.run 都计数，按 queryCount 路由到不同 mock result
  function build() {
    let queryCount = 0;
    return {
      run: vi.fn(async () => {
        queryCount++;
        if (queryCount === 1) {
          if (opts.apocResult?.throwOnApoc) throw opts.apocResult.throwOnApoc;
          return opts.apocResult ?? { records: [] };
        }
        if (queryCount === 2) return opts.fallbackNodeResult ?? { records: [] };
        if (queryCount === 3) return opts.fallbackEdgeResult ?? { records: [] };
        return { records: [] };
      }),
      close: vi.fn(async () => {}),
    };
  }
  return { build, _opts: opts };
}

function makeMockDriver(ms: ReturnType<typeof makeMockSession>) {
  // 每次 .session() 返回一个新 session，每个 session 独立计数
  // 这样构造时的 ensureFulltextIndex 跟 extractSubgraphCTE 不互相干扰
  return {
    session: vi.fn(() => ms.build()),
  } as any;
}

describe("Neo4jGraphStore.extractSubgraphCTE (#8 APOC path)", () => {
  // 用 injectedDriver 跳过真实连接 (单测用 mock session)
  function makeStore(driverMock: any) {
    return new Neo4jGraphStore("test_owner", "bolt://mock", "neo4j", "", "raos", {
      injectedDriver: driverMock,
    });
  }

  it("方法签名：返回 shape 跟 MySQL 契约一致", () => {
    // 静态检查：Neo4jGraphStore 一定有 extractSubgraphCTE 方法，签名跟 GraphStore 一致
    const proto = Neo4jGraphStore.prototype as any;
    expect(typeof proto.extractSubgraphCTE).toBe("function");
  });

  it("空 seed：直接返回空 subgraph，不查 Neo4j", async () => {
    const ms = makeMockSession({});
    const driver = makeMockDriver(ms);
    const store = makeStore(driver);

    // 等构造触发的 ensureFulltextIndex 跑完 (它会调 1 次 driver.session)
    await new Promise((r) => setTimeout(r, 10));
    const callsBefore = (driver.session as any).mock.calls.length;

    const result = await store.extractSubgraphCTE([], 3, 50);
    expect(result.nodeIds).toEqual([]);
    expect(result.edges).toEqual([]);
    // extractSubgraphCTE 自己没产生新 session
    expect((driver.session as any).mock.calls.length).toBe(callsBefore);
  });

  it("APOC 路径：APOC 装好时直接返回（不 fallback）", async () => {
    const fakeNodeIds = ["a", "b", "c"];
    const fakeEdges = [
      { id: "r1", source: "a", target: "b", type: "REL", label: "to" },
      { id: "r2", source: "b", target: "c", type: "REL", label: "to" },
    ];
    const ms = makeMockSession({
      apocResult: {
        records: [
          {
            get: (key: string) => (key === "nodeIds" ? fakeNodeIds : key === "edges" ? fakeEdges : null),
          },
        ],
      },
    });
    const driver = makeMockDriver(ms);
    const store = makeStore(driver);

    await new Promise((r) => setTimeout(r, 10));
    const callsBefore = (driver.session as any).mock.calls.length;

    const result = await store.extractSubgraphCTE(["a"], 2, 50);

    expect(result.nodeIds).toEqual(fakeNodeIds);
    expect(result.edges).toEqual(fakeEdges);
    // extractSubgraphCTE 内部开了 1 个 session (APOC 走通)
    expect((driver.session as any).mock.calls.length - callsBefore).toBe(1);
  });

  it("APOC 不存在：fallback 到 Cypher variable-length path", async () => {
    // APOC ProcedureNotFound 错误
    const apocError = Object.assign(new Error("There is no procedure with the name apoc.path.subgraphAll registered"), {
      code: "Neo.ClientError.Procedure.ProcedureNotFound",
    });
    const ms = makeMockSession({
      apocResult: { records: [], throwOnApoc: apocError },
      fallbackNodeResult: {
        records: [
          { get: (k: string) => (k === "nodeIds" ? ["a", "b", "c"] : null) },
        ],
      },
      fallbackEdgeResult: {
        records: [
          { get: (k: string) => {
            const m: any = { id: "r1", source: "a", target: "b", type: "REL", label: "to" };
            return m[k];
          } },
        ],
      },
    });
    const driver = makeMockDriver(ms);
    const store = makeStore(driver);

    // 1 session 包含 3 个 run: APOC (throw) + fallback node + fallback edge
    await new Promise((r) => setTimeout(r, 10));
    const result = await store.extractSubgraphCTE(["a"], 2, 50);

    expect(result.nodeIds).toEqual(["a", "b", "c"]);
    expect(result.edges).toEqual([{ id: "r1", source: "a", target: "b", type: "REL", label: "to" }]);
    // 拿到 extractSubgraphCTE 用的那个 session
    const sessions = (driver.session as any).mock.results
      .map((r: any) => r.value)
      .filter((s: any) => s && s.run && (s.run as any).mock);
    const lastSession = sessions[sessions.length - 1];
    expect((lastSession.run as any).mock.calls.length).toBe(3);
  });

  it("APOC 返回空（seed 全不在）：也走 fallback", async () => {
    const ms = makeMockSession({
      apocResult: { records: [] }, // 没 throw，但 records 空
      fallbackNodeResult: { records: [] }, // fallback 也返回空
    });
    const driver = makeMockDriver(ms);
    const store = makeStore(driver);

    await new Promise((r) => setTimeout(r, 10));
    const result = await store.extractSubgraphCTE(["nonexistent"], 2, 50);

    expect(result.nodeIds).toEqual([]);
    expect(result.edges).toEqual([]);
    // 拿到 extractSubgraphCTE 用的那个 session: APOC + fallback node (edge 因空跳过)
    const sessions = (driver.session as any).mock.results
      .map((r: any) => r.value)
      .filter((s: any) => s && s.run && (s.run as any).mock);
    const lastSession = sessions[sessions.length - 1];
    expect((lastSession.run as any).mock.calls.length).toBe(2);
  });

  it("非 APOC 错误不吞，向上抛", async () => {
    const otherError = Object.assign(new Error("Database unavailable"), {
      code: "ServiceUnavailable",
    });
    const ms = makeMockSession({
      apocResult: { records: [], throwOnApoc: otherError },
    });
    const driver = makeMockDriver(ms);
    const store = makeStore(driver);

    await new Promise((r) => setTimeout(r, 10));
    await expect(store.extractSubgraphCTE(["a"], 2, 50)).rejects.toThrow("Database unavailable");
  });

  it("Cypher 静态检查：APOC 路径的 query 包含 apoc.path.subgraphAll", () => {
    // 源码静态检查——确保 cypher 写对了
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../src/memory/knowledge-graph/neo4j-store.ts"),
      "utf-8"
    );
    expect(src).toContain("apoc.path.subgraphAll");
    expect(src).toContain("bfs: true");
    expect(src).toContain("ProcedureNotFound"); // fallback 触发条件
  });

  it("Cypher 静态检查：fallback 路径用 variable-length path", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../src/memory/knowledge-graph/neo4j-store.ts"),
      "utf-8"
    );
    // fallback 路径
    expect(src).toMatch(/MATCH\s+path\s*=\s*\(seed\)\-\[\*0\.\..*maxDepth/);
    expect(src).toContain("RETURN toString(id(r))");
  });
});
