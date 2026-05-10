export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";
if (!(currentLevel in LEVEL_PRIORITY)) {
  currentLevel = "info";
}

/** 日志输出目标 */
export type LogSink = (entry: LogEntry) => void;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

const sinks: LogSink[] = [defaultConsoleSink];

function defaultConsoleSink(entry: LogEntry): void {
  if (process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    console.log(JSON.stringify(entry));
    return;
  }
  const { timestamp, level, event, ...rest } = entry;
  const fields = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  const levelStr = level.toUpperCase().padEnd(5);
  console.log(`${timestamp} [${levelStr}] ${event}${fields}`);
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

export function removeLogSink(sink: LogSink): void {
  const idx = sinks.indexOf(sink);
  if (idx >= 0) sinks.splice(idx, 1);
}

// P2 修复：敏感字段脱敏规则
const SENSITIVE_KEYS = new RegExp(
  "password|secret|token|apikey|api_key|auth|cookie|private_key|credential",
  "i"
);
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SQL_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s+/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    // 敏感键名直接脱敏
    if (SENSITIVE_KEYS.test(key)) return "***";
    // 长字符串可能是 base64 内容（如文件上传），截断
    if (value.length > 2000) return value.slice(0, 100) + "...[truncated " + value.length + " chars]";
    // SQL 语句脱敏
    if (SQL_PATTERN.test(value)) return "[SQL_QUERY_REDACTED]";
    // 邮箱脱敏
    if (EMAIL_PATTERN.test(value)) {
      return value.replace(EMAIL_PATTERN, (email) => {
        const [user, domain] = email.split("@");
        return user.slice(0, 2) + "***@" + domain;
      });
    }
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      return value.map((v, i) => sanitizeValue(String(i), v));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      sanitized[k] = sanitizeValue(k, v);
    }
    return sanitized;
  }
  return value;
}

export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const safeData = data ? sanitizeValue("root", data) as Record<string, unknown> : undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeData,
  };

  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // sink 不应阻断主流程
    }
  }
}
