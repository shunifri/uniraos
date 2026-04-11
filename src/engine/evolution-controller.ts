/**
 * Skill 进化控制器
 *
 * 控制 Skill 自我繁殖的安全边界：
 * - 生成深度限制（Skill 生成 Skill 的最大层级）
 * - 生成速率限制
 * - 生成审计日志
 * - 价值对齐检查
 * - 人类监督环
 * - Red Line 约束系统
 * - Genealogy 族谱 API
 */
import { log } from "../utils/logger.js";

export interface EvolutionConfig {
  /** Skill 生成 Skill 的最大深度（默认 3） */
  maxGenerationDepth: number;
  /** 每小时最多生成多少个 Skill（默认 20） */
  maxGenerationsPerHour: number;
  /** 是否需要人工审批（默认 false） */
  requireHumanApproval: boolean;
  /** 禁止生成的 Skill 名称前缀 */
  forbiddenPrefixes: string[];
  /** 禁止使用的能力 */
  forbiddenCapabilities: string[];
}

const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  maxGenerationDepth: 3,
  maxGenerationsPerHour: 20,
  requireHumanApproval: false,
  forbiddenPrefixes: ["__internal_", "sys_"],
  forbiddenCapabilities: ["network:outbound:*", "shell:exec:*"],
};

interface GenerationRecord {
  name: string;
  generatedBy: string;
  depth: number;
  timestamp: number;
  approved: boolean;
}

interface PendingApproval {
  id: string;
  name: string;
  description: string;
  code: string;
  capabilities: string[];
  generatedBy: string;
  depth: number;
  createdAt: number;
}

// ===== Red Line Types =====

export interface RedLineContext {
  skillName: string;
  generatedBy: string;
  capabilities: string[];
  depth: number;
  code?: string;
}

export interface RedLineConstraint {
  id: string;
  description: string;
  check: (ctx: RedLineContext) => string | null; // returns violation description or null
  blocking: boolean; // true = hard block, false = warning only
}

export interface RedLineViolation {
  constraintId: string;
  description: string;
  blocking: boolean;
  skillName: string;
  detectedAt: number;
}

// ===== Genealogy Types =====

export interface GenealogyNode {
  name: string;
  depth: number;
  generatedBy: string | null;
  timestamp: number;
  children: GenealogyNode[];
}

export interface GenealogyStats {
  totalGenerated: number;
  maxDepth: number;
  rootSkills: string[]; // depth-0 generators
  leafSkills: string[]; // no children
  averageDepth: number;
}

// ===== Core protected skill names =====
const CORE_SKILL_NAMES = [
  "stm_read",
  "stm_write",
  "stm_list",
  "stm_delete",
  "ltm_read",
  "ltm_write",
  "ltm_search",
  "ltm_delete",
  "recall_context",
  "memory_stats",
];

export class EvolutionController {
  private config: EvolutionConfig;
  private generations: GenerationRecord[] = [];
  private currentDepth = new Map<string, number>(); // skillName → generation depth
  private pendingApprovals: PendingApproval[] = [];
  private redLines: RedLineConstraint[] = [];
  private violations: RedLineViolation[] = [];
  private budget = {
    totalBudget: 100,        // Total energy units
    used: 0,                 // Used so far
    costPerGenerate: 10,     // Cost to generate a new skill
    costPerOptimize: 5,      // Cost to optimize existing
    costPerAdopt: 3,         // Cost to adopt from federation
    regenRate: 1,            // Units regenerated per hour
    lastRegenAt: Date.now(),
  };

  constructor(config?: Partial<EvolutionConfig>) {
    this.config = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
    this.initBuiltInRedLines();
  }

  /** Check if budget allows an action */
  hasBudget(actionType: string): boolean {
    this.regenerate();
    const cost = this.getActionCost(actionType);
    return (this.budget.totalBudget - this.budget.used) >= cost;
  }

  /** Consume budget for an action */
  consumeBudget(actionType: string): void {
    this.regenerate();
    const cost = this.getActionCost(actionType);
    this.budget.used += cost;
  }

  /** Get current budget status */
  getBudgetStatus(): { total: number; used: number; remaining: number; regenRate: number } {
    this.regenerate();
    return {
      total: this.budget.totalBudget,
      used: this.budget.used,
      remaining: this.budget.totalBudget - this.budget.used,
      regenRate: this.budget.regenRate,
    };
  }

  private regenerate(): void {
    const now = Date.now();
    const hoursPassed = (now - this.budget.lastRegenAt) / 3600000;
    const regen = Math.floor(hoursPassed * this.budget.regenRate);
    if (regen > 0) {
      this.budget.used = Math.max(0, this.budget.used - regen);
      this.budget.lastRegenAt = now;
    }
  }

  private getActionCost(actionType: string): number {
    switch (actionType) {
      case "generate": return this.budget.costPerGenerate;
      case "optimize": return this.budget.costPerOptimize;
      case "adopt": return this.budget.costPerAdopt;
      default: return 0;
    }
  }

  /** Initialize built-in red line constraints */
  private initBuiltInRedLines(): void {
    // 1. Core skill protection
    this.redLines.push({
      id: "core_skill_protection",
      description: "Forbid overwriting core Skills (stm_*, ltm_*, recall_context, memory_stats)",
      blocking: true,
      check: (ctx: RedLineContext) => {
        const name = ctx.skillName;
        if (CORE_SKILL_NAMES.includes(name)) {
          return `Cannot overwrite core skill "${name}"`;
        }
        if (name.startsWith("stm_") || name.startsWith("ltm_")) {
          return `Cannot generate skill with reserved prefix: "${name}"`;
        }
        return null;
      },
    });

    // 2. Network capability restriction
    this.redLines.push({
      id: "network_capability",
      description: "Forbid unapproved network:outbound:* capability",
      blocking: true,
      check: (ctx: RedLineContext) => {
        for (const cap of ctx.capabilities) {
          if (cap.startsWith("network:outbound:")) {
            return `Unapproved network capability: "${cap}"`;
          }
          if (cap === "network:outbound" || cap === "network:outbound:*") {
            return `Unapproved network capability: "${cap}"`;
          }
        }
        return null;
      },
    });

    // 3. Sandbox file write restriction
    this.redLines.push({
      id: "sandbox_file_write",
      description: "Forbid filesystem:write:* outside sandbox",
      blocking: true,
      check: (ctx: RedLineContext) => {
        for (const cap of ctx.capabilities) {
          if (cap.startsWith("filesystem:write:")) {
            const path = cap.slice("filesystem:write:".length);
            if (path !== "*" && !path.startsWith("/sandbox") && !path.startsWith("sandbox")) {
              return `File write outside sandbox not allowed: "${cap}"`;
            }
            if (path === "*") {
              return `Unrestricted file write capability not allowed: "${cap}"`;
            }
          }
        }
        return null;
      },
    });

    // 4. Max generation depth
    this.redLines.push({
      id: "max_generation_depth",
      description: "Forbid exceeding maximum generation depth",
      blocking: true,
      check: (ctx: RedLineContext) => {
        if (ctx.depth > this.config.maxGenerationDepth) {
          return `Generation depth ${ctx.depth} exceeds maximum ${this.config.maxGenerationDepth}`;
        }
        return null;
      },
    });
  }

  // ===== Red Line Methods =====

  /** Add a custom red line constraint */
  addRedLine(constraint: RedLineConstraint): void {
    // Replace if same ID exists
    const idx = this.redLines.findIndex((r) => r.id === constraint.id);
    if (idx >= 0) {
      this.redLines[idx] = constraint;
    } else {
      this.redLines.push(constraint);
    }
    log("info", "redline.added", { id: constraint.id, blocking: constraint.blocking });
  }

  /** Remove a red line constraint by ID */
  removeRedLine(id: string): boolean {
    const idx = this.redLines.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.redLines.splice(idx, 1);
    log("info", "redline.removed", { id });
    return true;
  }

  /** Get all red line constraints */
  getRedLines(): RedLineConstraint[] {
    return [...this.redLines];
  }

  /** Get violation history */
  getViolations(options?: { since?: number; blocking?: boolean }): RedLineViolation[] {
    let result = [...this.violations];
    if (options?.since != null) {
      result = result.filter((v) => v.detectedAt >= options.since!);
    }
    if (options?.blocking != null) {
      result = result.filter((v) => v.blocking === options.blocking);
    }
    return result;
  }

  /** Check all red lines against a context, record violations */
  checkRedLines(ctx: RedLineContext): RedLineViolation[] {
    const newViolations: RedLineViolation[] = [];
    const now = Date.now();

    for (const rl of this.redLines) {
      const violationDesc = rl.check(ctx);
      if (violationDesc != null) {
        const violation: RedLineViolation = {
          constraintId: rl.id,
          description: violationDesc,
          blocking: rl.blocking,
          skillName: ctx.skillName,
          detectedAt: now,
        };
        newViolations.push(violation);
        this.violations.push(violation);
        log(rl.blocking ? "error" : "warn", "redline.violation", {
          constraintId: rl.id,
          skillName: ctx.skillName,
          description: violationDesc,
          blocking: rl.blocking,
        });
      }
    }

    return newViolations;
  }

  // ===== Genealogy Methods =====

  /** Get ancestry chain from root to the given skill */
  getAncestry(name: string): string[] {
    const chain: string[] = [];
    let current = name;
    const visited = new Set<string>();

    while (current) {
      if (visited.has(current)) break; // prevent infinite loop
      visited.add(current);
      chain.unshift(current);
      const record = this.generations.find((g) => g.name === current);
      if (!record) break;
      current = record.generatedBy;
    }

    return chain;
  }

  /** Get all descendant names of a skill */
  getDescendants(name: string): string[] {
    const descendants: string[] = [];
    const queue = [name];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const children = this.generations
        .filter((g) => g.generatedBy === current)
        .map((g) => g.name);

      for (const child of children) {
        if (!visited.has(child)) {
          descendants.push(child);
          queue.push(child);
        }
      }
    }

    return descendants;
  }

  /** Get the full genealogy tree(s) */
  getGenealogyTree(): GenealogyNode[] {
    // Find root generators: skills that generated others but were not themselves generated
    const generatedNames = new Set(this.generations.map((g) => g.name));
    const generatorNames = new Set(this.generations.map((g) => g.generatedBy));

    // Root skills are generators that are not themselves generated
    const rootNames = [...generatorNames].filter((name) => !generatedNames.has(name));

    const buildNode = (name: string): GenealogyNode => {
      const record = this.generations.find((g) => g.name === name);
      const children = this.generations
        .filter((g) => g.generatedBy === name)
        .map((g) => buildNode(g.name));

      return {
        name,
        depth: record?.depth ?? 0,
        generatedBy: record?.generatedBy ?? null,
        timestamp: record?.timestamp ?? 0,
        children,
      };
    };

    return rootNames.map((rootName) => {
      const children = this.generations
        .filter((g) => g.generatedBy === rootName)
        .map((g) => buildNode(g.name));

      return {
        name: rootName,
        depth: 0,
        generatedBy: null,
        timestamp: 0,
        children,
      };
    });
  }

  /** Get siblings: skills generated by the same parent */
  getSiblings(name: string): string[] {
    const record = this.generations.find((g) => g.name === name);
    if (!record) return [];

    return this.generations
      .filter((g) => g.generatedBy === record.generatedBy && g.name !== name)
      .map((g) => g.name);
  }

  /** Get genealogy statistics */
  getGenealogyStats(): GenealogyStats {
    if (this.generations.length === 0) {
      return {
        totalGenerated: 0,
        maxDepth: 0,
        rootSkills: [],
        leafSkills: [],
        averageDepth: 0,
      };
    }

    const generatedNames = new Set(this.generations.map((g) => g.name));
    const generatorNames = new Set(this.generations.map((g) => g.generatedBy));

    // Root skills: generators that were not themselves generated
    const rootSkills = [...generatorNames].filter((name) => !generatedNames.has(name));

    // Leaf skills: generated skills that never generated others
    const leafSkills = this.generations
      .filter((g) => !generatorNames.has(g.name))
      .map((g) => g.name);

    const maxDepth = Math.max(...this.generations.map((g) => g.depth));
    const avgDepth =
      this.generations.reduce((sum, g) => sum + g.depth, 0) / this.generations.length;

    return {
      totalGenerated: this.generations.length,
      maxDepth,
      rootSkills,
      leafSkills,
      averageDepth: avgDepth,
    };
  }

  // ===== Original Methods =====

  /** 检查是否允许生成新 Skill */
  canGenerate(name: string, generatedBy: string, capabilities: string[]): { allowed: boolean; reason?: string } {
    // Budget check
    if (!this.hasBudget("generate")) {
      return { allowed: false, reason: "Insufficient evolution budget for generate action" };
    }

    // Red line checks first
    const parentDepth = this.currentDepth.get(generatedBy) ?? 0;
    const ctx: RedLineContext = {
      skillName: name,
      generatedBy,
      capabilities,
      depth: parentDepth + 1,
    };
    const redLineViolations = this.checkRedLines(ctx);
    const blockingViolation = redLineViolations.find((v) => v.blocking);
    if (blockingViolation) {
      return { allowed: false, reason: blockingViolation.description };
    }

    // 名称检查
    for (const prefix of this.config.forbiddenPrefixes) {
      if (name.startsWith(prefix)) {
        return { allowed: false, reason: `名称前缀 "${prefix}" 不允许` };
      }
    }

    // 能力检查
    for (const cap of capabilities) {
      for (const forbidden of this.config.forbiddenCapabilities) {
        if (matchCapability(cap, forbidden)) {
          return { allowed: false, reason: `能力 "${cap}" 被禁止` };
        }
      }
    }

    // 深度检查
    if (parentDepth >= this.config.maxGenerationDepth) {
      return { allowed: false, reason: `生成深度已达上限 ${this.config.maxGenerationDepth}` };
    }

    // 速率检查
    const oneHourAgo = Date.now() - 3600000;
    const recentGenerations = this.generations.filter((g) => g.timestamp > oneHourAgo).length;
    if (recentGenerations >= this.config.maxGenerationsPerHour) {
      return { allowed: false, reason: `每小时生成上限 ${this.config.maxGenerationsPerHour} 已达到` };
    }

    return { allowed: true };
  }

  /** 记录 Skill 生成 */
  recordGeneration(name: string, generatedBy: string): void {
    const parentDepth = this.currentDepth.get(generatedBy) ?? 0;
    const depth = parentDepth + 1;
    this.currentDepth.set(name, depth);

    this.generations.push({
      name,
      generatedBy,
      depth,
      timestamp: Date.now(),
      approved: !this.config.requireHumanApproval,
    });
    // 限制历史记录大小，防止内存泄漏
    if (this.generations.length > 1000) {
      this.generations = this.generations.slice(-500);
    }

    log("info", "skill.generated", {
      name,
      generatedBy,
      depth,
      totalGenerations: this.generations.length,
    });
  }

  /** 提交人工审批 */
  submitForApproval(
    name: string,
    description: string,
    code: string,
    capabilities: string[],
    generatedBy: string,
  ): string {
    const id = crypto.randomUUID();
    const parentDepth = this.currentDepth.get(generatedBy) ?? 0;
    this.pendingApprovals.push({
      id,
      name,
      description,
      code,
      capabilities,
      generatedBy,
      depth: parentDepth + 1,
      createdAt: Date.now(),
    });

    log("info", "skill.pending_approval", { id, name, generatedBy });
    return id;
  }

  /** 人工审批通过 */
  approve(id: string): PendingApproval | null {
    const idx = this.pendingApprovals.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const item = this.pendingApprovals.splice(idx, 1)[0];
    log("info", "skill.approved", { id, name: item.name });
    return item;
  }

  /** 人工审批拒绝 */
  reject(id: string, reason: string): boolean {
    const idx = this.pendingApprovals.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const item = this.pendingApprovals.splice(idx, 1)[0];
    log("info", "skill.rejected", { id, name: item.name, reason });
    return true;
  }

  /** 获取待审批列表 */
  getPendingApprovals(): PendingApproval[] {
    return [...this.pendingApprovals];
  }

  /** 获取生成历史 */
  getGenerationHistory(): GenerationRecord[] {
    return [...this.generations];
  }

  /** 获取 Skill 的生成深度 */
  getDepth(skillName: string): number {
    return this.currentDepth.get(skillName) ?? 0;
  }

  /** 获取配置 */
  getConfig(): EvolutionConfig {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(partial: Partial<EvolutionConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}

function matchCapability(cap: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === cap) return true;
  const parts = pattern.split(":");
  const capParts = cap.split(":");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "*") return true;
    if (parts[i] !== capParts[i]) return false;
  }
  return parts.length <= capParts.length;
}
