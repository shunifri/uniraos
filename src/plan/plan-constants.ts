/**
 * Plan System Constants — 计划系统常量集中定义
 */

/** 默认单步超时（5 分钟） */
export const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000;

/** 计划心跳更新间隔（60 秒） */
export const PLAN_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** 判断计划是否中断的空闲阈值（30 分钟） */
export const STALE_PLAN_THRESHOLD_MS = 30 * 60 * 1000;

/** 计划文件名最大长度（含 hash 后缀） */
export const PLAN_FILENAME_MAX_LENGTH = 60;
