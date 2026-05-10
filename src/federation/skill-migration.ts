/**
 * 跨实例 Skill 迁移管理器
 *
 * 负责 Skill 的导出、导入、跨实例拉取。
 * 通过 FederationTransport 实现传输层解耦。
 */
import type { SkillRegistry } from "../registry/index.js";
import type { MetricsCollector } from "../engine/metrics.js";
import { defineSkill } from "../types/index.js";
import type { MigrationPackage, MigrationResult, FederationTransport, FederationEvent, FederationEventHandler } from "./types.js";

export class SkillMigrationManager {
  private registry: SkillRegistry;
  private metrics: MetricsCollector;
  private transport: FederationTransport;
  private instanceId: string;
  private migrationHistory: MigrationResult[] = [];
  private eventHandlers: FederationEventHandler[] = [];

  /** 导入策略（可注入自定义策略） */
  importPolicy: (pkg: MigrationPackage) => { allow: boolean; reason?: string } = () => ({ allow: true });

  constructor(
    registry: SkillRegistry,
    metrics: MetricsCollector,
    transport: FederationTransport,
    instanceId: string,
  ) {
    this.registry = registry;
    this.metrics = metrics;
    this.transport = transport;
    this.instanceId = instanceId;
    this.registerTransportHandlers();
  }

  /** 注册传输层处理器（响应远程请求） */
  private registerTransportHandlers(): void {
    // 响应远程拉取请求
    this.transport.onReceive("skill:export", async (payload) => {
      const { skillName } = payload as { skillName: string };
      const pkg = this.exportSkill(skillName);
      if (!pkg) throw new Error(`Skill not found: ${skillName}`);
      return pkg;
    });

    // 响应远程推送
    this.transport.onReceive("skill:push", async (payload, from) => {
      const pkg = payload as MigrationPackage;
      return this.importSkill(pkg);
    });

    // 响应 Skill 列表查询
    this.transport.onReceive("skill:list", async () => {
      return this.registry.list().map((s) => ({
        name: s.name,
        version: s.version,
        description: s.description,
        capabilities: s.capabilities,
      }));
    });
  }

  /** 导出 Skill 为迁移包 */
  exportSkill(skillName: string): MigrationPackage | null {
    const skill = this.registry.lookup(skillName);
    if (!skill) return null;

    const metrics = this.metrics.getMetrics(skillName);

    const pkg: MigrationPackage = {
      protocol: "raos-migration/v1",
      sourceInstance: this.instanceId,
      skill: {
        name: skill.name,
        version: skill.version,
        description: skill.description ?? "",
        capabilities: skill.capabilities ?? [],
        dependencies: skill.dependencies,
        handlerCode: skill.handler.toString(),
        compensateCode: skill.compensate?.toString(),
        visible: skill.visible,
        timeout: skill.timeout,
        retry: {
          maxRetries: skill.retry.maxRetries,
          backoffMs: skill.retry.backoffMs,
          backoffMultiplier: skill.retry.backoffMultiplier,
        },
      },
      performanceBaseline: metrics
        ? {
            avgLatencyMs: metrics.avgDurationMs,
            successRate: metrics.successRate,
            p95LatencyMs: metrics.p95DurationMs,
            totalCalls: metrics.totalCalls,
          }
        : undefined,
      exportedAt: Date.now(),
    };

    return pkg;
  }

  /** 导入迁移包（本地注册） */
  importSkill(pkg: MigrationPackage): MigrationResult {
    const baseResult = {
      skillName: pkg.skill.name,
      sourceInstance: pkg.sourceInstance,
      targetInstance: this.instanceId,
    };

    // 协议版本检查
    if (pkg.protocol !== "raos-migration/v1") {
      const result: MigrationResult = { ...baseResult, success: false, action: "rejected", reason: `Unsupported protocol: ${pkg.protocol}` };
      this.migrationHistory.push(result);
      return result;
    }

    // 导入策略检查
    const policy = this.importPolicy(pkg);
    if (!policy.allow) {
      const result: MigrationResult = { ...baseResult, success: false, action: "rejected", reason: policy.reason };
      this.migrationHistory.push(result);
      return result;
    }

    // P0 安全修复：联邦远程代码不再通过 new Function 直接执行
    // 远程 skill 只迁移元数据，handler 需在目标实例由管理员手动审批后重新注册
    const result: MigrationResult = {
      ...baseResult,
      success: false,
      action: "rejected",
      reason: "Remote skill handler execution is disabled for security. Please manually recreate this skill on the target instance.",
    };
    this.migrationHistory.push(result);
    this.emit({ type: "skill:migration_rejected", timestamp: Date.now(), data: { ...result, from: pkg.sourceInstance, skillName: pkg.skill.name } });
    return result;
  }

  /** 从远程实例拉取 Skill */
  async pullSkill(endpoint: string, skillName: string): Promise<MigrationResult> {
    try {
      const pkg = (await this.transport.send(endpoint, "skill:export", { skillName })) as MigrationPackage;
      return this.importSkill(pkg);
    } catch (err) {
      return {
        skillName,
        sourceInstance: endpoint,
        targetInstance: this.instanceId,
        success: false,
        action: "rejected",
        reason: err instanceof Error ? (err as Error).message : String(err),
      };
    }
  }

  /** 推送 Skill 到远程实例 */
  async pushSkill(endpoint: string, skillName: string): Promise<MigrationResult> {
    const pkg = this.exportSkill(skillName);
    if (!pkg) {
      return {
        skillName,
        sourceInstance: this.instanceId,
        targetInstance: endpoint,
        success: false,
        action: "rejected",
        reason: "Skill not found locally",
      };
    }

    try {
      const result = (await this.transport.send(endpoint, "skill:push", pkg)) as MigrationResult;
      return result;
    } catch (err) {
      return {
        skillName,
        sourceInstance: this.instanceId,
        targetInstance: endpoint,
        success: false,
        action: "rejected",
        reason: err instanceof Error ? (err as Error).message : String(err),
      };
    }
  }

  /** 列出远程实例的 Skills */
  async listRemoteSkills(endpoint: string): Promise<Array<{ name: string; version: string; description: string }>> {
    try {
      return (await this.transport.send(endpoint, "skill:list", {})) as any[];
    } catch {
      return [];
    }
  }

  /** 获取迁移历史 */
  getHistory(): MigrationResult[] {
    return [...this.migrationHistory];
  }

  /** 事件订阅 */
  on(handler: FederationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: FederationEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* 事件处理失败不影响主流程 */ }
    }
  }
}
