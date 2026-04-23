/**
 * RAOS Form Engine - FormRenderer
 *
 * 核心表单渲染器，集成 Zustand 状态管理、验证引擎和联动引擎。
 */

import React, { useRef, useState, useEffect, useReducer, useCallback } from "react";
import { Form, Row, Col } from "antd";
import type { RaosFormSchema, RaosFieldSchema, FieldState } from "../types";
import { getComponent, getComponentAsync, hasComponent } from "../registry/componentRegistry";
import { createFormStore, type FormStoreState } from "../store/useFormStore";
import { evaluateLinkage, findDependentFields } from "./LinkageEngine";
import { validateField, validateFieldAsync, debouncedAsyncValidate } from "./ValidationEngine";
import { evaluateFieldPermission, getUserPermissions } from "./PermissionEngine";
import { useAuthStore } from "../../../store/auth";
import { formT } from "../i18n/form-i18n";

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

async function loadFieldDataSource(
  fieldName: string,
  fieldSchema: RaosFieldSchema,
  store: ReturnType<typeof createFormStore>,
  timersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>
) {
  const dataSource = fieldSchema['x-dataSource']!;
  const cascade = dataSource.cascade!;

  // 1. 设置 loading 状态
  store.getState().setFieldState(fieldName, { loading: true });

  // 2. 根据 executeWhen 判断是否需要加载
  const dependencies = Array.isArray(cascade.dependency)
    ? cascade.dependency
    : [cascade.dependency];

  const formData = store.getState().formData;

  if (cascade.executeWhen === 'allFilled') {
    const allFilled = dependencies.every((dep) => {
      const val = formData[dep];
      return val !== undefined && val !== null && val !== '';
    });
    if (!allFilled) {
      store.getState().setFieldState(fieldName, { loading: false, options: [] });
      if (cascade.clearOnChange) {
        store.getState().setFieldValue(fieldName, undefined);
      }
      return;
    }
  }

  // 3. 防抖
  const debounceMs = cascade.debounce || 300;
  const existingTimer = timersRef.current.get(fieldName);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    try {
      const response = await fetch('/api/form/data-source/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldSchema,
          formData,
          dependencyValues: Object.fromEntries(
            dependencies.map((dep) => [dep, formData[dep]])
          ),
        }),
      });

      const result = await response.json();

      if (result.success) {
        store.getState().setFieldState(fieldName, {
          loading: false,
          options: result.data.options,
        });

        if (cascade.clearOnChange) {
          const currentValue = store.getState().getFieldValue(fieldName);
          const hasValue = result.data.options.some(
            (opt: any) => opt.value === currentValue
          );
          if (!hasValue) {
            store.getState().setFieldValue(fieldName, undefined);
          }
        }
      } else {
        store.getState().setFieldState(fieldName, { loading: false });
      }
    } catch (error) {
      console.error(`Failed to load data source for ${fieldName}:`, error);
      store.getState().setFieldState(fieldName, { loading: false });
    } finally {
      if (timersRef.current.get(fieldName) === timer) {
        timersRef.current.delete(fieldName);
      }
    }
  }, debounceMs);

  timersRef.current.set(fieldName, timer);
}

export const FormRenderer: React.FC<FormRendererProps> = ({
  schema,
  initialData,
  readOnly = false,
  onChange,
  onSubmit,
}) => {
  // 使用 useState lazy initializer 创建 store，避免 StrictMode 双渲染问题
  const [store] = useState(() => createFormStore({ schema, initialData, readOnly }));

  // 防抖定时器管理
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 强制重渲染机制
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // 订阅 store 变化（使用 ref 防止 onChange 循环）
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      forceUpdate();
      const cb = onChangeRef.current;
      if (cb) {
        cb(store.getState().formData);
      }
    });
    return unsubscribe;
  }, [store]);

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
        if (depSchema?.['x-dataSource']?.cascade) {
          loadFieldDataSource(depField, depSchema, store, timersRef);
        }
      }
    },
    [store, schema]
  );

  // 字段失焦处理（支持异步验证）
  const handleFieldBlur = useCallback(
    (name: string) => {
      const state = store.getState();
      const value = state.getFieldValue(name);
      const fieldSchema = schema.properties[name];
      if (!fieldSchema) return;

      const fieldState = state.getFieldState(name);
      const hasAsync = !!(fieldSchema as any)["x-asyncValidator"];

      if (hasAsync) {
        debouncedAsyncValidate(name, () =>
          validateFieldAsync(
            fieldSchema,
            value,
            state.formData,
            fieldState.required,
            { isHidden: !fieldState.visible }
          )
        ).then((result) => {
          state.setFieldError(name, result.errors);
        });
      } else {
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
        const hasAsync = !!(fieldSchema as any)["x-asyncValidator"];
        const validator = hasAsync ? validateFieldAsync : validateField;
        const promise = validator(
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

  // Async component loading state
  const [asyncComponents, setAsyncComponents] = React.useState<Map<string, React.FC<any>>>(new Map());
  const [loadingAsync, setLoadingAsync] = React.useState<Set<string>>(new Set());

  const loadAsyncComponent = useCallback(async (widgetName: string) => {
    if (asyncComponents.has(widgetName) || loadingAsync.has(widgetName)) return;
    setLoadingAsync((prev) => new Set(prev).add(widgetName));
    try {
      const Comp = await getComponentAsync(widgetName);
      setAsyncComponents((prev) => {
        const next = new Map(prev);
        next.set(widgetName, Comp);
        return next;
      });
    } catch (err) {
      console.error(`Failed to load async component "${widgetName}":`, err);
    } finally {
      setLoadingAsync((prev) => {
        const next = new Set(prev);
        next.delete(widgetName);
        return next;
      });
    }
  }, [asyncComponents, loadingAsync]);

  // 获取当前用户权限
  const user = useAuthStore((s) => s.user);
  const userPermissions = getUserPermissions(user);

  // 字段渲染
  const renderField = (name: string, fieldSchema: RaosFieldSchema) => {
    const state = store.getState();
    const fieldState = state.getFieldState(name);

    // 权限评估
    const permResult = evaluateFieldPermission(fieldSchema["x-permission"], userPermissions);
    if (!permResult.visible || !fieldState.visible) {
      return null;
    }

    const isFieldReadOnly = readOnly || fieldState.readonly || permResult.readOnly;

    const value = state.getFieldValue(name);
    const errors = state.errors[name] || [];
    const widgetName = fieldSchema["ui:widget"] || "input";

    let Component: React.FC<any> | undefined;
    try {
      Component = getComponent(widgetName);
    } catch {
      Component = asyncComponents.get(widgetName);
      if (!Component && hasComponent(widgetName) && !loadingAsync.has(widgetName)) {
        loadAsyncComponent(widgetName);
        return (
          <Col key={name} span={fieldSchema["ui:colSpan"] || 24}>
            <Form.Item label={fieldSchema.title}>
              <div style={{ color: "#999", padding: "8px 0" }}>{formT("component.loading")}</div>
            </Form.Item>
          </Col>
        );
      }
    }

    if (!Component) {
      return (
        <Col key={name} span={fieldSchema["ui:colSpan"] || 24}>
          <Form.Item label={fieldSchema.title} validateStatus="error"
            help={`Component "${widgetName}" not found`}>
            <div style={{ color: "red" }}>{formT("component.notFound", { name: widgetName })}</div>
          </Form.Item>
        </Col>
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
            readOnly={isFieldReadOnly}
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
