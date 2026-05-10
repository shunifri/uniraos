/**
 * RabbitMQ Client
 * 
 * Features:
 * - Connection retry with exponential backoff
 * - Message persistence
 * - Ack/Nack handling
 * - Dead letter queue support
 * - Connection health check
 * - Singleton pattern
 */

import { connect as amqpConnect, ChannelModel, Channel, Message, Options } from 'amqplib';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  QueueMessage,
  QueueOptions,
  ConsumeOptions,
  PublishOptions,
  RabbitMQConfig,
  defaultRabbitMQConfig,
  DeadLetterConfig,
  ConnectionState,
  MessageHandler,
} from './types.js';
import { log } from '../utils/logger.js';

/**
 * RabbitMQ Client class
 * Provides a high-level interface for RabbitMQ operations
 */
export class RabbitMQClient extends EventEmitter {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private config: RabbitMQConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private consumers = new Map<string, { queue: string; handler: MessageHandler }>();
  private isClosing = false;

  constructor(config?: Partial<RabbitMQConfig>) {
    super();
    this.config = { ...defaultRabbitMQConfig, ...config };
  }

  /**
   * Connect to RabbitMQ server
   * Implements connection retry with exponential backoff
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.state = 'connecting';
    this.isClosing = false;

    try {
      log('info', 'rabbitmq_connecting', { url: this.maskUrl(this.config.url) });

      this.connection = await amqpConnect(this.config.url, {
        timeout: this.config.connectionTimeout,
        heartbeat: this.config.heartbeat,
      });

      this.channel = await this.connection.createChannel();
      
      // Set prefetch count for fair dispatch
      await this.channel.prefetch(this.config.prefetch);

      // Setup event handlers
      this.setupEventHandlers();

      this.state = 'connected';
      this.reconnectAttempts = 0;
      
      log('info', 'rabbitmq_connected');
      this.emit('connected');

      // Restore consumers if any
      await this.restoreConsumers();

    } catch (error) {
      this.state = 'disconnected';
      log('error', 'rabbitmq_connection_failed', { 
        error: (error as Error).message,
        attempt: this.reconnectAttempts + 1,
      });
      
      this.emit('error', error);
      await this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Create a queue with optional configuration
   */
  async createQueue(name: string, options: QueueOptions = {}): Promise<void> {
    this.ensureConnected();
    
    const assertOptions: Options.AssertQueue = {
      durable: options.durable ?? true,
      autoDelete: options.autoDelete ?? false,
      arguments: options.arguments,
      messageTtl: options.messageTtl,
      maxLength: options.maxLength,
      maxPriority: options.maxPriority,
    };

    await this.channel!.assertQueue(name, assertOptions);
    log('debug', 'rabbitmq_queue_created', { queue: name });
  }

  /**
   * Create a dead letter queue configuration
   * Sets up a main queue with a dead letter exchange
   */
  async createDeadLetterQueue(
    name: string, 
    dlqName: string,
    config?: Partial<DeadLetterConfig>
  ): Promise<void> {
    this.ensureConnected();

    const dlConfig: DeadLetterConfig = {
      exchange: `${name}-dlx`,
      routingKey: `${name}-dlq`,
      maxRetries: 3,
      retryDelay: 5000,
      ...config,
    };

    // Create dead letter exchange
    await this.channel!.assertExchange(dlConfig.exchange, 'direct', { durable: true });

    // Create dead letter queue
    await this.channel!.assertQueue(dlqName, { durable: true });
    await this.channel!.bindQueue(dlqName, dlConfig.exchange, dlConfig.routingKey);

    // Create main queue with dead letter configuration
    await this.channel!.assertQueue(name, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': dlConfig.exchange,
        'x-dead-letter-routing-key': dlConfig.routingKey,
        ...(dlConfig.maxRetries > 0 && { 'x-max-retries': dlConfig.maxRetries }),
        ...(dlConfig.retryDelay > 0 && { 'x-message-ttl': dlConfig.retryDelay }),
      },
    });

    log('info', 'rabbitmq_dlq_created', { 
      queue: name, 
      dlq: dlqName,
      exchange: dlConfig.exchange,
    });
  }

  /**
   * Publish a message to a queue
   * Messages are persistent by default
   */
  async publish(queue: string, message: QueueMessage, options?: PublishOptions): Promise<void> {
    this.ensureConnected();

    // Ensure queue exists (creates if not exists with default options)
    await this.createQueue(queue);

    const content = Buffer.from(JSON.stringify(message));
    
    const publishOptions: Options.Publish = {
      persistent: true,
      messageId: message.id,
      timestamp: message.timestamp,
      type: message.type,
      headers: {
        'x-retry-count': message.retryCount,
        ...(options?.headers || {}),
      },
      ...options,
    };

    const result = this.channel!.sendToQueue(queue, content, publishOptions);

    if (!result) {
      throw new Error(`Failed to publish message to queue ${queue}: channel write buffer full`);
    }

    log('debug', 'rabbitmq_message_published', { 
      queue, 
      messageId: message.id,
      type: message.type,
    });
  }

  /**
   * Consume messages from a queue
   * Handles ack/nack automatically based on handler result
   */
  async consume(
    queue: string, 
    handler: MessageHandler,
    options: ConsumeOptions = {}
  ): Promise<void> {
    this.ensureConnected();

    // Ensure queue exists
    await this.createQueue(queue);

    const consumerOptions: Options.Consume = {
      noAck: options.noAck ?? false,
      consumerTag: options.consumerTag || `consumer-${randomUUID()}`,
      exclusive: options.exclusive ?? false,
    };

    // Set prefetch if specified
    if (options.prefetch !== undefined) {
      await this.channel!.prefetch(options.prefetch);
    }

    const { consumerTag } = await this.channel!.consume(
      queue,
      async (msg: Message | null) => {
        if (!msg) {
          log('warn', 'rabbitmq_consumer_cancelled', { queue });
          return;
        }

        try {
          const message: QueueMessage = JSON.parse(msg.content.toString());
          
          // Add retry count from headers if present
          const retryCount = msg.properties.headers?.['x-retry-count'] || 0;
          message.retryCount = retryCount;

          log('debug', 'rabbitmq_message_received', { 
            queue, 
            messageId: message.id,
            type: message.type,
          });

          await handler(message);

          // Acknowledge successful processing
          if (!options.noAck) {
            this.channel!.ack(msg);
            log('debug', 'rabbitmq_message_acked', { 
              queue, 
              messageId: message.id,
            });
          }
        } catch (error) {
          log('error', 'rabbitmq_message_handler_error', {
            queue,
            error: (error as Error).message,
          });

          if (!options.noAck) {
            // Reject and requeue if retry count is low, otherwise nack to DLQ
            const retryCount = msg.properties.headers?.['x-retry-count'] || 0;
            const shouldRequeue = retryCount < 3;

            this.channel!.nack(msg, false, shouldRequeue);
            log('debug', 'rabbitmq_message_nacked', { 
              queue,
              requeue: shouldRequeue,
              retryCount,
            });
          }
        }
      },
      consumerOptions
    );

    // Store consumer for reconnection recovery
    this.consumers.set(consumerTag, { queue, handler });

    log('info', 'rabbitmq_consumer_started', { 
      queue, 
      consumerTag,
    });
  }

  /**
   * Cancel a consumer
   */
  async cancelConsumer(consumerTag: string): Promise<void> {
    this.ensureConnected();
    await this.channel!.cancel(consumerTag);
    this.consumers.delete(consumerTag);
    log('info', 'rabbitmq_consumer_cancelled', { consumerTag });
  }

  /**
   * Check if the connection is healthy
   */
  async healthCheck(): Promise<boolean> {
    if (this.state !== 'connected' || !this.connection || !this.channel) {
      return false;
    }

    try {
      // Check channel is still open by verifying it has a valid connection reference
      return this.channel.connection !== null && this.channel.connection !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.connection !== null && this.channel !== null;
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    this.isClosing = true;
    
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close channel
    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        log('warn', 'rabbitmq_channel_close_error', { error: (error as Error).message });
      }
      this.channel = null;
    }

    // Close connection
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        log('warn', 'rabbitmq_connection_close_error', { error: (error as Error).message });
      }
      this.connection = null;
    }

    this.state = 'closed';
    this.consumers.clear();
    
    log('info', 'rabbitmq_closed');
    this.emit('closed');
  }

  /**
   * Get the underlying channel (for advanced operations)
   */
  getChannel(): Channel | null {
    return this.channel;
  }

  /**
   * Ensure the client is connected
   */
  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('RabbitMQ client is not connected. Call connect() first.');
    }
  }

  /**
   * Setup connection event handlers
   */
  private setupEventHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (error) => {
      log('error', 'rabbitmq_connection_error', { error: (error as Error).message });
      this.emit('error', error);
    });

    this.connection.on('close', () => {
      if (!this.isClosing) {
        log('warn', 'rabbitmq_connection_closed_unexpectedly');
        this.state = 'disconnected';
        this.emit('disconnected');
        void this.scheduleReconnect();
      }
    });

    if (this.channel) {
      this.channel.on('error', (error) => {
        log('error', 'rabbitmq_channel_error', { error: (error as Error).message });
        this.emit('error', error);
      });

      this.channel.on('close', () => {
        log('warn', 'rabbitmq_channel_closed');
      });

      this.channel.on('return', (msg) => {
        log('warn', 'rabbitmq_message_returned', { 
          messageId: msg.properties.messageId,
        });
      });
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private async scheduleReconnect(): Promise<void> {
    if (this.isClosing || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    
    if (this.config.maxReconnectAttempts > 0 && 
        this.reconnectAttempts > this.config.maxReconnectAttempts) {
      log('error', 'rabbitmq_max_reconnect_attempts_reached', {
        attempts: this.reconnectAttempts,
      });
      this.emit('max_reconnect_attempts_reached');
      return;
    }

    // Exponential backoff with jitter
    const baseDelay = this.config.reconnectInterval;
    const maxDelay = 30000; // Max 30 seconds
    const delay = Math.min(
      baseDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      maxDelay
    );
    const jitter = Math.random() * 1000; // Add up to 1s jitter
    const totalDelay = delay + jitter;

    this.state = 'reconnecting';
    
    log('info', 'rabbitmq_reconnect_scheduled', {
      attempt: this.reconnectAttempts,
      delay: Math.round(totalDelay),
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      
      try {
        await this.connect();
      } catch (error) {
        // Connection failed, will schedule another reconnect
        log('error', 'rabbitmq_reconnect_failed', {
          attempt: this.reconnectAttempts,
          error: (error as Error).message,
        });
      }
    }, totalDelay);
  }

  /**
   * Restore consumers after reconnection
   */
  private async restoreConsumers(): Promise<void> {
    if (this.consumers.size === 0) return;

    log('info', 'rabbitmq_restoring_consumers', { count: this.consumers.size });

    const oldConsumers = new Map(this.consumers);
    this.consumers.clear();

    for (const entry of Array.from(oldConsumers.values())) {
      try {
        await this.consume(entry.queue, entry.handler);
      } catch (error) {
        log('error', 'rabbitmq_consumer_restore_failed', {
          queue: entry.queue,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Mask sensitive information in URL for logging
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return 'invalid-url';
    }
  }
}

// Singleton instance
let rabbitMQClientInstance: RabbitMQClient | null = null;

/**
 * Get the singleton RabbitMQ client instance
 */
export function getRabbitMQClient(config?: Partial<RabbitMQConfig>): RabbitMQClient {
  if (!rabbitMQClientInstance) {
    rabbitMQClientInstance = new RabbitMQClient(config);
  }
  return rabbitMQClientInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetRabbitMQClient(): void {
  rabbitMQClientInstance = null;
}
