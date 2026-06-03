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
    expect(output).toContain("current k=2: RMSE=");
    expect(output).toContain("best k=");
    expect(output).toContain("improvement:");
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

  it("RMSE 输出格式：current vs best，且能跑完推荐逻辑", () => {
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
    // 提取 RMSE 数字
    const currentMatch = output.match(/current k=2: RMSE=([\d.]+)/);
    const bestMatch = output.match(/best k=([\d.]+):\s*RMSE=([\d.]+)/);
    expect(currentMatch).not.toBeNull();
    expect(bestMatch).not.toBeNull();

    const currentRmse = parseFloat(currentMatch![1]);
    const bestK = parseFloat(bestMatch![1]);
    const bestRmse = parseFloat(bestMatch![2]);

    expect(currentRmse).toBeGreaterThan(0);
    expect(bestK).toBeGreaterThan(0);
    expect(bestK).toBeLessThanOrEqual(5);
    expect(bestRmse).toBeGreaterThan(0);
    // best 的 RMSE ≤ current（标定函数保证）
    expect(bestRmse).toBeLessThanOrEqual(currentRmse + 0.001);
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
});
