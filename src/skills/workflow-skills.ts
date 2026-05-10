/**
 * 工作流 Skill 家族
 *
 * 基于 Workflow Engine Lite 实现的审批和任务管理 Skill
 */

import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { LLMProvider } from "../llm/types.js";
import { getWorkflowEngine } from "../workflow/engine.js";
import { getWorkflowRepository } from "../workflow/repository.js";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "../workflow/templates.js";
import type { TaskAction, ApprovalQueryParams, TaskQueryParams, InstanceStatus, TaskStatus } from "../workflow/types.js";
import { generateWorkflow } from "../workflow/workflow-llm-generator.js";
import { getUserRoles } from "../db/user-repository.js";

export function createWorkflowSkills(registry: SkillRegistry, getProvider?: () => LLMProvider | null): void {
  const engine = getWorkflowEngine();
  const repo = getWorkflowRepository();

  // ===== workflow_list: 查询可用流程 =====
  registry.register(
    defineSystemSkill({
      name: "workflow_list",
      description: `查询当前用户可以发起的审批流程列表。
参数:
  category?(string): 按分类筛选
  limit?(number): 返回数量，默认 50
使用示例:
  - "有哪些我可以发起的审批流程？" → 无参数
  - "查看财务类的审批流程" → category="finance"`,
      paramSchema: {
        properties: {
          category: { type: "string", description: "流程分类筛选" },
          limit: { type: "number", description: "返回数量限制" },
        },
      },
      handler: async (params, context) => {
        try {
          const userId = context.user?.id ?? "anonymous";
          const category = params.category as string | undefined;
          const rawLimit = Number(params.limit) || 50;
          const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

          // 查询数据库中的流程定义
          const dbDefs = await repo.listDefinitions(category);
          const availableDbDefs = await engine.filterAvailableDefinitions(dbDefs, userId);

          // 查询内置模板（数据库中没有的）
          const dbKeys = new Set(availableDbDefs.map((d) => d.key));
          const builtinDefs = BUILTIN_TEMPLATES.filter((t) => !dbKeys.has(t.key)).map((t) => ({
            key: t.key,
            name: t.name,
            category: t.category,
            description: t.description,
          }));

          const allDefs = [
            ...availableDbDefs.map((d) => ({
              key: d.key,
              name: d.name,
              category: d.category,
              version: d.version,
            })),
            ...builtinDefs,
          ].slice(0, limit);

          return {
            success: true,
            data: {
              total: allDefs.length,
              items: allDefs,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? (err as Error).message : String(err);
          console.error(`[workflow_list] Unexpected error:`, msg);
          return { success: false, error: new Error(`查询流程列表失败: ${msg}`) };
        }
      },
    }),
  );

  // ===== approval_submit: 提交审批 =====
  registry.register(
    defineSystemSkill({
      name: "approval_submit",
      description: `提交审批申请。基于工作流引擎自动路由到正确的审批人。
参数:
  workflowKey(string): 审批流程标识，如 "expense_approval"(报销)、"leave_approval"(请假)、"procurement_approval"(采购)
  formData(object): 表单数据，根据流程类型不同字段不同
  businessKey?(string): 业务标识（如订单号）
  priority?(string): 优先级 low/normal/high/urgent
使用示例:
  - 报销: workflowKey="expense_approval", formData={amount: 3000, category: "差旅", description: "北京出差", attachments: [...]}
  - 请假: workflowKey="leave_approval", formData={leave_type: "annual", start_date: "2026-05-01", days: 3, reason: "年假"}`,
      paramSchema: {
        properties: {
          workflowKey: { type: "string", description: "审批流程标识" },
          formData: { type: "object", description: "表单数据" },
          businessKey: { type: "string", description: "业务标识" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        },
        required: ["workflowKey", "formData"],
      },
      handler: async (params, context) => {
        try {
          const workflowKey = params.workflowKey as string;
          const formData = (params.formData as Record<string, unknown>) ?? {};
          const businessKey = params.businessKey as string | undefined;

          // 检查流程定义是否存在
          let def = await repo.getDefinitionByKey(workflowKey);
          if (!def) {
            // 尝试从内置模板创建
            const template = getBuiltinTemplate(workflowKey);
            if (template) {
              def = await repo.createDefinition({
                name: template.name,
                key: template.key,
                version: 1,
                category: template.category,
                definition: template.spec,
                formSchema: (template.spec.nodes.find((n) => n.type === "user_task" && n.id === "fill_form") as { form?: typeof template.formSchema })?.form,
                createdBy: "system",
              });
            } else {
              const existingDefs = await repo.listDefinitions();
              const existingKeys = existingDefs.map((d) => d.key);
              console.error(`[approval_submit] Workflow not found: ${workflowKey}. Existing DB keys: [${existingKeys.join(", ")}]. Builtin keys: [${BUILTIN_TEMPLATES.map((t) => t.key).join(", ")}]`);
              return { success: false, error: new Error(`未找到审批流程: ${workflowKey}。数据库中现有流程: ${existingKeys.join(", ") || "无"}。可用内置模板: ${BUILTIN_TEMPLATES.map((t) => t.key).join(", ")}`) };
            }
          }

          const userId = context.user?.id ?? "anonymous";
          const result = await engine.startInstance(workflowKey, userId, formData, businessKey);

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            data: {
              instanceId: result.instance!.id,
              status: result.instance!.status,
              currentNode: result.instance!.currentNodeId,
              task: result.task ? {
                taskId: result.task.id,
                nodeName: result.task.nodeName,
                assignee: result.task.assignee,
                status: result.task.status,
              } : null,
              message: result.task
                ? `审批已提交，当前状态：${result.task.nodeName}，等待 ${result.task.assignee ?? "分配审批人"} 处理`
                : "审批已提交",
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? (err as Error).message : String(err);
          console.error(`[approval_submit] Unexpected error:`, msg);
          return { success: false, error: new Error(`提交审批失败: ${msg}`) };
        }
      },
    }),
  );

  // ===== approval_query: 查询审批 =====
  registry.register(
    defineSystemSkill({
      name: "approval_query",
      description: `查询审批实例列表或详情。
参数:
  scope?(string): 查询范围 — my_pending(我的待办) / my_submitted(我发起的) / my_approved(我已审批的) / all(全部)
  workflowKey?(string): 按流程类型筛选
  status?(string): 状态筛选 running/completed/cancelled
  limit?(number): 返回数量，默认 20
使用示例:
  - "我有哪些待审批的？" → scope="my_pending"
  - "查看所有报销审批" → workflowKey="expense_approval", scope="all"`,
      paramSchema: {
        properties: {
          scope: { type: "string", enum: ["my_pending", "my_submitted", "my_approved", "all"] },
          workflowKey: { type: "string" },
          status: { type: "string", enum: ["running", "completed", "cancelled"] },
          limit: { type: "number" },
        },
        required: ["scope"],
      },
      handler: async (params, context) => {
        try {
          const scope = params.scope as string;
          const userId = context.user?.id ?? "anonymous";
          const rawLimit = Number(params.limit) || 20;
          const safeLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
          const query: ApprovalQueryParams = {
            scope: scope as ApprovalQueryParams["scope"],
            workflowKey: params.workflowKey as string | undefined,
            status: params.status as InstanceStatus | undefined,
            limit: safeLimit,
          };

          // scope 转换
          if (scope === "my_pending") {
            // 查询 assignee 为当前用户的 pending 任务
            const { items: assignedTasks } = await repo.listTasks({
              assignee: userId,
              status: "pending",
              limit: query.limit,
            });
            // 查询 assignee 为空的 pending 任务（candidate 任务）
            const { items: unassignedTasks } = await repo.listTasks({
              status: "pending",
              limit: query.limit,
            });
            const candidateTasks = unassignedTasks.filter((t) => {
              if (t.assignee) return false;
              if (t.candidateUsers?.includes(userId)) return true;
              if (t.candidateGroups && t.candidateGroups.length > 0) {
                // 无法在这里高效查询角色，简化为返回所有未分配且有 candidateGroups 的任务
                // 前端/调用方可以进一步过滤
                return true;
              }
              return false;
            });
            const allTasks = [...assignedTasks, ...candidateTasks].slice(0, query.limit);
            return {
              success: true,
              data: {
                total: allTasks.length,
                items: allTasks.map((t) => ({
                  taskId: t.id,
                  instanceId: t.instanceId,
                  nodeName: t.nodeName,
                  status: t.status,
                  createdAt: t.createdAt,
                  dueDate: t.dueDate,
                })),
              },
            };
          }

          if (scope === "my_submitted") {
            query.starter = userId;
          }

          if (scope === "my_approved") {
            // 查询当前用户已完成的任务
            const { items: tasks, total } = await repo.listTasks({
              assignee: userId,
              status: "completed",
              limit: query.limit,
            });
            return {
              success: true,
              data: {
                total,
                items: tasks.map((t) => ({
                  taskId: t.id,
                  instanceId: t.instanceId,
                  nodeName: t.nodeName,
                  action: t.action,
                  completedAt: t.completedAt,
                })),
              },
            };
          }

          const { items, total } = await repo.listInstances(query);
          return {
            success: true,
            data: {
              total,
              items: items.map((inst) => ({
                instanceId: inst.id,
                status: inst.status,
                starter: inst.starter,
                currentNode: inst.currentNodeId,
                startedAt: inst.startedAt,
                businessKey: inst.businessKey,
              })),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? (err as Error).message : String(err);
          console.error(`[approval_query] Unexpected error:`, msg);
          return { success: false, error: new Error(`查询审批失败: ${msg}`) };
        }
      },
    }),
  );

  // ===== approval_approve: 审批操作 =====
  registry.register(
    defineSystemSkill({
      name: "approval_approve",
      description: `完成审批任务（通过/驳回/转交/委派）。
参数:
  taskId(number): 任务ID
  action(string): 操作类型 — approve(通过) / reject(驳回) / transfer(转交) / delegate(委派)
  comment?(string): 审批意见
  formData?(object): 附加表单数据
  transferTo?(string): 转交给谁（action=transfer时必填）
使用示例:
  - "通过这条报销" → taskId=123, action="approve", comment="同意"
  - "驳回并退回修改" → taskId=123, action="reject", comment="金额有误，请重新核对"
  - "转交给王经理审批" → taskId=123, action="transfer", transferTo="wang_manager"`,
      paramSchema: {
        properties: {
          taskId: { type: "number" },
          action: { type: "string", enum: ["approve", "reject", "transfer", "delegate"] },
          comment: { type: "string" },
          formData: { type: "object" },
          transferTo: { type: "string" },
        },
        required: ["taskId", "action"],
      },
      handler: async (params, context) => {
        try {
          const taskId = params.taskId as number;
          const action = params.action as TaskAction;
          const comment = params.comment as string | undefined;
          const formData = (params.formData as Record<string, unknown>) ?? {};
          const transferTo = params.transferTo as string | undefined;

          const task = await repo.getTaskById(taskId);
          if (!task) {
            return { success: false, error: new Error(`任务不存在: ${taskId}`) };
          }

          const userId = context.user?.id ?? "anonymous";

          // 权限检查：assignee、candidate 或待认领任务
          const isAssignee = task.assignee === userId;
          if (!isAssignee) {
            const isCandidate = task.candidateUsers?.includes(userId) ?? false;
            let isGroupMember = false;
            if (task.candidateGroups && task.candidateGroups.length > 0) {
              const userRoles = await getUserRoles(userId);
              const roleSet = new Set([...userRoles.map((r) => r.id), ...userRoles.map((r) => r.name)]);
              isGroupMember = task.candidateGroups.some((g) => roleSet.has(g));
            }
            const noRestrictions = !task.assignee && !task.candidateUsers?.length && !task.candidateGroups?.length;
            if (!isCandidate && !isGroupMember && !noRestrictions) {
              return { success: false, error: new Error(task.assignee ? `无权操作此任务，当前分配给: ${task.assignee}` : "无权操作此任务") };
            }
          }

          // 转交操作
          if (action === "transfer" && transferTo) {
            const result = await engine.transferTask(taskId, transferTo, comment, userId);
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return {
              success: true,
              data: {
                taskId,
                action: "transfer",
                transferredTo: transferTo,
                message: `已转交给 ${transferTo} 处理`,
              },
            };
          }

          // 委派操作暂不支持
          if (action === "delegate") {
            return { success: false, error: new Error("委派功能暂不支持") };
          }

          // 完成审批任务
          const result = await engine.completeTask(taskId, {
            action,
            comment,
            formData,
          }, userId);

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            data: {
              taskId,
              action,
              instanceId: result.instance?.id,
              instanceStatus: result.instance?.status,
              message: action === "reject"
                ? "已驳回"
                : action === "approve"
                  ? "已通过"
                  : `已执行 ${action}`,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? (err as Error).message : String(err);
          console.error(`[approval_approve] Unexpected error:`, msg);
          return { success: false, error: new Error(`审批操作失败: ${msg}`) };
        }
      },
    }),
  );

  // ===== task_create: 创建任务 =====
  registry.register(
    defineSystemSkill({
      name: "task_create",
      description: `创建独立任务或待办事项（不关联工作流审批流程）。
参数:
  title(string): 任务标题
  description?(string): 任务描述
  assignee?(string): 分配给谁的 userId
  dueDate?(string): 截止日期（ISO 格式）
  priority?(string): 优先级 low/normal/high/urgent
  tags?(string[]): 标签列表
使用示例:
  - "创建一个跟进客户的需求" → title="跟进客户A需求", assignee="张三"
  - "提醒我这周五提交报告" → title="提交月度报告", dueDate="2026-04-25", priority="high"`,
      paramSchema: {
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          assignee: { type: "string" },
          dueDate: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
      },
      handler: async (params, context) => {
        const userId = context.user?.id ?? "anonymous";

        // 独立任务不关联工作流，instance_id 为 null
        const task = await repo.createTask({
          instanceId: null,
          nodeId: "standalone_task",
          nodeName: params.title as string,
          taskType: "user_task",
          assignee: (params.assignee as string) || userId,
          status: "pending",
          formData: {
            description: params.description,
            priority: params.priority ?? "normal",
            tags: params.tags,
            creator: userId,
          },
          dueDate: params.dueDate ? new Date(params.dueDate as string).getTime() : undefined,
        });

        return {
          success: true,
          data: {
            taskId: task.id,
            title: task.nodeName,
            assignee: task.assignee,
            status: task.status,
            dueDate: task.dueDate,
          },
        };
      },
    }),
  );

  // ===== task_query: 查询任务 =====
  registry.register(
    defineSystemSkill({
      name: "task_query",
      description: `查询任务/待办列表。
参数:
  scope(string): 查询范围 — my(我的所有) / assigned_to_me(分配给我的) / created_by_me(我创建的) / all(全部)
  status?(string): 状态筛选 pending/completed/cancelled
  dueBefore?(string): 截止日期之前（ISO 格式）
  limit?(number): 返回数量，默认 20
使用示例:
  - "我今天有哪些待办？" → scope="assigned_to_me", status="pending"
  - "查看所有已完成的任务" → scope="all", status="completed"`,
      paramSchema: {
        properties: {
          scope: { type: "string", enum: ["my", "assigned_to_me", "created_by_me", "all"] },
          status: { type: "string", enum: ["pending", "completed", "cancelled"] },
          dueBefore: { type: "string" },
          limit: { type: "number" },
        },
        required: ["scope"],
      },
      handler: async (params, context) => {
        const userId = context.user?.id ?? "anonymous";
        const query: TaskQueryParams = {
          limit: (params.limit as number) ?? 20,
          status: params.status as TaskStatus | undefined,
        };

        const scope = params.scope as string;
        if (scope === "assigned_to_me" || scope === "my") {
          query.assignee = userId;
        }
        // created_by_me 和 all 暂时不区分（独立任务的 creator 在 formData 中）

        if (params.dueBefore) {
          query.dueBefore = new Date(params.dueBefore as string).getTime();
        }

        const { items, total } = await repo.listTasks(query);
        return {
          success: true,
          data: {
            total,
            items: items.map((t) => ({
              taskId: t.id,
              title: t.nodeName,
              assignee: t.assignee,
              status: t.status,
              dueDate: t.dueDate,
              createdAt: t.createdAt,
              priority: t.formData?.priority ?? "normal",
            })),
          },
        };
      },
    }),
  );

  // ===== task_update: 更新任务 =====
  registry.register(
    defineSystemSkill({
      name: "task_update",
      description: `更新任务状态或信息。
参数:
  taskId(number): 任务ID
  status?(string): 新状态 — pending/completed/cancelled
  assignee?(string): 重新分配给谁
  comment?(string): 备注
使用示例:
  - "标记任务123为已完成" → taskId=123, status="completed"
  - "取消这个任务" → taskId=123, status="cancelled"`,
      paramSchema: {
        properties: {
          taskId: { type: "number" },
          status: { type: "string", enum: ["pending", "completed", "cancelled"] },
          assignee: { type: "string" },
          comment: { type: "string" },
        },
        required: ["taskId"],
      },
      handler: async (params, context) => {
        const taskId = params.taskId as number;
        const task = await repo.getTaskById(taskId);
        if (!task) {
          return { success: false, error: new Error(`任务不存在: ${taskId}`) };
        }

        const userId = context.user?.id ?? "anonymous";
        // 权限检查：assignee、candidate 或 creator 可以更新
        const isAssignee = task.assignee === userId;
        const isCreator = (task.formData?.creator as string) === userId;
        if (!isAssignee && !isCreator) {
          const isCandidate = task.candidateUsers?.includes(userId) ?? false;
          let isGroupMember = false;
          if (task.candidateGroups && task.candidateGroups.length > 0) {
            const userRoles = await getUserRoles(userId);
            const roleSet = new Set([...userRoles.map((r) => r.id), ...userRoles.map((r) => r.name)]);
            isGroupMember = task.candidateGroups.some((g) => roleSet.has(g));
          }
          const noRestrictions = !task.assignee && !task.candidateUsers?.length && !task.candidateGroups?.length;
          if (!isCandidate && !isGroupMember && !noRestrictions) {
            return { success: false, error: new Error("无权更新此任务") };
          }
        }

        const updates: Partial<typeof task> = {};
        if (params.status) updates.status = params.status as typeof task.status;
        if (params.assignee) updates.assignee = params.assignee as string;
        if (params.comment) updates.comment = params.comment as string;
        if (params.status === "completed") updates.completedAt = Date.now();

        await repo.updateTask(taskId, updates);

        return {
          success: true,
          data: {
            taskId,
            status: params.status ?? task.status,
            message: `任务已更新`,
          },
        };
      },
    }),
  );

  // ===== workflow_generate: LLM 生成工作流 =====
  registry.register(
    defineSystemSkill({
      name: "workflow_generate",
      timeout: 120000,
      description: `使用 AI 根据自然语言描述自动生成或修改工作流定义（包括流程结构和表单）。
参数:
  description(string): 自然语言描述，如"创建一个员工入职审批流程，需要 HR 和部门经理两级审批"
  name(string): 流程显示名称，如"员工入职审批"
  key(string): 流程唯一标识（英文小写+下划线），如"onboarding_approval"
  category?(string): 分类，如"hr"/"finance"/"it"/"general"
  existingKey?(string): 如果提供，则基于该现有流程进行修改而非从零创建
使用示例:
  - 创建新流程: description="创建一个项目立项审批流程，先由项目经理审批，再由CTO审批", name="项目立项审批", key="project_approval"
  - 修改现有流程: description="在项目立项流程中增加财务预算审核环节", existingKey="project_approval", name="项目立项审批", key="project_approval"`,
      paramSchema: {
        properties: {
          description: { type: "string", description: "自然语言描述" },
          name: { type: "string", description: "流程显示名称" },
          key: { type: "string", description: "流程唯一标识（英文小写+下划线）" },
          category: { type: "string", description: "分类" },
          existingKey: { type: "string", description: "要修改的现有流程标识" },
        },
        required: ["description", "name", "key"],
      },
      handler: async (params, context) => {
        const userId = context.user?.id ?? "anonymous";
        // 权限检查：仅管理员可生成/修改工作流
        const userRoles = await getUserRoles(userId);
        const isAdmin = userRoles.some((r) =>
          r.name.toLowerCase().includes("admin") ||
          r.name.toLowerCase().includes("管理员"),
        );
        if (!isAdmin) {
          return { success: false, error: new Error("只有管理员才能生成或修改工作流") };
        }

        if (!getProvider) {
          return { success: false, error: new Error("LLM Provider 未注入，无法生成工作流") };
        }

        const result = await generateWorkflow(
          {
            description: params.description as string,
            name: params.name as string,
            key: params.key as string,
            category: params.category as string | undefined,
            existingKey: params.existingKey as string | undefined,
          },
          getProvider,
        );

        if (!result.success) {
          return { success: false, error: new Error(result.error ?? "生成失败") };
        }

        return {
          success: true,
          data: {
            definitionId: result.definition!.id,
            key: result.definition!.key,
            name: result.definition!.name,
            category: result.definition!.category,
            nodeCount: result.definition!.definition.nodes.length,
            message: params.existingKey
              ? `流程 "${result.definition!.name}" 已更新，共 ${result.definition!.definition.nodes.length} 个节点`
              : `流程 "${result.definition!.name}" 已创建，共 ${result.definition!.definition.nodes.length} 个节点`,
          },
        };
      },
    }),
  );
}
