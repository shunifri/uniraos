/**
 * Plan State Manager — 计划状态管理
 *
 * 职责：
 * 1. 用户隔离的 plan 目录管理（.raos/workspace/<userId>/plans/）
 * 2. Plan 文件的 CRUD
 * 3. 计划列表、进度查询
 * 4. 同名/相同计划去重判断
 * 5. 文件锁（简易版）防止并发写冲突
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { withPlanLock, readPlanFileLocked, writePlanFileLocked } from "./plan-lock.js";
import { join, resolve, basename } from "path";
import { createHash } from "crypto";
import { PLAN_FILENAME_MAX_LENGTH } from "./plan-constants.js";
import { findPlanByConversationIdIndexed, invalidateUserIndex } from "./plan-index.js";
import { getCurrentUserId } from "../user/request-context.js";
import { log } from "../utils/logger.js";
import { getDb } from "../db/database.js";
import { parsePlan, serializePlan, createPlanContent, computeProgress } from "./plan-parser.js";
import type {
  ParsedPlan,
  PlanMeta,
  PlanSummary,
  CreatePlanInput,
  PlanStatus,
} from "./plan-types.js";

const SAFE_BASE = resolve(process.cwd(), ".raos", "workspace");

/** 获取用户 plan 目录 */
export function getUserPlanDir(userId?: string): string {
  const uid = userId || getCurrentUserId() || "anonymous";
  const dir = resolve(SAFE_BASE, uid, "plans");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 安全检查：确保路径在用户 workspace 内 */
function ensureSafePath(filePath: string, userId?: string): string {
  const planDir = getUserPlanDir(userId);
  const resolved = resolve(planDir, filePath);
  if (!resolved.startsWith(planDir)) {
    throw new Error(`路径安全违规: ${filePath} 超出用户 plan 目录`);
  }
  return resolved;
}

/** 生成文件路径（基于标题 + hash，防止冲突） */
function makePlanFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PLAN_FILENAME_MAX_LENGTH - 9); // 留空间给 "-hash.md"
  const hash = createHash("sha256").update(title).digest("hex").slice(0, 8);
  return `${base}-${hash}.md`;
}

/** 计算内容 hash（用于判断是否是"相同计划"） */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** 通过 conversationId 查找关联的计划（使用内存索引，O(1)） */
export function findPlanByConversationId(conversationId: string, userId?: string): { fileName: string; plan: ParsedPlan } | null {
  const indexed = findPlanByConversationIdIndexed(conversationId, userId);
  if (!indexed) return null;

  const planDir = getUserPlanDir(userId);
  const filePath = join(planDir, indexed.fileName);
  if (!existsSync(filePath)) {
    // 文件已被删除，索引失效，重试一次
    invalidateUserIndex(userId);
    const retry = findPlanByConversationIdIndexed(conversationId, userId);
    if (!retry) return null;
    return findPlanByConversationId(conversationId, userId);
  }

  try {
    const plan = readPlan(indexed.fileName, userId);
    return { fileName: indexed.fileName, plan };
  } catch {
    return null;
  }
}

/** 检查计划是否存在（同名或同内容） */
function findExistingPlan(
  planDir: string,
  title: string,
  contentHash?: string
): { fileName: string; plan: ParsedPlan } | null {
  const targetFile = makePlanFileName(title);
  const targetPath = join(planDir, targetFile);

  // 1. 先检查同名文件
  if (existsSync(targetPath)) {
    try {
      const raw = readPlanFileLocked(targetPath);
      const plan = parsePlan(raw);
      return { fileName: targetFile, plan };
    } catch {
      return null;
    }
  }

  // 2. 检查内容 hash 是否匹配（避免用户改了标题但内容一样）
  if (contentHash) {
    try {
      const files = readdirSync(planDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const raw = readPlanFileLocked(join(planDir, file));
        const plan = parsePlan(raw);
        const existingHash = hashContent(plan.content);
        if (existingHash === contentHash) {
          return { fileName: file, plan };
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

// ─── 公开 API ───

/** 创建新计划 */
export function createPlan(input: CreatePlanInput, userId?: string): { fileName: string; plan: ParsedPlan; isNew: boolean } {
  const planDir = getUserPlanDir(userId);
  const contentHash = hashContent(input.content);

  // 检查是否已存在
  const existing = findExistingPlan(planDir, input.title, contentHash);
  if (existing && !input.overwrite) {
    // 如果已有计划且状态不是 completed/failed，直接返回已存在的
    if (!["completed", "failed", "cancelled"].includes(existing.plan.meta.status)) {
      log("info", "plan_reuse_existing", { planId: existing.plan.meta.planId, title: input.title });
      return { fileName: existing.fileName, plan: existing.plan, isNew: false };
    }
    // 如果已完成/失败，且没有强制覆盖，创建带版本号的文件名
  }

  const fileName = existing && !input.overwrite
    ? `${makePlanFileName(input.title).replace(".md", "")}_${Date.now()}.md`
    : makePlanFileName(input.title);

  const filePath = join(planDir, fileName);

  // 如果覆盖，先删除旧文件
  if (input.overwrite && existing && existing.fileName !== fileName) {
    try { unlinkSync(join(planDir, existing.fileName)); } catch { /* ignore */ }
  }

  const mdContent = createPlanContent(input.title, input.content, input.tags, input.conversationId);
  writePlanFileLocked(filePath, mdContent);

  const plan = parsePlan(mdContent);
  log("info", "plan_created", { planId: plan.meta.planId, fileName, userId: userId || getCurrentUserId() });
  invalidateUserIndex(userId);

  return { fileName, plan, isNew: true };
}

/** 读取计划 */
export function readPlan(fileName: string, userId?: string): ParsedPlan {
  const filePath = ensureSafePath(fileName, userId);
  if (!existsSync(filePath)) {
    throw new Error(`计划文件不存在: ${fileName}`);
  }
  const raw = readPlanFileLocked(filePath);
  return parsePlan(raw);
}

/** 保存计划（更新状态） */
export function savePlan(fileName: string, plan: ParsedPlan, userId?: string): void {
  const filePath = ensureSafePath(fileName, userId);
  plan.meta.updatedAt = Date.now();
  const content = serializePlan(plan);
  writePlanFileLocked(filePath, content);
  invalidateUserIndex(userId);
}

/** 删除计划 */
export function deletePlan(fileName: string, userId?: string): boolean {
  try {
    const filePath = ensureSafePath(fileName, userId);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      invalidateUserIndex(userId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 更新计划状态 */
export async function updatePlanStatus(
  fileName: string,
  status: PlanStatus,
  options?: { currentStep?: number; error?: string },
  userId?: string
): Promise<ParsedPlan> {
  const filePath = ensureSafePath(fileName, userId);
  return withPlanLock(filePath, () => {
    const plan = readPlan(fileName, userId);
    plan.meta.status = status;
    if (options?.currentStep !== undefined) plan.meta.currentStep = options.currentStep;
    if (options?.error !== undefined) plan.meta.error = options.error;
    savePlan(fileName, plan, userId);
    return plan;
  });
}

/** 更新步骤状态 */
export async function updateStepStatus(
  fileName: string,
  stepIndex: number,
  status: ParsedPlan["steps"][number]["status"],
  options?: { result?: string; error?: string; output?: string },
  userId?: string
): Promise<ParsedPlan> {
  const filePath = ensureSafePath(fileName, userId);
  return withPlanLock(filePath, () => {
    const plan = readPlan(fileName, userId);
    const step = plan.steps.find((s) => s.index === stepIndex);
    if (!step) {
      throw new Error(`步骤 ${stepIndex} 不存在`);
    }
    step.status = status;
    if (status === "running" && !step.startedAt) step.startedAt = Date.now();
    if (["completed", "failed", "skipped"].includes(status)) step.finishedAt = Date.now();
    if (options?.result !== undefined) step.result = options.result;
    if (options?.error !== undefined) step.error = options.error;
    if (options?.output !== undefined) step.output = options.output;

    // 自动更新当前步骤索引
    const firstPending = plan.steps.findIndex((s) => s.status === "pending");
    plan.meta.currentStep = firstPending >= 0 ? firstPending : plan.steps.length;

    // 自动推断整体状态
    const allCompleted = plan.steps.every((s) => s.status === "completed" || s.status === "skipped");
    const anyFailed = plan.steps.some((s) => s.status === "failed");
    if (allCompleted) plan.meta.status = "completed";
    else if (anyFailed && status === "failed") plan.meta.status = "failed";
    else if (status === "running") plan.meta.status = "running";

    savePlan(fileName, plan, userId);
    invalidateUserIndex(userId);
    return plan;
  });
}

/** 列出用户所有计划 */
export function listPlans(userId?: string): PlanSummary[] {
  const planDir = getUserPlanDir(userId);
  try {
    const files = readdirSync(planDir).filter((f) => f.endsWith(".md"));
    const summaries: PlanSummary[] = [];

    for (const file of files) {
      try {
        const plan = readPlan(file, userId);
        summaries.push({
          planId: plan.meta.planId,
          fileName: file,
          title: plan.meta.title,
          status: plan.meta.status,
          createdAt: plan.meta.createdAt,
          updatedAt: plan.meta.updatedAt,
          progress: computeProgress(plan),
          currentStep: plan.meta.currentStep,
          totalSteps: plan.meta.totalSteps,
        });
      } catch {
        // 跳过解析失败的文件
      }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** 查询单个计划进度详情 */
export function getPlanProgress(fileName: string, userId?: string): {
  summary: PlanSummary;
  steps: ParsedPlan["steps"];
} {
  const plan = readPlan(fileName, userId);
  return {
    summary: {
      planId: plan.meta.planId,
      fileName,
      title: plan.meta.title,
      status: plan.meta.status,
      createdAt: plan.meta.createdAt,
      updatedAt: plan.meta.updatedAt,
      progress: computeProgress(plan),
      currentStep: plan.meta.currentStep,
      totalSteps: plan.meta.totalSteps,
    },
    steps: plan.steps,
  };
}

/** 暂停计划 */
export async function pausePlan(fileName: string, userId?: string): Promise<ParsedPlan> {
  return updatePlanStatus(fileName, "paused", undefined, userId);
}

/** 恢复计划 */
export async function resumePlan(fileName: string, userId?: string): Promise<ParsedPlan> {
  const plan = readPlan(fileName, userId);
  if (plan.meta.status === "paused" || plan.meta.status === "failed") {
    return updatePlanStatus(fileName, "running", { currentStep: plan.meta.currentStep }, userId);
  }
  return plan;
}

/** 取消计划 */
export async function cancelPlan(fileName: string, userId?: string): Promise<ParsedPlan> {
  return updatePlanStatus(fileName, "cancelled", undefined, userId);
}

/** 更新计划 frontmatter 元数据（用于心跳等轻量更新） */
export async function updatePlanMeta(
  fileName: string,
  metaUpdates: Partial<PlanMeta>,
  userId?: string
): Promise<ParsedPlan> {
  const filePath = ensureSafePath(fileName, userId);
  return withPlanLock(filePath, () => {
    const content = readPlanFileLocked(filePath);
    const plan = parsePlan(content);
    Object.assign(plan.meta, metaUpdates);
    plan.meta.updatedAt = Date.now();
    writePlanFileLocked(filePath, serializePlan(plan));
    invalidateUserIndex(userId);
    return plan;
  });
}

/** 向对话中插入进度消息 */
export async function saveChatMessage(
  conversationId: string,
  role: string,
  content: string,
  opts?: { skillName?: string; status?: string; isError?: boolean; extra?: unknown }
): Promise<void> {
  if (!conversationId) return;
  try {
    const extraJson = opts?.extra ? JSON.stringify(opts.extra) : null;
    
      const db = getDb();
      if (!db) return;
      const insertMsg = db.prepare("INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)");
      insertMsg.run(conversationId, role, content, opts?.skillName || null, opts?.status || null, opts?.isError ? 1 : 0, extraJson);
    
  } catch (err) {
    log("warn", "plan_save_chat_msg_failed", { conversationId, error: err instanceof Error ? err.message : String(err) });
  }
}
