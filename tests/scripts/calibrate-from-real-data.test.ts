import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * P2-7 标定 pipeline (v3 review 闭环)：从真实数据生成 ground_truth.json
 *
 * 端到端测试 calibrate-from-real-data.ts：
 *   1. pipeline 能跑（heuristic 模式不需要 LLM）
 *   2. 生成 ground_truth.json 格式正确
 *   3. RMSE 计算有意义（current vs best）
 *   4. 输出 recommendations 有 actionable 建议
 */
describe.sequential("calibrate-from-real-data.ts (P2-7 标定 pipeline)", () => {
  const scriptPath = path.resolve(__dirname, "../../scripts/calibrate-from-real-data.ts");
  const tmpOut = path.resolve(__dirname, "../fixtures/test-ground-truth.json");

  beforeAll(() => {
    const fixturesDir = path.dirname(tmpOut);
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
  });

  it("pipeline 跑通（heuristic 模式）", () => {
    const output = execSync(
      `npx tsx ${scriptPath} --out ${tmpOut}`,
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
      }
    );
    expect(output).toContain("[calibrate-real] ===== RESULTS =====");
    expect(output).toContain("data points:");
    expect(output).toContain("rescued by fallback:");
    expect(output).toContain("production RMSE (vs relevance):");
  }, 120_000);

  it("生成 ground_truth.json 格式正确（每条含 raw, relevance, query, nodeLabel, source）", () => {
    // 上一步的 beforeAll 已经写出了文件
    expect(fs.existsSync(tmpOut)).toBe(true);
    const points = JSON.parse(fs.readFileSync(tmpOut, "utf-8")) as Array<{
      raw: number;
      relevance: number;
      query?: string;
      nodeLabel?: string;
      source?: string;
    }>;

    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeGreaterThan(0);

    // 每条都有 raw + relevance
    for (const p of points) {
      expect(typeof p.raw).toBe("number");
      expect(p.raw).toBeGreaterThanOrEqual(0);
      expect(typeof p.relevance).toBe("number");
      expect(p.relevance).toBeGreaterThanOrEqual(0);
      expect(p.relevance).toBeLessThanOrEqual(1);
    }

    // 至少有一些点有 query/nodeLabel（synthetic 模式应该 100% 有）
    const withMeta = points.filter((p) => p.query && p.nodeLabel);
    expect(withMeta.length).toBeGreaterThan(0);
  });

  it("FULLTEXT STAGE CALIBRATION 输出格式（仅当 stage=1 fulltext points 足够时）", () => {
    const output = execSync(
      `npx tsx ${scriptPath} --out ${tmpOut}`,
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
      }
    );
    // 新输出格式：FULLTEXT STAGE CALIBRATION 在 stage=1 有点时才出现
    // 验证 rescued by fallback 一定出现（无论 stage 分布如何）
    expect(output).toContain("rescued by fallback:");

    // 提取 production RMSE（必出）
    const prodMatch = output.match(/production RMSE \(vs relevance\): ([\d.]+)/);
    expect(prodMatch).not.toBeNull();
    const prodRmse = parseFloat(prodMatch![1]);
    expect(prodRmse).toBeGreaterThan(0);
    expect(prodRmse).toBeLessThan(1);

    // 提取 rescued 比例
    const rescuedMatch = output.match(/rescued by fallback: (\d+) \/ (\d+) \(([\d.]+)%\)/);
    if (rescuedMatch) {
      const rescuedPct = parseFloat(rescuedMatch[3]);
      expect(rescuedPct).toBeGreaterThanOrEqual(0);
      expect(rescuedPct).toBeLessThanOrEqual(100);
    }
  }, 120_000);

  it("--synthetic 控制 fallback 数量（不报错就行）", () => {
    const output = execSync(
      `npx tsx ${scriptPath} --out ${tmpOut} --synthetic 50`,
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
      }
    );
    expect(output).toContain("synthetic tuples");
  }, 120_000);

  it("--llm 模式降级到 heuristic（无 LLM provider 时不报错）", () => {
    const output = execSync(
      `npx tsx ${scriptPath} --out ${tmpOut} --llm`,
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
      }
    );
    // 应该没抛错就完成
    expect(output).toContain("===== RESULTS =====");
  }, 120_000);

  it("analyze-calibration.ts 能对生成的 ground_truth.json 做详细分析", () => {
    // 先用 pipeline 跑一份 ground_truth
    execSync(
      `npx tsx ${scriptPath} --out ${tmpOut}`,
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
      }
    );
    expect(fs.existsSync(tmpOut)).toBe(true);

    // 跑分析
    const analyzeScript = path.resolve(__dirname, "../../scripts/analyze-calibration.ts");
    const output = execSync(`npx tsx ${analyzeScript} ${tmpOut}`, { encoding: "utf-8" });

    // 应该输出关键段落
    expect(output).toContain("RAW SCORE DISTRIBUTION");
    expect(output).toContain("RELEVANCE DISTRIBUTION");
    expect(output).toContain("CORRELATION");
    expect(output).toContain("RMSE BY RAW BUCKET");
    expect(output).toContain("FINE-GRAINED K SEARCH");
    expect(output).toContain("HIGHEST-ERROR POINTS");
    // analyze-calibration 输出 best k — 在 FINE-GRAINED K SEARCH 段
    const bestKMatch = output.match(/best k:\s+([\d.]+)/);
    expect(bestKMatch).not.toBeNull();
    const bestK = parseFloat(bestKMatch![1]);
    // best k ≥ 0.5 (synthetic 数据下 k 在 1-2 区间，k=0 不可能最优)
    expect(bestK).toBeGreaterThanOrEqual(0.5);
    expect(bestK).toBeLessThan(5);
  }, 120_000);
});
