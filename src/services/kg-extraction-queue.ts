/**
 * 知识图谱抽取离线队列 — KG v2 阶段 2
 *
 * 职责：把 kb_ingest / ParsingQueue 中的 LLM 抽取从同步流程中剥离，
 * 后台异步执行。详见 docs/KG_ARCHITECTURE_VISION.md §3.2、§8.2。
 *
 * 设计：
 * - 复用 IngestQueue 模式（串行、超时、状态可查）
 * - 任务粒度 = 一个文档的整次抽取
 * - 失败容错：单次抽取失败不影响主流程（kg 节点/边缺失可后续重跑）
 * - 幂等性：底层 extractRelationsToGraph 已做去重，重入安全
 * - 简易防抖：30 秒内同 (userId, docId) 重复入队会被忽略
 */
import { IngestQueue, type QueueTask } from "../utils/ingest-queue.js";
import { extractRelationsToGraph } from "../memory/knowledge-graph/extraction-pipeline.js";
import type { UserSessionManager } from "../user/user-session.js";

export interface KgExtractionJob {
  docId: string;
  docName: string;
  userId: string;
  content: string;
  /** 切分大小（字符数），默认 3000 */
  chunkSize?: number;
  /** 切分重叠，默认 500 */
  overlap?: number;
  /** 每段 LLM 调用最多处理多少关系，默认 20 */
  maxRelationsPerChunk?: number;
  /** 是否创建 doc anchor 节点，默认 true */
  createDocAnchor?: boolean;
  /** 日志标签 */
  callerTag?: string;
}

export interface KgExtractionTask extends QueueTask {
  docId: string;
  docName: string;
  userId: string;
  /** 抽取结果（完成后填入） */
  result?: { totalRelations: number; createdNodes: number; chunksProcessed: number };
}

class KgExtractionQueueImpl {
  private queue: IngestQueue;
  /** 防抖：30 秒内同 (userId, docId) 重复入队会被忽略 */
  private recentTasks = new Map<string, string>();

  constructor() {
    this.queue = new IngestQueue({ concurrency: 1, timeoutMs: 600_000 }); // 10 分钟
  }

  /**
   * 提交一个文档的抽取任务。
   * 返回 taskId；如果 30 秒内同 (userId, docId) 已入队，返回旧 taskId。
   */
  enqueue(job: KgExtractionJob, sessionManager: UserSessionManager): string {
    const recentKey = `${job.userId}:${job.docId}`;
    const existing = this.recentTasks.get(recentKey);
    if (existing) {
      const task = this.queue.getTask(existing);
      if (task && (task.status === "pending" || task.status === "running")) {
        console.log(
          `[KgExtractionQueue] Skip enqueue for ${recentKey}, already ${task.status}`
        );
        return existing;
      }
    }

    const taskId = `kg_extract_${job.docId}_${Date.now()}`;
    this.recentTasks.set(recentKey, taskId);
    setTimeout(() => {
      const cur = this.recentTasks.get(recentKey);
      if (cur === taskId) this.recentTasks.delete(recentKey);
    }, 30_000);

    this.queue.enqueue(
      async () => this.runJob(job, sessionManager),
      {
        id: taskId,
        docId: job.docId,
        userId: job.userId,
        name: `kg-extract-${job.docName}`,
      }
    );
    return taskId;
  }

  private async runJob(
    job: KgExtractionJob,
    sessionManager: UserSessionManager
  ): Promise<void> {
    const session = sessionManager.getOrCreate(job.userId);
    const graphManager = (session as any).graphManager;
    if (!graphManager) {
      console.warn(`[KgExtractionQueue] No graphManager for user ${job.userId}, skip`);
      return;
    }
    // 阶段 2: LLM provider 不在 session 上，而是从 sessionManager 全局读取
    const llmProvider = sessionManager.getLLMProvider();
    if (!llmProvider) {
      console.warn(`[KgExtractionQueue] No llmProvider for user ${job.userId}, skip`);
      return;
    }
    if (!job.content || job.content.trim().length === 0) {
      console.log(`[KgExtractionQueue] Empty content for ${job.docId}, skip`);
      return;
    }

    const store = (await graphManager.getStore()) as any;
    const result = await extractRelationsToGraph(
      store,
      {
        docId: job.docId,
        docName: job.docName,
        content: job.content,
        tags: [],
      },
      llmProvider,
      {
        chunkSize: job.chunkSize ?? 3000,
        overlap: job.overlap ?? 500,
        maxRelationsPerChunk: job.maxRelationsPerChunk ?? 20,
        createDocAnchor: job.createDocAnchor ?? true,
        callerTag: job.callerTag ?? "KgExtractionQueue",
      }
    );

    console.log(
      `[KgExtractionQueue] ${job.docId} done: chunks=${result.chunksProcessed}, relations=${result.totalRelations}, newNodes=${result.createdNodes}`
    );
  }

  getStatus() {
    return this.queue.getStatus();
  }

  getTask(taskId: string): QueueTask | undefined {
    return this.queue.getTask(taskId);
  }
}

/** 全局单例 */
export const kgExtractionQueue = new KgExtractionQueueImpl();
