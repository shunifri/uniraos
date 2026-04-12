import { randomUUID } from 'crypto';
import { getRabbitMQClient } from './rabbitmq-client.js';
import { getRedisClient } from '../cache/redis-client.js';
import { log } from '../utils/logger.js';
import type { QueueMessage } from './types.js';

export interface DocParserRequest {
  docId: string;
  filePath: string;
  fileType: string;
  ownerId: string;
  options?: {
    extractImages?: boolean;
    extractTables?: boolean;
    ocrEnabled?: boolean;
  };
}

export interface DocParserStatus {
  taskId: string;
  docId: string;
  status: 'pending' | 'parsing' | 'completed' | 'failed';
  progress: number; // 0-100
  stage?: string;
  result?: {
    chunkCount: number;
    pageCount: number;
    error?: string;
  };
  createdAt: number;
  updatedAt: number;
}

const QUEUE_NAME = 'doc_parser_requests';
const PROGRESS_CHANNEL = 'doc:parser:progress';
const TASK_TTL = 7200; // 2 hours

export class DocParserProducer {
  private rabbit = getRabbitMQClient();
  private redis = getRedisClient();

  async enqueue(request: DocParserRequest): Promise<string> {
    const taskId = randomUUID();
    const message: QueueMessage<DocParserRequest> = {
      id: taskId,
      type: 'doc_parser_request',
      payload: request,
      timestamp: Date.now(),
      retryCount: 0,
    };

    const status: DocParserStatus = {
      taskId,
      docId: request.docId,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await Promise.all([
      this.redis.set(`docparser:${taskId}`, status, TASK_TTL),
      this.rabbit.publish(QUEUE_NAME, message),
    ]);

    log('info', 'Doc parser task enqueued', { taskId, docId: request.docId });
    return taskId;
  }

  async getStatus(taskId: string): Promise<DocParserStatus | null> {
    return this.redis.get<DocParserStatus>(`docparser:${taskId}`);
  }

  async updateProgress(
    taskId: string,
    progress: number,
    stage?: string
  ): Promise<void> {
    const existing = await this.getStatus(taskId);
    if (!existing) return;

    const updated: DocParserStatus = {
      ...existing,
      progress: Math.min(100, Math.max(0, progress)),
      stage,
      updatedAt: Date.now(),
    };

    await this.redis.set(`docparser:${taskId}`, updated, TASK_TTL);

    // Publish progress for SSE
    await this.redis.getClient().publish(PROGRESS_CHANNEL, JSON.stringify({
      taskId,
      docId: existing.docId,
      progress: updated.progress,
      stage,
    }));
  }

  async complete(taskId: string, result: DocParserStatus['result']): Promise<void> {
    await this.updateStatus(taskId, {
      status: 'completed',
      progress: 100,
      result,
    });
  }

  async fail(taskId: string, error: string): Promise<void> {
    await this.updateStatus(taskId, {
      status: 'failed',
      result: { chunkCount: 0, pageCount: 0, error },
    });
  }

  private async updateStatus(taskId: string, update: Partial<DocParserStatus>): Promise<void> {
    const existing = await this.getStatus(taskId);
    if (!existing) return;

    const updated: DocParserStatus = {
      ...existing,
      ...update,
      updatedAt: Date.now(),
    };

    await this.redis.set(`docparser:${taskId}`, updated, TASK_TTL);

    // Publish completion event
    await this.redis.getClient().publish(PROGRESS_CHANNEL, JSON.stringify({
      taskId,
      docId: existing.docId,
      status: updated.status,
      progress: updated.progress,
      result: updated.result,
    }));
  }
}

let instance: DocParserProducer | null = null;

export function getDocParserProducer(): DocParserProducer {
  if (!instance) {
    instance = new DocParserProducer();
  }
  return instance;
}
