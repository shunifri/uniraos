/**
 * RAOS Form Engine - DynamicForm
 *
 * 对外暴露的表单封装组件，提供 Card 包裹、描述文本和操作按钮区域。
 */

import React from "react";
import { Card, Button, Space } from "antd";
import { FormRenderer } from "./form-engine/core/FormRenderer";
import type { RaosFormSchema, FormAction } from "./form-engine/types";

export interface DynamicFormProps {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  onChange?: (formData: Record<string, any>) => void;
  onSubmit?: (formData: Record<string, any>) => void;
  onReset?: () => void;
  onCancel?: () => void;
  loading?: boolean;
  embedded?: boolean;
}

const defaultActions: FormAction[] = [
  { type: "submit", label: "提交", primary: true },
];

function getButtonType(action: FormAction): "primary" | "dashed" | "default" {
  if (action.type === "saveDraft") return "dashed";
  if (action.primary) return "primary";
  return "default";
}

const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  initialData,
  readOnly,
  onChange,
  onSubmit,
  onReset,
  onCancel,
  loading,
  embedded,
}) => {
  const actions = schema.actions ?? defaultActions;

  const handleActionClick = (action: FormAction) => {
    // submit 类型按钮已设置 htmlType="submit"，点击会自动提交所在表单
    // 避免使用 document.querySelector("form")，它在多表单场景会选中错误的表单
    if (action.type === "reset") {
      onReset?.();
    } else if (action.type === "cancel") {
      onCancel?.();
    } else if (action.type === "custom" && action.onClick) {
      // 自定义 action 支持 expr: 表达式（简单沙箱执行）
      try {
        const expr = action.onClick.replace(/^expr:/, "");
        const fn = new Function("Math", "String", "Number", "Date", "Array", "Object", "JSON", `"use strict"; return (${expr});`);
        fn(Math, String, Number, Date, Array, Object, JSON);
      } catch (e) {
        console.error("Custom action error:", e);
      }
    }
  };

  const formContent = (
    <>
      {schema.description && (
        <div style={{ marginBottom: 16 }}>{schema.description}</div>
      )}

      <FormRenderer
        schema={schema}
        initialData={initialData}
        readOnly={readOnly}
        onChange={onChange}
        onSubmit={onSubmit}
      >
        {!readOnly && (
          <Space style={{ marginTop: 16 }}>
            {actions.map((action, index) => (
              <Button
                key={`${action.type}-${index}`}
                type={getButtonType(action)}
                danger={action.danger}
                htmlType={action.type === "submit" ? "submit" : undefined}
                loading={action.type === "submit" ? loading : undefined}
                onClick={() => handleActionClick(action)}
              >
                {action.label}
              </Button>
            ))}
          </Space>
        )}
      </FormRenderer>
    </>
  );

  if (embedded) {
    return formContent;
  }

  return (
    <Card title={schema.title} className="dynamic-form">
      {formContent}
    </Card>
  );
};

export default DynamicForm;
