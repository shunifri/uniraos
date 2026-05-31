import { parentPort, workerData } from "node:worker_threads";
import { runInNewContext } from "node:vm";

interface WorkerData {
  code: string;
  params: Record<string, unknown>;
  hasContext: boolean;
  user?: { id: string; name?: string; displayName?: string; departmentId?: string };
}

const data = workerData as WorkerData;

const skillContext = data.hasContext ? {
  callSkill: async (name: string, params: Record<string, unknown>) => {
    return new Promise((resolve, reject) => {
      const callId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const handler = (msg: any) => {
        if (msg && msg.type === "callSkillResult" && msg.callId === callId) {
          parentPort!.off("message", handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      };
      parentPort!.on("message", handler);
      parentPort!.postMessage({ type: "callSkill", callId, name, params });
    });
  }
} : undefined;

(async () => {
  try {
    const sandbox: Record<string, unknown> = {
      params: data.params,
      context: { ...skillContext, user: data.user },
      console,
      // setTimeout/setInterval 已移除，防止 DoS（无限循环定时器）
      Promise,
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      encodeURIComponent,
      decodeURI,
      decodeURIComponent,
      escape: undefined,
      unescape: undefined,
      require: undefined,
      module: undefined,
      exports: undefined,
      process: undefined,
      __dirname: undefined,
      __filename: undefined,
    };

    const wrappedCode = `
      (async () => {
        ${data.code}
      })()
    `;

    const result = await runInNewContext(wrappedCode, sandbox, {
      timeout: 30000,
      displayErrors: true,
    });
    // 如果 skill handler 返回了标准的 { success, data, error } 对象，直接透传
    if (result && typeof result === 'object' && 'success' in result) {
      parentPort!.postMessage(result);
    } else {
      parentPort!.postMessage({ success: true, data: result });
    }
  } catch (err: any) {
    parentPort!.postMessage({ success: false, error: err.message || String(err) });
  }
})();
