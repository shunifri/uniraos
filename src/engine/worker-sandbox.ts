/**
 * Worker Thread 沙箱
 *
 * 不信任的 Skill 在 Worker 中运行，隔离主线程。
 * 支持 CPU 时间限制、内存限制，以及 context.callSkill 代理。
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { log } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

    // 开发/测试环境使用 .ts，生产环境（Docker/dist）使用 .js
    const ext = process.env.NODE_ENV === "production" ? ".js" : ".ts";
    const workerPath = join(__dirname, `worker-sandbox-worker${ext}`);
    const worker = new Worker(workerPath, {
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
