/**
 * 自动进化引擎
 *
 * 实现"观察→分析→决策→执行→验证"的自动进化闭环。
 *
 * 架构设计：
 *   - 策略可插拔：EvolutionStrategy 接口，可注入多个策略并行评估
 *   - 执行器可扩展：ActionExecutor 接口，不同 action type 可注册不同执行器
 *   - 事件驱动：进化循环的每个阶段都发出事件，方便监控和扩展
 *   - 安全控制：与 EvolutionController 集成，强制深度/速率/审批约束
 */
import type { SkillRegistry } from "../registry/index.js";
import type { MetricsCollector } from "../engine/metrics.js";
import type { EvolutionController } from "../engine/evolution-controller.js";
import type { SkillLifecycleManager } from "../engine/skill-lifecycle.js";
import { OptimizeActionExecutor, GenerateActionExecutor, CanaryActionExecutor, AdoptActionExecutor } from "./executors/index.js";
import type { LLMProvider } from "../llm/types.js";
import type {
  EvolutionStrategy,
  EvolutionContext,
  EvolutionAction,
  SkillRecommendation,
  FederationEvent,
  FederationEventHandler,
  ActionExecutor,
} from "./types.js";
import { log } from "../utils/logger.js";

// ===== 内置策略 =====

/** 性能瓶颈检测策略 */
export class BottleneckDetectionStrategy implements EvolutionStrategy {
  readonly name = "bottleneck-detection";

  private successRateThreshold: number;
  private latencyThresholdMs: number;

  constructor(opts?: { successRateThreshold?: number; latencyThresholdMs?: number }) {
    this.successRateThreshold = opts?.successRateThreshold ?? 0.8;
    this.latencyThresholdMs = opts?.latencyThresholdMs ?? 5000;
  }

  async analyze(ctx: EvolutionContext): Promise<EvolutionAction[]> {
    const actions: EvolutionAction[] = [];

    for (const m of ctx.metrics) {
      // 低成功率 → 优化
      if (m.totalCalls >= 20 && m.successRate < this.successRateThreshold) {
        actions.push({
          type: "optimize",
          skillName: m.name,
          payload: {
            reason: `成功率 ${(m.successRate * 100).toFixed(1)}% 低于阈值 ${(this.successRateThreshold * 100).toFixed(0)}%`,
            currentSuccessRate: m.successRate,
            totalCalls: m.totalCalls,
          },
          priority: Math.round((1 - m.successRate) * 100),
          requiresApproval: m.successRate < 0.5, // 极低成功率需要人工审视
        });
      }

      // 高延迟 → 优化
      if (m.totalCalls >= 10 && m.p95LatencyMs > this.latencyThresholdMs) {
        actions.push({
          type: "optimize",
          skillName: m.name,
          payload: {
            reason: `P95 延迟 ${m.p95LatencyMs.toFixed(0)}ms 超过阈值 ${this.latencyThresholdMs}ms`,
            currentP95: m.p95LatencyMs,
          },
          priority: Math.min(80, Math.round((m.p95LatencyMs / this.latencyThresholdMs) * 40)),
          requiresApproval: false,
        });
      }
    }

    return actions;
  }
}

/** 不活跃 Skill 淘汰策略 */
export class InactiveRetirementStrategy implements EvolutionStrategy {
  readonly name = "inactive-retirement";

  private maxInactiveMs: number;
  private protectedPrefixes: string[];

  constructor(opts?: { maxInactiveDays?: number; protectedPrefixes?: string[] }) {
    this.maxInactiveMs = (opts?.maxInactiveDays ?? 30) * 24 * 60 * 60 * 1000;
    this.protectedPrefixes = opts?.protectedPrefixes ?? [
      "file_", "http_", "shell_", "db_", "stm_", "ltm_", "recall_",
      "skill_", "plan_", "kb_", "api_", "ws_", "mq_", "web_",
      "doc_", "chart_", "prompt_", "task_",
    ];
  }

  async analyze(ctx: EvolutionContext): Promise<EvolutionAction[]> {
    const actions: EvolutionAction[] = [];
    const now = Date.now();

    for (const m of ctx.metrics) {
      // 跳过受保护的系统 Skill
      if (this.protectedPrefixes.some((p) => m.name.startsWith(p))) continue;

      // 长期未使用 → 淘汰
      if (now - m.lastCalledAt > this.maxInactiveMs && m.totalCalls > 0) {
        actions.push({
          type: "retire",
          skillName: m.name,
          payload: {
            reason: `超过 ${Math.round(this.maxInactiveMs / 86400000)} 天未使用`,
            lastCalledAt: m.lastCalledAt,
            daysSinceLastCall: Math.round((now - m.lastCalledAt) / 86400000),
          },
          priority: 20,
          requiresApproval: false,
        });
      }
    }

    return actions;
  }
}

/** 错误驱动生成策略 — 基于高频错误模式自动生成新 Skill */
export class ErrorDrivenGenerationStrategy implements EvolutionStrategy {
  readonly name = "error-driven-generation";

  private minErrorCount: number;
  private protectedPrefixes: string[];

  constructor(opts?: { minErrorCount?: number; protectedPrefixes?: string[] }) {
    this.minErrorCount = opts?.minErrorCount ?? 10;
    this.protectedPrefixes = opts?.protectedPrefixes ?? [
      "file_", "http_", "shell_", "db_", "stm_", "ltm_", "recall_",
      "skill_", "plan_", "kb_", "api_", "ws_", "mq_", "web_",
      "doc_", "chart_", "prompt_", "task_",
    ];
  }

  async analyze(ctx: EvolutionContext): Promise<EvolutionAction[]> {
    const actions: EvolutionAction[] = [];

    // 1. 聚合错误类型（按 errorType 汇总，过滤系统 Skill）
    const errorCounts = new Map<string, number>();
    for (const err of ctx.recentErrors) {
      // 跳过系统核心 Skill 的错误
      if (this.protectedPrefixes.some((p) => err.skillName.startsWith(p))) continue;
      errorCounts.set(err.errorType, (errorCounts.get(err.errorType) || 0) + err.count);
    }

    // 2. 对高频错误类型生成处理 Skill
    for (const [errorType, count] of errorCounts.entries()) {
      if (count < this.minErrorCount) continue;

      const normalizedType = errorType.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const handlerSkillName = `error_handler_${normalizedType}`;

      // 如果已存在同名 Skill，跳过
      if (ctx.registeredSkills.includes(handlerSkillName)) continue;

      actions.push({
        type: "generate",
        skillName: handlerSkillName,
        payload: {
          description: `自动生成的错误处理 Skill：处理 "${errorType}" 类型错误。当其他 Skill 遇到此错误时，提供重试、降级或恢复策略。`,
          capabilities: [`error:handle:${errorType}`],
          errorType,
          triggerCount: count,
          source: "error-driven-generation-strategy",
        },
        priority: Math.min(80, Math.round(count * 2)),
        requiresApproval: true, // 自动生成的 Skill 默认需要审批
      });
    }

    return actions;
  }
}

/** 联邦推荐采纳策略 */
export class FederatedAdoptionStrategy implements EvolutionStrategy {
  readonly name = "federated-adoption";

  private minConfidence: number;

  constructor(opts?: { minConfidence?: number }) {
    this.minConfidence = opts?.minConfidence ?? 0.7;
  }

  async analyze(ctx: EvolutionContext): Promise<EvolutionAction[]> {
    const actions: EvolutionAction[] = [];

    for (const rec of ctx.federatedRecommendations) {
      if (rec.confidence < this.minConfidence) continue;

      if (rec.action === "adopt" || rec.action === "upgrade") {
        actions.push({
          type: "adopt",
          skillName: rec.skillName,
          payload: {
            reason: rec.reason,
            sourceInstance: rec.sourceInstance,
            confidence: rec.confidence,
            recommendation: rec,
          },
          priority: Math.round(rec.confidence * 60),
          requiresApproval: true, // 联邦采纳默认需要审批
        });
      }
    }

    return actions;
  }
}

// ===== 动作执行器 =====

/** 淘汰执行器 */
export class RetireActionExecutor implements ActionExecutor {
  readonly actionType = "retire";

  async execute(action: EvolutionAction, ctx: { registry: SkillRegistry }): Promise<{ success: boolean; message: string }> {
    try {
      ctx.registry.unregister(action.skillName);
      return { success: true, message: `Skill "${action.skillName}" retired` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ===== 进化引擎 =====

export interface EvolutionEngineConfig {
  /** 进化循环间隔（毫秒），默认 1 小时 */
  cycleIntervalMs: number;
  /** 每轮最多执行的动作数 */
  maxActionsPerCycle: number;
  /** 是否自动执行（false 则只生成建议） */
  autoExecute: boolean;
  /** 自动执行时是否跳过需要审批的动作 */
  skipApprovalRequired: boolean;
}

const DEFAULT_CONFIG: EvolutionEngineConfig = {
  cycleIntervalMs: 3600000,   // 1 小时
  maxActionsPerCycle: 5,
  autoExecute: false,          // 默认只建议，不自动执行
  skipApprovalRequired: true,
};

export class EvolutionEngine {
  private registry: SkillRegistry;
  private metrics: MetricsCollector;
  private evolutionController: EvolutionController;
  private lifecycleManager: SkillLifecycleManager;
  private config: EvolutionEngineConfig;

  private strategies: EvolutionStrategy[] = [];
  private executors: Map<string, ActionExecutor> = new Map();
  private pendingActions: EvolutionAction[] = [];
  private executedActions: Array<EvolutionAction & { executedAt: number; result: { success: boolean; message: string } }> = [];
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private lastCycleAt = 0;
  private cycleCount = 0;
  private eventHandlers: FederationEventHandler[] = [];

  /** 外部注入：联邦推荐获取函数 */
  getFederatedRecommendations: () => SkillRecommendation[] = () => [];

  constructor(opts: {
    registry: SkillRegistry;
    metrics: MetricsCollector;
    evolutionController: EvolutionController;
    lifecycleManager: SkillLifecycleManager;
    config?: Partial<EvolutionEngineConfig>;
    llmProvider?: LLMProvider;
  }) {
    this.registry = opts.registry;
    this.metrics = opts.metrics;
    this.evolutionController = opts.evolutionController;
    this.lifecycleManager = opts.lifecycleManager;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };

    // 注册内置策略
    this.addStrategy(new BottleneckDetectionStrategy());
    this.addStrategy(new InactiveRetirementStrategy());
    this.addStrategy(new ErrorDrivenGenerationStrategy());
    this.addStrategy(new FederatedAdoptionStrategy());

    // 注册内置执行器
    this.addExecutor(new RetireActionExecutor());
    this.addExecutor(new AdoptActionExecutor());

    if (opts.llmProvider) {
      this.addExecutor(new OptimizeActionExecutor(opts.llmProvider, opts.lifecycleManager));
      this.addExecutor(new GenerateActionExecutor(opts.llmProvider, opts.evolutionController));
    }
    this.addExecutor(new CanaryActionExecutor(opts.lifecycleManager));
  }

  /** 注册进化策略 */
  addStrategy(strategy: EvolutionStrategy): void {
    this.strategies.push(strategy);
  }

  /** 移除策略 */
  removeStrategy(name: string): void {
    this.strategies = this.strategies.filter((s) => s.name !== name);
  }

  /** 注册动作执行器 */
  addExecutor(executor: ActionExecutor): void {
    this.executors.set(executor.actionType, executor);
  }

  /** 启动自动进化循环 */
  start(): void {
    if (this.cycleTimer) return;
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.cycleIntervalMs);
    // 延迟 10 秒后执行第一次（等系统稳定）
    setTimeout(() => this.runCycle(), 10000);
  }

  /** 停止自动进化循环 */
  stop(): void {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  /** 响应式检测：指标恶化时立即触发进化循环 */
  checkAndTrigger(): void {
    try {
      const degraded = this.metrics.checkDegradation?.(0.3);
      if (degraded && Array.isArray(degraded) && degraded.length > 0) {
        log("info", "evolution.degradation_detected", { count: degraded.length, skills: degraded.map((d: any) => d.skillName ?? d) });
        this.runCycle().catch((err) => {
          log("error", "evolution.reactive_cycle_failed", { error: err instanceof Error ? err.message : String(err) });
        });
      }
    } catch (err) {
      log("error", "evolution.check_trigger_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** 手动触发一次进化循环 */
  async runCycle(): Promise<{
    actions: EvolutionAction[];
    executed: Array<{ action: EvolutionAction; result: { success: boolean; message: string } }>;
  }> {
    this.cycleCount++;
    this.emit({ type: "evolution:cycle_start", timestamp: Date.now(), data: { cycle: this.cycleCount } });

    // 1. 构建进化上下文
    const context = this.buildContext();

    // 2. 所有策略并行分析
    const allActions: EvolutionAction[] = [];
    const analyzePromises = this.strategies.map(async (strategy) => {
      try {
        const actions = await strategy.analyze(context);
        return actions;
      } catch (err) {
        log("warn", "evolution.strategy_failed", { strategy: strategy.name, error: err instanceof Error ? err.message : String(err) });
        return [];
      }
    });

    const strategyResults = await Promise.all(analyzePromises);
    for (const actions of strategyResults) {
      allActions.push(...actions);
    }

    // 3. 去重 + 排序
    const deduped = this.deduplicateActions(allActions);
    const sorted = deduped.sort((a, b) => b.priority - a.priority);
    const topActions = sorted.slice(0, this.config.maxActionsPerCycle);

    // 更新待处理动作
    this.pendingActions = sorted;

    // 4. 执行（如果启用自动执行）
    const executed: Array<{ action: EvolutionAction; result: { success: boolean; message: string } }> = [];

    if (this.config.autoExecute) {
      for (const action of topActions) {
        if (action.requiresApproval && this.config.skipApprovalRequired) {
          continue;
        }

        const result = await this.executeAction(action);
        executed.push({ action, result });
      }
    }

    // 5. 自动评估活跃的 canary 部署
    const lifecycleAll = this.lifecycleManager.getAll();
    for (const info of lifecycleAll) {
      if (info.state === "canary") {
        const canaryAction: EvolutionAction = {
          type: "canary",
          skillName: info.name,
          payload: { action: "evaluate" },
          priority: 90, // High priority
          requiresApproval: false,
        };
        const canaryResult = await this.executeAction(canaryAction);
        executed.push({ action: canaryAction, result: canaryResult });
      }
    }

    this.lastCycleAt = Date.now();
    this.emit({
      type: "evolution:cycle_end",
      timestamp: Date.now(),
      data: {
        cycle: this.cycleCount,
        totalActions: sorted.length,
        executedCount: executed.length,
        topAction: topActions[0] ?? null,
      },
    });

    return { actions: sorted, executed };
  }

  /** 手动执行一个进化动作 */
  async executeAction(action: EvolutionAction): Promise<{ success: boolean; message: string }> {
    // 进化控制器检查
    if (action.type === "adopt" || action.type === "generate") {
      const capabilities = Array.isArray(action.payload?.capabilities)
        ? (action.payload.capabilities as string[])
        : [];
      const check = this.evolutionController.canGenerate(
        action.skillName,
        "evolution-engine",
        capabilities,
      );
      if (!check.allowed) {
        const result = { success: false, message: `Evolution controller blocked: ${check.reason}` };
        this.emit({
          type: "evolution:action_rejected",
          timestamp: Date.now(),
          data: { action, result },
        });
        return result;
      }
    }

    const executor = this.executors.get(action.type);
    if (!executor) {
      const result = { success: false, message: `No executor registered for action type: ${action.type}` };
      this.emit({
        type: "evolution:action_rejected",
        timestamp: Date.now(),
        data: { action, result },
      });
      return result;
    }

    try {
      const result = await executor.execute(action, {
        registry: this.registry,
        metrics: this.metrics,
      });

      this.executedActions.push({ ...action, executedAt: Date.now(), result });
      // 限制历史记录大小，防止内存泄漏
      if (this.executedActions.length > 500) {
        this.executedActions = this.executedActions.slice(-300);
      }

      // 记录到进化控制器
      if (result.success && (action.type === "adopt" || action.type === "generate")) {
        this.evolutionController.recordGeneration(action.skillName, "evolution-engine");
      }

      // Consume budget after successful execution (if supported by controller)
      if (result.success && 'consumeBudget' in this.evolutionController) {
        (this.evolutionController as any).consumeBudget?.(action.type);
      }

      // 更新生命周期
      if (result.success && action.type === "retire") {
        this.lifecycleManager.deprecate(action.skillName);
      }

      this.emit({
        type: "evolution:action_executed",
        timestamp: Date.now(),
        data: { action, result },
      });

      // 从待处理列表移除
      this.pendingActions = this.pendingActions.filter((a) => a.skillName !== action.skillName || a.type !== action.type);

      return result;
    } catch (err) {
      const result = { success: false, message: err instanceof Error ? err.message : String(err) };
      this.emit({
        type: "evolution:action_rejected",
        timestamp: Date.now(),
        data: { action, result },
      });
      return result;
    }
  }

  /** 构建进化上下文 */
  private buildContext(): EvolutionContext {
    const allMetrics = this.metrics.getAllMetrics();

    // 收集最近错误模式
    const errorMap = new Map<string, Map<string, number>>();
    for (const m of allMetrics) {
      for (const [errType, count] of Object.entries(m.errorDistribution)) {
        if (!errorMap.has(m.skillName)) errorMap.set(m.skillName, new Map());
        errorMap.get(m.skillName)!.set(errType, count);
      }
    }

    const recentErrors: EvolutionContext["recentErrors"] = [];
    for (const [skillName, errors] of errorMap) {
      for (const [errorType, count] of errors) {
        recentErrors.push({ skillName, errorType, count });
      }
    }

    return {
      metrics: allMetrics.map((m) => ({
        name: m.skillName,
        totalCalls: m.totalCalls,
        successRate: m.successRate,
        avgLatencyMs: m.avgDurationMs,
        p95LatencyMs: m.p95DurationMs,
        lastCalledAt: m.lastCalledAt,
      })),
      registeredSkills: this.registry.list().map((s) => s.name),
      recentErrors,
      federatedRecommendations: this.getFederatedRecommendations(),
      lastEvolutionAt: this.lastCycleAt,
    };
  }

  /** 去重：同一 Skill 的同类动作只保留优先级最高的 */
  private deduplicateActions(actions: EvolutionAction[]): EvolutionAction[] {
    const seen = new Map<string, EvolutionAction>();
    for (const action of actions) {
      const key = `${action.type}:${action.skillName}`;
      const existing = seen.get(key);
      if (!existing || action.priority > existing.priority) {
        seen.set(key, action);
      }
    }
    return [...seen.values()];
  }

  // ===== 查询接口 =====

  /** 获取待处理动作列表 */
  getPendingActions(): EvolutionAction[] {
    return [...this.pendingActions];
  }

  /** 获取已执行动作历史 */
  getExecutedActions(): Array<EvolutionAction & { executedAt: number; result: { success: boolean; message: string } }> {
    return [...this.executedActions];
  }

  /** 获取引擎状态 */
  getStatus(): {
    running: boolean;
    cycleCount: number;
    lastCycleAt: number;
    pendingActions: number;
    executedActions: number;
    strategies: string[];
    executors: string[];
    config: EvolutionEngineConfig;
  } {
    return {
      running: this.cycleTimer !== null,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      pendingActions: this.pendingActions.length,
      executedActions: this.executedActions.length,
      strategies: this.strategies.map((s) => s.name),
      executors: [...this.executors.keys()],
      config: { ...this.config },
    };
  }

  /** 更新配置 */
  updateConfig(partial: Partial<EvolutionEngineConfig>): void {
    this.config = { ...this.config, ...partial };

    // 如果间隔变了且正在运行，重启定时器
    if (partial.cycleIntervalMs && this.cycleTimer) {
      this.stop();
      this.start();
    }
  }

  /** 事件订阅 */
  on(handler: FederationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: FederationEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* ignore */ }
    }
  }
}
