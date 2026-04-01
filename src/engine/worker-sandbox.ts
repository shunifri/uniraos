/**
 * Worker Thread 沙箱
 *
 * 不信任的 Skill 在 Worker 中运行，隔离主线程。
 * 支持 CPU 时间限制和内存限制。
 */
import { Worker } from "node:worker_threads";
import { log } from "../utils/logger.js";

export interface SandboxConfig {
  /** 最大执行时间（ms），默认 30000 */
  timeout: number;
  /** 最大内存（MB），默认 128 */
  maxMemoryMB: number;
}

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeout: 30000,
  maxMemoryMB: 128,
};

export interface SandboxResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * 在 Worker Thread 中执行不信任的代码
 *
 * @param code - 函数体字符串（接收 params 参数，返回 {success, data?, error?}）
 * @param params - 传入参数
 * @param config - 沙箱配置
 */
export function runInSandbox(
  code: string,
  params: Record<string, unknown>,
  config?: Partial<SandboxConfig>,
): Promise<SandboxResult> {
  const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    // Worker 内联代码
    const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  try {
    const params = workerData.params;
    const fn = new Function('params', workerData.code);
    const result = await fn(params);
    parentPort.postMessage({ success: true, data: result });
  } catch (err) {
    parentPort.postMessage({ success: false, error: err.message || String(err) });
  }
})();
`;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { code, params },
      resourceLimits: {
        maxOldGenerationSizeMb: cfg.maxMemoryMB,
        maxYoungGenerationSizeMb: Math.ceil(cfg.maxMemoryMB / 4),
      },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        success: false,
        error: `Sandbox timeout after ${cfg.timeout}ms`,
        durationMs: Date.now() - startTime,
      });
    }, cfg.timeout);

    worker.on("message", (msg: { success: boolean; data?: unknown; error?: string }) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        success: msg.success,
        data: msg.data,
        error: msg.error,
        durationMs,
      });
      worker.terminate();
    });

    worker.on("error", (err: any) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      log("warn", "sandbox.error", { error: err?.message, durationMs });
      resolve({
        success: false,
        error: err?.message ?? String(err),
        durationMs,
      });
    });

    worker.on("exit", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        const durationMs = Date.now() - startTime;
        resolve({
          success: false,
          error: `Worker exited with code ${exitCode}`,
          durationMs,
        });
      }
    });
  });
}
