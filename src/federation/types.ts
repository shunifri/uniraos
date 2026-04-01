/**
 * 联邦/迁移/进化 — 公共类型定义
 *
 * 设计原则：
 *   1. 协议开放 — 所有数据结构可序列化为 JSON，方便跨语言、跨系统对接
 *   2. Provider 可替换 — 传输层、存储层、策略层均为接口，支持注入自定义实现
 *   3. 事件驱动 — 关键操作均发出事件，上层可订阅并扩展行为
 */

// ===== 跨实例 Skill 迁移协议 =====

/** 迁移包：比 SkillPackage 更完整，携带运行时元数据 */
export interface MigrationPackage {
  /** 协议版本，未来可扩展 */
  protocol: "raos-migration/v1";
  /** 源实例标识 */
  sourceInstance: string;
  /** Skill 元信息 */
  skill: {
    name: string;
    version: string;
    description: string;
    capabilities: string[];
    dependencies: string[];
    handlerCode: string;
    compensateCode?: string;
    visible: boolean;
    timeout: number;
    retry: { maxRetries: number; backoffMs: number; backoffMultiplier: number };
  };
  /** 性能基线（供目标实例参考） */
  performanceBaseline?: {
    avgLatencyMs: number;
    successRate: number;
    p95LatencyMs: number;
    totalCalls: number;
  };
  /** 关联的知识/记忆（可选，跟随迁移） */
  attachedData?: Array<{
    type: "memory" | "knowledge" | "config";
    key: string;
    value: unknown;
  }>;
  /** 导出时间戳 */
  exportedAt: number;
  /** 签名（用于验证来源） */
  signature?: string;
}

/** 迁移结果 */
export interface MigrationResult {
  success: boolean;
  skillName: string;
  sourceInstance: string;
  targetInstance: string;
  action: "imported" | "updated" | "skipped" | "rejected";
  reason?: string;
}

// ===== 联邦 Skill 学习协议 =====

/** 实例自述信息（用于联邦节点发现） */
export interface InstanceProfile {
  instanceId: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  skillCount: number;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

/** 联邦指标快照（从各实例收集） */
export interface FederatedMetricsSnapshot {
  instanceId: string;
  timestamp: number;
  skills: Array<{
    name: string;
    version: string;
    totalCalls: number;
    successRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
}

/** Skill 推荐（联邦学习的输出） */
export interface SkillRecommendation {
  /** 推荐动作 */
  action: "adopt" | "upgrade" | "optimize" | "deprecate";
  /** 目标 Skill */
  skillName: string;
  /** 推荐来源实例 */
  sourceInstance: string;
  /** 推荐理由 */
  reason: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 关联的 MigrationPackage（adopt/upgrade 时提供） */
  migrationPackage?: MigrationPackage;
}

// ===== 进化引擎协议 =====

/** 进化策略：可插拔的优化决策器 */
export interface EvolutionStrategy {
  /** 策略名称 */
  readonly name: string;
  /** 分析当前系统状态，返回建议动作列表 */
  analyze(context: EvolutionContext): Promise<EvolutionAction[]>;
}

/** 进化上下文：传递给策略的系统状态 */
export interface EvolutionContext {
  /** 所有 Skill 的当前指标 */
  metrics: Array<{
    name: string;
    totalCalls: number;
    successRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    lastCalledAt: number;
  }>;
  /** 已注册 Skill 列表 */
  registeredSkills: string[];
  /** 最近的错误模式 */
  recentErrors: Array<{ skillName: string; errorType: string; count: number }>;
  /** 联邦推荐（如果有） */
  federatedRecommendations: SkillRecommendation[];
  /** 上次进化时间 */
  lastEvolutionAt: number;
}

/** 进化动作：策略输出的具体操作 */
export interface EvolutionAction {
  /** 动作类型 */
  type:
    | "optimize"       // 优化已有 Skill
    | "generate"       // 生成新 Skill
    | "retire"         // 淘汰不活跃 Skill
    | "adopt"          // 从联邦采纳 Skill
    | "canary"         // 发起灰度测试
    | "rollback"       // 回滚到旧版本
    | "alert";         // 仅告警，不自动执行
  /** 目标 Skill */
  skillName: string;
  /** 动作详情 */
  payload: Record<string, unknown>;
  /** 优先级 0-100 */
  priority: number;
  /** 是否需要人工审批 */
  requiresApproval: boolean;
}

// ===== 传输层接口 =====

/** 实例间通信的传输层（可替换实现） */
export interface FederationTransport {
  /** 传输层名称 */
  readonly name: string;
  /** 发送请求到远程实例 */
  send(endpoint: string, action: string, payload: unknown): Promise<unknown>;
  /** 广播到所有已知实例 */
  broadcast(action: string, payload: unknown): Promise<Array<{ instanceId: string; result: unknown }>>;
  /** 注册本地处理器 */
  onReceive(action: string, handler: (payload: unknown, from: string) => Promise<unknown>): void;
}

// ===== 事件系统 =====

export type FederationEventType =
  | "skill:migrated"
  | "skill:adopted"
  | "skill:optimized"
  | "skill:retired"
  | "federation:heartbeat"
  | "federation:recommendation"
  | "evolution:cycle_start"
  | "evolution:cycle_end"
  | "evolution:action_executed"
  | "evolution:action_rejected";

export interface FederationEvent {
  type: FederationEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export type FederationEventHandler = (event: FederationEvent) => void;
