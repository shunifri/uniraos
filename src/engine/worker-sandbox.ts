/**
 * Worker Thread 沙箱
 *
 * 不信任的 Skill 在 Worker 中运行，隔离主线程。
 * 支持 CPU 时间限制、内存限制，以及 context.callSkill 代理。
 */
import { Worker } from "node:worker_threads";
import { log } from "../utils/logger.js";

export interface SandboxConfig {
  /** 最大执行时间（ms），默认 30000 */
  timeout: number;
  /** 最大内存（MB），默认 128 */
  maxMemoryMB: number;
}

export interface SandboxContext {
  /** 调用其他 Skill（通过主线程代理） */
  callSkill: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 当前用户信息（系统自动注入） */
  user?: {
    id: string;
    name?: string;
    displayName?: string;
    departmentId?: string;
  };
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
 * @param code - 函数体字符串（接收 params, context 参数，返回 {success, data?, error?}）
 * @param params - 传入参数
 * @param config - 沙箱配置
 * @param context - 沙箱上下文（可选），提供 callSkill 等代理能力
 */
export function runInSandbox(
  code: string,
  params: Record<string, unknown>,
  config?: Partial<SandboxConfig>,
  context?: SandboxContext,
): Promise<SandboxResult> {
  const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };

  return new Promise((resolve) => {
    const startTime = Date.now();

    // Worker 内联代码
    const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');

// 创建 context 代理（如果主线程提供了 context）
const context = workerData.hasContext ? {
  callSkill: async (name, params) => {
    return new Promise((resolve, reject) => {
      const callId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const handler = (msg) => {
        if (msg && msg.type === 'callSkillResult' && msg.callId === callId) {
          parentPort.off('message', handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      };
      parentPort.on('message', handler);
      parentPort.postMessage({ type: 'callSkill', callId, name, params });
    });
  }
} : undefined;

(async () => {
  try {
    const params = workerData.params;
    // 使用 async IIFE 包裹代码，使生成的代码可以使用 await
    const fn = new Function('params', 'context', 'return (async () => {\n' + workerData.code + '\n})();');
    const result = await fn(params, { ...context, user: workerData.user });
    parentPort.postMessage({ success: true, data: result });
  } catch (err) {
    parentPort.postMessage({ success: false, error: err.message || String(err) });
  }
})();
`;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { code, params, hasContext: !!context, user: context?.user },
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

    worker.on("message", async (msg: any) => {
      // 处理 context.callSkill 请求
      if (msg && msg.type === "callSkill" && context) {
        try {
          const result = await context.callSkill(msg.name, msg.params);
          worker.postMessage({ type: "callSkillResult", callId: msg.callId, result });
        } catch (err) {
          worker.postMessage({
            type: "callSkillResult",
            callId: msg.callId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      // 处理最终结果
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
