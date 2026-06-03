/**
 * KG v2 阶段 6：中文分词 (nodejieba) e2e 测试
 *
 * 覆盖：
 * - nodejieba 集成后的中文切分效果（vs 启发式 baseline）
 * - 混合中英文 query 切分
 * - 优雅降级（模拟 nodejieba 不可用时启发式工作）
 * - 与 understandQuery 集成后的中文召回
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  tokenizeQuery,
  isChineseTokenizerActive,
  understandQuery,
  _clearQueryCache,
} from "../../../src/memory/knowledge-graph/query-understanding.js";
import { getMySQLAdapter } from "../../../src/db/mysql-adapter.js";
import { GraphStore } from "../../../src/memory/knowledge-graph/graph-store.js";
import {
  chineseTokenize,
  heuristicChineseTokenize,
  isJiebaActive,
  _resetJiebaForTest,
} from "../../../src/memory/knowledge-graph/chinese-tokenizer.js";

describe.sequential("KG v2 Stage 6 — nodejieba 集成", () => {
  it("nodejieba 加载成功（健康检查）", () => {
    expect(isJiebaActive()).toBe(true);
    expect(isChineseTokenizerActive()).toBe(true);
  });

  it("chineseTokenize 切出'苹果'、'微软'、'战略'、'共同点'（nodejieba 精度）", () => {
    const tokens = chineseTokenize("苹果和微软在 AI 战略上有什么共同点");
    // nodejieba 比启发式更强：能识别"战略"和"共同点"作为完整词
    expect(tokens).toContain("苹果");
    expect(tokens).toContain("微软");
    expect(tokens).toContain("战略");
    // "共同点" nodejieba 应当能切出（启发式也能切出）
    expect(tokens).toContain("共同点");
  });

  it("chineseTokenize 切'蒂姆·库克'（混合符号）", () => {
    const tokens = chineseTokenize("蒂姆·库克");
    // nodejieba 应该切出"蒂姆"和"库克"
    // 注意：nodejieba 不识别"·"为分隔符，但通常 HMM 会切出合理结果
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  it("混合中英文：apple 和 微软 → apple, 微软", () => {
    const tokens = chineseTokenize("apple 和 微软");
    expect(tokens).toContain("apple");
    expect(tokens).toContain("微软");
  });

  it("混合中英文：knowledge graph 知识图谱", () => {
    const tokens = chineseTokenize("knowledge graph 知识图谱");
    expect(tokens).toContain("knowledge");
    expect(tokens).toContain("graph");
    // nodejieba 默认词典切出"知识"+"图谱"（更细粒度，反而对 KG 召回有利）
    expect(tokens).toContain("知识");
    expect(tokens).toContain("图谱");
  });

  it("启发式 fallback 在 nodejieba 不可用时仍能工作", () => {
    // 强制重置 jieba，让 fallback 路径生效
    _resetJiebaForTest();
    const tokens = heuristicChineseTokenize("苹果和微软");
    expect(tokens).toContain("苹果");
    expect(tokens).toContain("微软");
    // 恢复 jieba
    _resetJiebaForTest();
    expect(isJiebaActive()).toBe(true);
  });

  it("heuristicChineseTokenize 不如 nodejieba 强（共同点）", () => {
    const heuristicTokens = heuristicChineseTokenize("苹果和微软在 AI 战略上有什么共同点");
    const jiebaTokens = chineseTokenize("苹果和微软在 AI 战略上有什么共同点");
    // jieba 应该至少和启发式一样多（或更多）
    expect(jiebaTokens.length).toBeGreaterThanOrEqual(heuristicTokens.length);
  });
});

describe.sequential("KG v2 Stage 6 — tokenizeQuery 集成中文分词", () => {
  it("tokenizeQuery 调用 nodejieba（验证 isJiebaActive 在 query 路径中工作）", () => {
    expect(isJiebaActive()).toBe(true); // 确认 jieba 已加载
    const tokens = tokenizeQuery("苹果和微软");
    expect(tokens).toContain("苹果");
    expect(tokens).toContain("微软");
  });

  it("关系型 query 切分：苹果和微软在 AI 战略上有什么共同点", () => {
    const tokens = tokenizeQuery("苹果和微软在 AI 战略上有什么共同点");
    // nodejieba 切分后应该包含 苹果、微软、战略
    expect(tokens).toContain("苹果");
    expect(tokens).toContain("微软");
    // 战略 (nodejieba 应能切出，启发式也可能)
    expect(tokens).toContain("战略");
  });

  it("英文 query 仍能正常切分（向后兼容）", () => {
    const tokens = tokenizeQuery("apple tim cook");
    expect(tokens).toContain("apple");
    expect(tokens).toContain("tim");
    expect(tokens).toContain("cook");
  });
});

describe.sequential("KG v2 Stage 6 — 中文 query 端到端召回", () => {
  it("中文 query 经过 nodejieba 切分后能命中中文节点", async () => {
    const SUFFIX = "stage6_e2e_" + Date.now();
    const TEST_OWNER = "kg_v2_s6_e2e_" + SUFFIX;
    const adapter = getMySQLAdapter();
    try {
      await adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [TEST_OWNER, "s6e2e_" + SUFFIX, "h", 1]
      );
    } catch (e) { /* ignore */ }

    const store = new GraphStore(TEST_OWNER);
    await store.clearGraph();
    _clearQueryCache();
    try {
      // 用不会和 alias map 冲突的节点（"张三"等）
      const zhang = await store.addNode({
        label: "张三", type: "entity", tags: [], properties: {},
        createdAt: Date.now(), canonicalForm: "张三", version: 1, importance: 0.8,
      });
      const li = await store.addNode({
        label: "李四", type: "entity", tags: [], properties: {},
        createdAt: Date.now(), canonicalForm: "李四", version: 1, importance: 0.7,
      });
      const wang = await store.addNode({
        label: "王五", type: "entity", tags: [], properties: {},
        createdAt: Date.now(), canonicalForm: "王五", version: 1, importance: 0.5,
      });
      await store.addEdge(zhang.id, li.id, "EXTRACTED", "collaborated_with");
      await store.addEdge(li.id, wang.id, "EXTRACTED", "manages");

      // 中文 query 命中
      const u = await understandQuery("张三和李四的关系是什么", store as any);
      // nodejieba 应该切出 张三、李四、关系
      const matched = u.entities.filter((e) => e.matchedNodeIds.length > 0);
      expect(matched.length).toBeGreaterThanOrEqual(2);
    } finally {
      await store.clearGraph();
    }
  });
});
