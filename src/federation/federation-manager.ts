/**
 * 联邦 Skill 学习管理器
 *
 * 跨 RAOS 实例共享进化经验：
 *   1. 心跳机制 — 实例间互相发现和健康监测
 *   2. 指标聚合 — 收集各实例的 Skill 性能数据
 *   3. 最优推荐 — 基于聚合指标推荐高质量 Skill
 *   4. 策略可扩展 — 推荐算法可替换
 *
 * 不共享原始数据，只共享指标和 Skill 包 — 隐私安全。
 */
import type { MetricsCollector } from "../engine/metrics.js";
import type { SkillRegistry } from "../registry/index.js";
import type {
  FederationTransport,
  InstanceProfile,
  FederatedMetricsSnapshot,
  SkillRecommendation,
  FederationEvent,
  FederationEventHandler,
} from "./types.js";
import type { SkillMigrationManager } from "./skill-migration.js";
import { log } from "../utils/logger.js";

/** 推荐策略接口 — 可插拔 */
export interface RecommendationStrategy {
  readonly name: string;
  /**
   * 基于聚合指标生成推荐
   * @param local 本地 Skill 列表和指标
   * @param remote 各远程实例的指标快照
   */
  recommend(
    local: { skills: string[]; metrics: Map<string, { successRate: number; avgLatencyMs: number; totalCalls: number }> },
    remote: FederatedMetricsSnapshot[],
  ): SkillRecommendation[];
}

/** 默认推荐策略：基于成功率和延迟的简单比较 */
export class DefaultRecommendationStrategy implements RecommendationStrategy {
  readonly name = "default";

  recommend(
    local: { skills: string[]; metrics: Map<string, { successRate: number; avgLatencyMs: number; totalCalls: number }> },
    remote: FederatedMetricsSnapshot[],
  ): SkillRecommendation[] {
    const recommendations: SkillRecommendation[] = [];
    const localSkillSet = new Set(local.skills);

    // 收集远程 Skill 的最优指标
    const remoteBest = new Map<string, { instanceId: string; successRate: number; avgLatencyMs: number; totalCalls: number }>();

    for (const snapshot of remote) {
      for (const skill of snapshot.skills) {
        const current = remoteBest.get(skill.name);
        // 以成功率为主、延迟为辅选最优
        if (
          !current ||
          skill.successRate > current.successRate ||
          (skill.successRate === current.successRate && skill.avgLatencyMs < current.avgLatencyMs)
        ) {
          remoteBest.set(skill.name, {
            instanceId: snapshot.instanceId,
            successRate: skill.successRate,
            avgLatencyMs: skill.avgLatencyMs,
            totalCalls: skill.totalCalls,
          });
        }
      }
    }

    for (const [skillName, best] of remoteBest) {
      // 本地没有 → 建议采纳（仅推荐调用量大且成功率高的）
      if (!localSkillSet.has(skillName)) {
        if (best.totalCalls >= 50 && best.successRate >= 0.9) {
          recommendations.push({
            action: "adopt",
            skillName,
            sourceInstance: best.instanceId,
            reason: `远程实例 ${best.instanceId} 拥有高质量 Skill "${skillName}" (成功率 ${(best.successRate * 100).toFixed(1)}%, ${best.totalCalls} 次调用)`,
            confidence: Math.min(best.successRate, best.totalCalls / 200),
          });
        }
        continue;
      }

      // 本地有 → 比较性能
      const localMetrics = local.metrics.get(skillName);
      if (!localMetrics) continue;

      // 远程明显优于本地 → 建议升级
      if (
        best.successRate > localMetrics.successRate + 0.05 ||
        (best.successRate >= localMetrics.successRate && best.avgLatencyMs < localMetrics.avgLatencyMs * 0.7)
      ) {
        recommendations.push({
          action: "upgrade",
          skillName,
          sourceInstance: best.instanceId,
          reason: `远程版本性能更优 (成功率 ${(best.successRate * 100).toFixed(1)}% vs ${(localMetrics.successRate * 100).toFixed(1)}%, 延迟 ${best.avgLatencyMs.toFixed(0)}ms vs ${localMetrics.avgLatencyMs.toFixed(0)}ms)`,
          confidence: 0.6,
        });
      }

      // 本地成功率低 → 建议优化
      if (localMetrics.successRate < 0.8 && localMetrics.totalCalls >= 20) {
        recommendations.push({
          action: "optimize",
          skillName,
          sourceInstance: "self",
          reason: `本地 Skill 成功率偏低 (${(localMetrics.successRate * 100).toFixed(1)}%)，建议优化`,
          confidence: 0.8,
        });
      }
    }

    // 本地长期未使用的 Skill → 建议淘汰
    // （这部分由 EvolutionEngine 处理更合适，这里仅做标记）

    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }
}

export class FederationManager {
  private registry: SkillRegistry;
  private metrics: MetricsCollector;
  private transport: FederationTransport;
  private migration: SkillMigrationManager;
  private instanceId: string;
  private strategy: RecommendationStrategy;

  private remoteSnapshots: Map<string, FederatedMetricsSnapshot> = new Map();
  private recommendations: SkillRecommendation[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: FederationEventHandler[] = [];

  constructor(opts: {
    registry: SkillRegistry;
    metrics: MetricsCollector;
    transport: FederationTransport;
    migration: SkillMigrationManager;
    instanceId: string;
    strategy?: RecommendationStrategy;
  }) {
    this.registry = opts.registry;
    this.metrics = opts.metrics;
    this.transport = opts.transport;
    this.migration = opts.migration;
    this.instanceId = opts.instanceId;
    this.strategy = opts.strategy ?? new DefaultRecommendationStrategy();
    this.registerTransportHandlers();
  }

  private registerTransportHandlers(): void {
    // 响应心跳
    this.transport.onReceive("federation:heartbeat", async (payload) => {
      const profile = payload as InstanceProfile;
      // 更新 transport 的对等实例列表
      if ("addPeer" in this.transport) {
        (this.transport as any).addPeer(profile);
      }
      return this.getLocalProfile();
    });

    // 响应指标查询
    this.transport.onReceive("federation:metrics", async () => {
      return this.getLocalMetricsSnapshot();
    });

    // 响应推荐查询
    this.transport.onReceive("federation:recommendations", async () => {
      return this.recommendations;
    });
  }

  /** 启动联邦服务（定时心跳+指标同步） */
  start(opts?: { heartbeatIntervalMs?: number; syncIntervalMs?: number }): void {
    const heartbeatInterval = opts?.heartbeatIntervalMs ?? 60000;  // 每分钟心跳
    const syncInterval = opts?.syncIntervalMs ?? 300000;            // 每5分钟同步指标

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), heartbeatInterval);
    this.syncTimer = setInterval(() => this.syncAndRecommend(), syncInterval);

    // 立即执行一次
    void this.sendHeartbeat();
  }

  /** 停止联邦服务 */
  stop(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
  }

  /** 发送心跳到所有对等实例 */
  async sendHeartbeat(): Promise<void> {
    const profile = this.getLocalProfile();
    try {
      await this.transport.broadcast("federation:heartbeat", profile);
      this.emit({ type: "federation:heartbeat", timestamp: Date.now(), data: { instanceId: this.instanceId } });
    } catch (err) { log("debug", "federation.heartbeat_failed", { error: err instanceof Error ? (err as Error).message : String(err) }); }
  }

  /** 同步指标并生成推荐 */
  async syncAndRecommend(): Promise<SkillRecommendation[]> {
    // 从所有对等实例收集指标
    try {
      const results = await this.transport.broadcast("federation:metrics", {});
      for (const { instanceId, result } of results) {
        if (result && typeof result === "object" && !("error" in (result as any)) && "skills" in (result as any)) {
          this.remoteSnapshots.set(instanceId, result as FederatedMetricsSnapshot);
        }
      }
    } catch (err) { log("debug", "federation.sync_failed", { error: err instanceof Error ? (err as Error).message : String(err) }); }

    // 生成推荐
    const localSkills = this.registry.list().map((s) => s.name);
    const localMetrics = new Map<string, { successRate: number; avgLatencyMs: number; totalCalls: number }>();

    for (const name of localSkills) {
      const m = this.metrics.getMetrics(name);
      if (m) {
        localMetrics.set(name, {
          successRate: m.successRate,
          avgLatencyMs: m.avgDurationMs,
          totalCalls: m.totalCalls,
        });
      }
    }

    this.recommendations = this.strategy.recommend(
      { skills: localSkills, metrics: localMetrics },
      [...this.remoteSnapshots.values()],
    );

    if (this.recommendations.length > 0) {
      this.emit({
        type: "federation:recommendation",
        timestamp: Date.now(),
        data: { count: this.recommendations.length, top: this.recommendations[0] },
      });
    }

    return this.recommendations;
  }

  /** 获取当前推荐列表 */
  getRecommendations(): SkillRecommendation[] {
    return [...this.recommendations];
  }

  /** 接受推荐（执行动作） */
  async acceptRecommendation(skillName: string): Promise<{ success: boolean; reason?: string }> {
    const rec = this.recommendations.find((r) => r.skillName === skillName);
    if (!rec) return { success: false, reason: "Recommendation not found" };

    if (rec.action === "adopt" || rec.action === "upgrade") {
      // 从推荐源拉取 Skill
      const result = await this.migration.pullSkill(rec.sourceInstance, skillName);
      return { success: result.success, reason: result.reason };
    }

    // optimize/deprecate 需要进化引擎处理
    return { success: true, reason: `Action "${rec.action}" queued for evolution engine` };
  }

  /** 获取本地实例 profile */
  getLocalProfile(): InstanceProfile {
    return {
      instanceId: this.instanceId,
      endpoint: "", // 由调用者设置
      version: "2.0",
      capabilities: this.registry.list().flatMap((s) => s.capabilities ?? []),
      skillCount: this.registry.size,
      lastHeartbeat: Date.now(),
    };
  }

  /** 获取本地指标快照 */
  getLocalMetricsSnapshot(): FederatedMetricsSnapshot {
    const allMetrics = this.metrics.getAllMetrics();
    return {
      instanceId: this.instanceId,
      timestamp: Date.now(),
      skills: allMetrics.map((m) => ({
        name: m.skillName,
        version: "1.0",
        totalCalls: m.totalCalls,
        successRate: m.successRate,
        avgLatencyMs: m.avgDurationMs,
        p95LatencyMs: m.p95DurationMs,
      })),
    };
  }

  /** 获取远程指标快照 */
  getRemoteSnapshots(): Map<string, FederatedMetricsSnapshot> {
    return new Map(this.remoteSnapshots);
  }

  /** 替换推荐策略 */
  setStrategy(strategy: RecommendationStrategy): void {
    this.strategy = strategy;
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
