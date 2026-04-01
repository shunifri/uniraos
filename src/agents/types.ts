/**
 * 多层次智能体架构 - 核心类型定义
 *
 * 三级智能体：Simple → ReAct → Team
 * 七种协作协议：HIERARCHICAL, SEQUENTIAL, SWARM, A2A, CONTRACT_NET, MARKET_BASED, BLACKBOARD
 */
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type { LLMProvider, Message, ToolDefinition } from "../llm/types.js";
import type { StreamEvent as BaseStreamEvent } from "../llm/agent-loop.js";

// ===== 智能体级别 =====

export type AgentLevel = "simple" | "react" | "team";

// ===== 协作协议 =====

export enum Protocol {
  /** 层级式：中心化决策，严格任务拆解与质量审计 */
  HIERARCHICAL = "HIERARCHICAL",
  /** 顺序式：线性单向流，确定性状态接力 */
  SEQUENTIAL = "SEQUENTIAL",
  /** 蜂群式：动态自组织，去中心化快速接力 */
  SWARM = "SWARM",
  /** 对等式：点对点移交，授权式移交 */
  A2A = "A2A",
  /** 合同网：招标投标制，竞争择优 */
  CONTRACT_NET = "CONTRACT_NET",
  /** 市场式：经济博弈，基于资源成本的最优配置 */
  MARKET_BASED = "MARKET_BASED",
  /** 黑板式：共享上下文，异步协同 */
  BLACKBOARD = "BLACKBOARD",
}

// ===== 智能体 Profile =====

export interface AgentProfile {
  /** 角色名称，如 "项目经理"、"前端专家" */
  role: string;
  /** 系统人格提示词 */
  personality: string;
  /** 擅长领域标签 */
  expertise: string[];
  /** 可使用的 Skill 名称列表（空=全部） */
  allowedSkills: string[];
  /** 能力成本估算（用于 MARKET_BASED） */
  costPerToken?: number;
}

// ===== 智能体输入/输出 =====

export interface AgentInput {
  /** 用户消息或上游智能体传入 */
  message: string;
  /** 附加上下文（黑板数据、上游结果等） */
  context?: Record<string, unknown>;
  /** 对话历史（可选，用于延续对话） */
  history?: Message[];
  /** 用户 ID（用于 per-user 对话历史管理） */
  userId?: string;
}

export interface AgentOutput {
  /** 最终回复 */
  response: string;
  /** 智能体级别 */
  level: AgentLevel;
  /** 使用的协议（team 级别） */
  protocol?: Protocol;
  /** 执行步骤 */
  steps: AgentStep[];
  /** 参与的子智能体 */
  agents?: string[];
  /** 总迭代次数 */
  iterations: number;
  /** 元数据（耗时、token 用量等） */
  metadata: Record<string, unknown>;
}

export interface AgentStep {
  agentRole: string;
  type: "thinking" | "response" | "tool_call" | "tool_result" | "handoff" | "bid" | "blackboard_update";
  content?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

// ===== 流式事件 =====

export interface AgentStreamEvent {
  event:
    | "strategy_selected"
    | "agent_start"
    | "agent_thinking"
    | "text_delta"
    | "tool_call"
    | "tool_start"
    | "tool_result"
    | "handoff"
    | "bid"
    | "blackboard_update"
    | "agent_done"
    | "done"
    | "error";
  agentRole?: string;
  data: Record<string, unknown>;
}

// ===== 策略分析结果 =====

export interface StrategyDecision {
  /** 选择的智能体级别 */
  level: AgentLevel;
  /** 选择的协议（仅 team 级别） */
  protocol?: Protocol;
  /** 决策理由 */
  reasoning: string;
  /** 建议的智能体配置（team 级别） */
  teamConfig?: TeamConfig;
  /** 是否检测到话题变化 */
  topicChange?: boolean;
}

export interface TeamConfig {
  /** 团队成员 Profile */
  members: AgentProfile[];
  /** 管理者 Profile（HIERARCHICAL 模式） */
  manager?: AgentProfile;
  /** 流水线步骤描述（SEQUENTIAL 模式） */
  pipelineSteps?: string[];
  /** 最大轮次 */
  maxRounds?: number;
}

// ===== 智能体接口 =====

export interface Agent {
  readonly name: string;
  readonly level: AgentLevel;
  readonly profile: AgentProfile;

  run(input: AgentInput): Promise<AgentOutput>;
  runStream(input: AgentInput): AsyncGenerator<AgentStreamEvent>;
}

// ===== 协议执行器接口 =====

export interface ProtocolExecutor {
  readonly protocol: Protocol;

  execute(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): Promise<AgentOutput>;

  executeStream(
    input: AgentInput,
    config: TeamConfig,
    agentFactory: (profile: AgentProfile) => Agent,
  ): AsyncGenerator<AgentStreamEvent>;
}

// ===== 黑板数据结构 =====

export interface BlackboardEntry {
  key: string;
  value: unknown;
  author: string;
  timestamp: number;
  version: number;
}

export interface Blackboard {
  entries: Map<string, BlackboardEntry>;
  read(key: string): BlackboardEntry | undefined;
  write(key: string, value: unknown, author: string): void;
  list(): BlackboardEntry[];
  subscribe(callback: (entry: BlackboardEntry) => void): () => void;
}

// ===== 竞标数据结构 =====

export interface Bid {
  agentRole: string;
  confidence: number; // 0-1
  estimatedCost: number;
  estimatedTime: number; // ms
  approach: string;
}

// ===== 智能体依赖 =====

export interface AgentDeps {
  registry: SkillRegistry;
  engine: ExecutionEngine;
  provider: LLMProvider;
}
