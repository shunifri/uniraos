import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import * as path from "path";

/**
 * P2-7 标定：calibrate-fts-score.ts 端到端测试
 *
 * 跑 npx tsx scripts/calibrate-fts-score.ts 验证：
 *   1. 默认 synthetic ground truth 能跑通
 *   2. 找到 k（最佳 k 在合理区间 [0.5, 5]）
 *   3. RMSE 比 current k 更小（推荐换 k）
 */
describe.sequential("calibrate-fts-score.ts (P2-7 标定脚本)", () => {
  const scriptPath = path.resolve(__dirname, "../../scripts/calibrate-fts-score.ts");

  it("跑默认 synthetic ground truth 不抛错", () => {
    const output = execSync(`npx tsx ${scriptPath}`, { encoding: "utf-8" });
    expect(output).toContain("[calibrate] current default k=2");
    expect(output).toContain("[calibrate] best k in");
    expect(output).toContain("recommendation");
  });

  it("找到的最优 k 在合理区间 [0.5, 5]", () => {
    const output = execSync(`npx tsx ${scriptPath}`, { encoding: "utf-8" });
    // 提取 "best k in [0.5, 5.0]: k=<X>" 中的 k 值
    const match = output.match(/best k in \[[\d.]+, [\d.]+\]: k=([\d.]+)/);
    expect(match).not.toBeNull();
    const k = parseFloat(match![1]);
    expect(k).toBeGreaterThan(0.5);
    expect(k).toBeLessThan(5);
  });

  it("RMSE 改善率 ≥ 0%（k 调优至少不更差）", () => {
    const output = execSync(`npx tsx ${scriptPath}`, { encoding: "utf-8" });
    const match = output.match(/RMSE improvement: ([\d.-]+)%/);
    expect(match).not.toBeNull();
    const improvement = parseFloat(match![1]);
    // synthetic ground truth 用经验值拟合，best k 应该比 k=2 至少不更差
    expect(improvement).toBeGreaterThanOrEqual(0);
  });
});
