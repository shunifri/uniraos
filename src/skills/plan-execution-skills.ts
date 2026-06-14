/**
 * Plan Execution Skills — 计划管理 Skill 家族
 *
 * 暴露给用户/Agent 的计划管理能力：
 * - plan_create: 创建计划（自动绑定当前对话）
 * - plan_list: 列出计划
 * - plan_status: 查询计划进度
 * - plan_execute: 执行计划
 * - plan_pause: 暂停计划
 * - plan_resume: 恢复计划
 * - plan_cancel: 取消计划
 * - plan_delete: 删除计划
 * - plan_edit: 编辑计划（修改/添加/删除步骤）
 * - plan_chat_command: 对话内计划指令识别（继续/进度/修改/跳过）
 * - plan_resume_all: 系统级恢复中断计划
 */

import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { getGlobalExecutionEngine } from "../engine/execution-engine.js";
import {
  createPlan,
  readPlan,
  listPlans,
  getPlanProgress,
  pausePlan,
  resumePlan,
  cancelPlan,
  deletePlan,
  updatePlanStatus,
  findPlanByConversationId,
  saveChatMessage,
} from "../plan/plan-state.js";
import { executePlan, resumeInterruptedPlans, cancelScheduledPlanEvents } from "../plan/plan-executor.js";
import { parsePlan, serializePlan, computeProgress } from "../plan/plan-parser.js";
import type { ParsedPlan } from "../plan/plan-types.js";

export function createPlanExecutionSkills(registry: SkillRegistry): void {
  // ===== plan_create: 创建计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_create",
      description: `创建一个新的执行计划。自动绑定当前对话，支持断点续传。

参数:
  title(string): 计划标题
  content(string): 计划内容（markdown 格式，包含步骤列表）
  tags?(string[]): 标签列表
  overwrite?(boolean): 是否覆盖同名计划，默认 false

使用示例:
  - "帮我创建一个开发计划" -> title="开发计划", content="## Task 1\n- [ ] Step 1: ..."
  - "根据这个需求创建计划" -> title="需求实现", content=需求文档`,
      paramSchema: {
        properties: {
          title: { type: "string", description: "计划标题" },
          content: { type: "string", description: "计划内容（markdown）" },
          tags: { type: "array", items: { type: "string" }, description: "标签" },
          overwrite: { type: "boolean", description: "是否覆盖同名计划" },
        },
        required: ["title", "content"],
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          const conversationId = context.conversationId;
          const result = createPlan(
            {
              title: params.title as string,
              content: params.content as string,
              tags: (params.tags as string[]) || undefined,
              conversationId: conversationId || undefined,
              overwrite: (params.overwrite as boolean) || false,
            },
            userId
          );

          const progress = computeProgress(result.plan);

          // 如果绑定了对话，发送创建通知
          if (conversationId && result.isNew) {
            await saveChatMessage(conversationId, "system", `📋 **计划已创建**\n\n**${result.plan.meta.title}**\n共 ${result.plan.meta.totalSteps} 个步骤\n\n输入"开始执行"或"执行计划"即可启动。`, {
              skillName: "plan_create",
              extra: { planId: result.plan.meta.planId, fileName: result.fileName },
            });
          }

          return {
            success: true,
            data: {
              planId: result.plan.meta.planId,
              title: result.plan.meta.title,
              fileName: result.fileName,
              status: result.plan.meta.status,
              totalSteps: result.plan.meta.totalSteps,
              progress,
              isNew: result.isNew,
              message: result.isNew ? "计划创建成功" : "已存在同名计划，返回已有计划",
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`创建计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_list: 列出计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_list",
      description: `列出当前用户的所有计划。

参数:
  status?(string): 状态筛选 — draft | running | paused | completed | failed | cancelled
  limit?(number): 返回数量，默认 20

使用示例:
  - "查看我的所有计划" -> 无参数
  - "查看进行中的计划" -> status="running"`,
      paramSchema: {
        properties: {
          status: { type: "string", enum: ["draft", "running", "paused", "completed", "failed", "cancelled"] },
          limit: { type: "number", description: "返回数量限制" },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          const all = listPlans(userId);
          let items = all;

          if (params.status) {
            items = items.filter((p) => p.status === params.status);
          }

          const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
          items = items.slice(0, limit);

          return {
            success: true,
            data: {
              total: all.length,
              filtered: items.length,
              items: items.map((p) => ({
                planId: p.planId,
                title: p.title,
                status: p.status,
                progress: p.progress,
                currentStep: p.currentStep,
                totalSteps: p.totalSteps,
                updatedAt: p.updatedAt,
              })),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`查询计划列表失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_status: 查询计划进度 =====
  registry.register(
    defineSystemSkill({
      name: "plan_status",
      description: `查询指定计划的详细进度。如果不传 fileName，自动查找当前对话关联的计划。

参数:
  fileName?(string): 计划文件名（如 "feature-implementation.md"）

使用示例:
  - "查看进度" -> 无参数（自动查找当前对话的计划）
  - "查看 feature-implementation.md 的进度" -> fileName="feature-implementation.md"`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名（可选）" },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          let fileName = params.fileName as string | undefined;

          // 如果没有传 fileName，尝试通过 conversationId 查找
          if (!fileName && context.conversationId) {
            const found = findPlanByConversationId(context.conversationId, userId);
            if (found) fileName = found.fileName;
          }

          if (!fileName) {
            return { success: false, error: new Error("请指定计划文件名，或当前对话没有关联计划") };
          }

          const progress = getPlanProgress(fileName, userId);

          return {
            success: true,
            data: {
              planId: progress.summary.planId,
              title: progress.summary.title,
              status: progress.summary.status,
              progress: progress.summary.progress,
              currentStep: progress.summary.currentStep,
              totalSteps: progress.summary.totalSteps,
              createdAt: progress.summary.createdAt,
              updatedAt: progress.summary.updatedAt,
              steps: progress.steps.map((s) => ({
                index: s.index,
                taskTitle: s.taskTitle,
                description: s.description,
                status: s.status,
                startedAt: s.startedAt,
                finishedAt: s.finishedAt,
                result: s.result,
                error: s.error,
              })),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`查询计划进度失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_execute: 执行计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_execute",
      description: `执行指定计划（从当前步骤开始或指定步骤）。如果不传 fileName，自动查找当前对话关联的计划。

参数:
  fileName?(string): 计划文件名（可选，不传则自动查找当前对话关联的计划）
  fromStep?(number): 从第几步开始（0-based），默认从当前步骤继续
  asyncProgress?(boolean): 是否异步推进（每步后通过 Scheduler 安排下一步，支持跨 session），默认 false
  stepDelayMs?(number): 步骤间延迟（毫秒），默认 0
  maxRetries?(number): 失败时自动重试次数，默认 0

使用示例:
  - "执行计划" -> 无参数（自动查找当前对话的计划）
  - "从第 3 步开始执行" -> fromStep=2
  - "24小时持续推进" -> asyncProgress=true`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名（可选）" },
          fromStep: { type: "number", description: "起始步骤索引（0-based）" },
          asyncProgress: { type: "boolean", description: "是否异步推进（跨 session）" },
          stepDelayMs: { type: "number", description: "步骤间延迟（毫秒）" },
          maxRetries: { type: "number", description: "失败重试次数" },
        },
      },
      handler: async (params, context) => {
        const engine = getGlobalExecutionEngine();
        if (!engine) {
          return { success: false, error: new Error("执行引擎未初始化") };
        }

        try {
          const userId = context.user?.id || "anonymous";
          let fileName = params.fileName as string | undefined;

          // 如果没有传 fileName，尝试通过 conversationId 查找
          if (!fileName && context.conversationId) {
            const found = findPlanByConversationId(context.conversationId, userId);
            if (found) fileName = found.fileName;
          }

          if (!fileName) {
            return { success: false, error: new Error("请指定计划文件名，或当前对话没有关联计划") };
          }

          const result = await executePlan(
            fileName,
            engine,
            {
              fromStep: params.fromStep as number | undefined,
              asyncProgress: (params.asyncProgress as boolean) || false,
              stepDelayMs: params.stepDelayMs as number | undefined,
              maxRetries: params.maxRetries as number | undefined,
            },
            userId
          );

          return {
            success: result.success,
            data: result,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`执行计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_pause: 暂停计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_pause",
      description: `暂停正在执行的计划。如果不传 fileName，自动查找当前对话关联的计划。

参数:
  fileName?(string): 计划文件名（可选）

使用示例:
  - "暂停计划" -> 无参数`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名（可选）" },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          let fileName = params.fileName as string | undefined;

          if (!fileName && context.conversationId) {
            const found = findPlanByConversationId(context.conversationId, userId);
            if (found) fileName = found.fileName;
          }

          if (!fileName) {
            return { success: false, error: new Error("请指定计划文件名，或当前对话没有关联计划") };
          }

          const plan = await pausePlan(fileName, userId);

          if (plan.meta.conversationId) {
            await saveChatMessage(plan.meta.conversationId, "system", `⏸️ **计划已暂停** — ${plan.meta.title}\n\n输入"继续执行"即可恢复。`, {
              skillName: "plan_pause",
              extra: { planId: plan.meta.planId, status: plan.meta.status },
            });
          }

          return {
            success: true,
            data: {
              planId: plan.meta.planId,
              title: plan.meta.title,
              status: plan.meta.status,
              message: "计划已暂停",
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`暂停计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_resume: 恢复计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_resume",
      description: `恢复暂停或失败的计划。如果不传 fileName，自动查找当前对话关联的计划。

参数:
  fileName?(string): 计划文件名（可选）
  asyncProgress?(boolean): 是否异步推进，默认 false

使用示例:
  - "继续执行" -> 无参数
  - "恢复并异步推进" -> asyncProgress=true`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名（可选）" },
          asyncProgress: { type: "boolean", description: "是否异步推进" },
        },
      },
      handler: async (params, context) => {
        const engine = getGlobalExecutionEngine();
        if (!engine) {
          return { success: false, error: new Error("执行引擎未初始化") };
        }

        try {
          const userId = context.user?.id || "anonymous";
          let fileName = params.fileName as string | undefined;

          if (!fileName && context.conversationId) {
            const found = findPlanByConversationId(context.conversationId, userId);
            if (found) fileName = found.fileName;
          }

          if (!fileName) {
            return { success: false, error: new Error("请指定计划文件名，或当前对话没有关联计划") };
          }

          const plan = await resumePlan(fileName, userId);

          // 如果请求了异步推进，立即开始执行
          if (params.asyncProgress) {
            const result = await executePlan(
              fileName,
              engine,
              { asyncProgress: true },
              userId
            );
            return {
              success: result.success,
              data: { ...result, status: plan.meta.status },
            };
          }

          return {
            success: true,
            data: {
              planId: plan.meta.planId,
              title: plan.meta.title,
              status: plan.meta.status,
              message: "计划已恢复，等待执行",
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`恢复计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_cancel: 取消计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_cancel",
      description: `取消计划执行。如果不传 fileName，自动查找当前对话关联的计划。

参数:
  fileName?(string): 计划文件名（可选）

使用示例:
  - "取消计划" -> 无参数`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名（可选）" },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          let fileName = params.fileName as string | undefined;

          if (!fileName && context.conversationId) {
            const found = findPlanByConversationId(context.conversationId, userId);
            if (found) fileName = found.fileName;
          }

          if (!fileName) {
            return { success: false, error: new Error("请指定计划文件名，或当前对话没有关联计划") };
          }

          const plan = await cancelPlan(fileName, userId);
          await cancelScheduledPlanEvents(fileName, userId);
          return {
            success: true,
            data: {
              planId: plan.meta.planId,
              title: plan.meta.title,
              status: plan.meta.status,
              message: "计划已取消",
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`取消计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_delete: 删除计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_delete",
      description: `删除计划文件。

参数:
  fileName(string): 计划文件名

使用示例:
  - "删除 feature-implementation.md" -> fileName="feature-implementation.md"`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名" },
        },
        required: ["fileName"],
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          const deleted = deletePlan(params.fileName as string, userId);
          return {
            success: deleted,
            data: { deleted, message: deleted ? "计划已删除" : "计划不存在" },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`删除计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_edit: 编辑计划 =====
  registry.register(
    defineSystemSkill({
      name: "plan_edit",
      description: `编辑计划内容（修改步骤、添加步骤、删除步骤、重新排序）。如果不传 fileName，自动查找当前对话关联的计划。

参数:
  fileName?(string): 计划文件名（可选）
  action(string): 操作类型 — modify_step | add_step | delete_step | reorder_steps | update_title
  stepIndex?(number): 步骤索引（0-based，modify/delete 时必填）
  newDescription?(string): 新步骤描述（modify/add 时）
  newTaskTitle?(string): 新 Task 标题（可选）
  newTitle?(string): 新计划标题（update_title 时）
  targetIndex?(number): 目标位置（reorder 时）

使用示例:
  - "把第 3 步改成安装依赖" -> action="modify_step", stepIndex=2, newDescription="安装依赖"
  - "在第 2 步后添加新步骤" -> action="add_step", stepIndex=2, newDescription="运行测试"
  - "删除第 5 步" -> action="delete_step", stepIndex=4
  - "修改计划标题" -> action="update_title", newTitle="新标题"`,
      paramSchema: {
        properties: {
          fileName: { type: "string", description: "计划文件名（可选）" },
          action: { type: "string", enum: ["modify_step", "add_step", "delete_step", "reorder_steps", "update_title"], description: "操作类型" },
          stepIndex: { type: "number", description: "步骤索引" },
          newDescription: { type: "string", description: "新步骤描述" },
          newTaskTitle: { type: "string", description: "新 Task 标题" },
          newTitle: { type: "string", description: "新计划标题" },
          targetIndex: { type: "number", description: "目标位置（reorder 时）" },
        },
        required: ["action"],
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id || "anonymous";
          let fileName = params.fileName as string | undefined;

          if (!fileName && context.conversationId) {
            const found = findPlanByConversationId(context.conversationId, userId);
            if (found) fileName = found.fileName;
          }

          if (!fileName) {
            return { success: false, error: new Error("请指定计划文件名，或当前对话没有关联计划") };
          }

          const plan = readPlan(fileName, userId);
          const action = params.action as string;

          switch (action) {
            case "update_title": {
              if (!params.newTitle) return { success: false, error: new Error("newTitle 必填") };
              plan.meta.title = params.newTitle as string;
              break;
            }
            case "modify_step": {
              const idx = params.stepIndex as number;
              if (idx === undefined) return { success: false, error: new Error("stepIndex 必填") };
              const step = plan.steps.find((s) => s.index === idx);
              if (!step) return { success: false, error: new Error(`步骤 ${idx} 不存在`) };
              if (params.newDescription) step.description = params.newDescription as string;
              if (params.newTaskTitle) step.taskTitle = params.newTaskTitle as string;
              break;
            }
            case "add_step": {
              const idx = (params.stepIndex as number) ?? plan.steps.length;
              const newStep = {
                index: plan.steps.length,
                taskTitle: (params.newTaskTitle as string) || plan.steps[plan.steps.length - 1]?.taskTitle || "Task",
                description: (params.newDescription as string) || "新步骤",
                status: "pending" as const,
              };
              // 插入到指定位置后
              plan.steps.splice(Math.min(idx + 1, plan.steps.length), 0, newStep);
              // 重新编号
              plan.steps.forEach((s, i) => { s.index = i; });
              plan.meta.totalSteps = plan.steps.length;
              break;
            }
            case "delete_step": {
              if (plan.meta.status === "running") {
                return { success: false, error: new Error("计划正在执行中，请先暂停计划再删除步骤") };
              }
              const idx = params.stepIndex as number;
              if (idx === undefined) return { success: false, error: new Error("stepIndex 必填") };
              plan.steps = plan.steps.filter((s) => s.index !== idx);
              plan.steps.forEach((s, i) => { s.index = i; });
              plan.meta.totalSteps = plan.steps.length;
              break;
            }
            case "reorder_steps": {
              if (plan.meta.status === "running") {
                return { success: false, error: new Error("计划正在执行中，请先暂停计划再重新排序步骤") };
              }
              const fromIdx = params.stepIndex as number;
              const toIdx = params.targetIndex as number;
              if (fromIdx === undefined || toIdx === undefined) {
                return { success: false, error: new Error("stepIndex 和 targetIndex 必填") };
              }
              const [moved] = plan.steps.splice(fromIdx, 1);
              plan.steps.splice(toIdx, 0, moved);
              plan.steps.forEach((s, i) => { s.index = i; });
              break;
            }
            default:
              return { success: false, error: new Error(`未知操作: ${action}`) };
          }

          // 保存修改
          const { savePlan } = await import("../plan/plan-state.js");
          savePlan(fileName, plan, userId);

          return {
            success: true,
            data: {
              planId: plan.meta.planId,
              title: plan.meta.title,
              totalSteps: plan.meta.totalSteps,
              message: `计划已更新: ${action}`,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`编辑计划失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_chat_command: 对话内计划指令识别 =====
  registry.register(
    defineSystemSkill({
      name: "plan_chat_command",
      description: `对话内计划指令识别：解析自然语言指令，自动操作当前对话关联的计划。

支持的指令:
  - "继续执行" / "继续" / "go on" -> 恢复并执行计划
  - "进度如何" / "怎么样了" / "status" -> 查询计划进度
  - "把第 3 步改成 xxx" -> 修改步骤描述
  - "跳过第 5 步" -> 标记步骤为 skipped
  - "暂停" / "stop" -> 暂停计划
  - "取消计划" -> 取消计划

参数:
  command(string): 自然语言指令

使用示例:
  - "继续执行" -> command="继续执行"
  - "把第 2 步改成写测试" -> command="把第 2 步改成写测试"`,
      paramSchema: {
        properties: {
          command: { type: "string", description: "自然语言指令" },
        },
        required: ["command"],
      },
      handler: async (params, context) => {
        const engine = getGlobalExecutionEngine();
        if (!engine) {
          return { success: false, error: new Error("执行引擎未初始化") };
        }

        try {
          const userId = context.user?.id || "anonymous";
          const command = (params.command as string).trim();

          // 如果没有 conversationId，无法自动查找
          if (!context.conversationId) {
            return { success: false, error: new Error("当前不在对话上下文中，无法识别计划指令") };
          }

          const found = findPlanByConversationId(context.conversationId, userId);
          if (!found) {
            return { success: false, error: new Error("当前对话没有关联计划") };
          }

          const { fileName, plan } = found;

          // 1. 继续执行
          if (/^(继续|执行|go on|resume|start)/i.test(command)) {
            const result = await executePlan(fileName, engine, { asyncProgress: true }, userId);
            return { success: result.success, data: { ...result, action: "resume_execute" } };
          }

          // 2. 查询进度
          if (/^(进度|状态|怎么样了|status|progress)/i.test(command)) {
            const progress = getPlanProgress(fileName, userId);
            return {
              success: true,
              data: { action: "status", ...progress.summary, steps: progress.steps },
            };
          }

          // 3. 暂停
          if (/^(暂停|stop|pause)/i.test(command)) {
            const updated = await pausePlan(fileName, userId);
            return { success: true, data: { action: "pause", status: updated.meta.status } };
          }

          // 4. 取消
          if (/^(取消|cancel)/i.test(command)) {
            const updated = await cancelPlan(fileName, userId);
            await cancelScheduledPlanEvents(fileName, userId);
            return { success: true, data: { action: "cancel", status: updated.meta.status } };
          }

          // 5. 修改步骤："把第 N 步改成 xxx" / "修改第 N 步为 xxx"
          const modifyMatch = command.match(/(?:把|修改)\s*第?\s*(\d+)\s*步\s*(?:改成|改为|成)\s*(.+)/);
          if (modifyMatch) {
            const stepIndex = parseInt(modifyMatch[1], 10) - 1;
            const newDesc = modifyMatch[2].trim();
            const targetStep = plan.steps.find((s) => s.index === stepIndex);
            if (!targetStep) {
              return { success: false, error: new Error(`步骤 ${stepIndex + 1} 不存在`) };
            }
            targetStep.description = newDesc;
            const { savePlan } = await import("../plan/plan-state.js");
            savePlan(fileName, plan, userId);
            return { success: true, data: { action: "modify_step", stepIndex, newDescription: newDesc } };
          }

          // 6. 跳过步骤："跳过第 N 步"
          const skipMatch = command.match(/跳过\s*第?\s*(\d+)\s*步/);
          if (skipMatch) {
            const stepIndex = parseInt(skipMatch[1], 10) - 1;
            const { updateStepStatus } = await import("../plan/plan-state.js");
            await updateStepStatus(fileName, stepIndex, "skipped", { result: "skipped by user command" }, userId);
            return { success: true, data: { action: "skip_step", stepIndex } };
          }

          // 7. 添加步骤："在第 N 步后添加 xxx"
          const addMatch = command.match(/在\s*第?\s*(\d+)\s*步后?\s*添加\s*(.+)/);
          if (addMatch) {
            const stepIndex = parseInt(addMatch[1], 10) - 1;
            const newDesc = addMatch[2].trim();
            const newStep = {
              index: plan.steps.length,
              taskTitle: plan.steps[plan.steps.length - 1]?.taskTitle || "Task",
              description: newDesc,
              status: "pending" as const,
            };
            plan.steps.splice(Math.min(stepIndex + 1, plan.steps.length), 0, newStep);
            plan.steps.forEach((s, i) => { s.index = i; });
            plan.meta.totalSteps = plan.steps.length;
            const { savePlan } = await import("../plan/plan-state.js");
            savePlan(fileName, plan, userId);
            return { success: true, data: { action: "add_step", stepIndex, newDescription: newDesc } };
          }

          return { success: false, error: new Error(`无法识别的指令: ${command}`) };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`指令执行失败: ${msg}`) };
        }
      },
    })
  );

  // ===== plan_resume_all: 恢复所有中断的计划（管理员/系统用） =====
  registry.register(
    defineSystemSkill({
      name: "plan_resume_all",
      description: `系统级 Skill：扫描并恢复所有中断的计划（服务启动时调用）。

使用示例:
  - 系统自动调用，恢复因服务重启而中断的计划`,
      paramSchema: {
        properties: {},
      },
      handler: async () => {
        const engine = getGlobalExecutionEngine();
        if (!engine) {
          return { success: false, error: new Error("执行引擎未初始化") };
        }

        try {
          await resumeInterruptedPlans(engine);
          return { success: true, data: { message: "中断计划恢复扫描完成" } };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: new Error(`恢复中断计划失败: ${msg}`) };
        }
      },
    })
  );

  console.log("   Plan execution skills registered (plan_create/list/status/execute/pause/resume/cancel/delete/edit/chat_command/resume_all)");
}
