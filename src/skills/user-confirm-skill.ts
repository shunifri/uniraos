/**
 * user_confirm Skill — 请求用户在前端交互确认
 *
 * AI 调用此 Skill 时会暂停对话，在前端显示交互卡片（单选/多选/表单/审批）。
 * 用户操作后，结果作为 tool result 注入回对话。
 */
import { defineSkill, Autonomy } from "../types/index.js";

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
      type: field.type === "number" ? "number" : "string",
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

// 全局确认队列：confirmId → { resolve, reject, timeout }
export const confirmQueue = new Map<string, {
  resolve: (response: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

export function createUserConfirmSkill() {
  return defineSkill({
    name: "user_confirm",
    visible: true,
    autonomy: Autonomy.GUARDIAN,
    description: `请求用户确认或输入信息。调用后在前端显示交互卡片，暂停对话等待用户操作。

模式：
- selection：选项卡片（单选/多选）
- form：表单（仅用于自由文本输入，如姓名、地址）
- approval：确认/取消

参数:
  type("selection"|"form"|"approval"): 交互类型
  title(string): 卡片标题
  description?(string): 补充说明
  options?(array): 选项列表（selection），每项 { id, label, description? }
  multiSelect?(boolean): 是否多选（默认 false）
  fields?(array): 表单字段（form），每项 { key, label, type, required?, options?, placeholder?, defaultValue? }
    type: "text"|"number"|"select"|"radio"|"checkbox"|"textarea"|"date"
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
          description: "表单字段 [{key, label, type, required?, options?, placeholder?}]",
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
        confirmText: { type: "string", description: "确认按钮文字" },
        cancelText: { type: "string", description: "取消按钮文字" },
      },
      required: ["type", "title"],
    },
    timeout: 600000, // 10 分钟等待用户
    handler: async (params) => {
      const confirmId = crypto.randomUUID().slice(0, 12);

      if (params.type === "form") {
        return {
          success: true,
          data: {
            __formRender: true,
            __userConfirm: true,
            confirmId,
            type: params.type,
            title: params.title,
            description: params.description,
            schema: convertFieldsToSchema(
              params.fields ?? [],
              params.title,
              params.description,
              params.confirmText,
              params.cancelText
            ),
            fields: params.fields,
            confirmText: params.confirmText ?? "确定",
            cancelText: params.cancelText ?? "取消",
          },
        };
      }

      return {
        success: true,
        data: {
          __userConfirm: true,
          confirmId,
          type: params.type,
          title: params.title,
          description: params.description,
          options: params.options,
          multiSelect: params.multiSelect ?? false,
          fields: params.fields,
          confirmText: params.confirmText ?? "确定",
          cancelText: params.cancelText ?? "取消",
        },
      };
    },
  });
}
