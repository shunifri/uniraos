/**
 * Workflow Adapter — 将 Workflow 事件转换为 InboxItem
 */

import type { InboxItem, CreateInboxItemInput } from "../inbox-types.js";
import { getFormDefinition, getFormDefinitionByKey } from "../../services/form-service.js";

export interface WorkflowAdapter {
  toInboxItem(task: any, node: any, instance: any): Promise<CreateInboxItemInput>;
}

export function createWorkflowAdapter(): WorkflowAdapter {
  return {
    async toInboxItem(task: any, node: any, instance: any): Promise<CreateInboxItemInput> {
      // 优先从 formDefinitionId 加载表单定义，fallback 到内嵌 form
      let schema = node.form;
      if (!schema && node.formDefinitionId) {
        let formDef = await getFormDefinition(node.formDefinitionId);
        if (!formDef) {
          formDef = await getFormDefinitionByKey(node.formDefinitionId);
        }
        if (formDef && formDef.schema_json) {
          schema = typeof formDef.schema_json === "string" ? JSON.parse(formDef.schema_json) : formDef.schema_json;
        }
      }

      return {
        userId: task.assignee || task.candidateUsers?.[0] || "system",
        type: "approval",
        category: "workflow_task",
        source: "workflow",
        sourceId: String(task.id),
        title: node.name || node.id || "审批任务",
        description: instance.name || "",
        priority: node.dueDuration ? "high" : "normal",
        payload: {
          schema,
          actions: node.actions || [
            { action: "approve", label: "通过", primary: true },
            { action: "reject", label: "驳回", danger: true },
            { action: "transfer", label: "转交" },
          ],
          metadata: {
            instanceId: instance.id,
            nodeId: node.id,
            taskId: task.id,
          },
        },
        dueAt: task.dueDate ? new Date(task.dueDate).getTime() : undefined,
      };
    },
  };
}
