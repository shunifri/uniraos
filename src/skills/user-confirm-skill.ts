/**
 * user_confirm Skill — 请求用户在前端交互确认
 *
 * AI 调用此 Skill 时会暂停对话，在前端显示交互卡片（单选/多选/表单/审批）。
 * 用户操作后，结果作为 tool result 注入回对话。
 */
import { defineSkill, Autonomy } from "../types/index.js";
import { PendingConfirmRepository } from "../db/pending-confirm-repository.js";
import { requestContext } from "../user/request-context.js";

function convertFieldsToSchema(
  fields: any[],
  title?: string,
  description?: string,
  confirmText?: string,
  cancelText?: string
): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  const widgetMap: Record<string, string> = {
    text: "input",
    number: "number",
    select: "select",
    radio: "radio",
    checkbox: "checkbox",
    textarea: "textarea",
    date: "datePicker",
  };

  for (const field of fields) {
    properties[field.key] = {
      type: field.type === "number" ? "number" : field.type === "checkbox" ? "array" : "string",
      title: field.label || field.key,
      "ui:widget": widgetMap[field.type] || "input",
      required: field.required,
    };

    if (field.required) required.push(field.key);

    if (field.placeholder) {
      properties[field.key]["ui:placeholder"] = field.placeholder;
    }

    if (field.defaultValue !== undefined) {
      properties[field.key].default = field.defaultValue;
    }

    if (field.options) {
      properties[field.key]["x-dataSource"] = {
        type: "static",
        options: field.options.map((opt: any) => ({
          label: opt.label,
          value: opt.id,
        })),
      };
    }

    // 默认使用卡片式/选项式变体，交互更轻便
    const uiProps: Record<string, any> = {};
    if (field.type === "radio") {
      uiProps.variant = "segmented";
    } else if (field.type === "checkbox") {
      uiProps.variant = "tag";
    } else if (field.type === "select") {
      uiProps.variant = "segmented";
    }
    if (Object.keys(uiProps).length > 0) {
      properties[field.key]["ui:props"] = uiProps;
    }
  }

  return {
    type: "object",
    title,
    description,
    properties,
    required,
    actions: [
      { type: "submit", label: confirmText ?? "确定", primary: true },
      { type: "cancel", label: cancelText ?? "取消" },
    ],
  };
}

// 全局确认队列：confirmId → { resolve, reject, timeout? }
export const confirmQueue = new Map<string, {
  resolve: (response: unknown) => void;
  reject: (err: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}>();

export function createUserConfirmSkill() {
  return defineSkill({
    name: "user_confirm",
    visible: true,
    autonomy: Autonomy.GUARDIAN,
    description: `人机交互确认 — 当需要用户做出选择、填写信息或确认操作时调用此工具。调用后前端会显示交互卡片，暂停对话等待用户操作，用户操作结果会作为 tool result 返回继续对话。

适用场景（包括但不限于）：
- 需要用户从多个选项中选择（如选专业、选方案、选时间）
- 需要用户填写表单信息（如个人信息、需求描述、配置参数）
- 需要用户确认操作（如是否删除、是否提交、是否继续）
- 需要用户审批决策（如同意/驳回某个方案）
- 任何需要暂停对话、等待用户交互后再继续的场景

不要直接在回答文本中列出问题让用户回复，而是调用此工具生成交互卡片。

模式：
- selection：选项卡片（单选/多选），适合让用户从预设选项中选择
- form：表单，适合收集多个字段的信息
- approval：确认/取消，适合简单的二元确认

参数:
  type("selection"|"form"|"approval"): 交互类型
  title(string): 卡片标题
  description?(string): 补充说明
  options?(array): 选项列表（selection），每项 { id, label, description? }
  multiSelect?(boolean): 是否多选（默认 false）
  fields?(array): 表单字段（form 简化模式），每项 { key, label, type, required?, options?, placeholder?, defaultValue? }
    type: "text"|"number"|"select"|"radio"|"checkbox"|"textarea"|"date"
  formKey?(string): 应用表单标识（form 自动加载模式，推荐）。
    传入 formKey 时，系统自动从 form_definitions 表加载对应的 RaosFormSchema，与主站渲染完全一致。
    适用优先级：schema > formKey > fields。
  schema?(object): 表单 Schema（form 高级模式，RaosFormSchema 格式，与主站表单引擎对齐）。
    传入 schema 时优先使用 schema，fields 将被忽略。
  confirmText?(string): 确认按钮文字（默认"确定"）
  cancelText?(string): 取消按钮文字（默认"取消"）`,
    paramSchema: {
      properties: {
        type: { type: "string", description: "交互类型", enum: ["selection", "form", "approval"] },
        title: { type: "string", description: "卡片标题" },
        description: { type: "string", description: "补充说明" },
        options: {
          type: "array",
          description: "选项列表 [{id, label, description?}]",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "选项ID" },
              label: { type: "string", description: "选项文字" },
              description: { type: "string", description: "选项详细说明" }
            }
          }
        },
        multiSelect: { type: "boolean", description: "是否多选" },
        fields: {
          type: "array",
          description: "表单字段 [{key, label, type, required?, options?, placeholder?}]（简化模式）",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "字段名" },
              label: { type: "string", description: "字段标签" },
              type: { type: "string", description: "字段类型", enum: ["text", "number", "select", "radio", "checkbox", "textarea", "date"] },
              required: { type: "boolean", description: "是否必填" },
              options: { type: "array", description: "下拉/单选选项 [{id, label}]", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } } } },
              placeholder: { type: "string", description: "占位文字" },
              defaultValue: { type: "string", description: "默认值" }
            }
          }
        },
        formKey: { type: "string", description: "应用表单标识，自动从 form_definitions 表加载 schema" },
        schema: { type: "object", description: "表单 Schema（RaosFormSchema 格式，与主站对齐，优先于 fields/formKey）" },
        confirmText: { type: "string", description: "确认按钮文字" },
        cancelText: { type: "string", description: "取消按钮文字" },
      },
      required: ["type", "title"],
    },
    timeout: 86400000, // 24 小时等待用户（几乎永不过期）
    handler: async (params) => {
      const confirmId = crypto.randomUUID().slice(0, 12);
      const ctx = requestContext.getStore();
      const conversationId = ctx?.conversationId ?? "";
      const userId = ctx?.userId ?? "default";

      if (params.type === "form") {
        // 优先使用传入的 schema（RaosFormSchema 格式，与主站表单引擎对齐）
        // 其次使用 formKey 自动从 form_definitions 表加载 schema
        // 最后回退到 fields 简化模式
        let schema: any;
        if (params.schema) {
          schema = { ...(params.schema as any) };
          // 智能合并 actions：保留 schema 中原有的 actions 结构，只更新 submit/cancel 的 label
          const existingActions = schema.actions as any[] | undefined;
          if (existingActions && existingActions.length > 0) {
            schema.actions = existingActions.map((a: any) => {
              if (a.type === "submit") return { ...a, label: params.confirmText ?? a.label ?? "确定" };
              if (a.type === "cancel") return { ...a, label: params.cancelText ?? a.label ?? "取消" };
              return a;
            });
          } else {
            schema.actions = [
              { type: "submit", label: params.confirmText ?? "确定", primary: true },
              { type: "cancel", label: params.cancelText ?? "取消" },
            ];
          }
        } else if (params.formKey) {
          // 从 form_definitions 表加载应用表单 schema
          const { getFormDefinitionByKey } = await import("../services/form-service.js");
          const formDef = await getFormDefinitionByKey(params.formKey as string);
          if (formDef?.schema_json) {
            schema = { ...(formDef.schema_json as any) };
            // 使用 form 定义中的 name/description 作为标题（如果未传入）
            if (!params.title && formDef.name) {
              params.title = formDef.name;
            }
            if (!params.description && formDef.description) {
              params.description = formDef.description;
            }
            // 合并 actions
            const existingActions = schema.actions as any[] | undefined;
            if (existingActions && existingActions.length > 0) {
              schema.actions = existingActions.map((a: any) => {
                if (a.type === "submit") return { ...a, label: params.confirmText ?? a.label ?? "确定" };
                if (a.type === "cancel") return { ...a, label: params.cancelText ?? a.label ?? "取消" };
                return a;
              });
            } else {
              schema.actions = [
                { type: "submit", label: params.confirmText ?? "确定", primary: true },
                { type: "cancel", label: params.cancelText ?? "取消" },
              ];
            }
          } else {
            return { success: false, error: new Error(`表单定义不存在: ${params.formKey}`) };
          }
        } else {
          schema = convertFieldsToSchema(
            (params.fields as any[]) ?? [],
            params.title as string,
            params.description as string,
            params.confirmText as string,
            params.cancelText as string
          );
        }
        const confirmData = {
          __formRender: true,
          __userConfirm: true,
          confirmId,
          type: params.type,
          title: params.title,
          description: params.description,
          schema,
          fields: params.fields as any[],
          formKey: params.formKey as string | undefined,
          appId: ctx?.appId as string | undefined,
          confirmText: params.confirmText ?? "确定",
          cancelText: params.cancelText ?? "取消",
        };
        // 持久化到数据库，支持刷新/重启后恢复
        try {
          const repo = PendingConfirmRepository.getInstance();
          await repo.create({
            confirmId,
            conversationId,
            userId,
            confirmData,
            status: "pending",
          });
        } catch (err) {
          console.warn("[user_confirm] 持久化 pending confirm 失败:", err);
        }
        return { success: true, data: confirmData };
      }

      const confirmData = {
        __userConfirm: true,
        confirmId,
        type: params.type,
        title: params.title,
        description: params.description,
        options: params.options,
        multiSelect: params.multiSelect ?? false,
        fields: params.fields,
        appId: ctx?.appId as string | undefined,
        confirmText: params.confirmText ?? "确定",
        cancelText: params.cancelText ?? "取消",
      };
      // 持久化到数据库，支持刷新/重启后恢复
      try {
        const repo = PendingConfirmRepository.getInstance();
        await repo.create({
          confirmId,
          conversationId,
          userId,
          confirmData,
          status: "pending",
        });
      } catch (err) {
        console.warn("[user_confirm] 持久化 pending confirm 失败:", err);
      }
      return { success: true, data: confirmData };
    },
  });
}
