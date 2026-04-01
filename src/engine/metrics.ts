/**
 * Skill 执行指标收集器
 *
 * 收集每个 Skill 的：成功率、平均耗时、调用频率、错误分布。
 * 用于可观测性和 MARKET_BASED 协议的成本估算。
 */

export interface SkillMetrics {
  skillName: string;
  totalCalls: number;
  successCount: number;
  failCount: number;
  successRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  maxDurationMs: number;
  lastCalledAt: number;
  /** 最近的错误类型分布 */
  errorDistribution: Record<string, number>;
}

interface CallRecord {
  timestamp: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
}

export class MetricsCollector {
  /** 每个 Skill 的调用记录 */
  private records = new Map<string, CallRecord[]>();
  /** 保留的最大记录数 */
  private maxRecords: number;

  constructor(opts?: { maxRecords?: number }) {
    this.maxRecords = opts?.maxRecords ?? 1000;
  }

  /** 记录一次 Skill 调用 */
  record(skillName: string, durationMs: number, success: boolean, errorType?: string): void {
    let records = this.records.get(skillName);
    if (!records) {
      records = [];
      this.records.set(skillName, records);
    }

    records.push({
      timestamp: Date.now(),
      durationMs,
      success,
      errorType,
    });

    // LRU 淘汰
    if (records.length > this.maxRecords) {
      records.splice(0, records.length - this.maxRecords);
    }
  }

  /** 获取单个 Skill 的指标 */
  getMetrics(skillName: string): SkillMetrics | null {
    const records = this.records.get(skillName);
    if (!records || records.length === 0) return null;

    const successCount = records.filter((r) => r.success).length;
    const failCount = records.length - successCount;
    const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);

    const errorDist: Record<string, number> = {};
    for (const r of records) {
      if (!r.success && r.errorType) {
        errorDist[r.errorType] = (errorDist[r.errorType] ?? 0) + 1;
      }
    }

    return {
      skillName,
      totalCalls: records.length,
      successCount,
      failCount,
      successRate: successCount / records.length,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      p99DurationMs: percentile(durations, 0.99),
      maxDurationMs: durations[durations.length - 1],
      lastCalledAt: records[records.length - 1].timestamp,
      errorDistribution: errorDist,
    };
  }

  /** 获取所有 Skill 的指标 */
  getAllMetrics(): SkillMetrics[] {
    const metrics: SkillMetrics[] = [];
    for (const skillName of this.records.keys()) {
      const m = this.getMetrics(skillName);
      if (m) metrics.push(m);
    }
    return metrics.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  /** 获取系统总览 */
  getSummary(): {
    totalCalls: number;
    totalSuccess: number;
    totalFail: number;
    overallSuccessRate: number;
    topSkills: Array<{ name: string; calls: number; successRate: number }>;
    slowestSkills: Array<{ name: string; avgMs: number }>;
  } {
    const all = this.getAllMetrics();
    const totalCalls = all.reduce((s, m) => s + m.totalCalls, 0);
    const totalSuccess = all.reduce((s, m) => s + m.successCount, 0);
    const totalFail = totalCalls - totalSuccess;

    return {
      totalCalls,
      totalSuccess,
      totalFail,
      overallSuccessRate: totalCalls > 0 ? totalSuccess / totalCalls : 0,
      topSkills: all.slice(0, 10).map((m) => ({
        name: m.skillName,
        calls: m.totalCalls,
        successRate: m.successRate,
      })),
      slowestSkills: [...all]
        .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
        .slice(0, 10)
        .map((m) => ({ name: m.skillName, avgMs: Math.round(m.avgDurationMs) })),
    };
  }

  /** 清空所有指标 */
  reset(): void {
    this.records.clear();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}
