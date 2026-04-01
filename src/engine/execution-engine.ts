import type {
  ExecutionContext,
  ExecutionResult,
  SkillDefinition,
  SkillResult,
  TraceEntry,
} from "../types/index.js";
import { Autonomy } from "../types/index.js";
import { SkillRegistry } from "../registry/index.js";
import { WALManager } from "../wal/index.js";
import {
  MaxDepthExceededError,
  CallBudgetExhaustedError,
  SkillTimeoutError,
} from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { MetricsCollector } from "./metrics.js";
import { CircuitBreakerManager } from "./circuit-breaker.js";
import type { EmergenceDetector } from "./emergence-detector.js";
import type { SkillLifecycleManager } from "./skill-lifecycle.js";

export interface EngineConfig {
  maxDepth: number;
  callBudget: number;
}

const DEFAULT_CONFIG: EngineConfig = {
  maxDepth: 50,
  callBudget: 200,
};

/** 已完成步骤记录（用于 SAGA 补偿） */
interface CompletedStep {
  skillName: string;
  params: Record<string, unknown>;
  result: unknown;
}

export class ExecutionEngine {
  private registry: SkillRegistry;
  private wal: WALManager;
  private config: EngineConfig;
  readonly metrics: MetricsCollector;
  readonly circuitBreakers: CircuitBreakerManager;
  private emergenceDetector: EmergenceDetector | null = null;
  private lifecycleManager: SkillLifecycleManager | null = null;

  /** 执行历史（供 UI 查询） */
  private history: ExecutionResult[] = [];

  constructor(
    registry: SkillRegistry,
    wal: WALManager,
    config?: Partial<EngineConfig>,
  ) {
    this.registry = registry;
    this.wal = wal;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = new MetricsCollector();
    this.circuitBreakers = new CircuitBreakerManager();
  }

  /** 设置涌现检测器 */
  setEmergenceDetector(detector: EmergenceDetector): void {
    this.emergenceDetector = detector;
  }

  /** 设置生命周期管理器 */
  setLifecycleManager(manager: SkillLifecycleManager): void {
    this.lifecycleManager = manager;
  }

  /** 执行一个 Skill（顶层入口） */
  async execute(
    skillName: string,
    params: Record<string, unknown> = {},
  ): Promise<ExecutionResult> {
    const context: ExecutionContext = {
      traceId: crypto.randomUUID(),
      callStack: [],
      depth: 0,
      maxDepth: this.config.maxDepth,
      callBudget: { remaining: this.config.callBudget },
      trace: [],
    };

    const completedSteps: CompletedStep[] = [];
    let result: SkillResult;

    try {
      result = await this.executeRecursive(skillName, params, context, undefined, completedSteps);
    } catch (err) {
      // SAGA：失败时反向补偿已完成的步骤
      if (completedSteps.length > 0) {
        await this.runCompensation(completedSteps, context);
      }
      throw err;
    }

    const execResult: ExecutionResult = {
      ...result,
      trace: context.trace,
      traceId: context.traceId,
    };

    this.history.push(execResult);
    return execResult;
  }

  /** 获取执行历史 */
  getHistory(): ExecutionResult[] {
    return this.history;
  }

  /** 递归执行核心 */
  private async executeRecursive(
    skillName: string,
    params: Record<string, unknown>,
    context: ExecutionContext,
    parentWalId?: string,
    completedSteps?: CompletedStep[],
  ): Promise<SkillResult> {
    // 深度检查
    if (context.depth >= context.maxDepth) {
      throw new MaxDepthExceededError(context.depth, context.maxDepth);
    }

    // 预算检查
    if (context.callBudget.remaining <= 0) {
      throw new CallBudgetExhaustedError();
    }
    context.callBudget.remaining--;

    const skill = this.registry.get(skillName);

    // 熔断器检查
    this.circuitBreakers.check(skillName, skill.circuitBreaker);

    // 更新上下文
    const childContext: ExecutionContext = {
      ...context,
      callStack: [...context.callStack, skillName],
      depth: context.depth + 1,
    };

    // WAL 记录
    const walId = this.wal.begin(
      context.traceId,
      skillName,
      params,
      parentWalId,
    );

    const traceEntry: TraceEntry = {
      skillName,
      depth: context.depth,
      startTime: Date.now(),
      endTime: 0,
      success: false,
    };

    try {
      // 1. 执行 AUTO_PRE 依赖
      const preBlocks = skill.errorPropagation?.preFailureBlocks !== false; // 默认 true
      try {
        await this.executeHooks(
          skill,
          Autonomy.AUTO_PRE,
          { target: skillName, params },
          childContext,
          walId,
          completedSteps,
        );
      } catch (preErr) {
        if (preBlocks) throw preErr;
        log("warn", "skill.pre_hook_failed_ignored", {
          traceId: context.traceId,
          skill: skillName,
          error: preErr instanceof Error ? preErr.message : String(preErr),
        });
      }

      // 2. 执行 Skill 本身（带超时和重试）
      const result = await this.executeWithRetry(skill, params, childContext);

      // 3. 记录已完成步骤（供 SAGA 补偿）
      if (completedSteps && skill.compensate) {
        completedSteps.push({ skillName, params, result: result.data });
      }

      // 4. 执行 AUTO_POST 依赖
      const postAffects = skill.errorPropagation?.postFailureAffectsResult === true; // 默认 false
      try {
        await this.executeHooks(
          skill,
          Autonomy.AUTO_POST,
          { target: skillName, result: result.data },
          childContext,
          walId,
          completedSteps,
        );
      } catch (postErr) {
        if (postAffects) throw postErr;
        log("warn", "skill.post_hook_failed_ignored", {
          traceId: context.traceId,
          skill: skillName,
          error: postErr instanceof Error ? postErr.message : String(postErr),
        });
      }

      traceEntry.endTime = Date.now();
      traceEntry.success = result.success;
      context.trace.push(traceEntry);

      this.wal.complete(walId, result.data);

      // 熔断器记录成功
      this.circuitBreakers.recordSuccess(skillName, skill.circuitBreaker);

      // 记录指标
      const duration = traceEntry.endTime - traceEntry.startTime;
      this.metrics.record(skillName, duration, true);

      // 涌现检测
      this.emergenceDetector?.record(skillName, {
        callStack: childContext.callStack,
        depth: context.depth,
        success: true,
        duration,
      });

      // 生命周期管理：记录使用
      this.lifecycleManager?.recordUsage(skillName);

      log("info", "skill.executed", {
        traceId: context.traceId,
        skill: skillName,
        version: skill.version,
        depth: context.depth,
        duration,
        success: true,
      });

      return result;
    } catch (err) {
      traceEntry.endTime = Date.now();
      traceEntry.success = false;
      traceEntry.error = err instanceof Error ? err.message : String(err);
      context.trace.push(traceEntry);

      const duration = traceEntry.endTime - traceEntry.startTime;

      // 熔断器记录失败
      this.circuitBreakers.recordFailure(skillName, skill.circuitBreaker);

      // 记录失败指标
      this.metrics.record(
        skillName,
        duration,
        false,
        err instanceof Error ? err.constructor.name : "UnknownError",
      );

      // 涌现检测
      this.emergenceDetector?.record(skillName, {
        callStack: childContext.callStack,
        depth: context.depth,
        success: false,
        duration,
      });

      // 生命周期管理：记录使用（即使失败）
      this.lifecycleManager?.recordUsage(skillName);

      this.wal.fail(walId, traceEntry.error);

      log("warn", "skill.failed", {
        traceId: context.traceId,
        skill: skillName,
        version: skill.version,
        depth: context.depth,
        duration,
        error: traceEntry.error,
        errorType: err instanceof Error ? err.constructor.name : "UnknownError",
      });

      throw err;
    }
  }

  /** SAGA 反向补偿 */
  private async runCompensation(
    completedSteps: CompletedStep[],
    context: ExecutionContext,
  ): Promise<void> {
    // 反向执行补偿
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i];
      const skill = this.registry.lookup(step.skillName);
      if (!skill?.compensate) continue;

      try {
        await skill.compensate(step.params, step.result, context);
        log("info", "skill.compensated", {
          traceId: context.traceId,
          skill: step.skillName,
        });
      } catch (compErr) {
        log("error", "skill.compensation_failed", {
          traceId: context.traceId,
          skill: step.skillName,
          error: compErr instanceof Error ? compErr.message : String(compErr),
        });
      }
    }
  }

  /** 执行特定 autonomy 类型的依赖 hooks */
  private async executeHooks(
    skill: SkillDefinition,
    autonomy: Autonomy,
    params: Record<string, unknown>,
    context: ExecutionContext,
    parentWalId: string,
    completedSteps?: CompletedStep[],
  ): Promise<void> {
    for (const depName of skill.dependencies) {
      const dep = this.registry.lookup(depName);
      if (dep && dep.autonomy === autonomy) {
        await this.executeRecursive(depName, params, context, parentWalId, completedSteps);
      }
    }
  }

  /** 带重试的执行（增强：jitter + backoff 上限 + 熔断器） */
  private async executeWithRetry(
    skill: SkillDefinition,
    params: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<SkillResult> {
    const { maxRetries, backoffMs, backoffMultiplier, retryableErrors, maxBackoffMs, jitter } =
      skill.retry;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result =
          skill.autonomy === Autonomy.GUARDIAN
            ? await this.executeGuarded(skill, params, context)
            : await this.executeWithTimeout(skill, params, context);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // 检查是否可重试
        if (retryableErrors && retryableErrors.length > 0) {
          if (!retryableErrors.includes(lastError.name)) throw lastError;
        }

        if (attempt < maxRetries) {
          let delay = backoffMs * Math.pow(backoffMultiplier, attempt);

          // 退避上限
          if (maxBackoffMs && delay > maxBackoffMs) {
            delay = maxBackoffMs;
          }

          // Jitter: ±25%
          if (jitter) {
            const jitterRange = delay * 0.25;
            delay += (Math.random() * 2 - 1) * jitterRange;
          }

          log("debug", "skill.retry", {
            skill: skill.name,
            attempt: attempt + 1,
            maxRetries,
            delay: Math.round(delay),
          });

          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /** 带超时的执行 */
  private async executeWithTimeout(
    skill: SkillDefinition,
    params: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<SkillResult> {
    if (skill.timeout <= 0) {
      return skill.handler(params, context);
    }

    return Promise.race([
      skill.handler(params, context),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new SkillTimeoutError(skill.name, skill.timeout)),
          skill.timeout,
        ),
      ),
    ]);
  }

  /** GUARDIAN 模式：不可超时中断 */
  private async executeGuarded(
    skill: SkillDefinition,
    params: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<SkillResult> {
    return skill.handler(params, context);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
