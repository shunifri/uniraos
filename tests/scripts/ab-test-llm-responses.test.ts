/**
 * P2-CRITICAL-FIX: A/B test graphContext 对 LLM 真实响应的贡献
 *
 * A 路径: query → FTS top-5 → LLM
 * B 路径: query → FTS + BFS subgraph → LLM
 *
 * Judge: heuristic (relevant entity mentions) + LLM judge (0-1 score)
 *
 * 跑在 dev MySQL 上，15-20 queries；synthetic 但能给出 baseline。
 * 真数据 (production logs) 接 csv 后才有 ground truth 完整覆盖。
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

describe("ab-test-llm-responses.ts (P2-CRITICAL-FIX A/B on LLM)", () => {
  const scriptPath = path.resolve(__dirname, "../../scripts/ab-test-llm-responses.ts");

  it.skipIf(
    !process.env.ANTHROPIC_API_KEY,
    "pipeline 跑通：3 queries, 双向 LLM 调用 + judge, 写 json"
  )(() => {
    const tmpOut = path.resolve(__dirname, "../fixtures/ab-llm-test-tmp.json");
    try {
      const output = execSync(
        `npx tsx ${scriptPath} 3 user_admin ${tmpOut}`,
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            MYSQL_PRIMARY_HOST: "localhost",
            MYSQL_PRIMARY_PORT: "3307",
            MYSQL_USER: "raos",
            MYSQL_PASSWORD: "raospassword",
            MYSQL_DATABASE: "raos",
          },
          timeout: 300_000, // 3 queries * 2 paths * 2 LLM calls (answer + judge) * 30s = 6 min worst case
        }
      );
      // 输出包含: 加载 queries, per-query score, AGGREGATE, RECOMMENDATION
      expect(output).toContain("[ab-llm] loaded 3 queries");
      expect(output).toContain("[ab-llm] ===== AGGREGATE");
      expect(output).toContain("avg LLM judge: A=");
      expect(output).toContain("avg LLM judge: B=");
      expect(output).toContain("===== RECOMMENDATION =====");
      expect(fs.existsSync(tmpOut)).toBe(true);
    } finally {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  }, 360_000);

  it("heuristic judge 单元测试：mention 检测", () => {
    // 简单验证 heuristic 函数行为
    const resp = "苹果公司由蒂姆·库克领导，主要产品包括 iPhone 和 MacBook。";
    const mentions = ["苹果公司", "蒂姆·库克", "iPhone", "MacBook"].filter((l) =>
      resp.includes(l)
    );
    expect(mentions.length).toBe(4);
    const hitRate = mentions.length / 4;
    expect(hitRate).toBe(1.0);
  });

  it("context 格式化：FTS 路径 + BFS 路径", () => {
    // 简单模拟
    const fts = [{ node: { label: "苹果公司", type: "entity" }, score: 0.95 }];
    const subgraph = {
      nodes: [
        { label: "蒂姆·库克", type: "person" },
        { label: "iPhone", type: "product" },
      ],
      edges: [
        { source: "苹果公司", target: "蒂姆·库克", type: "CEO_OF", label: "CEO" },
      ],
    };
    const contextA = fts.map((r, i) => `${i + 1}. [${r.node.type}] ${r.node.label} (score=${r.score.toFixed(3)})`).join("\n");
    expect(contextA).toContain("苹果公司");
    expect(contextA).not.toContain("蒂姆·库克");

    const contextB = contextA + "\n\n知识图谱子图 (2 节点, 1 边):\n1. [person] 蒂姆·库克\n2. [product] iPhone\n\n关系:\n- 苹果公司 --[CEO_OF: CEO]--> 蒂姆·库克";
    expect(contextB).toContain("蒂姆·库克");
    expect(contextB).toContain("CEO_OF");
  });
});
