import { getRabbitMQClient } from './rabbitmq-client.js';
import { getLLMProducer } from './llm-producer.js';
import { getRedisClient } from '../cache/redis-client.js';
import { log } from '../utils/logger.js';
import type { QueueMessage } from './types.js';
import type { LLMRequest } from './llm-producer.js';

const QUEUE_NAME = 'llm_requests';
const RESULT_CHANNEL = 'llm:results';

export class LLMConsumer {
  private rabbit = getRabbitMQClient();
  private redis = getRedisClient();
  private producer = getLLMProducer();
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.rabbit.createQueue(QUEUE_NAME, {
      durable: true,
      maxPriority: 10,
    });

    await this.rabbit.consume(QUEUE_NAME, async (message) => {
      await this.processRequest(message as QueueMessage<LLMRequest>);
    });

    log('info', 'LLM consumer started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.rabbit.close();
    log('info', 'LLM consumer stopped');
  }

  private async processRequest(message: QueueMessage<LLMRequest>): Promise<void> {
    const { id: taskId, payload: request } = message;

    try {
      log('info', 'Processing LLM request', { taskId, conversationId: request.conversationId });

      // Update status to processing
      await this.producer.updateStatus(taskId, { status: 'processing' });

      // Simulate LLM processing (replace with actual LLM call)
      const result = await this.callLLM(request);

      // Update status to completed
      await this.producer.updateStatus(taskId, {
        status: 'completed',
        result,
      });

      // Publish result to Redis Pub/Sub for real-time notifications
      await this.redis.getClient().publish(RESULT_CHANNEL, JSON.stringify({
        taskId,
        conversationId: request.conversationId,
        result,
      }));

      log('info', 'LLM request completed', { taskId });
    } catch (error) {
      const errorMsg = (error as Error).message;
      log('error', 'LLM request failed', { taskId, error: errorMsg });

      await this.producer.updateStatus(taskId, {
        status: 'failed',
        error: errorMsg,
      });

      // Re-throw to trigger message retry
      throw error;
    }
  }

  private async callLLM(request: LLMRequest): Promise<any> {
    // TODO: Integrate with actual LLM provider
    // This is a placeholder implementation
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      content: `Processed: ${request.messages[request.messages.length - 1]?.content || ''}`,
      model: request.model || 'default',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
  }
}

let instance: LLMConsumer | null = null;

export function getLLMConsumer(): LLMConsumer {
  if (!instance) {
    instance = new LLMConsumer();
  }
  return instance;
}
