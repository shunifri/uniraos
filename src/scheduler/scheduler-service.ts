/**
 * Scheduler Service — 基于 Bull 的时间感知调度器
 *
 * 设计原则：
 * - 所有定时任务（用户级 + 系统级）走同一套队列
 * - Bull 队列作为触发引擎，MySQL 作为持久化备份
 * - Redis 宕机后可通过 MySQL 重建队列
 */

import Bull from "bull";
import { randomUUID } from "crypto";
import { dbConfig } from "../config/db-config.js";
import { log } from "../utils/logger.js";
import type {
  ScheduledEvent,
  CreateScheduledEventInput,
  ScheduledEventQuery,
} from "./scheduler-types.js";

const QUEUE_NAME = "schedule-events";
const REDIS_PREFIX = "bull";

let queueInstance: Bull.Queue | null = null;

function getQueue(): Bull.Queue {
  if (!queueInstance) {
    const redisCfg = dbConfig.redis;
    const node = redisCfg.nodes[0];

    // Bull 需要独立的 Redis 连接（不能复用已有的 RedisClient）
    // 因为 Bull 的 bclient/subscriber 不支持 enableReadyCheck / maxRetriesPerRequest
    queueInstance = new Bull(QUEUE_NAME, {
      prefix: REDIS_PREFIX,
      redis: {
        host: node.host,
        port: node.port,
        password: redisCfg.password || undefined,
        // Bull 自己会管理连接，不需要这些选项
      },
    });

    queueInstance.on("completed", (job: Bull.Job, result: any) => {
      log("info", "schedule_job_completed", { jobId: job.id, result });
    });

    queueInstance.on("failed", (job: Bull.Job | undefined, err: Error) => {
      log("error", "schedule_job_failed", { jobId: job?.id, error: err.message });
    });

    log("info", "scheduler_queue_initialized", { queue: QUEUE_NAME, prefix: REDIS_PREFIX, redis: `${node.host}:${node.port}` });
  }
  return queueInstance;
}

export class SchedulerService {
  private queue = getQueue();

  /**
   * 创建定时任务
   */
  async createEvent(input: CreateScheduledEventInput): Promise<ScheduledEvent> {
    const id = `sched_${randomUUID().slice(0, 12)}`;
    const now = Date.now();

    const event: ScheduledEvent = {
      id,
      userId: input.userId,
      type: input.type,
      triggerConfig: input.triggerConfig,
      actionConfig: input.actionConfig,
      escalationConfig: input.escalationConfig,
      source: input.source,
      sourceId: input.sourceId,
      status: "pending",
      retryCount: 0,
      createdAt: now,
    };

    // 计算 Bull Job 的延迟时间
    const delay = this.computeDelay(input.triggerConfig);

    if (delay !== null && delay >= 0) {
      // 先加入 Bull 队列，成功后再持久化到 MySQL
      // 这样可以避免数据库有记录但队列中没有 job 的情况
      try {
        await this.queue.add(
          { eventId: id },
          {
            delay,
            jobId: id,
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          }
        );
        log("info", "schedule_event_queued", { eventId: id, delayMs: delay, mode: input.triggerConfig.mode });
      } catch (queueErr: any) {
        log("error", "schedule_event_queue_failed", { eventId: id, error: queueErr.message });
        throw new Error(`Bull 队列添加失败: ${queueErr.message}`);
      }
    } else if (input.triggerConfig.mode === "conditional") {
      // 条件触发任务：不加入 Bull 队列
      log("info", "schedule_event_conditional", { eventId: id, condition: input.triggerConfig.condition });
    } else {
      log("warn", "schedule_event_invalid_trigger", { eventId: id, trigger: input.triggerConfig });
    }

    // 持久化到 MySQL（队列添加成功后）
    await this.saveToDB(event);

    return event;
  }

  /**
   * 取消定时任务（物理删除：从队列和数据库中移除）
   */
  async cancelEvent(eventId: string): Promise<boolean> {
    await this.deleteEvent(eventId);
    log("info", "schedule_event_cancelled", { eventId });
    return true;
  }

  /**
   * 物理删除定时任务
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    // 从 Bull 队列移除
    const job = await this.queue.getJob(eventId);
    if (job) {
      await job.remove();
    }

    // 从 MySQL 删除
    const { getMySQLAdapter } = await import("../db/mysql-adapter.js");
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      "DELETE FROM scheduled_events WHERE id = ?",
      [eventId]
    );

    return true;
  }

  /**
   * 立即触发（测试用或手动触发）
   */
  async triggerNow(eventId: string): Promise<void> {
    const event = await this.getEvent(eventId);
    if (!event) throw new Error(`Event not found: ${eventId}`);

    // 创建即时执行的 Bull job
    await this.queue.add({ eventId }, { delay: 0, jobId: `${eventId}_manual_${Date.now()}` });
    log("info", "schedule_event_manual_trigger", { eventId });
  }

  /**
   * 查询单个任务
   */
  async getEvent(eventId: string): Promise<ScheduledEvent | null> {
    const { getMySQLAdapter } = await import("../db/mysql-adapter.js");
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query<ScheduledEvent>(
      "SELECT * FROM scheduled_events WHERE id = ?",
      [eventId]
    );
    if (rows.length === 0) return null;
    return this.parseRow(rows[0]);
  }

  /**
   * 列表查询
   */
  async listEvents(query: ScheduledEventQuery): Promise<{ items: ScheduledEvent[]; total: number }> {
    const { getMySQLAdapter } = await import("../db/mysql-adapter.js");
    const adapter = await getMySQLAdapter();

    const conditions: string[] = [];
    const params: any[] = [];

    if (query.userId) {
      conditions.push("user_id = ?");
      params.push(query.userId);
    }
    if (query.type) {
      conditions.push("type = ?");
      params.push(query.type);
    }
    if (query.status) {
      conditions.push("status = ?");
      params.push(query.status);
    }
    if (query.source) {
      conditions.push("source = ?");
      params.push(query.source);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const [countRows, dataRows] = await Promise.all([
      adapter.query<{ total: number }>(`SELECT COUNT(*) as total FROM scheduled_events ${where}`, params),
      adapter.query<ScheduledEvent>(
        `SELECT * FROM scheduled_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      ),
    ]);

    return {
      items: dataRows.map((r) => this.parseRow(r)),
      total: countRows[0]?.total || 0,
    };
  }

  /**
   * 更新任务状态
   */
  async updateStatus(eventId: string, status: string, triggeredAt?: number): Promise<void> {
    const { getMySQLAdapter } = await import("../db/mysql-adapter.js");
    const adapter = await getMySQLAdapter();

    if (triggeredAt) {
      await adapter.execute(
        "UPDATE scheduled_events SET status = ?, triggered_at = ? WHERE id = ?",
        [status, triggeredAt, eventId]
      );
    } else {
      await adapter.execute(
        "UPDATE scheduled_events SET status = ? WHERE id = ?",
        [status, eventId]
      );
    }
  }

  /**
   * 处理升级策略
   */
  async handleEscalation(event: ScheduledEvent): Promise<void> {
    if (!event.escalationConfig) return;
    const { afterMs, channel, repeat = 0, intervalMs = 60000 } = event.escalationConfig;

    // 创建升级提醒任务
    const escalationEvent = await this.createEvent({
      userId: event.userId,
      type: "reminder",
      triggerConfig: { mode: "relative", delayMs: afterMs },
      actionConfig: {
        type: channel as any,
        payload: { title: "升级提醒", originalEventId: event.id },
      },
      source: "system",
      sourceId: event.id,
    });

    log("info", "schedule_escalation_created", { originalEventId: event.id, escalationId: escalationEvent.id, channel });
  }

  // ─── 私有方法 ───

  private async saveToDB(event: ScheduledEvent): Promise<void> {
    const { getMySQLAdapter } = await import("../db/mysql-adapter.js");
    const adapter = await getMySQLAdapter();

    await adapter.execute(
      `INSERT INTO scheduled_events
        (id, user_id, type, trigger_config, action_config, escalation_config, source, source_id, status, retry_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.userId,
        event.type,
        JSON.stringify(event.triggerConfig),
        JSON.stringify(event.actionConfig),
        event.escalationConfig ? JSON.stringify(event.escalationConfig) : null,
        event.source,
        event.sourceId || null,
        event.status,
        event.retryCount,
        event.createdAt,
      ]
    );
  }

  private parseRow(row: any): ScheduledEvent {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      triggerConfig: typeof row.trigger_config === "string" ? JSON.parse(row.trigger_config) : row.trigger_config,
      actionConfig: typeof row.action_config === "string" ? JSON.parse(row.action_config) : row.action_config,
      escalationConfig: row.escalation_config
        ? (typeof row.escalation_config === "string" ? JSON.parse(row.escalation_config) : row.escalation_config)
        : undefined,
      source: row.source,
      sourceId: row.source_id || undefined,
      status: row.status,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      triggeredAt: row.triggered_at || undefined,
      completedAt: row.completed_at || undefined,
    };
  }

  private computeDelay(trigger: { mode: string; at?: number; delayMs?: number }): number | null {
    switch (trigger.mode) {
      case "absolute":
        if (!trigger.at) return null;
        return Math.max(0, trigger.at - Date.now());
      case "relative":
      case "delayed":
        if (!trigger.delayMs && trigger.delayMs !== 0) return null;
        return Math.max(0, trigger.delayMs);
      case "cron":
        // cron 需要 cron-parser 计算下次执行时间
        // 简化：先返回 null，后续扩展
        return null;
      case "conditional":
        return null;
      default:
        return null;
    }
  }
}

// 单例
let schedulerServiceInstance: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerServiceInstance) {
    schedulerServiceInstance = new SchedulerService();
  }
  return schedulerServiceInstance;
}
