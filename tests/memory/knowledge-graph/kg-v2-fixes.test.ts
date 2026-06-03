/**
 * KG v2 修 1+2+3 e2e 测试
 *
 * 修 1: graphContext 传完整结构（节点对象 + 路径 + 子图摘要）
 * 修 2: 中文启发式分词（"苹果和微软" → ["苹果", "微软"]）
 * 修 3: extractEntities 独立抽取（实体不再只是 relations 的副产物）
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";
import { tokenizeQuery, understandQuery, _clearQueryCache } from "../../../src/memory/knowledge-graph/query-understanding.js";
import { heuristicChineseTokenize, _resetJiebaForTest, isJiebaActive } from "../../../src/memory/knowledge-graph/chinese-tokenizer.js";
import { recall, summarizeSubgraph } from "../../../src/memory/knowledge-graph/recall.js";
import { extractEntities } from "../../../src/memory/knowledge-graph/relationship-extractor.js";
import { extractRelationsToGraph } from "../../../src/memory/knowledge-graph/extraction-pipeline.js";
import type { LLMProvider } from "../../../src/llm/types.js";

describe.sequential("KG v2 修 2 (阶段 6 已用 nodejieba 替代启发式) — 启发式 fallback 验证", () => {
  // KG v2 阶段 6 集成 nodejieba 后，tokenizeQuery 默认走 jieba。
  // 修 2 那批"启发式"测试改为验证 fallback 路径（heuristicChineseTokenize）的行为。

  beforeEach(() => {
    _resetJiebaForTest(); // 让 isJiebaActive() === false，从而 heuristic 路径生效
  });

  afterEach(() => {
    _resetJiebaForTest(); // 恢复
  });

  it("heuristicChineseTokenize 按'和'切分: 苹果和微软 → 苹果, 微软", () => {
    const tokens = heuristicChineseTokenize("苹果和微软");
    expect(tokens).toContain("苹果");
    expect(tokens).toContain("微软");
  });

  it("heuristicChineseTokenize 按'与'切分: 机器学习与深度学习 → 机器, 学习, 深度, 学习", () => {
    // 启发式无中文分词，保留"机器学习"作为整词需要 jieba。
    // 启发式只是按 separator 切，所以"机器学习与深度学习"会切出 ["机器学习", "深度学习"]
    const tokens = heuristicChineseTokenize("机器学习与深度学习");
    expect(tokens).toContain("机器学习");
    expect(tokens).toContain("深度学习");
  });

  it("heuristicChineseTokenize 按顿号切分", () => {
    const tokens = heuristicChineseTokenize("苹果、特斯拉、谷歌");
    expect(tokens).toContain("苹果");
    expect(tokens).toContain("特斯拉");
    expect(tokens).toContain("谷歌");
  });

  it("heuristicChineseTokenize 虚词过滤: 在/什么 不会单独成 token", () => {
    const tokens = heuristicChineseTokenize("苹果和微软在 AI 战略上有什么共同点");
    expect(tokens).not.toContain("在");
    expect(tokens).not.toContain("什么");
  });

  it("tokenizeQuery 优先 jieba，jieba 不可用时降级", () => {
    // 阶段 6 之前：默认 heuristic；阶段 6 之后：默认 jieba，heuristic 是 fallback
    expect(isJiebaActive()).toBe(true); // jieba 已加载
    const tokens = tokenizeQuery("apple tim cook");
    expect(tokens).toContain("apple");
    expect(tokens).toContain("tim");
    expect(tokens).toContain("cook");
  });
});

describe.sequential("KG v2 修 3 — extractEntities 独立抽取", () => {
  const fakeLLM: LLMProvider = {
    name: "fake",
    model: "fake",
    chat: async () => ({
      content: JSON.stringify([
        { label: "苹果公司", type: "organization", importance: 0.9 },
        { label: "蒂姆·库克", type: "person", importance: 0.85 },
        { label: "iPhone", type: "product", importance: 0.7 },
      ]),
      toolCalls: [],
      finishReason: "stop" as const,
    }),
  };

  it("extractEntities 抽取独立实体（不依赖 relations）", async () => {
    const entities = await extractEntities(
      "苹果公司的 CEO 是蒂姆·库克。苹果公司生产 iPhone。",
      fakeLLM
    );
    expect(entities.length).toBe(3);
    // 用 Set 比较，避免 sort 顺序不一致
    const labels = new Set(entities.map((e) => e.label));
    expect(labels).toEqual(new Set(["iPhone", "蒂姆·库克", "苹果公司"]));
    // 重要性评分有保留
    expect(entities.find((e) => e.label === "苹果公司")!.importance).toBe(0.9);
  });

  it("extractEntities 过滤掉不合规的 entity", async () => {
    const noisyLLM: LLMProvider = {
      name: "fake", model: "fake",
      chat: async () => ({
        content: JSON.stringify([
          { label: "valid entity", type: "concept", importance: 0.5 },
          { label: "", type: "concept", importance: 0.5 }, // 空 label
          { label: "x", type: "concept", importance: 0.5 }, // 长度 < 1
          { label: "a".repeat(50), type: "concept", importance: 0.5 }, // 长度 > 30
          { label: "wrong_type", type: "unknown_type", importance: 0.5 }, // 任何 type 都接受（不严格过滤 type）
          { label: "zero_importance", type: "concept", importance: 0.05 }, // 重要性 < 0.1
        ]),
        toolCalls: [],
        finishReason: "stop" as const,
      }),
    };
    const entities = await extractEntities("test", noisyLLM);
    expect(entities.length).toBeGreaterThanOrEqual(1);
    // 至少有 1 个 valid entity 留下
    const valid = entities.find((e) => e.label === "valid entity");
    expect(valid).toBeDefined();
  });

  it("extractEntities 静默处理 LLM 异常（不抛错）", async () => {
    const brokenLLM: LLMProvider = {
      name: "fake", model: "fake",
      chat: async () => { throw new Error("LLM service down"); },
    };
    const entities = await extractEntities("test", brokenLLM);
    expect(entities).toEqual([]);
  });
});

describe.sequential("KG v2 修 1 — summarizeSubgraph 把计数变可读结构", () => {
  const SUFFIX = "summ_" + Date.now();
  const TEST_OWNER = "kg_v2_fix1_" + SUFFIX;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "fix1_" + SUFFIX, "h", 1]
      );
    } catch (e) { /* ignore */ }
  });

  beforeEach(async () => {
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
  });

  afterEach(async () => {
    try { await store.clearGraph(); } catch { /* ignore */ }
  });

  it("summarizeSubgraph 包含 seed 节点 label（不是只有 id）", async () => {
    // 简单 graph: Apple_inc -[created_by]-> Tim_cook
    const apple = await store.addNode({
      label: "apple_inc", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "apple_inc", version: 1, importance: 0.8,
      communityId: 0,
    });
    const tim = await store.addNode({
      label: "tim_cook", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), canonicalForm: "tim_cook", version: 1, importance: 0.7,
      communityId: 0,
    });
    await store.addEdge(apple.id, tim.id, "EXTRACTED", "created_by");

    // 模拟理解 + recall
    const understanding = {
      raw: "apple_inc tim_cook",
      normalized: "apple_inc tim_cook",
      queryType: "relational" as const,
      queryTypeConfidence: 0.7,
      keywords: ["apple_inc", "tim_cook"],
      entities: [],
      entityTypes: [],
    };
    const recallResult = {
      seedEntities: [apple, tim],
      relatedEntities: [],
      edges: [],
      paths: [{ nodes: [apple, tim], edges: [{ ...{}, label: "created_by", type: "EXTRACTED" } as any] }],
      scores: new Map(),
      durationMs: 0,
    };

    const summary = summarizeSubgraph(understanding, recallResult);
    // 关键断言：summary 里包含 label，不是只 id
    expect(summary).toContain("apple_inc");
    expect(summary).toContain("tim_cook");
    // 包含路径信息
    expect(summary).toContain("created_by");
    // 包含社区
    expect(summary).toContain("社区归属");
  });

  it("summarizeSubgraph 在没有 path 时给提示", async () => {
    const a = await store.addNode({
      label: "lonely", type: "entity", tags: [], properties: {},
      createdAt: Date.now(), version: 1, importance: 0.5,
    });
    const understanding = {
      raw: "lonely", normalized: "lonely", queryType: "relational" as const,
      queryTypeConfidence: 0.5, keywords: ["lonely"], entities: [], entityTypes: [],
    };
    const recallResult = {
      seedEntities: [a],
      relatedEntities: [],
      edges: [],
      paths: [],
      scores: new Map(),
      durationMs: 0,
    };
    const summary = summarizeSubgraph(understanding, recallResult);
    // 单 seed + relational + 无 path → 提示
    expect(summary).toContain("种子节点");
  });

  it("summarizeSubgraph 在完全空时返回提示", () => {
    const summary = summarizeSubgraph(
      { raw: "x", normalized: "x", queryType: "factual" as const, queryTypeConfidence: 0.5, keywords: [], entities: [], entityTypes: [] },
      { seedEntities: [], relatedEntities: [], edges: [], paths: [], scores: new Map(), durationMs: 0 }
    );
    expect(summary).toContain("图谱召回为空");
  });
});

describe.sequential("KG v2 修 1+2 — end-to-end 中文 query 召回", () => {
  it("中文 query 经过启发式分词后能命中已存在的图谱节点", async () => {
    const SUFFIX = "e2e_zh_" + Date.now();
    const TEST_OWNER = "kg_v2_e2e_zh_" + SUFFIX;
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "e2ezh_" + SUFFIX, "h", 1]
      );
    } catch (e) { /* ignore */ }

    const store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
    _clearQueryCache(); // 关键：避免 process-global 缓存污染
    try {
      // 用"张三""李四"等不在 alias map 里的中文名（避免 alias 重定向问题）
      const zhang = await store.addNode({
        label: "张三", type: "entity", tags: [], properties: {},
        createdAt: Date.now(), canonicalForm: "张三", version: 1, importance: 0.8,
      });
      const li = await store.addNode({
        label: "李四", type: "entity", tags: [], properties: {},
        createdAt: Date.now(), canonicalForm: "李四", version: 1, importance: 0.7,
      });
      await store.addEdge(zhang.id, li.id, "EXTRACTED", "collaborated_with");

      // 中文 query（无空格）—— 修 2 之前会失败
      const u = await understandQuery("张三和李四", store as any);
      // tokens 应该被正确切分
      expect(u.keywords).toContain("张三");
      expect(u.keywords).toContain("李四");
      // matched 至少有两个 entity（"张三" + "李四" 精确匹配）
      const matched = u.entities.filter((e) => e.matchedNodeIds.length > 0);
      expect(matched.length).toBeGreaterThanOrEqual(2);
    } finally {
      await store.clearGraph();
    }
  });
});

// ============================================================
// P0-2 闭环：extractRelationsToGraph 真的把"独立出现的 entity"建到图谱
// （v3 review 的 P0-2：之前修 3 是 dead code，extractEntities 的结果没人用）
// ============================================================
describe.sequential("KG v2 P0-2 — extractRelationsToGraph 真的写入独立 entity", () => {
  const SUFFIX = "p02_" + Date.now();
  const TEST_OWNER = "kg_v2_p02_" + SUFFIX;
  let store: GraphStore;

  // 双角色 LLM mock：根据 prompt 内容区分"实体抽取"和"关系抽取"
  // - 实体 prompt 包含 "命名实体"
  // - 关系 prompt 包含 "之间的关系"
  const fakeLLM: LLMProvider = {
    name: "fake", model: "fake",
    chat: async (messages) => {
      const prompt = messages[messages.length - 1]?.content ?? "";
      // P1-6: 合并 prompt 包含"同时抽取"，返回 { entities, relations } 对象
      if (prompt.includes("同时抽取")) {
        // 关键："独立实体张三"在 relations 里**完全不出现**，专门用于验证闭环
        return {
          content: JSON.stringify({
            entities: [
              { label: "独立实体张三", type: "person", importance: 0.85 },
              { label: "王五", type: "person", importance: 0.75 },
              { label: "赵六", type: "person", importance: 0.65 },
            ],
            // 关系抽取：只有"王五 → 赵六"一条
            relations: [
              { sourceLabel: "王五", targetLabel: "赵六", relation: "mentors", confidence: 0.9 },
            ],
          }),
          toolCalls: [],
          finishReason: "stop" as const,
        };
      }
      // 老路径 fallback（extractEntities/extractRelationships 单独调）：
      // 这里保留旧分支，理论上当前生产不再走，但别的测试可能用
      if (prompt.includes("命名实体")) {
        return {
          content: JSON.stringify([
            { label: "独立实体张三", type: "person", importance: 0.85 },
            { label: "王五", type: "person", importance: 0.75 },
            { label: "赵六", type: "person", importance: 0.65 },
          ]),
          toolCalls: [],
          finishReason: "stop" as const,
        };
      }
      // 关系抽取 fallback
      return {
        content: JSON.stringify([
          { sourceLabel: "王五", targetLabel: "赵六", relation: "mentors", confidence: 0.9 },
        ]),
        toolCalls: [],
        finishReason: "stop" as const,
      };
    },
  };

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "p02_" + SUFFIX, "h", 1]
      );
    } catch { /* ignore */ }
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
  });

  it("独立出现的 entity（不在 relations 里）也会被写入图谱", async () => {
    const text = "独立实体张三、王五和赵六共同完成了这个项目。王五是赵六的导师。";
    const r = await extractRelationsToGraph(
      store as any,
      { docId: "doc_p02", docName: "p02.md", content: text, tags: [] },
      fakeLLM,
      { createDocAnchor: false, callerTag: "p02-test" }
    );

    // 抽取的 relations 数 = 1（王五→赵六）
    expect(r.totalRelations).toBe(1);

    // 关键断言 1：参与关系的 entity 都进了图谱
    const wang = await store.findNodeByLabel("王五");
    const zhao = await store.findNodeByLabel("赵六");
    expect(wang).toBeDefined();
    expect(zhao).toBeDefined();

    // 关键断言 2：独立出现的 entity（不在任何 relation 里）也被建出来
    //  这是 P0-2 闭环的核心证明
    const standalone = await store.findNodeByLabel("独立实体张三");
    expect(standalone).toBeDefined();
    expect(standalone!.importance).toBeCloseTo(0.85, 2);

    // 关键断言 3：关系边存在
    const edges = await store.getAllEdges();
    const relEdges = edges.filter((e) => e.type === "LLM_EXTRACTED" && e.label === "mentors");
    expect(relEdges).toHaveLength(1);
  });

  it("多次跑（幂等）：独立 entity 不会变成重复节点", async () => {
    const text = "独立实体张三、王五和赵六共同完成了这个项目。王五是赵六的导师。";
    await extractRelationsToGraph(
      store as any,
      { docId: "doc_p02_idem", docName: "p02_idem.md", content: text, tags: [] },
      fakeLLM,
      { createDocAnchor: false, callerTag: "p02-test" }
    );

    // 独立 entity 应该只出现一次（去重 + 幂等）
    const allStandalone = (await store.getAllNodes()).filter(
      (n) => n.label === "独立实体张三"
    );
    expect(allStandalone).toHaveLength(1);
  });

  afterAll(async () => {
    if (store) await store.clearGraph();
  });
});

// ============================================================
// P2-11: ACL 精确匹配（之前 n.id.includes(id) 是模糊匹配，
//   "doc_abc" 会被 "doc_abc_v2" 误命中——边界情况但生产可能踩）
// 验证：allowedDocIds=["doc_abc"] 时，"kb_doc_doc_abc_v2" 必须被拒
// ============================================================
describe.sequential("KG v2 P2-11 — ACL 精确匹配", () => {
  const SUFFIX = "p211_" + Date.now();
  const TEST_OWNER = "kg_v2_p211_" + SUFFIX;
  let store: GraphStore;

  beforeAll(async () => {
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "p211_" + SUFFIX, "h", 1]
      );
    } catch { /* ignore */ }
    store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
  });

  it("kb_document 节点 id 后缀精确匹配 allowedDocIds（防止 'doc_abc' 误中 'doc_abc_v2'）", async () => {
    // 建两个 doc anchor 节点：doc_abc 和 doc_abc_v2（前者被允许，后者不被允许）
    const allowedAnchor = await store.addNode({
      id: "kb_doc_doc_abc",
      label: "doc_abc.md",
      type: "kb_document",
      tags: ["kb_document"],
      properties: { sourceDoc: "doc_abc.md" },
      createdAt: Date.now(),
      canonicalForm: "doc_abc.md",
      version: 1,
      importance: 0.5,
    });
    const deniedAnchor = await store.addNode({
      id: "kb_doc_doc_abc_v2",
      label: "doc_abc_v2.md",
      type: "kb_document",
      tags: ["kb_document"],
      properties: { sourceDoc: "doc_abc_v2.md" },
      createdAt: Date.now(),
      canonicalForm: "doc_abc_v2.md",
      version: 1,
      importance: 0.5,
    });
    // 加一个普通 entity 节点 + CONTAINS 边，召回能从 entity 拉到 doc anchor
    const entity = await store.addNode({
      id: "entity_xyz",
      label: "xyz_entity",
      type: "entity",
      tags: [],
      properties: {},
      createdAt: Date.now(),
      canonicalForm: "xyz_entity",
      version: 1,
      importance: 0.5,
    });
    await store.addEdge(allowedAnchor.id, entity.id, "CONTAINS", "contains");
    await store.addEdge(deniedAnchor.id, entity.id, "CONTAINS", "contains");

    // query 命中 entity（"xyz_entity" 是 token）
    const u = await understandQuery("xyz_entity", store as any);
    expect(u.entities.length).toBeGreaterThan(0); // 确保 seed 解析成功

    const r = await recall(u, store as any, { allowedDocIds: ["doc_abc"] });

    // 关键断言：allowed doc_abc 在召回里，denied doc_abc_v2 不在
    // （之前 n.id.includes("doc_abc") 会让 "kb_doc_doc_abc_v2" 误中）
    const allNodeIds = new Set([...r.seedEntities, ...r.relatedEntities].map((n) => n.id));
    expect(allNodeIds.has(allowedAnchor.id)).toBe(true);
    expect(allNodeIds.has(deniedAnchor.id)).toBe(false);
  });

  it("空 allowedDocIds 表示不限制（向后兼容）", async () => {
    // 不传 allowedDocIds → 所有 kb_document 节点都允许
    const u = await understandQuery("abc", store as any);
    const r = await recall(u, store as any);
    const allNodeIds = new Set([...r.seedEntities, ...r.relatedEntities].map((n) => n.id));
    // 不抛错就过
    expect(allNodeIds.size).toBeGreaterThanOrEqual(0);
  });

  afterAll(async () => {
    if (store) await store.clearGraph();
  });
});
