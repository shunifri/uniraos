import { randomUUID } from 'crypto';
import { getRabbitMQClient } from './rabbitmq-client.js';
import { getRedisClient } from '../cache/redis-client.js';
import { log } from '../utils/logger.js';
import type { QueueMessage } from './types.js';

export interface LLMRequest {
  conversationId: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  stream?: boolean;
  userId: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const QUEUE_NAME = 'llm_requests';
const TASK_TTL = 3600; // 1 hour

export class LLMProducer {
  private rabbit = getRabbitMQClient();
  private redis = getRedisClient();

  async enqueue(request: LLMRequest): Promise<string> {
    const taskId = randomUUID();
    const message: QueueMessage<LLMRequest> = {
      id: taskId,
      type: 'llm_request',
      payload: request,
      timestamp: Date.now(),
      retryCount: 0,
    };

    // Store initial status in Redis
    const status: TaskStatus = {
      taskId,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await Promise.all([
      this.redis.set(`task:${taskId}`, status, TASK_TTL),
      this.rabbit.publish(QUEUE_NAME, message),
    ]);

    log('info', 'LLM task enqueued', { taskId, conversationId: request.conversationId });
    return taskId;
  }

  async getStatus(taskId: string): Promise<TaskStatus | null> {
    return this.redis.get<TaskStatus>(`task:${taskId}`);
  }

  async updateStatus(taskId: string, update: Partial<TaskStatus>): Promise<void> {
    const existing = await this.getStatus(taskId);
    if (!existing) return;

    const updated: TaskStatus = {
      ...existing,
      ...update,
      updatedAt: Date.now(),
    };

    await this.redis.set(`task:${taskId}`, updated, TASK_TTL);
  }
}

let instance: LLMProducer | null = null;

export function getLLMProducer(): LLMProducer {
  if (!instance) {
    instance = new LLMProducer();
  }
  return instance;
}
