/**
 * Queue Types
 * Type definitions for message queue system
 */

/**
 * Queue message interface
 * Represents a message in the queue system
 */
export interface QueueMessage<T = any> {
  /** Unique message identifier */
  id: string;
  /** Message type/category */
  type: string;
  /** Message payload */
  payload: T;
  /** Unix timestamp when message was created */
  timestamp: number;
  /** Number of retry attempts */
  retryCount: number;
}

/**
 * Queue options for creating queues
 */
export interface QueueOptions {
  /** Whether the queue survives broker restart */
  durable?: boolean;
  /** Whether the queue is deleted when last consumer unsubscribes */
  autoDelete?: boolean;
  /** Queue arguments (e.g., for dead letter exchange) */
  arguments?: Record<string, any>;
  /** Message TTL in milliseconds */
  messageTtl?: number;
  /** Maximum number of messages in queue */
  maxLength?: number;
  /** Maximum priority for messages (0-255) */
  maxPriority?: number;
}

/**
 * Consume options for message consumption
 */
export interface ConsumeOptions {
  /** Whether to auto-acknowledge messages */
  noAck?: boolean;
  /** Consumer tag identifier */
  consumerTag?: string;
  /** Whether message is exclusive to this consumer */
  exclusive?: boolean;
  /** Prefetch count for this consumer */
  prefetch?: number;
}

/**
 * Publish options for message publishing
 */
export interface PublishOptions {
  /** Message persistence (1 = persistent, 0 = transient) */
  deliveryMode?: number;
  /** Message priority (0-9) */
  priority?: number;
  /** Expiration time in milliseconds */
  expiration?: string;
  /** Correlation ID for request-reply pattern */
  correlationId?: string;
  /** Reply-to queue for request-reply pattern */
  replyTo?: string;
  /** Message ID */
  messageId?: string;
  /** Timestamp */
  timestamp?: number;
  /** Type of message */
  type?: string;
  /** User ID */
  userId?: string;
  /** Application ID */
  appId?: string;
  /** Headers */
  headers?: Record<string, any>;
}

/**
 * RabbitMQ connection configuration
 */
export interface RabbitMQConfig {
  /** RabbitMQ connection URL */
  url: string;
  /** Prefetch count for consumers */
  prefetch: number;
  /** Reconnect interval in milliseconds */
  reconnectInterval: number;
  /** Maximum number of reconnection attempts (0 = infinite) */
  maxReconnectAttempts: number;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Heartbeat interval in seconds */
  heartbeat: number;
}

/**
 * Default RabbitMQ configuration
 */
export const defaultRabbitMQConfig: RabbitMQConfig = {
  url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  prefetch: 10,
  reconnectInterval: 5000,
  maxReconnectAttempts: 0,
  connectionTimeout: 30000,
  heartbeat: 60,
};

/**
 * Dead letter queue configuration
 */
export interface DeadLetterConfig {
  /** Dead letter exchange name */
  exchange: string;
  /** Dead letter routing key */
  routingKey: string;
  /** Maximum retry attempts before sending to DLQ */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelay: number;
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

/**
 * Message handler type
 */
export type MessageHandler<T = any> = (message: QueueMessage<T>) => Promise<void>;
