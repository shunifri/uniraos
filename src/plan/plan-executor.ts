/**
 * Plan Executor — 计划执行引擎
 *
 * 职责：
 * 1. 执行计划中的单个步骤
 * 2. 持续推进计划（同 session 或跨 session 通过 Scheduler）
 * 3. 服务启动时恢复中断的计划
 * 4. 步骤超时和重试控制
 */

import { log } from "../utils/logger.js";
import type { ExecutionEngine } from "../engine/execution-engine.js";
import {
  readPlan,
  savePlan,
  updateStepStatus,
  updatePlanStatus,
  getUserPlanDir,
  listPlans,
  saveChatMessage,
} from "./plan-state.js";
import { computeProgress } from "./plan-parser.js";
import { inboxEventBus } from "../inbox/inbox-events.js";
import type {
  ParsedPlan,
  PlanExecutionResult,
  PlanExecuteOptions,
  PlanStep,
} from "./plan-types.js";
import {
  DEFAULT_STEP_TIMEOUT_MS,
  PLAN_HEARTBEAT_INTERVAL_MS,
  STALE_PLAN_THRESHOLD_MS,
} from "./plan-constants.js";

const DEFAULT_MAX_RETRIES = 0;

/** 正在执行的计划文件路径集合，防止重复并发执行 */
const executingPlans = new Set<string>();

function acquireExecutionLock(filePath: string): boolean {
  if (executingPlans.has(filePath)) {
    return false;
  }
  executingPlans.add(filePath);
  return true;
}

function releaseExecutionLock(filePath: string): void {
  executingPlans.delete(filePath);
}

/** 执行计划的一个步骤 */
export async function executeStep(
  fileName: string,
  stepIndex: number,
  engine: ExecutionEngine,
  userId?: string,
  options?: { requireConfirm?: boolean; stepTimeoutMs?: number }
): Promise<{ success: boolean; result?: string; error?: string; output?: string }> {
  const plan = readPlan(fileName, userId);
  const step = plan.steps.find((s) => s.index === stepIndex);
  if (!step) {
    return { success: false, error: `步骤 ${stepIndex} 不存在` };
  }

  // 检查是否需要用户确认
  const needsConfirm = options?.requireConfirm || step.description.includes("[confirm]");
  if (needsConfirm) {
    const confirmResult = await engine.execute("user_confirm", {
      type: "approval",
      title: `确认执行步骤 ${stepIndex + 1}`,
      description: `${step.description}\n\n是否继续执行？`,
      confirmText: "继续执行",
      cancelText: "跳过此步骤",
    });
    if (!confirmResult.success || (confirmResult.data as any)?.cancelled) {
      await updateStepStatus(fileName, stepIndex, "skipped", { result: "skipped by user" }, userId);
      await notifyStepProgress(plan, stepIndex, "skipped", "用户跳过了此步骤", userId);
      return { success: true, result: "skipped" };
    }
  }

  // 标记为执行中
  await updateStepStatus(fileName, stepIndex, "running", undefined, userId);
  await notifyStepProgress(plan, stepIndex, "running", undefined, userId);
  log("info", "plan_step_start", { planId: plan.meta.planId, step: stepIndex, description: step.description });

  try {
    // 解析步骤描述，尝试提取 skill 调用
    const skillCall = parseSkillCall(step.description);

    const stepTimeoutMs = options?.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`步骤执行超时 (${stepTimeoutMs}ms)`)), stepTimeoutMs);
    });

    let result: { success: boolean; data?: unknown; error?: Error };

    // 启动心跳定时器
    const heartbeatTimer = setInterval(async () => {
      try {
        const { updatePlanMeta } = await import("./plan-state.js");
        await updatePlanMeta(fileName, { lastHeartbeat: Date.now() }, userId);
      } catch {
        // 忽略心跳更新失败
      }
    }, PLAN_HEARTBEAT_INTERVAL_MS);

    try {
      if (skillCall) {
        result = await Promise.race([engine.execute(skillCall.skillName, skillCall.params), timeoutPromise]);
      } else {
        // 没有明确 skill，使用 plan_and_execute 让 LLM 自己规划这一步
        result = await Promise.race([
          engine.execute("plan_and_execute", {
            task: step.description,
            max_steps: 5,
            allow_replan: true,
          }),
          timeoutPromise,
        ]);
      }
    } finally {
      clearInterval(heartbeatTimer);
    }

    if (result.success) {
      const output = result.data ? JSON.stringify(result.data, null, 2).slice(0, 2000) : "完成";
      await updateStepStatus(
        fileName,
        stepIndex,
        "completed",
        { result: "success", output },
        userId
      );
      await notifyStepProgress(plan, stepIndex, "completed", output, userId);
      log("info", "plan_step_completed", { planId: plan.meta.planId, step: stepIndex });
      return { success: true, result: "success", output };
    } else {
      const errorMsg = result.error?.message || "执行失败";
      await updateStepStatus(
        fileName,
        stepIndex,
        "failed",
        { result: "failed", error: errorMsg },
        userId
      );
      await notifyStepProgress(plan, stepIndex, "failed", errorMsg, userId);
      log("error", "plan_step_failed", { planId: plan.meta.planId, step: stepIndex, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    await updateStepStatus(
      fileName,
      stepIndex,
      "failed",
      { result: "failed", error: errorMsg },
      userId
    );
    await notifyStepProgress(plan, stepIndex, "failed", errorMsg, userId);
    log("error", "plan_step_exception", { planId: plan.meta.planId, step: stepIndex, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/** 向关联对话通知步骤进度 */
async function notifyStepProgress(
  plan: ParsedPlan,
  stepIndex: number,
  status: string,
  detail?: string,
  userId?: string
): Promise<void> {
  const convId = plan.meta.conversationId;
  if (!convId) return;

  const step = plan.steps.find((s) => s.index === stepIndex);
  if (!step) return;

  const progress = Math.round(
    ((plan.steps.filter((s) => s.status === "completed" || s.status === "skipped").length) / plan.steps.length) * 100
  );

  const emoji = status === "running" ? "🔄" : status === "completed" ? "✅" : status === "failed" ? "❌" : status === "skipped" ? "⏭️" : status === "scheduled" ? "⏰" : "📋";
  const content = `${emoji} **计划进度** [${progress}%] — ${plan.meta.title}\n\n**步骤 ${stepIndex + 1}/${plan.steps.length}:** ${step.description}\n**状态:** ${status}${detail ? `\n**详情:** ${detail.slice(0, 500)}` : ""}`;

  // 1. 持久化到 chat_messages（用户回来能看到历史）
  await saveChatMessage(convId, "system", content, {
    skillName: "plan_execute",
    extra: { planId: plan.meta.planId, stepIndex, status, progress },
  });

  // 2. 实时推送到 inbox SSE（用户在线时秒收到）
  inboxEventBus.emitInboxEvent({
    type: "chat_message",
    userId: userId || "anonymous",
    item: {
      id: `plan_${plan.meta.planId}_${stepIndex}_${Date.now()}`,
      userId: userId || "anonymous",
      type: "notification",
      category: "plan_progress",
      source: "system",
      title: `计划进度 [${progress}%]`,
      description: content,
      priority: "normal",
      status: "unread",
      payload: { planId: plan.meta.planId, stepIndex, status, progress, conversationId: convId },
      createdAt: Date.now(),
    } as any,
  });
}

/** 持续执行计划（从当前步骤到完成或失败） */
export async function executePlan(
  fileName: string,
  engine: ExecutionEngine,
  options: PlanExecuteOptions = {},
  userId?: string
): Promise<PlanExecutionResult> {
  const filePath = getUserPlanDir(userId) + "/" + fileName;
  if (!acquireExecutionLock(filePath)) {
    log("warn", "plan_already_executing", { fileName, userId });
    return {
      planId: "",
      success: false,
      message: "计划正在执行中，跳过重复调用",
      completedSteps: 0,
      totalSteps: 0,
    };
  }

  try {
  const plan = readPlan(fileName, userId);

  if (plan.meta.status === "completed") {
    await notifyPlanCompletion(plan, true, "计划已完成", userId);
    return {
      planId: plan.meta.planId,
      success: true,
      message: "计划已完成",
      completedSteps: plan.steps.length,
      totalSteps: plan.steps.length,
    };
  }

  if (plan.meta.status === "cancelled") {
    return {
      planId: plan.meta.planId,
      success: false,
      message: "计划已取消",
      completedSteps: plan.steps.filter((s) => s.status === "completed").length,
      totalSteps: plan.steps.length,
    };
  }

  // 标记计划为运行中
  await updatePlanStatus(fileName, "running", undefined, userId);

  const startStep = options.fromStep ?? Math.max(0, plan.meta.currentStep);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let i = startStep; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (step.status === "completed" || step.status === "skipped") continue;

    let retryCount = 0;
    let stepResult: { success: boolean; error?: string } | null = null;

    do {
      stepResult = await executeStep(fileName, i, engine, userId, { stepTimeoutMs: options.stepTimeoutMs });
      if (!stepResult.success && retryCount < maxRetries) {
        retryCount++;
        log("info", "plan_step_retry", { planId: plan.meta.planId, step: i, retry: retryCount });
        await delay(1000 * retryCount); // 指数退避
      }
    } while (!stepResult.success && retryCount < maxRetries);

    if (!stepResult.success) {
      const shouldContinue = step.optional || options.continueOnFailure;
      if (shouldContinue) {
        log("info", "plan_step_failed_continue", { planId: plan.meta.planId, step: i, optional: step.optional, continueOnFailure: options.continueOnFailure });
        // 继续执行后续步骤，不标记整个计划为失败
        continue;
      }
      // 步骤失败，停止执行
      await updatePlanStatus(fileName, "failed", { error: stepResult.error }, userId);
      await cancelScheduledPlanEvents(fileName, userId);
      await notifyPlanCompletion(plan, false, `步骤 ${i + 1} 执行失败: ${stepResult.error}`, userId);
      return {
        planId: plan.meta.planId,
        success: false,
        message: `步骤 ${i + 1} 执行失败: ${stepResult.error}`,
        completedSteps: plan.steps.filter((s) => s.status === "completed").length,
        totalSteps: plan.steps.length,
        failedStep: i,
        error: stepResult.error,
      };
    }

    // 步骤间延迟
    if (options.stepDelayMs && options.stepDelayMs > 0) {
      await delay(options.stepDelayMs);
    }

    // 如果配置了异步推进，每步完成后安排下一步
    if (options.asyncProgress && i < plan.steps.length - 1) {
      const nextStep = i + 1;
      await scheduleNextStep(fileName, nextStep, options, userId);
      const updatedPlan = readPlan(fileName, userId);
      await notifyStepProgress(updatedPlan, i, "scheduled", `已安排步骤 ${nextStep + 1} 执行`, userId);
      return {
        planId: plan.meta.planId,
        success: true,
        message: `步骤 ${i + 1} 完成，已安排下一步执行`,
        completedSteps: i + 1,
        totalSteps: plan.steps.length,
      };
    }
  }

  // 所有步骤完成
  await updatePlanStatus(fileName, "completed", undefined, userId);
  await cancelScheduledPlanEvents(fileName, userId);
  const finalPlan = readPlan(fileName, userId);
  await notifyPlanCompletion(finalPlan, true, "计划执行完成", userId);
  return {
    planId: plan.meta.planId,
    success: true,
    message: "计划执行完成",
    completedSteps: plan.steps.length,
    totalSteps: plan.steps.length,
  };
  } finally {
    releaseExecutionLock(filePath);
  }
}

/** 安排下一步通过 Scheduler 执行（跨 session） */
async function scheduleNextStep(
  fileName: string,
  nextStepIndex: number,
  options: PlanExecuteOptions,
  userId?: string
): Promise<void> {
  // Community Edition: scheduler removed; async progression is disabled.
  const plan = readPlan(fileName, userId);
  log("info", "plan_scheduler_disabled", {
    planId: plan.meta.planId,
    nextStep: nextStepIndex,
    delayMs: options.stepDelayMs || 0,
  });
}

/** 取消计划关联的所有已安排 Scheduler 事件 */
export async function cancelScheduledPlanEvents(fileName: string, userId?: string): Promise<void> {
  try {
    const plan = readPlan(fileName, userId);
    const eventIds = plan.meta.scheduledEventIds || [];
    if (eventIds.length === 0) return;

    // Community Edition: scheduler removed; just clear stored event IDs.
    const { updatePlanMeta } = await import("./plan-state.js");
    await updatePlanMeta(fileName, { scheduledEventIds: [] }, userId);
    log("info", "plan_scheduler_cleanup", { planId: plan.meta.planId, cancelledCount: eventIds.length });
  } catch {
    // 忽略清理错误
  }
}

/** 服务启动时恢复中断的计划 */
export async function resumeInterruptedPlans(engine: ExecutionEngine): Promise<void> {
  try {
    // 扫描所有用户的 plan 目录
    // 简化版：只扫描当前上下文的用户？不，恢复应该全局扫描
    // 但由于安全限制，我们先只处理能访问到的

    // 实际上更好的方式是通过数据库查询 running/paused 状态的计划
    // 但当前 plan 状态存在文件里，需要遍历
    // 这是一个简化实现

    log("info", "plan_resume_scan_start");

    // 获取所有用户目录（在 .raos/workspace/ 下）
    const { readdirSync, statSync } = await import("fs");
    const { resolve } = await import("path");
    const wsBase = resolve(process.cwd(), ".raos", "workspace");

    let resumedCount = 0;

    try {
      const entries = readdirSync(wsBase);
      for (const entry of entries) {
        const planDir = resolve(wsBase, entry, "plans");
        try {
          if (!statSync(planDir).isDirectory()) continue;
        } catch {
          continue;
        }

        const files = readdirSync(planDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          try {
            const plan = readPlan(file, entry);
            if (plan.meta.status === "running") {
              // 检查最后心跳或 running 步骤的 startedAt，如果超过 30 分钟未更新，认为中断，自动恢复
              const runningStep = plan.steps.find((s) => s.status === "running");
              const lastActivity = runningStep?.startedAt ?? plan.meta.lastHeartbeat ?? plan.meta.updatedAt;
              const idleTime = Date.now() - lastActivity;
              if (idleTime > STALE_PLAN_THRESHOLD_MS) {
                log("info", "plan_auto_resume", { planId: plan.meta.planId, userId: entry, idleMin: Math.round(idleTime / 60000) });
                await executePlan(file, engine, { asyncProgress: true }, entry);
                resumedCount++;
              }
            }
          } catch {
            // 跳过解析失败的
          }
        }
      }
    } catch {
      // workspace 目录可能不存在
    }

    log("info", "plan_resume_scan_done", { resumedCount });
  } catch (err: any) {
    log("error", "plan_resume_scan_error", { error: err.message });
  }
}

/** 解析步骤描述中的 skill 调用 */
function parseSkillCall(description: string): { skillName: string; params: Record<string, unknown> } | null {
  // 匹配 "Run: skill_name({...})" 或 "使用 skill_name(...)"
  const runMatch = description.match(/(?:Run|使用|调用)\s*[:：]?\s*([\w_]+)\s*\((.*)\)/i);
  if (runMatch) {
    const skillName = runMatch[1];
    const paramsStr = runMatch[2].trim();
    try {
      // 尝试解析 JSON 参数
      if (paramsStr.startsWith("{") || paramsStr.startsWith("[")) {
        const params = JSON.parse(paramsStr);
        return { skillName, params };
      }
      // 简单 key=value 解析
      const params: Record<string, unknown> = {};
      for (const pair of paramsStr.split(",")) {
        const [k, v] = pair.split("=").map((s) => s.trim());
        if (k) params[k] = v || "";
      }
      return { skillName, params };
    } catch {
      return { skillName, params: {} };
    }
  }

  // 匹配 "skill_name: ..." 格式
  const simpleMatch = description.match(/^([\w_]+)\s*[:：]\s*(.+)/);
  if (simpleMatch) {
    return { skillName: simpleMatch[1], params: { task: simpleMatch[2].trim() } };
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/** 通知计划整体完成/失败 */
async function notifyPlanCompletion(
  plan: ParsedPlan,
  success: boolean,
  message: string,
  userId?: string
): Promise<void> {
  const convId = plan.meta.conversationId;
  if (!convId) return;

  const progress = computeProgress(plan);
  const emoji = success ? "🎉" : "⚠️";
  const content = `${emoji} **计划${success ? "完成" : "失败"}** [${progress}%] — ${plan.meta.title}\n\n${message}\n\n**总进度:** ${plan.steps.filter((s) => s.status === "completed").length}/${plan.steps.length} 步骤已完成`;

  await saveChatMessage(convId, "system", content, {
    skillName: "plan_execute",
    extra: { planId: plan.meta.planId, status: plan.meta.status, progress, success },
  });

  inboxEventBus.emitInboxEvent({
    type: "chat_message",
    userId: userId || "anonymous",
    item: {
      id: `plan_${plan.meta.planId}_done_${Date.now()}`,
      userId: userId || "anonymous",
      type: "notification",
      category: "plan_progress",
      source: "system",
      title: `计划${success ? "完成" : "失败"}`,
      description: content,
      priority: success ? "normal" : "high",
      status: "unread",
      payload: { planId: plan.meta.planId, status: plan.meta.status, progress, success, conversationId: convId },
      createdAt: Date.now(),
    } as any,
  });
}
