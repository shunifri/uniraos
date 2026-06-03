/**
 * P2-CRITICAL-FIX #6 (auto-promote): Score candidate pool tests
 *
 * 验证候选池 + auto-promote 行为:
 *   - 第一次 add → 直接 active
 *   - auto-promote + RMSE 优 → 自动 promote
 *   - auto-promote + RMSE 不够优 → 保持 candidate
 *   - auto-promote 关掉 → 不自动 promote
 *   - 手动 promote / reject / delete / revert
 *   - threshold 0% 时即使微优也 promote
 *   - 多个 candidate 池中按激活时间排序
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("score-candidates (#6 candidate pool)", () => {
  let tmpDir: string;
  let storePath: string;
  let mod: typeof import("../../src/services/score-candidates.js");

  beforeEach(async () => {
    // 每个测试用全新 module instance (避免 vitest module 缓存的 inMemory 污染)
    vi.resetModules();
    // 用 SCORE_CAND_STORE_PATH env 让 store 写到独立文件, 避免测试间污染
    tmpDir = mkdtempSync(join(tmpdir(), "score-cand-test-"));
    storePath = join(tmpDir, "candidates.json");
    process.env.SCORE_CAND_STORE_PATH = storePath;
    mod = await import("../../src/services/score-candidates.js");
    // 默认开 auto-promote + 5% threshold
    await mod.setAutoPromote(true);
    await mod.setImprovementThreshold(5);
  });

  afterEach(() => {
    delete process.env.SCORE_CAND_STORE_PATH;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("第一次 addCandidate: 直接 active, k 立即生效", async () => {
    const r = await mod.addCandidate({ k: 1.5, rmse: 0.25, sampleSize: 100, runId: "r1" });
    expect(r.candidate.status).toBe("active");
    expect(r.autoPromoted).toBe(true);
    expect(r.reason).toContain("first");
    const k = mod.getCurrentK();
    expect(k.k).toBe(1.5);
    expect(k.source).toBe("candidate");
    const active = await mod.getActiveCandidate();
    expect(active?.id).toBe(r.candidate.id);
  });

  it("新 candidate RMSE 优 ≥ 5%: auto-promote, 老 active → candidate", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    expect(first.candidate.status).toBe("active");

    const second = await mod.addCandidate({ k: 1.5, rmse: 0.25, sampleSize: 100, runId: "r2" });
    expect(second.candidate.status).toBe("active");
    expect(second.autoPromoted).toBe(true);
    expect(second.reason).toContain("auto-promoted");

    // 老 active 变 candidate
    const all = await mod.getCandidates();
    const oldActive = all.find((c) => c.id === first.candidate.id);
    expect(oldActive?.status).toBe("candidate");
    expect(mod.getCurrentK().k).toBe(1.5);
  });

  it("新 candidate RMSE 改善 < 5%: 保持 candidate, 不 promote", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });

    // 改善 3% (0.291 vs 0.30) — 小于 5% 阈值
    const second = await mod.addCandidate({ k: 1.9, rmse: 0.291, sampleSize: 100, runId: "r2" });
    expect(second.candidate.status).toBe("candidate");
    expect(second.autoPromoted).toBe(false);
    expect(second.reason).toContain("threshold 5%");
    expect(mod.getCurrentK().k).toBe(2.0); // 仍用 first 的
  });

  it("新 candidate RMSE 反而更差: 保持 candidate", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });

    const second = await mod.addCandidate({ k: 1.5, rmse: 0.35, sampleSize: 100, runId: "r2" });
    expect(second.candidate.status).toBe("candidate");
    expect(second.autoPromoted).toBe(false);
    expect(mod.getCurrentK().k).toBe(2.0);
  });

  it("auto-promote 关掉: 即使 RMSE 优也不自动 promote", async () => {
    await mod.setAutoPromote(false);
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    const second = await mod.addCandidate({ k: 1.5, rmse: 0.20, sampleSize: 100, runId: "r2" }); // 33% 改善
    expect(second.candidate.status).toBe("candidate");
    expect(second.autoPromoted).toBe(false);
    expect(second.reason).toContain("auto-promote disabled");
    expect(mod.getCurrentK().k).toBe(2.0);
  });

  it("threshold 调成 0%: 微优也 promote", async () => {
    await mod.setImprovementThreshold(0);
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    // 改善 0.1%
    const second = await mod.addCandidate({ k: 1.99, rmse: 0.2997, sampleSize: 100, runId: "r2" });
    expect(second.candidate.status).toBe("active");
    expect(mod.getCurrentK().k).toBe(1.99);
  });

  it("手动 promote: 无视阈值", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    const second = await mod.addCandidate({ k: 1.5, rmse: 0.29, sampleSize: 100, runId: "r2" }); // 3% 改善
    expect(second.candidate.status).toBe("candidate");

    // 管理员手动 promote
    const result = await mod.promoteCandidate(second.candidate.id);
    expect(result.ok).toBe(true);
    expect(mod.getCurrentK().k).toBe(1.5);

    const all = await mod.getCandidates();
    const old = all.find((c) => c.id === first.candidate.id);
    expect(old?.status).toBe("candidate");
  });

  it("手动 reject: 状态 → rejected (保留在池里)", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    const second = await mod.addCandidate({ k: 1.5, rmse: 0.40, sampleSize: 100, runId: "r2" });

    const r = await mod.rejectCandidate(second.candidate.id, "RMSE too high");
    expect(r.ok).toBe(true);
    const all = await mod.getCandidates();
    const rejected = all.find((c) => c.id === second.candidate.id);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.notes).toBe("RMSE too high");
  });

  it("手动 delete: 状态 → deleted (软删, 审计保留)", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    const second = await mod.addCandidate({ k: 1.5, rmse: 0.40, sampleSize: 100, runId: "r2" });

    const r = await mod.deleteCandidate(second.candidate.id);
    expect(r.ok).toBe(true);
    const all = await mod.getCandidates();
    const deleted = all.find((c) => c.id === second.candidate.id);
    expect(deleted?.status).toBe("deleted");
  });

  it("不能 reject / delete 当前的 active", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    const r1 = await mod.rejectCandidate(first.candidate.id);
    expect(r1.ok).toBe(false);
    expect(r1.reason).toContain("active");
    const r2 = await mod.deleteCandidate(first.candidate.id);
    expect(r2.ok).toBe(false);
  });

  it("revert: 回到上一版 active (按 activatedAt)", async () => {
    const first = await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    // 等 5ms 避免 activatedAt 完全相同
    await new Promise((r) => setTimeout(r, 5));
    const second = await mod.addCandidate({ k: 1.5, rmse: 0.20, sampleSize: 100, runId: "r2" });
    expect(second.candidate.status).toBe("active");
    expect(mod.getCurrentK().k).toBe(1.5);

    const r = await mod.revertActive();
    expect(r.ok).toBe(true);
    expect(mod.getCurrentK().k).toBe(2.0); // 回到 first

    // first 重新 active, second → candidate
    const all = await mod.getCandidates();
    const f = all.find((c) => c.id === first.candidate.id);
    const s = all.find((c) => c.id === second.candidate.id);
    expect(f?.status).toBe("active");
    expect(s?.status).toBe("candidate");
  });

  it("revert: 没有上一版 → 回到 env", async () => {
    const first = await mod.addCandidate({ k: 1.5, rmse: 0.25, sampleSize: 100, runId: "r1" });
    const r = await mod.revertActive();
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("env");
    expect(r.newActive).toBeNull();
    expect(mod.getCurrentK().source).toBe("env");
  });

  it("池里有 N 个 candidates 时, getCandidates 返回所有", async () => {
    await mod.addCandidate({ k: 2.0, rmse: 0.30, sampleSize: 100, runId: "r1" });
    await mod.addCandidate({ k: 1.5, rmse: 0.40, sampleSize: 100, runId: "r2" });
    await mod.addCandidate({ k: 1.8, rmse: 0.35, sampleSize: 100, runId: "r3" });
    const all = await mod.getCandidates();
    expect(all.length).toBe(3);
  });
});
