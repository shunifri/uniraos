/**
 * 多模态 Skill 注册
 * 将多模态生成/理解能力包装为 RAOS Skill
 * 生成类 Skill 为异步（耗时），理解类 Skill 为同步
 */
import { defineSkill, Autonomy, TaskStatus } from "../types/index.js";
import type { SkillDefinition, AsyncTaskOps } from "../types/index.js";
import type { MultimodalProvider, MediaType } from "./types.js";
import type { AsyncTaskManager } from "../engine/async-task-manager.js";

export function createMultimodalSkills(
  getProvider: () => MultimodalProvider | null,
  taskManager: AsyncTaskManager,
): SkillDefinition[] {
  return [
    // ===== 生成类 Skills（异步） =====
    defineSkill({
      name: "media_generate",
      visible: true,
      autonomy: Autonomy.MANUAL,
      async: true,
      timeout: 300000, // 5 分钟
      description:
        "生成多媒体内容（图像/音频/视频）。参数: type('image'|'audio'|'video'), prompt(string), options?(object)。返回异步任务句柄。",
      handler: async (params, context) => {
        const provider = getProvider();
        if (!provider) {
          return { success: false, error: new Error("Multimodal provider not configured") };
        }

        const { type, prompt, referenceMedia, model, options } = params as {
          type: MediaType;
          prompt: string;
          referenceMedia?: string;
          model?: string;
          options?: Record<string, unknown>;
        };

        if (!type || !prompt) {
          return { success: false, error: new Error("type and prompt are required") };
        }

        if (!provider.supportedGenerateTypes.includes(type)) {
          return {
            success: false,
            error: new Error(`Provider does not support generating: ${type}. Supported: ${provider.supportedGenerateTypes.join(", ")}`),
          };
        }

        // 创建异步任务
        const task = taskManager.create();
        taskManager.start(task.taskId);

        // 异步执行生成（不阻塞 handler 返回）
        (async () => {
          try {
            taskManager.progress(task.taskId, 10);
            const result = await provider.generate({ type, prompt, referenceMedia, model, options });
            taskManager.complete(task.taskId, result);
          } catch (err) {
            taskManager.fail(task.taskId, err instanceof Error ? err.message : String(err));
          }
        })();

        return {
          success: true,
          data: { message: `${type} generation started`, taskId: task.taskId },
          async: task,
        };
      },
    }),

    defineSkill({
      name: "image_generate",
      visible: true,
      autonomy: Autonomy.MANUAL,
      async: true,
      timeout: 120000,
      description: "生成图像。参数: prompt(string), size?('256x256'|'512x512'|'1024x1024'), style?('natural'|'vivid')",
      handler: async (params) => {
        const provider = getProvider();
        if (!provider) {
          return { success: false, error: new Error("Multimodal provider not configured") };
        }

        const { prompt, size, style, model } = params as {
          prompt: string;
          size?: string;
          style?: string;
          model?: string;
        };

        if (!prompt) {
          return { success: false, error: new Error("prompt is required") };
        }

        const task = taskManager.create();
        taskManager.start(task.taskId);

        (async () => {
          try {
            taskManager.progress(task.taskId, 10);
            const result = await provider.generate({
              type: "image",
              prompt,
              model,
              options: { size: size ?? "1024x1024", style: style ?? "natural" },
            });
            taskManager.complete(task.taskId, result);
          } catch (err) {
            taskManager.fail(task.taskId, err instanceof Error ? err.message : String(err));
          }
        })();

        return {
          success: true,
          data: { message: "Image generation started", taskId: task.taskId },
          async: task,
        };
      },
    }),

    // ===== 理解类 Skills（同步） =====
    defineSkill({
      name: "media_understand",
      visible: true,
      autonomy: Autonomy.MANUAL,
      timeout: 60000,
      description:
        "理解/分析多媒体内容。参数: type('image'|'audio'|'video'), media(string: url 或 base64), prompt(string)",
      handler: async (params) => {
        const provider = getProvider();
        if (!provider) {
          return { success: false, error: new Error("Multimodal provider not configured") };
        }

        const { type, media, prompt, model } = params as {
          type: MediaType;
          media: string;
          prompt: string;
          model?: string;
        };

        if (!type || !media || !prompt) {
          return { success: false, error: new Error("type, media, and prompt are required") };
        }

        if (!provider.supportedUnderstandTypes.includes(type)) {
          return {
            success: false,
            error: new Error(`Provider does not support understanding: ${type}. Supported: ${provider.supportedUnderstandTypes.join(", ")}`),
          };
        }

        try {
          const result = await provider.understand({ type, media, prompt, model });
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),

    defineSkill({
      name: "image_describe",
      visible: true,
      autonomy: Autonomy.MANUAL,
      timeout: 60000,
      description: "描述/理解一张图片。参数: image(string: url 或 base64), question?(string, 默认'描述这张图片')",
      handler: async (params) => {
        const provider = getProvider();
        if (!provider) {
          return { success: false, error: new Error("Multimodal provider not configured") };
        }

        const { image, question } = params as { image: string; question?: string };
        if (!image) {
          return { success: false, error: new Error("image is required") };
        }

        try {
          const result = await provider.understand({
            type: "image",
            media: image,
            prompt: question ?? "请详细描述这张图片的内容",
          });
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),

    // ===== 任务查询 Skill =====
    defineSkill({
      name: "task_status",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "查询异步任务状态。参数: taskId(string)",
      handler: async (params) => {
        const { taskId } = params as { taskId: string };
        if (!taskId) {
          return { success: false, error: new Error("taskId is required") };
        }
        const task = taskManager.get(taskId);
        if (!task) {
          return { success: false, error: new Error(`Task not found: ${taskId}`) };
        }
        return { success: true, data: task };
      },
    }),

    defineSkill({
      name: "task_wait",
      visible: true,
      autonomy: Autonomy.MANUAL,
      timeout: 300000,
      description: "等待异步任务完成并返回结果。参数: taskId(string), timeoutMs?(number, 默认30000)",
      handler: async (params) => {
        const { taskId, timeoutMs } = params as { taskId: string; timeoutMs?: number };
        if (!taskId) {
          return { success: false, error: new Error("taskId is required") };
        }
        try {
          const task = await taskManager.waitFor(taskId, timeoutMs ?? 30000);
          return { success: true, data: task };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),

    defineSkill({
      name: "task_list",
      visible: true,
      autonomy: Autonomy.MANUAL,
      description: "列出所有异步任务。参数: status?('PENDING'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED')",
      handler: async (params) => {
        const { status } = params as { status?: string };
        const tasks = status
          ? taskManager.list({ status: status as TaskStatus })
          : taskManager.list();
        return {
          success: true,
          data: {
            tasks: tasks.map((t) => ({
              taskId: t.taskId,
              status: t.status,
              progress: t.progress,
              createdAt: new Date(t.createdAt).toISOString(),
              updatedAt: new Date(t.updatedAt).toISOString(),
            })),
            total: tasks.length,
          },
        };
      },
    }),
  ];
}
