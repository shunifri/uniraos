/**
 * 模型选择路由
 *
 * 根据任务复杂度、成本预算和能力要求自动选择最合适的 LLM 模型。
 */
import type { LLMProvider, Message } from "./types.js";
import { log } from "../utils/logger.js";

export interface ModelProfile {
  name: string;
  provider: LLMProvider;
  /** 能力标签: reasoning, coding, creative, fast, cheap */
  capabilities: string[];
  /** 每千 token 成本估算（相对值） */
  costPer1kTokens: number;
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 最大输出 token */
  maxOutput: number;
}

export interface RoutingRule {
  /** 匹配条件 */
  condition: (input: RoutingInput) => boolean;
  /** 偏好的能力标签 */
  preferCapabilities: string[];
  /** 成本权重（0-1，越高越偏好便宜模型） */
  costWeight: number;
}

export interface RoutingInput {
  messages: Message[];
  /** 预估 token 数 */
  estimatedTokens?: number;
  /** 任务类型提示 */
  taskType?: "reasoning" | "coding" | "creative" | "simple" | "complex";
  /** 是否需要工具调用 */
  needsToolUse?: boolean;
}

export class ModelRouter {
  private models: ModelProfile[] = [];
  private rules: RoutingRule[] = [];
  private defaultModel: string | null = null;

  addModel(profile: ModelProfile): void {
    this.models.push(profile);
    if (!this.defaultModel) this.defaultModel = profile.name;
  }

  setDefaultModel(name: string): void {
    this.defaultModel = name;
  }

  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
  }

  /** 根据输入选择最佳模型 */
  route(input: RoutingInput): ModelProfile {
    if (this.models.length === 0) {
      throw new Error("No models registered in router");
    }

    if (this.models.length === 1) return this.models[0];

    // 找到匹配的路由规则
    let preferCapabilities: string[] = [];
    let costWeight = 0.3;

    for (const rule of this.rules) {
      if (rule.condition(input)) {
        preferCapabilities = rule.preferCapabilities;
        costWeight = rule.costWeight;
        break;
      }
    }

    // 如果没有规则匹配，根据任务类型设置默认偏好
    if (preferCapabilities.length === 0 && input.taskType) {
      switch (input.taskType) {
        case "reasoning":
        case "complex":
          preferCapabilities = ["reasoning"];
          costWeight = 0.1;
          break;
        case "coding":
          preferCapabilities = ["coding", "reasoning"];
          costWeight = 0.2;
          break;
        case "creative":
          preferCapabilities = ["creative"];
          costWeight = 0.3;
          break;
        case "simple":
          preferCapabilities = ["fast", "cheap"];
          costWeight = 0.8;
          break;
      }
    }

    // 打分选择
    let bestModel = this.models[0];
    let bestScore = -Infinity;

    for (const model of this.models) {
      let score = 0;

      // 能力匹配得分
      const capMatch = preferCapabilities.filter((c) =>
        model.capabilities.includes(c),
      ).length;
      score += capMatch * 30;

      // 成本得分（越便宜得分越高，乘以权重）
      const maxCost = Math.max(...this.models.map((m) => m.costPer1kTokens));
      if (maxCost > 0) {
        score += (1 - model.costPer1kTokens / maxCost) * costWeight * 50;
      }

      // 上下文窗口匹配
      const tokens = input.estimatedTokens ?? estimateTokens(input.messages);
      if (tokens > model.contextWindow * 0.8) {
        score -= 100; // 超出窗口严重扣分
      }

      if (score > bestScore) {
        bestScore = score;
        bestModel = model;
      }
    }

    log("debug", "model.routed", {
      selected: bestModel.name,
      taskType: input.taskType,
      score: bestScore,
    });

    return bestModel;
  }

  /** 获取所有已注册模型 */
  getModels(): ModelProfile[] {
    return [...this.models];
  }
}

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / 4); // 粗略估算
}
