/**
 * Workflow Engine Lite — 内置审批模板
 *
 * 提供开箱即用的常用审批流程模板
 */

import type { WorkflowTemplate } from "./types.js";

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "expense_approval",
    name: "报销审批",
    category: "finance",
    description: "员工费用报销审批流程，支持多级审批和金额阈值控制",
    spec: {
      key: "expense_approval",
      name: "报销审批",
      nodes: [
        { id: "start", type: "start_event", next: "fill_form" },
        {
          id: "fill_form",
          type: "user_task",
          name: "填写报销单",
          form: {
            fields: [
              { key: "amount", label: "报销金额", type: "number", required: true, validation: [{ type: "min", value: 0.01, message: "金额必须大于0" }] },
              { key: "category", label: "费用类别", type: "select", required: true, options: [{ id: "travel", label: "差旅费" }, { id: "office", label: "办公费" }, { id: "entertainment", label: "招待费" }, { id: "other", label: "其他" }] },
              { key: "description", label: "费用说明", type: "textarea", required: true, placeholder: "请描述费用用途" },
              { key: "attachments", label: "发票附件", type: "file", required: true },
            ],
          },
          next: "manager_approval",
        },
        {
          id: "manager_approval",
          type: "user_task",
          name: "直属经理审批",
          assigneePolicy: "starter.manager",
          actions: ["approve", "reject", "transfer"],
          dueDuration: "PT24H",
          next: "check_amount",
        },
        {
          id: "check_amount",
          type: "exclusive_gateway",
          name: "金额检查",
          conditions: [
            { name: "大额", expression: "${amount} >= 5000", next: "director_approval" },
            { name: "普通", expression: "default", next: "notify_approved" },
          ],
        },
        {
          id: "director_approval",
          type: "user_task",
          name: "财务总监审批",
          assigneePolicy: "starter.director",
          actions: ["approve", "reject"],
          dueDuration: "PT48H",
          next: "notify_approved",
        },
        {
          id: "notify_approved",
          type: "service_task",
          name: "通知审批通过",
          service: "email_notification",
          config: { template: "expense_approved", to: "${starter.email}" },
          next: "end",
        },
        { id: "end", type: "end_event", name: "结束" },
      ],
    },
  },

  {
    key: "leave_approval",
    name: "请假审批",
    category: "hr",
    description: "员工请假审批流程，支持按请假类型和天数自动路由",
    spec: {
      key: "leave_approval",
      name: "请假审批",
      nodes: [
        { id: "start", type: "start_event", next: "fill_form" },
        {
          id: "fill_form",
          type: "user_task",
          name: "填写请假申请",
          form: {
            fields: [
              { key: "leave_type", label: "请假类型", type: "select", required: true, options: [{ id: "annual", label: "年假" }, { id: "sick", label: "病假" }, { id: "personal", label: "事假" }, { id: "marriage", label: "婚假" }, { id: "maternity", label: "产假" }] },
              { key: "start_date", label: "开始日期", type: "date", required: true },
              { key: "end_date", label: "结束日期", type: "date", required: true },
              { key: "days", label: "请假天数", type: "number", required: true },
              { key: "reason", label: "请假原因", type: "textarea", required: true },
              { key: "handover", label: "工作交接人", type: "user" },
            ],
          },
          next: "check_type",
        },
        {
          id: "check_type",
          type: "exclusive_gateway",
          name: "类型检查",
          conditions: [
            { name: "病假", expression: "${leave_type} == 'sick'", next: "manager_approval" },
            { name: "3天以上", expression: "${days} >= 3", next: "director_approval" },
            { name: "普通", expression: "default", next: "manager_approval" },
          ],
        },
        {
          id: "manager_approval",
          type: "user_task",
          name: "直属经理审批",
          assigneePolicy: "starter.manager",
          actions: ["approve", "reject", "return"],
          dueDuration: "PT24H",
          next: "check_director",
        },
        {
          id: "check_director",
          type: "exclusive_gateway",
          name: "是否需要总监审批",
          conditions: [
            { name: "需要", expression: "${days} >= 5", next: "director_approval" },
            { name: "不需要", expression: "default", next: "notify_approved" },
          ],
        },
        {
          id: "director_approval",
          type: "user_task",
          name: "总监审批",
          assigneePolicy: "starter.director",
          actions: ["approve", "reject", "return"],
          dueDuration: "PT48H",
          next: "notify_approved",
        },
        {
          id: "notify_approved",
          type: "service_task",
          name: "通知审批结果",
          service: "email_notification",
          config: { template: "leave_approved" },
          next: "end",
        },
        { id: "end", type: "end_event", name: "结束" },
      ],
    },
  },

  {
    key: "procurement_approval",
    name: "采购审批",
    category: "finance",
    description: "物资采购审批流程，按金额自动路由到不同层级审批人",
    spec: {
      key: "procurement_approval",
      name: "采购审批",
      nodes: [
        { id: "start", type: "start_event", next: "fill_form" },
        {
          id: "fill_form",
          type: "user_task",
          name: "填写采购申请",
          form: {
            fields: [
              { key: "item_name", label: "物品名称", type: "text", required: true },
              { key: "quantity", label: "数量", type: "number", required: true },
              { key: "unit_price", label: "单价", type: "number", required: true },
              { key: "total_amount", label: "总金额", type: "number", required: true },
              { key: "vendor", label: "供应商", type: "text" },
              { key: "reason", label: "采购理由", type: "textarea", required: true },
            ],
          },
          next: "manager_approval",
        },
        {
          id: "manager_approval",
          type: "user_task",
          name: "部门经理审批",
          assigneePolicy: "starter.manager",
          actions: ["approve", "reject", "return"],
          next: "check_amount",
        },
        {
          id: "check_amount",
          type: "exclusive_gateway",
          name: "金额路由",
          conditions: [
            { name: "小额", expression: "${total_amount} < 10000", next: "notify_approved" },
            { name: "中额", expression: "${total_amount} < 50000", next: "director_approval" },
            { name: "大额", expression: "default", next: "cfo_approval" },
          ],
        },
        {
          id: "director_approval",
          type: "user_task",
          name: "总监审批",
          assigneePolicy: "starter.director",
          actions: ["approve", "reject"],
          dueDuration: "PT48H",
          next: "notify_approved",
        },
        {
          id: "cfo_approval",
          type: "user_task",
          name: "财务总监审批",
          assigneePolicy: "cfo",
          actions: ["approve", "reject"],
          dueDuration: "P3D",
          next: "notify_approved",
        },
        {
          id: "notify_approved",
          type: "service_task",
          name: "通知采购结果",
          service: "email_notification",
          config: { template: "procurement_approved" },
          next: "end",
        },
        { id: "end", type: "end_event", name: "结束" },
      ],
    },
  },

  {
    key: "it_request",
    name: "IT 服务申请",
    category: "it",
    description: "IT 设备、账号、权限等服务申请流程",
    spec: {
      key: "it_request",
      name: "IT 服务申请",
      nodes: [
        { id: "start", type: "start_event", next: "fill_form" },
        {
          id: "fill_form",
          type: "user_task",
          name: "填写 IT 申请",
          form: {
            fields: [
              { key: "request_type", label: "申请类型", type: "select", required: true, options: [{ id: "device", label: "设备申请" }, { id: "account", label: "账号申请" }, { id: "permission", label: "权限申请" }, { id: "repair", label: "故障报修" }] },
              { key: "detail", label: "申请详情", type: "textarea", required: true },
              { key: "urgency", label: "紧急程度", type: "select", required: true, options: [{ id: "low", label: "低" }, { id: "normal", label: "中" }, { id: "high", label: "高" }, { id: "urgent", label: "紧急" }] },
            ],
          },
          next: "manager_approval",
        },
        {
          id: "manager_approval",
          type: "user_task",
          name: "直属经理审批",
          assigneePolicy: "starter.manager",
          actions: ["approve", "reject"],
          next: "it_handle",
        },
        {
          id: "it_handle",
          type: "user_task",
          name: "IT 处理",
          assignee: "it_admin",
          actions: ["approve", "reject"],
          dueDuration: "PT24H",
          next: "notify_result",
        },
        {
          id: "notify_result",
          type: "service_task",
          name: "通知处理结果",
          service: "email_notification",
          config: { template: "it_request_completed" },
          next: "end",
        },
        { id: "end", type: "end_event", name: "结束" },
      ],
    },
  },
];

/**
 * 根据 key 获取内置模板
 */
export function getBuiltinTemplate(key: string): WorkflowTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.key === key);
}

/**
 * 获取所有内置模板
 */
export function listBuiltinTemplates(category?: string): WorkflowTemplate[] {
  if (category) {
    return BUILTIN_TEMPLATES.filter((t) => t.category === category);
  }
  return BUILTIN_TEMPLATES;
}
