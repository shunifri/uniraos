/**
 * 用户会话管理：每个用户独立的 STM/LTM/AgentLoop
 */
import { join } from "path";
import { existsSync, renameSync, mkdirSync } from "fs";
import { ShortTermMemory } from "../memory/stm.js";
import { FileLTMBackend } from "../memory/ltm.js";
import { EnhancedLTMBackend } from "../memory/enhanced/enhanced-ltm-backend.js";
import type { LTMBackend } from "../memory/ltm-backend.js";
import type { EmbeddingProvider } from "../memory/embedding-provider.js";
import type { MemoryConfig } from "../config/config-manager.js";
import { AgentLoop } from "../llm/agent-loop.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type { LLMProvider } from "../llm/types.js";
import type { AgentLoopConfig } from "../llm/agent-loop.js";
import { KnowledgeGraphManager } from "../memory/knowledge-graph/index.js";

export interface UserSession {
  userId: string;
  stm: ShortTermMemory;
  ltm: LTMBackend;
  agentLoop: AgentLoop | null;
  lastActiveAt: number;
  graphManager: KnowledgeGraphManager | null;
}

export class UserSessionManager {
  private sessions = new Map<string, UserSession>();
  private baseLtmPath: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private llmProvider: LLMProvider | null = null;
  private memoryConfig: MemoryConfig;

  constructor(baseLtmPath: string, memoryConfig?: MemoryConfig) {
    this.baseLtmPath = baseLtmPath;
    this.memoryConfig = memoryConfig ?? { backend: 'file' };
    this.migrateOldData();
  }

  /** 设置 embedding provider，LTM 语义搜索依赖此 */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    // 更新所有已有 session 的 LTM（仅支持该方法的后端）
    for (const session of this.sessions.values()) {
      if (session.ltm.setEmbeddingProvider) {
        session.ltm.setEmbeddingProvider(provider);
      }
    }
  }

  /** 设置 LLM provider，用于冲突检测、事实提取等增强能力 */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  /** 获取当前记忆后端类型 */
  getMemoryBackend(): string {
    return this.memoryConfig.backend;
  }

  /** 获取或创建用户 session */
  getOrCreate(userId: string): UserSession {
    let session = this.sessions.get(userId);
    if (session) {
      session.lastActiveAt = Date.now();
      return session;
    }

    session = {
      userId,
      stm: new ShortTermMemory({ maxEntries: 200 }),
      ltm: this.createLTMBackend(userId),
      agentLoop: null,
      lastActiveAt: Date.now(),
      graphManager: new KnowledgeGraphManager(join(this.baseLtmPath, userId, "graph", "graph.json")),
    };

    this.sessions.set(userId, session);
    return session;
  }

  /** 根据配置创建对应的 LTM 后端 */
  private createLTMBackend(userId: string): LTMBackend {
    // 使用 EnhancedLTMBackend 包装 FileLTMBackend，自动获得版本链、遗忘管理、冲突检测能力
    const ltmPath = join(this.baseLtmPath, userId);
    return new EnhancedLTMBackend(
      {
        storePath: ltmPath,
        archiveIntervalMs: 60 * 60 * 1000,
        embeddingProvider: this.embeddingProvider ?? undefined,
      },
      this.llmProvider ?? undefined,
    );
  }

  /** 为指定用户重建 AgentLoop */
  rebuildAgentLoop(
    userId: string,
    registry: SkillRegistry,
    engine: ExecutionEngine,
    provider: LLMProvider,
    config?: Partial<AgentLoopConfig>,
  ): void {
    const session = this.getOrCreate(userId);
    session.agentLoop = new AgentLoop(registry, engine, provider, config);
  }

  /** 为所有活跃 session 重建 AgentLoop（LLM 配置变更时调用） */
  rebuildAllAgentLoops(
    registry: SkillRegistry,
    engine: ExecutionEngine,
    provider: LLMProvider,
    config?: Partial<AgentLoopConfig>,
  ): void {
    for (const [, session] of this.sessions) {
      session.agentLoop = new AgentLoop(registry, engine, provider, config);
    }
  }

  /** 销毁指定用户 session（LTM 已持久化，不会丢失） */
  destroy(userId: string): void {
    this.sessions.delete(userId);
  }

  /** 获取所有活跃 session 的摘要 */
  listSessions(): Array<{ userId: string; lastActiveAt: number; hasAgentLoop: boolean }> {
    return Array.from(this.sessions.values()).map((s) => ({
      userId: s.userId,
      lastActiveAt: s.lastActiveAt,
      hasAgentLoop: s.agentLoop !== null,
    }));
  }

  /** 启动定时清理不活跃 session */
  startCleanup(intervalMs = 60 * 60 * 1000, maxIdleMs = 24 * 60 * 60 * 1000): void {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, session] of this.sessions) {
        if (now - session.lastActiveAt > maxIdleMs) {
          this.sessions.delete(userId);
        }
      }
    }, intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 迁移旧数据：如果 baseLtmPath 下直接有 index.json（旧格式），
   * 则将其内容移到 default/ 子目录
   */
  private migrateOldData(): void {
    const oldIndex = join(this.baseLtmPath, "index.json");
    if (existsSync(oldIndex)) {
      const defaultDir = join(this.baseLtmPath, "default");
      mkdirSync(defaultDir, { recursive: true });

      // 移动文件
      for (const file of ["index.json", "archive-manifest.json"]) {
        const src = join(this.baseLtmPath, file);
        if (existsSync(src)) {
          renameSync(src, join(defaultDir, file));
        }
      }

      // 移动 archives 目录
      const oldArchives = join(this.baseLtmPath, "archives");
      const newArchives = join(defaultDir, "archives");
      if (existsSync(oldArchives) && !existsSync(newArchives)) {
        renameSync(oldArchives, newArchives);
      }

      console.log("   LTM data migrated: old format → default/");
    }
  }
}
