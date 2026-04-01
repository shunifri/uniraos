/**
 * Skill 生命周期管理
 *
 * - 渐进式部署（Canary）：新版本先承接部分流量
 * - 自动回滚：异常指标自动切回旧版
 * - 生命周期追踪：创建时间、最后调用时间、淘汰标记
 */
import { SkillRegistry } from "../registry/index.js";
import { MetricsCollector } from "./metrics.js";
import { log } from "../utils/logger.js";

export interface SkillLifecycleInfo {
  name: string;
  state: "active" | "canary" | "deprecated" | "retired";
  createdAt: number;
  lastUsedAt: number;
  canaryConfig?: CanaryConfig;
}

export interface CanaryConfig {
  /** 新版本名（注册在 registry 中的 versioned name） */
  newVersion: string;
  /** 旧版本名 */
  oldVersion: string;
  /** 新版本流量百分比（0-100） */
  trafficPercent: number;
  /** 自动提升阈值：成功率高于此值则全量切换 */
  promoteThreshold: number;
  /** 自动回滚阈值：成功率低于此值则回滚 */
  rollbackThreshold: number;
  /** 最少调用次数（达到后才评估） */
  minCalls: number;
  startedAt: number;
}

export class SkillLifecycleManager {
  private lifecycles = new Map<string, SkillLifecycleInfo>();
  private registry: SkillRegistry;
  private metrics: MetricsCollector;

  constructor(registry: SkillRegistry, metrics: MetricsCollector) {
    this.registry = registry;
    this.metrics = metrics;
  }

  /** 记录 Skill 被使用 */
  recordUsage(name: string): void {
    const info = this.getOrCreate(name);
    info.lastUsedAt = Date.now();
  }

  /** 开始渐进式部署 */
  startCanary(
    name: string,
    oldVersion: string,
    newVersion: string,
    opts?: Partial<Pick<CanaryConfig, "trafficPercent" | "promoteThreshold" | "rollbackThreshold" | "minCalls">>,
  ): void {
    const info = this.getOrCreate(name);
    info.state = "canary";
    info.canaryConfig = {
      oldVersion,
      newVersion,
      trafficPercent: opts?.trafficPercent ?? 10,
      promoteThreshold: opts?.promoteThreshold ?? 0.95,
      rollbackThreshold: opts?.rollbackThreshold ?? 0.5,
      minCalls: opts?.minCalls ?? 20,
      startedAt: Date.now(),
    };
    log("info", "lifecycle.canary_started", { name, oldVersion, newVersion });
  }

  /** 判断当前请求应该使用新版还是旧版 */
  shouldUseCanary(name: string): boolean {
    const info = this.lifecycles.get(name);
    if (!info?.canaryConfig || info.state !== "canary") return false;
    return Math.random() * 100 < info.canaryConfig.trafficPercent;
  }

  /** 评估 Canary 状态，自动提升或回滚 */
  evaluateCanary(name: string): "promote" | "rollback" | "continue" | "not_canary" {
    const info = this.lifecycles.get(name);
    if (!info?.canaryConfig || info.state !== "canary") return "not_canary";

    const { newVersion, minCalls, promoteThreshold, rollbackThreshold } = info.canaryConfig;
    const metrics = this.metrics.getMetrics(newVersion);
    if (!metrics || metrics.totalCalls < minCalls) return "continue";

    if (metrics.successRate >= promoteThreshold) {
      return "promote";
    }

    if (metrics.successRate < rollbackThreshold) {
      return "rollback";
    }

    return "continue";
  }

  /** 提升 Canary 到全量 */
  promoteCanary(name: string): void {
    const info = this.lifecycles.get(name);
    if (!info?.canaryConfig) return;

    const { newVersion } = info.canaryConfig;
    info.state = "active";
    info.canaryConfig = undefined;

    // 切换活跃版本
    try {
      this.registry.switchVersion(name, newVersion);
    } catch {
      // 版本可能未注册，忽略
    }

    log("info", "lifecycle.canary_promoted", { name, version: newVersion });
  }

  /** 回滚 Canary */
  rollbackCanary(name: string): void {
    const info = this.lifecycles.get(name);
    if (!info?.canaryConfig) return;

    const { oldVersion, newVersion } = info.canaryConfig;
    info.state = "active";
    info.canaryConfig = undefined;

    try {
      this.registry.switchVersion(name, oldVersion);
    } catch {
      // 忽略
    }

    log("warn", "lifecycle.canary_rolled_back", { name, oldVersion, newVersion });
  }

  /** 标记 Skill 为已弃用 */
  deprecate(name: string): void {
    const info = this.getOrCreate(name);
    info.state = "deprecated";
    log("info", "lifecycle.deprecated", { name });
  }

  /** 淘汰不活跃的 Skill（超过指定时间未使用） */
  retireInactive(maxInactiveMs: number): string[] {
    const retired: string[] = [];
    const now = Date.now();

    for (const [name, info] of this.lifecycles) {
      if (info.state === "active" && now - info.lastUsedAt > maxInactiveMs) {
        info.state = "retired";
        retired.push(name);
        log("info", "lifecycle.retired", { name, inactiveMs: now - info.lastUsedAt });
      }
    }

    return retired;
  }

  /** 获取所有生命周期信息 */
  getAll(): SkillLifecycleInfo[] {
    return [...this.lifecycles.values()];
  }

  /** 获取单个 Skill 的生命周期信息 */
  getInfo(name: string): SkillLifecycleInfo | undefined {
    return this.lifecycles.get(name);
  }

  private getOrCreate(name: string): SkillLifecycleInfo {
    let info = this.lifecycles.get(name);
    if (!info) {
      const now = Date.now();
      info = { name, state: "active", createdAt: now, lastUsedAt: now };
      this.lifecycles.set(name, info);
    }
    return info;
  }
}
