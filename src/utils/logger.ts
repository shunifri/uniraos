export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

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

export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // sink 不应阻断主流程
    }
  }
}
