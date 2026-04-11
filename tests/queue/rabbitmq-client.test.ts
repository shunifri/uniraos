/**
 * RabbitMQ Client Tests
 * 
 * Uses mocked amqplib for unit testing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from 'amqplib';

// Create mock functions that can be accessed from tests
const mockFns = {
  ack: vi.fn(),
  nack: vi.fn(),
  cancel: vi.fn(),
  close: vi.fn(),
  assertQueue: vi.fn(),
  assertExchange: vi.fn(),
  bindQueue: vi.fn(),
  prefetch: vi.fn(),
  sendToQueue: vi.fn(),
  consume: vi.fn(),
  channelOn: vi.fn(),
  createChannel: vi.fn(),
  connectionClose: vi.fn(),
  connectionOn: vi.fn(),
  connect: vi.fn(),
};

// Mock amqplib with factory function
vi.mock('amqplib', () => ({
  connect: (...args: any[]) => mockFns.connect(...args),
  default: { connect: (...args: any[]) => mockFns.connect(...args) },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  log: vi.fn(),
}));

// Import after mocks
import {
  RabbitMQClient,
  getRabbitMQClient,
  resetRabbitMQClient,
} from '../../src/queue/rabbitmq-client.js';
import { QueueMessage } from '../../src/queue/types.js';

// Helper to reset mocks before each test
function resetMocks() {
  mockFns.ack.mockReset();
  mockFns.nack.mockReset();
  mockFns.cancel.mockReset().mockResolvedValue(undefined);
  mockFns.close.mockReset().mockResolvedValue(undefined);
  mockFns.assertQueue.mockReset().mockResolvedValue({ queue: 'test-queue', messageCount: 0, consumerCount: 0 });
  mockFns.assertExchange.mockReset().mockResolvedValue(undefined);
  mockFns.bindQueue.mockReset().mockResolvedValue(undefined);
  mockFns.prefetch.mockReset().mockResolvedValue(undefined);
  mockFns.sendToQueue.mockReset().mockReturnValue(true);
  mockFns.consume.mockReset().mockResolvedValue({ consumerTag: 'test-consumer-tag' });
  mockFns.channelOn.mockReset();
  mockFns.connectionClose.mockReset().mockResolvedValue(undefined);
  mockFns.connectionOn.mockReset();
  mockFns.createChannel.mockReset().mockResolvedValue({
    assertQueue: mockFns.assertQueue,
    assertExchange: mockFns.assertExchange,
    bindQueue: mockFns.bindQueue,
    prefetch: mockFns.prefetch,
    sendToQueue: mockFns.sendToQueue,
    consume: mockFns.consume,
    cancel: mockFns.cancel,
    ack: mockFns.ack,
    nack: mockFns.nack,
    close: mockFns.close,
    on: mockFns.channelOn,
    connection: {},
  });
  mockFns.connect.mockReset().mockResolvedValue({
    createChannel: mockFns.createChannel,
    close: mockFns.connectionClose,
    on: mockFns.connectionOn,
  });
}

describe('RabbitMQClient', () => {
  let client: RabbitMQClient;

  beforeEach(() => {
    resetRabbitMQClient();
    resetMocks();
    
    client = new RabbitMQClient({
      url: 'amqp://localhost:5672',
      prefetch: 10,
      reconnectInterval: 100,
      maxReconnectAttempts: 3,
      connectionTimeout: 5000,
      heartbeat: 60,
    });
  });

  afterEach(async () => {
    if (client.getState() !== 'closed') {
      await client.close();
    }
    resetRabbitMQClient();
  });

  describe('Connection', () => {
    it('should connect successfully', async () => {
      await client.connect();
      
      expect(client.isConnected()).toBe(true);
      expect(client.getState()).toBe('connected');
    });

    it('should not reconnect if already connected', async () => {
      await client.connect();
      
      mockFns.connect.mockClear();
      await client.connect();
      
      // Should not call connect again
      expect(mockFns.connect).not.toHaveBeenCalled();
    });

    it('should throw error when operations called before connect', () => {
      expect(() => {
        // @ts-expect-error - accessing private method for testing
        client.ensureConnected();
      }).toThrow('RabbitMQ client is not connected');
    });

    it('should emit connected event', async () => {
      const connectedHandler = vi.fn();
      client.on('connected', connectedHandler);
      
      await client.connect();
      
      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should close connection properly', async () => {
      await client.connect();
      await client.close();
      
      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toBe('closed');
    });

    it('should emit closed event on close', async () => {
      await client.connect();
      
      const closedHandler = vi.fn();
      client.on('closed', closedHandler);
      
      await client.close();
      
      expect(closedHandler).toHaveBeenCalled();
    });
  });

  describe('Queue Operations', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should create a queue with default options', async () => {
      await client.createQueue('test-queue');
      
      expect(mockFns.assertQueue).toHaveBeenCalledWith('test-queue', {
        durable: true,
        autoDelete: false,
        arguments: undefined,
        messageTtl: undefined,
        maxLength: undefined,
        overflow: undefined,
      });
    });

    it('should create a queue with custom options', async () => {
      await client.createQueue('test-queue', {
        durable: false,
        autoDelete: true,
        messageTtl: 5000,
        maxLength: 1000,
        overflow: 'drop-head',
        arguments: { 'x-custom-arg': 'value' },
      });
      
      expect(mockFns.assertQueue).toHaveBeenCalledWith('test-queue', {
        durable: false,
        autoDelete: true,
        messageTtl: 5000,
        maxLength: 1000,
        overflow: 'drop-head',
        arguments: { 'x-custom-arg': 'value' },
      });
    });

    it('should create a dead letter queue', async () => {
      await client.createDeadLetterQueue('main-queue', 'main-queue-dlq');
      
      // Should create exchange
      expect(mockFns.assertExchange).toHaveBeenCalledWith(
        'main-queue-dlx',
        'direct',
        { durable: true }
      );
      
      // Should create DLQ
      expect(mockFns.assertQueue).toHaveBeenCalledWith('main-queue-dlq', { durable: true });
      
      // Should bind DLQ
      expect(mockFns.bindQueue).toHaveBeenCalledWith(
        'main-queue-dlq',
        'main-queue-dlx',
        'main-queue-dlq'
      );
    });

    it('should create dead letter queue with custom config', async () => {
      await client.createDeadLetterQueue('main-queue', 'main-queue-dlq', {
        exchange: 'custom-dlx',
        routingKey: 'custom-dlq',
        maxRetries: 5,
        retryDelay: 10000,
      });
      
      expect(mockFns.assertExchange).toHaveBeenCalledWith(
        'custom-dlx',
        'direct',
        { durable: true }
      );
      
      expect(mockFns.bindQueue).toHaveBeenCalledWith(
        'main-queue-dlq',
        'custom-dlx',
        'custom-dlq'
      );
    });
  });

  describe('Publish', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should publish a message', async () => {
      const message: QueueMessage = {
        id: 'msg-123',
        type: 'test',
        payload: { data: 'test-data' },
        timestamp: Date.now(),
        retryCount: 0,
      };

      await client.publish('test-queue', message);
      
      // Should create queue first
      expect(mockFns.assertQueue).toHaveBeenCalledWith('test-queue', expect.any(Object));
      
      // Should send message
      expect(mockFns.sendToQueue).toHaveBeenCalled();
      const [queue, content, options] = mockFns.sendToQueue.mock.calls[0];
      
      expect(queue).toBe('test-queue');
      expect(JSON.parse(content.toString())).toEqual(message);
      expect(options.persistent).toBe(true);
      expect(options.messageId).toBe('msg-123');
    });

    it('should publish with custom options', async () => {
      const message: QueueMessage = {
        id: 'msg-456',
        type: 'test',
        payload: { data: 'test-data' },
        timestamp: 1234567890,
        retryCount: 2,
      };

      await client.publish('test-queue', message, {
        priority: 5,
        expiration: '10000',
        headers: { 'x-custom': 'value', 'x-retry-count': 2 },
      });
      
      const [, , options] = mockFns.sendToQueue.mock.calls[0];
      
      expect(options.priority).toBe(5);
      expect(options.expiration).toBe('10000');
      expect(options.headers['x-custom']).toBe('value');
      expect(options.headers['x-retry-count']).toBe(2);
    });

    it('should throw error when publish fails', async () => {
      mockFns.sendToQueue.mockReturnValueOnce(false);
      
      const message: QueueMessage = {
        id: 'msg-789',
        type: 'test',
        payload: {},
        timestamp: Date.now(),
        retryCount: 0,
      };

      await expect(client.publish('test-queue', message)).rejects.toThrow(
        'Failed to publish message to queue test-queue'
      );
    });
  });

  describe('Consume', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should start consuming messages', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      await client.consume('test-queue', handler);
      
      expect(mockFns.consume).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        expect.objectContaining({
          noAck: false,
          exclusive: false,
        })
      );
    });

    it('should start consuming with custom options', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      await client.consume('test-queue', handler, {
        noAck: true,
        exclusive: true,
        consumerTag: 'my-consumer',
        prefetch: 5,
      });
      
      expect(mockFns.prefetch).toHaveBeenCalledWith(5);
      expect(mockFns.consume).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        expect.objectContaining({
          noAck: true,
          exclusive: true,
          consumerTag: 'my-consumer',
        })
      );
    });

    it('should handle messages successfully', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      await client.consume('test-queue', handler);
      
      // Get the message handler callback
      const messageHandler = mockFns.consume.mock.calls[0][1];
      
      const message: QueueMessage = {
        id: 'msg-123',
        type: 'test',
        payload: { test: 'data' },
        timestamp: Date.now(),
        retryCount: 0,
      };
      
      const mockMsg = {
        content: Buffer.from(JSON.stringify(message)),
        properties: {
          messageId: 'msg-123',
          headers: { 'x-retry-count': 0 },
        },
      } as unknown as Message;
      
      await messageHandler(mockMsg);
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'msg-123',
        type: 'test',
      }));
      expect(mockFns.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should nack message on handler error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Processing failed'));
      
      await client.consume('test-queue', handler);
      
      const messageHandler = mockFns.consume.mock.calls[0][1];
      
      const message: QueueMessage = {
        id: 'msg-123',
        type: 'test',
        payload: {},
        timestamp: Date.now(),
        retryCount: 0,
      };
      
      const mockMsg = {
        content: Buffer.from(JSON.stringify(message)),
        properties: {
          messageId: 'msg-123',
          headers: { 'x-retry-count': 0 },
        },
      } as unknown as Message;
      
      await messageHandler(mockMsg);
      
      // Should nack with requeue=true since retry count is low
      expect(mockFns.nack).toHaveBeenCalledWith(mockMsg, false, true);
    });

    it('should not requeue after max retries', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Processing failed'));
      
      await client.consume('test-queue', handler);
      
      const messageHandler = mockFns.consume.mock.calls[0][1];
      
      const message: QueueMessage = {
        id: 'msg-123',
        type: 'test',
        payload: {},
        timestamp: Date.now(),
        retryCount: 3,
      };
      
      const mockMsg = {
        content: Buffer.from(JSON.stringify(message)),
        properties: {
          messageId: 'msg-123',
          headers: { 'x-retry-count': 3 },
        },
      } as unknown as Message;
      
      await messageHandler(mockMsg);
      
      // Should nack with requeue=false since retry count is >= 3
      expect(mockFns.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });

    it('should handle null message (consumer cancelled)', async () => {
      const handler = vi.fn();
      
      await client.consume('test-queue', handler);
      
      const messageHandler = mockFns.consume.mock.calls[0][1];
      
      await messageHandler(null);
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should cancel consumer', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      await client.consume('test-queue', handler);
      
      const consumerTag = 'test-consumer-tag';
      
      await client.cancelConsumer(consumerTag);
      
      expect(mockFns.cancel).toHaveBeenCalledWith(consumerTag);
    });
  });

  describe('Health Check', () => {
    it('should return false when not connected', async () => {
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(false);
    });

    it('should return true when connected', async () => {
      await client.connect();
      
      // Get the actual channel that was created and ensure it references the connection
      const channel = client.getChannel();
      const connection = (client as any).connection;
      if (channel && connection) {
        // @ts-expect-error - modifying for test
        channel.connection = connection;
      }
      
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it('should return false when channel is closed', async () => {
      await client.connect();
      
      // Simulate channel being closed by setting connection to null
      const channel = client.getChannel();
      if (channel) {
        // @ts-expect-error - modifying private property for testing
        channel.connection = null;
      }
      
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const client1 = getRabbitMQClient();
      const client2 = getRabbitMQClient();
      
      expect(client1).toBe(client2);
    });

    it('should create new instance after reset', () => {
      const client1 = getRabbitMQClient();
      resetRabbitMQClient();
      const client2 = getRabbitMQClient();
      
      expect(client1).not.toBe(client2);
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors', async () => {
      mockFns.connect.mockRejectedValueOnce(new Error('Connection refused'));
      
      const errorHandler = vi.fn();
      client.on('error', errorHandler);
      
      await expect(client.connect()).rejects.toThrow('Connection refused');
      
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle channel errors', async () => {
      await client.connect();
      
      const errorHandler = vi.fn();
      client.on('error', errorHandler);
      
      // Simulate channel error by calling the error handler
      const channelErrorHandler = mockFns.channelOn.mock.calls.find(
        (call: [string, (...args: any[]) => void]) => call[0] === 'error'
      )?.[1];
      
      if (channelErrorHandler) {
        channelErrorHandler(new Error('Channel error'));
        expect(errorHandler).toHaveBeenCalled();
      }
    });
  });

  describe('State Management', () => {
    it('should track connection state', async () => {
      expect(client.getState()).toBe('disconnected');
      
      await client.connect();
      expect(client.getState()).toBe('connected');
      
      await client.close();
      expect(client.getState()).toBe('closed');
    });

    it('should check connected status', async () => {
      expect(client.isConnected()).toBe(false);
      
      await client.connect();
      expect(client.isConnected()).toBe(true);
      
      await client.close();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Reconnection', () => {
    it('should handle unexpected connection close', async () => {
      await client.connect();
      
      const disconnectedHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);
      
      // Get the close handler
      const closeHandler = mockFns.connectionOn.mock.calls.find(
        (call: [string, (...args: any[]) => void]) => call[0] === 'close'
      )?.[1];
      
      if (closeHandler) {
        // Simulate unexpected close
        closeHandler();
        
        expect(disconnectedHandler).toHaveBeenCalled();
        expect(client.getState()).toBe('reconnecting');
      }
    });
  });
});
