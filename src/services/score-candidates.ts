/**
 * P2-CRITICAL-FIX #6 (auto-promote): Score candidate pool
 *
 * 模型: 每次 successful calibration 跑完 → 产生 candidate → 落池
 *      池里某个 candidate 被标 active → 线上用的 k
 *      新 candidate vs active 比 RMSE → 优就自动 promote
 *      管理员可手动 reject/delete/promote/revert
 *
 * vs 之前的设计:
 *   - 之前: 一次 run → 直接改 env (没历史、没回滚、没门槛)
 *   - 现在: 多次 run → 候选池 → 系统/管理员决定谁 active
 *
 * 安全:
 *   - 管理员可关掉 auto-promote
 *   - 改善阈值默认 5% (RMSE 必须低至少 5% 才自动采纳)
 *   - 改之前/之后都持久化，可一键 revert
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type CandidateStatus = "active" | "candidate" | "rejected" | "deleted";

export interface ScoreCandidate {
  id: string;
  k: number;
  rmse: number;
  sampleSize: number;
  runId: string;
  status: CandidateStatus;
  createdAt: number;
  activatedAt?: number;
  rejectedAt?: number;
  notes?: string;
  /** vs 上一版 active 的 RMSE 改善 (%) — 仅 active 时有 */
  improvementVsPrevious?: number;
}

export interface CandidateStore {
  candidates: ScoreCandidate[];
  /** 当前 active candidate id */
  activeId: string | null;
  /** 全局 auto-promote 开关 */
  autoPromote: boolean;
  /** 改善阈值 (%)：新 candidate RMSE 需 < active RMSE * (1 - threshold) 才自动 promote */
  improvementThresholdPct: number;
  /** 上次改动时间 (审计) */
  lastChangedAt: number;
}

const DEFAULT_STORE: CandidateStore = {
  candidates: [],
  activeId: null,
  autoPromote: true,
  improvementThresholdPct: 5,
  lastChangedAt: 0,
};

let inMemory: CandidateStore | null = null;

/** 每次访问时算路径 (单测可设 SCORE_CAND_STORE_PATH 覆盖) */
function getStorePath(): string {
  if (process.env.SCORE_CAND_STORE_PATH) {
    return process.env.SCORE_CAND_STORE_PATH;
  }
  return resolve(process.cwd(), ".raos", "calibration", "candidates.json");
}

async function loadFromDisk(): Promise<CandidateStore> {
  if (inMemory) return inMemory;
  const path = getStorePath();
  if (!existsSync(path)) {
    inMemory = { ...DEFAULT_STORE };
    return inMemory;
  }
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content) as CandidateStore;
    inMemory = { ...DEFAULT_STORE, ...parsed };
  } catch (err) {
    console.warn("[score-candidates] failed to load store, using defaults:", err);
    inMemory = { ...DEFAULT_STORE };
  }
  return inMemory;
}

async function persist(): Promise<void> {
  if (!inMemory) return;
  const path = getStorePath();
  const dir = resolve(path, "..");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  // 原子写：写到 .tmp，再 rename
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(inMemory, null, 2), "utf-8");
  await rename(tmpPath, path);
}

// =============================================================================
// 运行时 k 值 (供 normalizeFtsScore 调用, 替代 process.env.FTS_SCORE_K)
// =============================================================================

let runtimeK: number = parseFloat(process.env.FTS_SCORE_K || "2");
let runtimeKSource: "env" | "candidate" = "env";
let runtimeKSetAt: number = Date.now();

export function getCurrentK(): { k: number; source: "env" | "candidate"; setAt: number } {
  return { k: runtimeK, source: runtimeKSource, setAt: runtimeKSetAt };
}

function setRuntimeK(k: number, source: "env" | "candidate") {
  runtimeK = k;
  runtimeKSource = source;
  runtimeKSetAt = Date.now();
}

// =============================================================================
// 公开 API
// =============================================================================

export async function getStore(): Promise<CandidateStore> {
  return loadFromDisk();
}

export async function setAutoPromote(enabled: boolean): Promise<void> {
  const s = await loadFromDisk();
  s.autoPromote = enabled;
  s.lastChangedAt = Date.now();
  await persist();
}

export async function setImprovementThreshold(pct: number): Promise<void> {
  const s = await loadFromDisk();
  s.improvementThresholdPct = Math.max(0, Math.min(50, pct));
  s.lastChangedAt = Date.now();
  await persist();
}

export async function getCandidates(): Promise<ScoreCandidate[]> {
  const s = await loadFromDisk();
  return s.candidates.slice();
}

export async function getActiveCandidate(): Promise<ScoreCandidate | null> {
  const s = await loadFromDisk();
  if (!s.activeId) return null;
  return s.candidates.find((c) => c.id === s.activeId) ?? null;
}

/**
 * 加一个新 candidate (从 successful calibration run 来的)
 *
 * 流程:
 *   1. 加为 'candidate'
 *   2. 如果 auto-promote 开 + 有 active + 改善 ≥ 阈值 → 改 active
 *   3. 如果没 active (首次) → 标 active
 *   4. 返回最终 status
 */
export async function addCandidate(input: {
  k: number;
  rmse: number;
  sampleSize: number;
  runId: string;
  notes?: string;
}): Promise<{ candidate: ScoreCandidate; autoPromoted: boolean; reason: string }> {
  const s = await loadFromDisk();

  const id = `cand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();

  const newCand: ScoreCandidate = {
    id,
    k: input.k,
    rmse: input.rmse,
    sampleSize: input.sampleSize,
    runId: input.runId,
    status: "candidate",
    createdAt: now,
    notes: input.notes,
  };

  // 找当前 active
  const activeCand = s.activeId ? s.candidates.find((c) => c.id === s.activeId) : null;

  // 第一次：直接标 active
  if (!activeCand) {
    newCand.status = "active";
    newCand.activatedAt = now;
    s.activeId = id;
    setRuntimeK(newCand.k, "candidate");
    s.candidates.push(newCand);
    s.lastChangedAt = now;
    await persist();
    return { candidate: newCand, autoPromoted: true, reason: "first candidate → auto-active" };
  }

  // 计算改善
  const improvementPct = ((activeCand.rmse - newCand.rmse) / activeCand.rmse) * 100;
  newCand.improvementVsPrevious = improvementPct;

  s.candidates.push(newCand);

  // 决定是否 auto-promote
  const passes = newCand.rmse < activeCand.rmse * (1 - s.improvementThresholdPct / 100);
  if (s.autoPromote && passes) {
    // 老 active 标 candidate
    activeCand.status = "candidate";
    newCand.status = "active";
    newCand.activatedAt = now;
    s.activeId = id;
    setRuntimeK(newCand.k, "candidate");
    s.lastChangedAt = now;
    await persist();
    return {
      candidate: newCand,
      autoPromoted: true,
      reason: `auto-promoted: RMSE ${newCand.rmse.toFixed(4)} < ${activeCand.rmse.toFixed(4)} * (1 - ${s.improvementThresholdPct}%) = ${(activeCand.rmse * (1 - s.improvementThresholdPct / 100)).toFixed(4)}, improvement ${improvementPct.toFixed(1)}%`,
    };
  }

  s.lastChangedAt = now;
  await persist();
  return {
    candidate: newCand,
    autoPromoted: false,
    reason: passes
      ? `kept as candidate (auto-promote disabled)`
      : `kept as candidate: improvement ${improvementPct.toFixed(1)}% < threshold ${s.improvementThresholdPct}%`,
  };
}

/** 管理员手动 promote (无视阈值) */
export async function promoteCandidate(id: string): Promise<{ ok: boolean; reason: string }> {
  const s = await loadFromDisk();
  const cand = s.candidates.find((c) => c.id === id);
  if (!cand) return { ok: false, reason: "candidate not found" };
  if (cand.status === "deleted") return { ok: false, reason: "candidate is deleted" };
  if (cand.status === "rejected") return { ok: false, reason: "candidate is rejected" };

  const oldActive = s.activeId ? s.candidates.find((c) => c.id === s.activeId) : null;
  if (oldActive) {
    oldActive.status = "candidate";
  }
  cand.status = "active";
  cand.activatedAt = Date.now();
  s.activeId = id;
  setRuntimeK(cand.k, "candidate");
  s.lastChangedAt = Date.now();
  await persist();
  return { ok: true, reason: `promoted k=${cand.k}` };
}

/** 管理员手动 reject (标记不会被 auto-promote，但仍可见) */
export async function rejectCandidate(id: string, notes?: string): Promise<{ ok: boolean; reason: string }> {
  const s = await loadFromDisk();
  const cand = s.candidates.find((c) => c.id === id);
  if (!cand) return { ok: false, reason: "candidate not found" };
  if (cand.status === "active") return { ok: false, reason: "cannot reject active candidate (revert first)" };
  if (cand.status === "deleted") return { ok: false, reason: "already deleted" };

  cand.status = "rejected";
  cand.rejectedAt = Date.now();
  if (notes) cand.notes = notes;
  s.lastChangedAt = Date.now();
  await persist();
  return { ok: true, reason: `rejected k=${cand.k}` };
}

/** 管理员手动 delete (从池里移除，但保留审计) */
export async function deleteCandidate(id: string): Promise<{ ok: boolean; reason: string }> {
  const s = await loadFromDisk();
  const cand = s.candidates.find((c) => c.id === id);
  if (!cand) return { ok: false, reason: "candidate not found" };
  if (cand.status === "active") return { ok: false, reason: "cannot delete active candidate (revert first)" };
  cand.status = "deleted";
  s.lastChangedAt = Date.now();
  await persist();
  return { ok: true, reason: `deleted k=${cand.k}` };
}

/** revert 到上一版 active (按 activatedAt 时间倒序) */
export async function revertActive(): Promise<{ ok: boolean; reason: string; newActive: ScoreCandidate | null }> {
  const s = await loadFromDisk();
  if (!s.activeId) return { ok: false, reason: "no active candidate", newActive: null };
  const currentActive = s.candidates.find((c) => c.id === s.activeId);
  if (!currentActive) return { ok: false, reason: "active not found", newActive: null };

  // 找上一版 (activatedAt < current.activatedAt 的最近一个)
  const previousActives = s.candidates
    .filter((c) => c.activatedAt && c.activatedAt < (currentActive.activatedAt ?? 0))
    .sort((a, b) => (b.activatedAt ?? 0) - (a.activatedAt ?? 0));

  if (previousActives.length === 0) {
    // 没上一版，回到 env
    currentActive.status = "candidate";
    s.activeId = null;
    const envK = parseFloat(process.env.FTS_SCORE_K || "2");
    setRuntimeK(envK, "env");
    s.lastChangedAt = Date.now();
    await persist();
    return { ok: true, reason: "reverted to env (no previous active)", newActive: null };
  }

  const newActive = previousActives[0];
  currentActive.status = "candidate";
  newActive.status = "active";
  newActive.activatedAt = Date.now();
  s.activeId = newActive.id;
  setRuntimeK(newActive.k, "candidate");
  s.lastChangedAt = Date.now();
  await persist();
  return { ok: true, reason: `reverted to k=${newActive.k}`, newActive };
}

/** 单测用：重置 in-memory cache */
export function __resetForTests(): void {
  inMemory = null;
  runtimeK = parseFloat(process.env.FTS_SCORE_K || "2");
  runtimeKSource = "env";
  runtimeKSetAt = Date.now();
}
