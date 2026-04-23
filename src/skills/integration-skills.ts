/**
 * 数据集成 Skill 家族
 *
 * Phase 2-3 Skill：
 * - kafka_consume / kafka_produce
 * - mqtt_publish / mqtt_subscribe
 * - ftp_download / sftp_upload
 * - soap_call
 * - odbc_query
 *
 * 所有外部依赖均为可选，未安装时自动跳过注册。
 */

import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { getWorkflowRepository } from "../workflow/repository.js";

async function getConnection(name: string) {
  return await getWorkflowRepository().getConnectionByName(name);
}

// ===== Kafka Skills =====

async function createKafkaSkills(registry: SkillRegistry): Promise<void> {
  try {
    const { Kafka } = await import("kafkajs") as any;

    // kafka_produce
    registry.register(
      defineSystemSkill({
        name: "kafka_produce",
        description: `向 Kafka 主题发送消息。参数: connection(string), topic(string), message(string|object), key?(string)`,
        paramSchema: {
          properties: {
            connection: { type: "string", description: "Kafka 连接配置名称" },
            topic: { type: "string", description: "主题名称" },
            message: { type: "string", description: "消息内容（字符串或 JSON）" },
            key: { type: "string", description: "消息键（用于分区）" },
          },
          required: ["connection", "topic", "message"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`Kafka 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { brokers: string[]; clientId?: string; sasl?: unknown; ssl?: boolean };

          const kafka = new Kafka({
            clientId: cfg.clientId ?? "raos-producer",
            brokers: cfg.brokers,
            ssl: cfg.ssl,
            sasl: cfg.sasl,
          });

          const producer = kafka.producer();
          await producer.connect();

          const value = typeof params.message === "object" ? JSON.stringify(params.message) : String(params.message);
          await producer.send({
            topic: params.topic as string,
            messages: [{ key: params.key as string | undefined, value }],
          });

          await producer.disconnect();
          return { success: true, data: { topic: params.topic, sent: true } };
        },
      }),
    );

    // kafka_consume
    registry.register(
      defineSystemSkill({
        name: "kafka_consume",
        description: `消费 Kafka 主题消息。参数: connection(string), topic(string), limit?(number, 默认 10), timeout?(number, 毫秒, 默认 5000)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            topic: { type: "string" },
            limit: { type: "number" },
            timeout: { type: "number" },
          },
          required: ["connection", "topic"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`Kafka 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { brokers: string[]; clientId?: string; sasl?: unknown; ssl?: boolean; groupId?: string };
          const limit = (params.limit as number) ?? 10;
          const timeout = (params.timeout as number) ?? 5000;

          const kafka = new Kafka({
            clientId: cfg.clientId ?? "raos-consumer",
            brokers: cfg.brokers,
            ssl: cfg.ssl,
            sasl: cfg.sasl,
          });

          const consumer = kafka.consumer({ groupId: cfg.groupId ?? "raos-group" });
          await consumer.connect();
          await consumer.subscribe({ topic: params.topic as string, fromBeginning: false });

          const messages: Array<{ key?: string; value: string; offset: string; timestamp: number }> = [];

          await consumer.run({
            eachMessage: async ({ message }: { message: { key?: Buffer | null; value: Buffer | null; offset: string; timestamp: number } }) => {
              messages.push({
                key: message.key?.toString(),
                value: message.value?.toString() ?? "",
                offset: message.offset,
                timestamp: message.timestamp,
              });
              if (messages.length >= limit) {
                consumer.pause([{ topic: params.topic as string }]);
              }
            },
          });

          // 等待超时或达到限制
          await new Promise((resolve) => setTimeout(resolve, timeout));
          await consumer.disconnect();

          return { success: true, data: { topic: params.topic, count: messages.length, messages } };
        },
      }),
    );

    console.log("   Kafka skills registered (kafka_consume/kafka_produce)");
  } catch {
    console.log("   [skills] kafkajs not installed, Kafka skills skipped");
  }
}

// ===== MQTT Skills =====

async function createMQTTSkills(registry: SkillRegistry): Promise<void> {
  try {
    const mqtt = await import("mqtt") as any;

    // mqtt_publish
    registry.register(
      defineSystemSkill({
        name: "mqtt_publish",
        description: `发布 MQTT 消息。参数: connection(string), topic(string), message(string|object), qos?(0/1/2)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            topic: { type: "string" },
            message: { type: "string" },
            qos: { type: "string", enum: ["0", "1", "2"], description: "QoS 等级 (0/1/2)" },
          },
          required: ["connection", "topic", "message"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`MQTT 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port?: number; username?: string; password?: string };
          const url = `mqtt://${cfg.host}:${cfg.port ?? 1883}`;

          const client = mqtt.connect(url, {
            username: cfg.username,
            password: cfg.password,
          });

          await new Promise<void>((resolve, reject) => {
            client.on("connect", resolve);
            client.on("error", reject);
          });

          const message = typeof params.message === "object" ? JSON.stringify(params.message) : String(params.message);
          client.publish(params.topic as string, message, { qos: (params.qos as number) ?? 0 });
          client.end();

          return { success: true, data: { topic: params.topic, published: true } };
        },
      }),
    );

    // mqtt_subscribe
    registry.register(
      defineSystemSkill({
        name: "mqtt_subscribe",
        description: `订阅 MQTT 主题并接收消息。参数: connection(string), topic(string), limit?(number, 默认 10), timeout?(number, 毫秒, 默认 5000)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            topic: { type: "string" },
            limit: { type: "number" },
            timeout: { type: "number" },
          },
          required: ["connection", "topic"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`MQTT 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port?: number; username?: string; password?: string };
          const url = `mqtt://${cfg.host}:${cfg.port ?? 1883}`;
          const limit = (params.limit as number) ?? 10;
          const timeout = (params.timeout as number) ?? 5000;

          const client = mqtt.connect(url, {
            username: cfg.username,
            password: cfg.password,
          });

          await new Promise<void>((resolve, reject) => {
            client.on("connect", resolve);
            client.on("error", reject);
          });

          const messages: Array<{ topic: string; message: string }> = [];
          client.subscribe(params.topic as string);
          client.on("message", (topic: string, message: Buffer) => {
            messages.push({ topic, message: message.toString() });
            if (messages.length >= limit) {
              client.end();
            }
          });

          await new Promise((resolve) => setTimeout(resolve, timeout));
          client.end();

          return { success: true, data: { count: messages.length, messages } };
        },
      }),
    );

    console.log("   MQTT skills registered (mqtt_publish/mqtt_subscribe)");
  } catch {
    console.log("   [skills] mqtt not installed, MQTT skills skipped");
  }
}

// ===== 统一入口 =====

export async function createIntegrationSkills(registry: SkillRegistry): Promise<void> {
  await createKafkaSkills(registry);
  await createMQTTSkills(registry);
}
