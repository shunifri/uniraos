/**
 * Workflow Engine Lite — 核心执行引擎
 *
 * 状态机推进逻辑：
 * 1. 启动流程 → 创建实例 → 推进到 StartEvent → 自动推进到第一个 Task
 * 2. 遇到 UserTask → 创建 Task 记录 → 暂停等待人工操作
 * 3. 用户完成 Task → 更新 Task → 推进到下一个节点
 * 4. 遇到 ServiceTask → 自动执行服务 → 推进到下一个节点
 * 5. 遇到 ExclusiveGateway → 评估条件 → 选择分支 → 推进
 * 6. 遇到 EndEvent → 标记实例完成
 */

import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowTask,
  WorkflowNode,
  UserTaskNode,
  ServiceTaskNode,
  ExclusiveGatewayNode,
  ParallelGatewayNode,
  WorkflowSpec,
  GuardContext,
  ExecutionResult,
  AdvanceOptions,
  TaskAction,
  ApproverConfig,
  SignPolicy,
  StarterConstraint,
} from "./types.js";
import { getWorkflowRepository } from "./repository.js";
import { getUserById, getUsersByRole, getUsersByDepartment, getUserRoles, getUserDepartment } from "../db/user-repository.js";
import { getFormDefinition } from "../services/form-service.js";

/** 守卫表达式引擎（简化版 SpEL） */
export class SimpleGuardEngine {
  evaluate(expression: string | unknown, context: GuardContext): boolean {
    const exprStr = typeof expression === "string" ? expression : String(expression ?? "");
    // "default" 表示默认分支，始终通过
    if (exprStr.trim() === "default") return true;

    // 替换 ${variable} 为实际值
    const expanded = exprStr.replace(/\$\{([^}]+)\}/g, (_match, path: string) => {
      const value = this.resolvePath(context.variables, path);
      return this.toLiteral(value);
    });

    try {
      // 使用 Function 构造函数安全求值（仅支持基本运算和比较）
      // eslint-disable-next-line no-new-func
      const fn = new Function("return (" + expanded + ")");
      return Boolean(fn());
    } catch {
      // 表达式求值失败，返回 false（安全失败）
      console.warn(`[WorkflowEngine] Guard evaluation failed: "${expression}" expanded to "${expanded}"`);
      return false;
    }
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private toLiteral(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return JSON.stringify(value);
    return JSON.stringify(value);
  }
}

/** 工作流执行引擎 */
export class WorkflowEngine {
  private guardEngine = new SimpleGuardEngine();
  private repo = getWorkflowRepository();

  // ===== 流程实例生命周期 =====

  /**
   * 启动流程实例
   * @param definitionKey 流程定义 key
   * @param starter 发起人
   * @param variables 初始变量
   * @param businessKey 业务标识
   */
  async startInstance(
    definitionKey: string,
    starter: string,
    variables: Record<string, unknown> = {},
    businessKey?: string,
  ): Promise<ExecutionResult> {
    try {
      const def = await this.repo.getDefinitionByKey(definitionKey);
      if (!def) {
        return { success: false, error: new Error(`Workflow definition not found: ${definitionKey}`) };
      }

      // 检查流程级发起人限制
      if (def.definition.starterConstraints) {
        for (const constraint of def.definition.starterConstraints) {
          const passed = await this.checkStarterConstraint(starter, constraint);
          if (!passed) {
            return { success: false, error: new Error(constraint.message || `发起人不满足条件: ${constraint.type}=${constraint.value}`) };
          }
        }
      }

      // 创建实例
      const instance = await this.repo.createInstance({
        definitionId: def.id,
        definitionVersion: def.version,
        businessKey,
        starter,
        status: "running",
        variables,
      });

      // 设置初始变量
      for (const [key, value] of Object.entries(variables)) {
        await this.repo.setVariable(instance.id, key, value, typeof value);
      }
      await this.repo.setVariable(instance.id, "starter", { id: starter }, "json");

      // 从 StartEvent 开始推进
      const startNode = def.definition.nodes.find((n) => n.type === "start_event");
      if (!startNode) {
        return { success: false, error: new Error("Workflow definition missing start_event") };
      }
      if (!startNode.next) {
        return { success: false, error: new Error("StartEvent has no next node") };
      }

      // 更新当前节点
      await this.repo.updateInstance(instance.id, { currentNodeId: startNode.id });
      instance.currentNodeId = startNode.id;

      // 自动推进到第一个任务
      return await this.advance(instance, { variables });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowEngine] startInstance failed for ${definitionKey}:`, msg);
      return { success: false, error: new Error(`启动流程失败: ${msg}`) };
    }
  }

  /**
   * 推进流程实例
   * @param instanceIdOrInstance 实例 ID 或实例对象
   * @param options 推进选项（用户操作、表单数据等）
   */
  async advance(
    instanceIdOrInstance: number | WorkflowInstance,
    options: AdvanceOptions = {},
  ): Promise<ExecutionResult> {
    try {
      const instance = typeof instanceIdOrInstance === "number"
        ? await this.repo.getInstanceById(instanceIdOrInstance)
        : instanceIdOrInstance;

      if (!instance) {
        return { success: false, error: new Error("Instance not found") };
      }
      if (instance.status !== "running") {
        return { success: false, error: new Error(`Instance is ${instance.status}`) };
      }

      const def = await this.repo.getDefinitionById(instance.definitionId);
      if (!def) {
        return { success: false, error: new Error("Definition not found") };
      }

      // 更新变量
      if (options.variables) {
        const vars = { ...instance.variables, ...options.variables };
        await this.repo.updateInstance(instance.id, { variables: vars });
        instance.variables = vars;
        for (const [key, value] of Object.entries(options.variables)) {
          await this.repo.setVariable(instance.id, key, value, typeof value);
        }
      }

      // 查找当前节点
      const currentNodeId = instance.currentNodeId;
      if (!currentNodeId) {
        return { success: false, error: new Error("Instance has no current node") };
      }

      const currentNode = def.definition.nodes.find((n) => n.id === currentNodeId);
      if (!currentNode) {
        return { success: false, error: new Error(`Node not found: ${currentNodeId}`) };
      }

      // 处理当前节点并决定下一个节点
      return await this.processNode(instance, def.definition, currentNode, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowEngine] advance failed:`, msg);
      return { success: false, error: new Error(`流程推进失败: ${msg}`) };
    }
  }

  /**
   * 完成用户任务
   * @param taskId 任务 ID
   * @param options 完成选项
   * @param userId 操作用户 ID（用于权限校验）
   */
  async completeTask(taskId: number, options: AdvanceOptions = {}, userId?: string): Promise<ExecutionResult> {
    const task = await this.repo.getTaskById(taskId);
    if (!task) {
      return { success: false, error: new Error(`Task not found: ${taskId}`) };
    }
    if (task.status !== "pending" && task.status !== "claimed") {
      return { success: false, error: new Error(`Task is ${task.status}`) };
    }

    if (task.instanceId === null) {
      return { success: false, error: new Error("独立任务不能通过 completeTask 完成，请使用 task_update") };
    }
    const instance = await this.repo.getInstanceById(task.instanceId);
    if (!instance) {
      return { success: false, error: new Error("Instance not found") };
    }

    // 权限校验：instance 状态、assignee/candidate 检查
    if (instance.status !== "running") {
      return { success: false, error: new Error(`流程已${instance.status === "completed" ? "完成" : "取消"}，无法操作`) };
    }
    if (userId) {
      const hasPermission = await this.checkTaskPermission(task, userId);
      if (!hasPermission) {
        return { success: false, error: new Error("无权操作此任务") };
      }
    }

    const now = Date.now();

    // 更新任务
    await this.repo.updateTask(taskId, {
      status: "completed",
      action: options.action,
      formData: options.formData,
      comment: options.comment,
      completedAt: now,
    });

    // 会签处理
    if (task.signGroup) {
      const signState = await this.repo.getVariable(instance.id, `__sign_${task.signGroup}`) as {
        nodeId: string;
        total: number;
        condition: string;
        minCount?: number;
        completed: number;
        approved: number;
        rejected: number;
      } | undefined;

      if (signState) {
        signState.completed += 1;
        if (options.action === "reject") {
          signState.rejected += 1;
        } else {
          signState.approved += 1;
        }
        await this.repo.setVariable(instance.id, `__sign_${task.signGroup}`, signState, "json");

        // reject 在会签中直接结束流程
        if (options.action === "reject") {
          await this.cancelSignGroupTasks(instance.id, task.signGroup, taskId);
          await this.repo.updateInstance(instance.id, { status: "completed", completedAt: now });
          return {
            success: true,
            instance: { ...instance, status: "completed", completedAt: now },
            task: { ...task, status: "completed", action: "reject", completedAt: now },
          };
        }

        // 判断是否满足会签条件
        const shouldAdvance = this.checkSignCondition(signState, options.action);
        if (!shouldAdvance) {
          // 条件不满足，等待其他审批人
          return {
            success: true,
            instance,
            task: { ...task, status: "completed", action: options.action, completedAt: now },
          };
        }

        // 条件满足，取消同组其他未完成任务
        await this.cancelSignGroupTasks(instance.id, task.signGroup, taskId);
      }
    }

    // 如果操作是 reject，结束流程
    if (options.action === "reject") {
      await this.repo.updateInstance(instance.id, { status: "completed", completedAt: now });
      return { success: true, instance: { ...instance, status: "completed", completedAt: now }, task: { ...task, status: "completed", action: "reject", completedAt: now } };
    }

    // 更新变量
    if (options.formData) {
      const vars = { ...instance.variables, ...options.formData };
      await this.repo.updateInstance(instance.id, { variables: vars });
      instance.variables = vars;
      for (const [key, value] of Object.entries(options.formData)) {
        await this.repo.setVariable(instance.id, key, value, typeof value);
      }
    }

    // 推进到下一个节点
    const def = await this.repo.getDefinitionById(instance.definitionId);
    if (def) {
      const currentNode = def.definition.nodes.find((n) => n.id === task.nodeId);
      if (currentNode?.next) {
        await this.repo.updateInstance(instance.id, { currentNodeId: currentNode.next });
        instance.currentNodeId = currentNode.next;
      } else {
        // 没有下一个节点，直接结束
        await this.repo.updateInstance(instance.id, { status: "completed", completedAt: now });
        return { success: true, instance: { ...instance, status: "completed", completedAt: now }, task: { ...task, status: "completed" } };
      }
    }

    // 推进流程
    const advanceResult = await this.advance(instance, options);
    return {
      ...advanceResult,
      task: {
        ...task,
        status: "completed" as const,
        action: options.action,
        completedAt: now,
        formData: options.formData,
        comment: options.comment,
      },
    };
  }

  /**
   * 认领任务
   */
  async claimTask(taskId: number, userId: string): Promise<ExecutionResult> {
    const task = await this.repo.getTaskById(taskId);
    if (!task) {
      return { success: false, error: new Error(`Task not found: ${taskId}`) };
    }
    if (task.status !== "pending") {
      return { success: false, error: new Error(`Task is ${task.status}`) };
    }

    // 权限校验：用户必须在 candidateUsers 或 candidateGroups 中
    const hasPermission = await this.checkTaskPermission(task, userId);
    if (!hasPermission) {
      return { success: false, error: new Error("无权认领此任务") };
    }

    await this.repo.updateTask(taskId, {
      status: "claimed",
      assignee: userId,
      claimedAt: Date.now(),
    });

    return { success: true, task: { ...task, status: "claimed", assignee: userId, claimedAt: Date.now() } };
  }

  /**
   * 转交任务
   */
  async transferTask(taskId: number, toUserId: string, comment?: string, userId?: string): Promise<ExecutionResult> {
    const task = await this.repo.getTaskById(taskId);
    if (!task) {
      return { success: false, error: new Error(`Task not found: ${taskId}`) };
    }
    if (task.status !== "pending" && task.status !== "claimed") {
      return { success: false, error: new Error(`Task is ${task.status}`) };
    }

    // 权限校验
    if (userId) {
      const hasPermission = await this.checkTaskPermission(task, userId);
      if (!hasPermission) {
        return { success: false, error: new Error("无权转交此任务") };
      }
    }

    await this.repo.updateTask(taskId, {
      assignee: toUserId,
      comment: comment ?? task.comment,
    });

    return { success: true, task: { ...task, assignee: toUserId } };
  }

  /**
   * 取消流程实例
   */
  async cancelInstance(instanceId: number, reason?: string, userId?: string): Promise<ExecutionResult> {
    const instance = await this.repo.getInstanceById(instanceId);
    if (!instance) {
      return { success: false, error: new Error(`Instance not found: ${instanceId}`) };
    }
    if (instance.status !== "running") {
      return { success: false, error: new Error(`流程已${instance.status === "completed" ? "完成" : "取消"}，无法取消`) };
    }

    // 权限校验：只有发起人可以取消（或传入了 userId 的任意调用方）
    if (userId && instance.starter !== userId) {
      return { success: false, error: new Error("只有发起人才能取消此流程") };
    }

    const now = Date.now();
    await this.repo.updateInstance(instanceId, { status: "cancelled", completedAt: now });

    // 取消所有未完成的任务
    const { items: tasks } = await this.repo.listTasks({ instanceId, status: ["pending", "claimed"] });
    for (const task of tasks) {
      await this.repo.updateTask(task.id, { status: "cancelled", comment: reason });
    }

    return { success: true, instance: { ...instance, status: "cancelled", completedAt: now } };
  }

  // ===== 节点处理 =====

  private async processNode(
    instance: WorkflowInstance,
    spec: WorkflowSpec,
    node: WorkflowNode,
    options: AdvanceOptions,
  ): Promise<ExecutionResult> {
    try {
      switch (node.type) {
        case "start_event":
          return await this.handleStartEvent(instance, spec, node);
        case "end_event":
          return await this.handleEndEvent(instance);
        case "user_task":
          return await this.handleUserTask(instance, spec, node as UserTaskNode, options);
        case "service_task":
          return await this.handleServiceTask(instance, spec, node as ServiceTaskNode);
        case "exclusive_gateway":
          return await this.handleExclusiveGateway(instance, spec, node as ExclusiveGatewayNode);
        case "parallel_gateway":
          return await this.handleParallelGateway(instance, spec, node as ParallelGatewayNode);
        default:
          return { success: false, error: new Error(`Unknown node type: ${(node as WorkflowNode).type}`) };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowEngine] processNode failed for node ${node.id} (${node.type}):`, msg);
      return { success: false, error: new Error(`节点 ${node.id} 处理失败: ${msg}`) };
    }
  }

  private async handleStartEvent(instance: WorkflowInstance, spec: WorkflowSpec, node: WorkflowNode): Promise<ExecutionResult> {
    // StartEvent 直接推进到下一个节点
    if (!node.next) {
      return { success: false, error: new Error("StartEvent has no next node") };
    }
    await this.repo.updateInstance(instance.id, { currentNodeId: node.next });
    instance.currentNodeId = node.next;
    return await this.advance(instance);
  }

  private async handleEndEvent(instance: WorkflowInstance): Promise<ExecutionResult> {
    const now = Date.now();
    await this.repo.updateInstance(instance.id, { status: "completed", completedAt: now });
    return { success: true, instance: { ...instance, status: "completed", completedAt: now } };
  }

  private async handleUserTask(
    instance: WorkflowInstance,
    _spec: WorkflowSpec,
    node: UserTaskNode,
    _options: AdvanceOptions,
  ): Promise<ExecutionResult> {
    // 检查是否已有活动的任务（单人会签）或会签组任务
    const existingTask = await this.repo.getActiveTaskByInstanceAndNode(instance.id, node.id);
    if (existingTask) {
      return { success: true, instance, task: existingTask };
    }

    // 解析审批人列表
    let approvers: string[] = [];
    if (node.approvers && node.approvers.length > 0) {
      approvers = await this.resolveApprovers(instance, node.approvers);
    } else if (node.assignee) {
      approvers = [node.assignee];
    } else if (node.assigneePolicy) {
      const assignee = await this.resolveAssignee(instance, node.assigneePolicy);
      if (assignee) approvers = [assignee];
    }

    // 无审批人：创建无 assignee 的任务
    if (approvers.length === 0) {
      const task = await this.repo.createTask({
        instanceId: instance.id,
        nodeId: node.id,
        nodeName: node.name,
        taskType: "user_task",
        candidateUsers: node.candidateUsers,
        candidateGroups: node.candidateGroups,
        status: "pending",
        dueDate: node.dueDuration ? this.parseDuration(node.dueDuration) : undefined,
      });
      return { success: true, instance, task };
    }

    // 单人审批：创建单个任务
    if (approvers.length === 1 || !node.signPolicy) {
      const task = await this.repo.createTask({
        instanceId: instance.id,
        nodeId: node.id,
        nodeName: node.name,
        taskType: "user_task",
        assignee: approvers[0],
        candidateUsers: node.candidateUsers,
        candidateGroups: node.candidateGroups,
        status: "pending",
        dueDate: node.dueDuration ? this.parseDuration(node.dueDuration) : undefined,
      });
      return { success: true, instance, task };
    }

    // 多人会签：为每个审批人创建任务
    const signPolicy = node.signPolicy;
    await this.repo.setVariable(instance.id, `__sign_${node.id}`, {
      nodeId: node.id,
      total: approvers.length,
      condition: signPolicy.condition,
      minCount: signPolicy.minCount,
      completed: 0,
      approved: 0,
      rejected: 0,
    }, "json");

    const tasks: WorkflowTask[] = [];
    for (let i = 0; i < approvers.length; i++) {
      const task = await this.repo.createTask({
        instanceId: instance.id,
        nodeId: node.id,
        nodeName: node.name,
        taskType: "user_task",
        assignee: approvers[i],
        status: "pending",
        dueDate: node.dueDuration ? this.parseDuration(node.dueDuration) : undefined,
        signGroup: node.id,
      });
      tasks.push(task);
    }

    // 返回第一个任务作为代表
    return { success: true, instance, task: tasks[0] };
  }

  private async handleServiceTask(
    instance: WorkflowInstance,
    spec: WorkflowSpec,
    node: ServiceTaskNode,
  ): Promise<ExecutionResult> {
    // 创建任务记录（用于审计）
    const task = await this.repo.createTask({
      instanceId: instance.id,
      nodeId: node.id,
      nodeName: node.name,
      taskType: "service_task",
      status: "pending",
    });

    // 自动执行服务（简化版，实际应调用 Skill 或外部服务）
    try {
      console.log(`[WorkflowEngine] Executing service task: ${node.service}`, node.config);
      // TODO: 调用具体的服务实现
      // 例如：email_notification, im_bot_send 等

      await this.repo.updateTask(task.id, { status: "completed", completedAt: Date.now() });

      // 推进到下一个节点
      if (node.next) {
        await this.repo.updateInstance(instance.id, { currentNodeId: node.next });
        instance.currentNodeId = node.next;
        return await this.advance(instance);
      }

      return { success: true, instance, task: { ...task, status: "completed" } };
    } catch (error) {
      await this.repo.updateTask(task.id, { status: "cancelled", comment: String(error) });
      return { success: false, instance, task, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  private async handleExclusiveGateway(
    instance: WorkflowInstance,
    spec: WorkflowSpec,
    node: ExclusiveGatewayNode,
  ): Promise<ExecutionResult> {
    const context: GuardContext = {
      variables: instance.variables,
      instance,
    };

    // 按顺序评估条件，第一个匹配的胜出
    for (const condition of node.conditions) {
      if (this.guardEngine.evaluate(condition.expression, context)) {
        await this.repo.updateInstance(instance.id, { currentNodeId: condition.next });
        instance.currentNodeId = condition.next;
        return await this.advance(instance);
      }
    }

    return { success: false, error: new Error(`No matching condition in gateway: ${node.id}`) };
  }

  private async handleParallelGateway(
    instance: WorkflowInstance,
    spec: WorkflowSpec,
    node: ParallelGatewayNode,
  ): Promise<ExecutionResult> {
    if (node.mode === "split") {
      // 并行分裂：为每个分支创建子流程（简化版：串行执行）
      // TODO: 真正的并行需要更复杂的实现
      if (node.branches && node.branches.length > 0) {
        const firstBranch = node.branches[0];
        await this.repo.updateInstance(instance.id, { currentNodeId: firstBranch });
        instance.currentNodeId = firstBranch;
        return await this.advance(instance);
      }
    }

    // join 模式或没有分支：直接推进到下一个节点
    if (node.next) {
      await this.repo.updateInstance(instance.id, { currentNodeId: node.next });
      instance.currentNodeId = node.next;
      return await this.advance(instance);
    }

    return { success: false, error: new Error(`ParallelGateway has no next node: ${node.id}`) };
  }

  // ===== 会签辅助方法 =====

  private checkSignCondition(
    signState: { total: number; condition: string; minCount?: number; completed: number; approved: number; rejected: number },
    action?: string,
  ): boolean {
    switch (signState.condition) {
      case "any":
        // 任一通过即满足（但 reject 不满足）
        return action !== "reject";
      case "all":
        // 全部完成且全部通过
        return signState.completed >= signState.total && signState.approved >= signState.total;
      case "majority":
        // 通过数达到最少通过数
        return signState.approved >= (signState.minCount ?? Math.ceil(signState.total / 2));
      default:
        return signState.completed >= signState.total;
    }
  }

  private async cancelSignGroupTasks(instanceId: number, signGroup: string, excludeTaskId: number): Promise<void> {
    const tasks = await this.repo.listTasks({ instanceId, status: "pending" });
    for (const t of tasks.items) {
      if (t.signGroup === signGroup && t.id !== excludeTaskId && t.status === "pending") {
        await this.repo.updateTask(t.id, { status: "cancelled", comment: "会签已通过，自动取消" });
      }
    }
  }

  /**
   * 检查用户是否有权限操作任务
   */
  private async checkTaskPermission(task: WorkflowTask, userId: string): Promise<boolean> {
    // 如果是 assignee，直接有权限
    if (task.assignee === userId) return true;
    // 如果没有设置任何 candidate 限制且未分配，允许任何人操作
    const hasCandidates = (task.candidateUsers && task.candidateUsers.length > 0) ||
                          (task.candidateGroups && task.candidateGroups.length > 0);
    if (!hasCandidates && !task.assignee) return true;
    // 检查 candidateUsers
    if (task.candidateUsers?.includes(userId)) return true;
    // 检查 candidateGroups（查询用户的角色）
    if (task.candidateGroups && task.candidateGroups.length > 0) {
      const userRoles = await getUserRoles(userId);
      const userRoleIds = new Set(userRoles.map((r) => r.id));
      const userRoleNames = new Set(userRoles.map((r) => r.name));
      if (task.candidateGroups.some((g) => userRoleIds.has(g) || userRoleNames.has(g))) {
        return true;
      }
    }
    return false;
  }

  // ===== 发起人限制检查 =====

  async checkStarterConstraint(starterId: string, constraint: StarterConstraint): Promise<boolean> {
    switch (constraint.type) {
      case "role": {
        const roles = await getUserRoles(starterId);
        return roles.some((r) => r.id === constraint.value || r.name === constraint.value);
      }
      case "department": {
        const user = await getUserById(starterId);
        return user?.departmentId === constraint.value;
      }
      default:
        return true;
    }
  }

  async filterAvailableDefinitions(
    definitions: WorkflowDefinition[],
    starterId: string,
  ): Promise<WorkflowDefinition[]> {
    const result: WorkflowDefinition[] = [];
    for (const def of definitions) {
      const constraints = def.definition.starterConstraints;
      if (!constraints || constraints.length === 0) {
        result.push(def);
        continue;
      }
      let passed = true;
      for (const constraint of constraints) {
        const ok = await this.checkStarterConstraint(starterId, constraint);
        if (!ok) {
          passed = false;
          break;
        }
      }
      if (passed) result.push(def);
    }
    return result;
  }

  // ===== 辅助方法 =====

  // ===== 审批人解析引擎 =====

  /**
   * 解析审批人配置，返回用户 ID 列表（支持多人）
   */
  private async resolveApprovers(instance: WorkflowInstance, configs: ApproverConfig[]): Promise<string[]> {
    const approvers = new Set<string>();
    for (const config of configs) {
      const users = await this.resolveApproverConfig(instance, config);
      users.forEach((u) => approvers.add(u));
    }
    return Array.from(approvers);
  }

  private async resolveApproverConfig(instance: WorkflowInstance, config: ApproverConfig): Promise<string[]> {
    switch (config.type) {
      case "user":
        return config.value ? [config.value] : [];
      case "starter":
        return instance.starter ? [instance.starter] : [];
      case "starter_manager": {
        if (!instance.starter) return [];
        const starter = await getUserById(instance.starter);
        if (!starter?.departmentId) return [];
        const manager = await this.findDeptManager(starter.departmentId);
        return manager ? [manager] : [];
      }
      case "starter_director": {
        if (!instance.starter) return [];
        const starter = await getUserById(instance.starter);
        if (!starter?.departmentId) return [];
        const director = await this.findDeptDirector(starter.departmentId);
        return director ? [director] : [];
      }
      case "role": {
        if (!config.value) return [];
        const users = await getUsersByRole(config.value);
        return users.map((u) => u.id);
      }
      case "role_dept": {
        if (!config.value || !config.deptId) return [];
        const users = await getUsersByRole(config.value);
        return users.filter((u) => u.departmentId === config.deptId).map((u) => u.id);
      }
      case "expression": {
        if (!config.value) return [];
        // 直接做变量替换，不求值为 boolean
        const exprStr = String(config.value);
        const expanded = exprStr.replace(/\$\{([^}]+)\}/g, (_match, path: string) => {
          const parts = path.split(".");
          let current: unknown = instance.variables;
          for (const part of parts) {
            if (current === null || current === undefined) return "";
            current = (current as Record<string, unknown>)[part];
          }
          return current !== undefined && current !== null ? String(current) : "";
        });
        return expanded ? [expanded] : [];
      }
      default:
        return [];
    }
  }

  private async findDeptManager(deptId: string): Promise<string | undefined> {
    // 简化实现：查询部门中第一个拥有 manager 相关角色的用户
    const users = await getUsersByDepartment(deptId);
    for (const user of users) {
      const roles = await getUserRoles(user.id);
      if (roles.some((r) => r.name.toLowerCase().includes("manager") || r.name.includes("经理"))) {
        return user.id;
      }
    }
    return users[0]?.id ?? undefined;
  }

  private async findDeptDirector(deptId: string): Promise<string | undefined> {
    // 简化实现：查询上级部门中第一个拥有 manager 相关角色的用户
    const { getDepartmentById } = await import("../db/department-repository.js");
    const dept = await getDepartmentById(deptId);
    if (!dept?.parentId) {
      return this.findDeptManager(deptId);
    }
    const parentUsers = await getUsersByDepartment(dept.parentId);
    for (const user of parentUsers) {
      const roles = await getUserRoles(user.id);
      if (roles.some((r) => r.name.toLowerCase().includes("director") || r.name.includes("总监") || r.name.includes("主管"))) {
        return user.id;
      }
    }
    return parentUsers[0]?.id ?? this.findDeptManager(deptId);
  }

  /** 兼容旧策略：assigneePolicy 字符串 */
  private async resolveAssignee(instance: WorkflowInstance, policy: string | unknown): Promise<string | undefined> {
    const policyStr = typeof policy === "string" ? policy : String(policy ?? "");
    if (!policyStr) return undefined;
    const parts = policyStr.split(".");
    if (parts[0] === "starter") {
      const starterVar = await this.repo.getVariable(instance.id, "starter") as { id?: string; manager?: string; director?: string } | undefined;
      if (!starterVar) return instance.starter ?? undefined;
      if (parts.length === 1) return starterVar.id ?? instance.starter ?? undefined;
      if (parts[1] === "manager") return starterVar.manager;
      if (parts[1] === "director") return starterVar.director;
    }
    return policyStr;
  }

  private parseDuration(duration: string | number | unknown): number {
    // 防御性处理：确保是字符串
    const durationStr = typeof duration === "string" ? duration : String(duration ?? "");
    if (!durationStr) return Date.now() + 24 * 60 * 60 * 1000;

    // 简化 ISO 8601 duration 解析：PT2H, PT30M, P1D
    const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
      // 尝试 P1D 格式
      const dayMatch = durationStr.match(/P(\d+)D/);
      if (dayMatch) return Date.now() + parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
      return Date.now() + 24 * 60 * 60 * 1000; // 默认 1 天
    }
    const hours = parseInt(match[1] ?? "0") * 60 * 60 * 1000;
    const minutes = parseInt(match[2] ?? "0") * 60 * 1000;
    const seconds = parseInt(match[3] ?? "0") * 1000;
    return Date.now() + hours + minutes + seconds;
  }
}

/**
 * 获取任务的表单定义
 * 优先使用 formDefinitionId 引用表单中心的定义，fallback 到内嵌 form
 */
export async function getTaskFormSchema(task: WorkflowTask, workflowSpec: WorkflowSpec): Promise<any | null> {
  const node = workflowSpec.nodes.find((n) => n.id === task.nodeId);
  if (!node || node.type !== "user_task") {
    return null;
  }

  const userTaskNode = node as UserTaskNode;

  // 优先使用 formDefinitionId 引用
  if (userTaskNode.formDefinitionId) {
    const formDef = await getFormDefinition(userTaskNode.formDefinitionId);
    if (formDef) {
      return {
        schema: formDef.schema_json,
        fieldPermissions: userTaskNode.formFieldPermissions,
        source: "form_center",
        formId: formDef.id,
      };
    }
  }

  // Fallback 到内嵌 form
  if (userTaskNode.form) {
    return {
      schema: userTaskNode.form,
      fieldPermissions: userTaskNode.formFieldPermissions,
      source: "inline",
    };
  }

  return null;
}

// ===== 单例 =====

let engineInstance: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
  if (!engineInstance) {
    engineInstance = new WorkflowEngine();
  }
  return engineInstance;
}
