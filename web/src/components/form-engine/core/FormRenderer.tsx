/**
 * RAOS Form Engine - FormRenderer
 *
 * 核心表单渲染器，集成 Zustand 状态管理、验证引擎和联动引擎。
 */

import React, { useRef, useEffect, useReducer, useCallback } from "react";
import { Form, Row, Col } from "antd";
import type { RaosFormSchema, RaosFieldSchema, FieldState } from "../types";
import { getComponent } from "../registry/componentRegistry";
import { createFormStore, type FormStoreState } from "../store/useFormStore";
import { evaluateLinkage, findDependentFields } from "./LinkageEngine";
import { validateField } from "./ValidationEngine";

// ───────────────────────────────────────────────────────────────
// Props 接口
// ───────────────────────────────────────────────────────────────

export interface FormRendererProps {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  onChange?: (formData: Record<string, any>) => void;
  onSubmit?: (formData: Record<string, any>) => void;
}

// ───────────────────────────────────────────────────────────────
// 联动辅助函数
// ───────────────────────────────────────────────────────────────

function applyLinkageToAllFields(
  store: ReturnType<typeof createFormStore>,
  schema: RaosFormSchema
) {
  for (const [name, fieldSchema] of Object.entries(schema.properties)) {
    applyLinkageToField(store, name, fieldSchema);
  }
}

function applyLinkageToField(
  store: ReturnType<typeof createFormStore>,
  name: string,
  fieldSchema: RaosFieldSchema
) {
  const rules = fieldSchema["x-linkage"];
  if (!rules) return;
  const result = evaluateLinkage(rules, store.getState().formData);
  store.getState().setFieldState(name, {
    visible: result.visible,
    disabled: result.disabled,
    readonly: result.readonly,
    required: result.required,
  });
  if (result.value !== undefined) {
    store.getState().setFieldValue(name, result.value);
  }
}

// ───────────────────────────────────────────────────────────────
// FormRenderer 组件
// ───────────────────────────────────────────────────────────────

export const FormRenderer: React.FC<FormRendererProps> = ({
  schema,
  initialData,
  readOnly = false,
  onChange,
  onSubmit,
}) => {
  // 使用 useRef 持有 store，避免重复创建
  const storeRef = useRef<ReturnType<typeof createFormStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createFormStore({ schema, initialData, readOnly });
  }
  const store = storeRef.current;

  // 强制重渲染机制
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // 订阅 store 变化
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      forceUpdate();
      if (onChange) {
        onChange(store.getState().formData);
      }
    });
    return unsubscribe;
  }, [store, onChange]);

  // 初始联动应用
  useEffect(() => {
    applyLinkageToAllFields(store, schema);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 字段变化处理
  const handleFieldChange = useCallback(
    (name: string, value: any) => {
      const state = store.getState();
      state.setFieldValue(name, value);
      state.setFieldError(name, []);

      // 异步验证
      const fieldSchema = schema.properties[name];
      if (fieldSchema) {
        const fieldState = state.getFieldState(name);
        validateField(
          fieldSchema,
          value,
          state.formData,
          fieldState.required,
          { isHidden: !fieldState.visible }
        ).then((result) => {
          state.setFieldError(name, result.errors);
        });
      }

      // 查找依赖字段并重新应用联动
      const dependents = findDependentFields(name, schema.properties);
      for (const depField of dependents) {
        const depSchema = schema.properties[depField];
        if (depSchema) {
          applyLinkageToField(store, depField, depSchema);
        }
      }
    },
    [store, schema]
  );

  // 字段失焦处理
  const handleFieldBlur = useCallback(
    (name: string) => {
      const state = store.getState();
      const value = state.getFieldValue(name);
      const fieldSchema = schema.properties[name];
      if (fieldSchema) {
        const fieldState = state.getFieldState(name);
        validateField(
          fieldSchema,
          value,
          state.formData,
          fieldState.required,
          { isHidden: !fieldState.visible }
        ).then((result) => {
          state.setFieldError(name, result.errors);
        });
      }
    },
    [store, schema]
  );

  // 表单提交
  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!onSubmit) return;

      const state = store.getState();
      const properties = schema.properties;
      const validationPromises: Promise<void>[] = [];
      const errorMap: Record<string, string[]> = {};

      for (const [name, fieldSchema] of Object.entries(properties)) {
        const fieldState = state.getFieldState(name);
        // 跳过不可见字段
        if (!fieldState.visible) {
          continue;
        }
        const promise = validateField(
          fieldSchema,
          state.getFieldValue(name),
          state.formData,
          fieldState.required,
          { isHidden: !fieldState.visible }
        ).then((result) => {
          if (!result.valid) {
            errorMap[name] = result.errors;
          }
        });
        validationPromises.push(promise);
      }

      await Promise.all(validationPromises);

      // 更新所有错误到 store
      for (const [name, errors] of Object.entries(errorMap)) {
        state.setFieldError(name, errors);
      }

      // 如果有错误，不调用 onSubmit
      const hasErrors = Object.keys(errorMap).length > 0;
      if (hasErrors) {
        return;
      }

      onSubmit(state.formData);
    },
    [store, schema, onSubmit]
  );

  // 字段渲染
  const renderField = (name: string, fieldSchema: RaosFieldSchema) => {
    const state = store.getState();
    const fieldState = state.getFieldState(name);

    if (!fieldState.visible) {
      return null;
    }

    const value = state.getFieldValue(name);
    const errors = state.errors[name] || [];
    const widgetName = fieldSchema["ui:widget"] || "input";

    let Component: React.FC<any>;
    try {
      Component = getComponent(widgetName);
    } catch (err) {
      return (
        <div key={name} style={{ color: "red", marginBottom: 8 }}>
          组件加载失败: {(err as Error).message}
        </div>
      );
    }

    return (
      <Col
        key={name}
        span={fieldSchema["ui:colSpan"] || 24}
      >
        <Form.Item
          htmlFor={name}
          label={fieldSchema.title}
          required={fieldState.required}
          validateStatus={errors.length > 0 ? "error" : undefined}
          help={errors[0] || fieldSchema["ui:help"]}
        >
          <Component
            schema={fieldSchema}
            name={name}
            value={value}
            onChange={(val: any) => handleFieldChange(name, val)}
            onBlur={() => handleFieldBlur(name)}
            formData={state.formData}
            fieldState={fieldState}
            readOnly={readOnly || fieldState.readonly}
            disabled={fieldState.disabled}
            id={name}
          />
        </Form.Item>
      </Col>
    );
  };

  // 渲染字段列表
  const renderFields = (fieldNames: string[]) => {
    const isGrid = schema.layout?.type === "grid";
    const fields = fieldNames
      .map((name) => {
        const fieldSchema = schema.properties[name];
        if (!fieldSchema) return null;
        return renderField(name, fieldSchema);
      })
      .filter(Boolean);

    if (isGrid) {
      return <Row gutter={schema.layout?.gutter || 16}>{fields}</Row>;
    }
    return <>{fields}</>;
  };

  // 布局渲染
  const renderLayout = () => {
    const sections = schema.layout?.sections;

    if (sections && sections.length > 0) {
      return sections.map((section) => (
        <div key={section.key} style={{ marginBottom: 24 }}>
          {section.title && (
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              {section.title}
            </div>
          )}
          {renderFields(section.fields)}
        </div>
      ));
    }

    return renderFields(Object.keys(schema.properties));
  };

  return (
    <Form
      layout={
        schema.layout?.type === "horizontal"
          ? "horizontal"
          : schema.layout?.type === "inline"
          ? "inline"
          : "vertical"
      }
      onSubmitCapture={handleSubmit}
    >
      {renderLayout()}
    </Form>
  );
};

export default FormRenderer;
