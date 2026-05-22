/**
 * Scheduler Skills — 定时任务管理
 *
 * 提供 AI Agent 创建、取消、查询定时任务的能力
 */

import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { getSchedulerService } from "../scheduler/scheduler-service.js";

export function createSchedulerSkills(registry: SkillRegistry): void {
  const scheduler = getSchedulerService();

  // ===== schedule_create: 创建定时任务 =====
  registry.register(
    defineSystemSkill({
      name: "schedule_create",
      description: `创建一个定时任务（提醒、通知、自动执行等）。
支持三种触发模式：
  1. delayed: 延迟触发（如 "10分钟后提醒我"）
  2. cron: 周期性触发（如 "每天早上9点"）
  3. conditional: 条件触发（当某条件满足时）

参数:
  type(string): 任务类型 — reminder(提醒) | deadline(截止) | recurring(周期) | conditional(条件)
  title(string): 任务标题
  description?(string): 任务描述
  trigger(object): 触发配置
    - mode(string): delayed | cron | conditional
    - delayMs?(number): 延迟毫秒数（mode=delayed 时必填）
    - cron?(string): cron 表达式（mode=cron 时必填）
    - condition?(string): 条件描述（mode=conditional 时必填）
    - timezone?(string): 时区，默认 "Asia/Shanghai"
  action(object): 执行动作
    - type(string): inbox(投递到收件箱) | chat(发送到聊天) | email(发送邮件) | webhook(调用 webhook) | skill(执行 skill)
    - payload(object): 动作参数
      - message?(string): 提醒消息内容
      - skillName?(string): 要执行的 skill 名称（type=skill 时必填）
      - skillParams?(object): skill 参数
      - recipient?(string): 接收者（type=email 时）
  escalation?(object): 升级策略（可选）
    - delayMs(number): 升级延迟
    - action(object): 升级后的动作

使用示例:
  - "10分钟后提醒我给张三发邮件" -> type="reminder", trigger={mode:"delayed",delayMs:600000}
  - "每天早上9点提醒我写日报" -> type="recurring", trigger={mode:"cron",cron:"0 9 * * *"}
  - "当服务器CPU超过90%时告警" -> type="conditional", trigger={mode:"conditional",condition:"cpu > 90"}`,
      paramSchema: {
        properties: {
          type: { type: "string", enum: ["reminder", "deadline", "recurring", "conditional"] },
          title: { type: "string" },
          description: { type: "string" },
          trigger: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["delayed", "cron", "conditional"] },
              delayMs: { type: "number" },
              cron: { type: "string" },
              condition: { type: "string" },
              timezone: { type: "string" },
            },
          },
          action: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["inbox", "chat", "email", "webhook", "skill"] },
              payload: { type: "object" },
            },
          },
          escalation: {
            type: "object",
            properties: {
              delayMs: { type: "number" },
              action: { type: "object" },
            },
          },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          const trigger = params.trigger as any;

          // 自动计算 delayMs：如果用户说"1分钟后"但没有提供 delayMs，尝试从描述中解析
          if (trigger.mode === "delayed" && !trigger.delayMs && trigger.delayMs !== 0) {
            const text = `${params.title || ""} ${params.description || ""}`;
            const parsed = parseNaturalLanguageDelay(text);
            if (parsed !== null) {
              trigger.delayMs = parsed;
            } else {
              return { success: false, error: new Error("未能识别延迟时间，请明确指定 delayMs（毫秒）或提供如'1分钟后'的描述") };
            }
          }

          // 自动设置 payload.type：提醒类任务默认用 "task" 类型，使其显示在 reminders tab
          const action = params.action as any;
          if (action?.payload && !action.payload.type) {
            if (params.type === "reminder" || params.type === "deadline") {
              action.payload.type = "task";
            } else {
              action.payload.type = "notification";
            }
          }
          if (action?.payload && !action.payload.category) {
            action.payload.category = "user_reminder";
          }

          const event = await scheduler.createEvent({
            userId,
            type: params.type as any,
            triggerConfig: trigger,
            actionConfig: action,
            escalationConfig: params.escalation as any,
            source: "agent",
            sourceId: context.traceId,
          });
          return {
            success: true,
            data: {
              eventId: event.id,
              type: event.type,
              status: event.status,
              triggerConfig: event.triggerConfig,
              createdAt: event.createdAt,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[schedule_create] error:`, msg);
          return { success: false, error: new Error(`创建定时任务失败: ${msg}`) };
        }
      },
    })
  );

  // ===== schedule_cancel: 取消定时任务 =====
  registry.register(
    defineSystemSkill({
      name: "schedule_cancel",
      description: `取消一个定时任务。
参数:
  eventId(string): 要取消的任务 ID

使用示例:
  - "取消我刚才创建的提醒" -> 需要用户提供 eventId`,
      paramSchema: {
        properties: {
          eventId: { type: "string", description: "任务 ID" },
        },
      },
      handler: async (params) => {
        try {
          const eventId = params.eventId as string;
          const success = await scheduler.cancelEvent(eventId);
          if (!success) {
            return { success: false, error: new Error(`任务 ${eventId} 不存在或已取消`) };
          }
          return { success: true, data: { eventId, cancelled: true } };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`取消任务失败: ${msg}`) };
        }
      },
    })
  );

  // ===== schedule_list: 查询定时任务列表 =====
  registry.register(
    defineSystemSkill({
      name: "schedule_list",
      description: `查询当前用户的定时任务列表。
参数:
  status?(string): 状态筛选 — pending | triggered | completed | cancelled | failed
  type?(string): 类型筛选 — reminder | deadline | recurring | conditional
  limit?(number): 返回数量，默认 20

使用示例:
  - "查看我的所有提醒" -> type="reminder"
  - "查看待执行的任务" -> status="pending"`,
      paramSchema: {
        properties: {
          status: { type: "string", enum: ["pending", "triggered", "completed", "cancelled", "failed"] },
          type: { type: "string", enum: ["reminder", "deadline", "recurring", "conditional"] },
          limit: { type: "number" },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          const query = {
            userId,
            status: params.status as string | undefined,
            type: params.type as string | undefined,
            limit: Math.min(Math.max(Number(params.limit) || 20, 1), 100),
          };
          const result = await scheduler.listEvents(query);
          return {
            success: true,
            data: {
              total: result.total,
              items: result.items.map((e: any) => ({
                eventId: e.id,
                type: e.type,
                status: e.status,
                title: e.actionConfig?.payload?.message || e.type,
                triggerConfig: e.triggerConfig,
                createdAt: e.createdAt,
                triggeredAt: e.triggeredAt,
                completedAt: e.completedAt,
              })),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`查询任务列表失败: ${msg}`) };
        }
      },
    })
  );

  console.log("   Scheduler skills registered (schedule_create/schedule_cancel/schedule_list)");
}

/**
 * 解析自然语言中的延迟时间
 * 支持：X分钟后、X小时后、X天后、X秒后
 * 返回：延迟毫秒数，或 null（无法识别）
 */
function parseNaturalLanguageDelay(text: string): number | null {
  const normalized = text.replace(/[\s\u3000]+/g, ""); // 去掉所有空格

  // 匹配 "数字+单位" 模式
  const minuteMatch = normalized.match(/(\d+(?:\.\d+)?)(?:分钟|分|min|mins|minutes)/i);
  if (minuteMatch) {
    return Math.round(parseFloat(minuteMatch[1]) * 60 * 1000);
  }

  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)(?:小时|时|hr|hrs|hours|hour)/i);
  if (hourMatch) {
    return Math.round(parseFloat(hourMatch[1]) * 60 * 60 * 1000);
  }

  const dayMatch = normalized.match(/(\d+(?:\.\d+)?)(?:天|日|day|days)/i);
  if (dayMatch) {
    return Math.round(parseFloat(dayMatch[1]) * 24 * 60 * 60 * 1000);
  }

  const secondMatch = normalized.match(/(\d+(?:\.\d+)?)(?:秒|秒钟|sec|secs|seconds|second)/i);
  if (secondMatch) {
    return Math.round(parseFloat(secondMatch[1]) * 1000);
  }

  // 中文数字 + 单位（如"十分钟后"）
  const cnMinuteMatch = normalized.match(/([一二两三四五六七八九十百千万亿\d]+)(?:分钟|分)/);
  if (cnMinuteMatch) {
    const num = parseChineseNumber(cnMinuteMatch[1]);
    if (num !== null) return num * 60 * 1000;
  }

  const cnHourMatch = normalized.match(/([一二两三四五六七八九十百千万亿\d]+)(?:小时|时)/);
  if (cnHourMatch) {
    const num = parseChineseNumber(cnHourMatch[1]);
    if (num !== null) return num * 60 * 60 * 1000;
  }

  const cnDayMatch = normalized.match(/([一二两三四五六七八九十百千万亿\d]+)(?:天|日)/);
  if (cnDayMatch) {
    const num = parseChineseNumber(cnDayMatch[1]);
    if (num !== null) return num * 24 * 60 * 60 * 1000;
  }

  return null;
}

/**
 * 解析中文数字（简化版）
 */
function parseChineseNumber(text: string): number | null {
  const map: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    百: 100, 千: 1000, 万: 10000, 亿: 100000000,
  };

  // 先尝试直接解析阿拉伯数字
  const arabic = parseFloat(text);
  if (!isNaN(arabic)) return arabic;

  // 简单中文数字：十、十一、二十
  if (text === "十") return 10;
  if (text.startsWith("十")) {
    const unit = map[text[1]];
    if (unit) return 10 + unit;
  }
  if (text.endsWith("十")) {
    const unit = map[text[0]];
    if (unit) return unit * 10;
  }
  if (text.length === 3 && text[1] === "十") {
    const tens = map[text[0]];
    const ones = map[text[2]];
    if (tens && ones) return tens * 10 + ones;
  }

  // 单字
  const single = map[text];
  if (single !== undefined) return single;

  return null;
}
