import { getRabbitMQClient } from './rabbitmq-client.js';
import { getDocParserProducer } from './doc-parser-producer.js';
import { log } from '../utils/logger.js';
import type { QueueMessage } from './types.js';
import type { DocParserRequest } from './doc-parser-producer.js';

const QUEUE_NAME = 'doc_parser_requests';

export class DocParserConsumer {
  private rabbit = getRabbitMQClient();
  private producer = getDocParserProducer();
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.rabbit.createQueue(QUEUE_NAME, {
      durable: true,
      // Limit concurrent parsing to avoid overwhelming the system
      arguments: {
        'x-max-priority': 10,
      },
    });

    await this.rabbit.consume(QUEUE_NAME, async (message) => {
      await this.processRequest(message as QueueMessage<DocParserRequest>);
    });

    log('info', 'Doc parser consumer started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    log('info', 'Doc parser consumer stopped');
  }

  private async processRequest(message: QueueMessage<DocParserRequest>): Promise<void> {
    const { id: taskId, payload: request } = message;
    const { docId, filePath, fileType } = request;

    try {
      log('info', 'Starting document parsing', { taskId, docId, fileType });

      // Update status to parsing
      await this.producer.updateProgress(taskId, 10, 'extracting_text');

      // Stage 1: Extract text (simulated)
      await this.parseDocument(request, async (progress, stage) => {
        await this.producer.updateProgress(taskId, progress, stage);
      });

      // Complete
      await this.producer.complete(taskId, {
        chunkCount: Math.floor(Math.random() * 50) + 10,
        pageCount: Math.floor(Math.random() * 20) + 5,
      });

      log('info', 'Document parsing completed', { taskId, docId });
    } catch (error) {
      const errorMsg = (error as Error).message;
      log('error', 'Document parsing failed', { taskId, docId, error: errorMsg });
      await this.producer.fail(taskId, errorMsg);
      throw error;
    }
  }

  private async parseDocument(
    request: DocParserRequest,
    onProgress: (progress: number, stage: string) => Promise<void>
  ): Promise<void> {
    // TODO: Integrate with actual document parser
    // This is a placeholder that simulates the parsing process

    const stages = [
      { progress: 20, stage: 'extracting_text', delay: 500 },
      { progress: 40, stage: 'analyzing_layout', delay: 800 },
      { progress: 60, stage: 'extracting_images', delay: 600 },
      { progress: 80, stage: 'generating_embeddings', delay: 1000 },
      { progress: 95, stage: 'indexing', delay: 500 },
    ];

    for (const { progress, stage, delay } of stages) {
      await new Promise(resolve => setTimeout(resolve, delay));
      await onProgress(progress, stage);
    }
  }
}

let instance: DocParserConsumer | null = null;

export function getDocParserConsumer(): DocParserConsumer {
  if (!instance) {
    instance = new DocParserConsumer();
  }
  return instance;
}
