import { parentPort, workerData } from "node:worker_threads";

interface WorkerData {
  code: string;
  params: Record<string, unknown>;
  hasContext: boolean;
  user?: { id: string; name?: string; displayName?: string; departmentId?: string };
}

const data = workerData as WorkerData;

const context = data.hasContext ? {
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
    const params = data.params;
    const fn = new Function("params", "context", "return (async () => {\n" + data.code + "\n})();");
    const result = await fn(params, { ...context, user: data.user });
    parentPort!.postMessage({ success: true, data: result });
  } catch (err: any) {
    parentPort!.postMessage({ success: false, error: err.message || String(err) });
  }
})();
