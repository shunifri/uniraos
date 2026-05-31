/**
 * RAOS Form Engine - FormRenderer
 *
 * 核心表单渲染器，集成 Zustand 状态管理、验证引擎和联动引擎。
 */

import React, { useRef, useState, useEffect, useReducer, useCallback } from "react";
import { Form, Row, Col, theme } from "antd";
import type { RaosFormSchema, RaosFieldSchema, FieldState } from "../types";
import { FieldWrapper } from "./FieldWrapper";
import { createFormStore, type FormStoreState } from "../store/useFormStore";
import { evaluateLinkage, findDependentFields } from "./LinkageEngine";
import { validateField, validateFieldAsync, debouncedAsyncValidate, validateCrossFieldRules } from "./ValidationEngine";
import { getComponentAsync } from "../registry/componentRegistry";
import { evaluateFieldPermission, getUserPermissions } from "./PermissionEngine";
import { applyConditionalSchema, getConditionDependencies, hasConditionalSchema } from "./ConditionEngine";
import { useAuthStore } from "../../../store/auth";

// ───────────────────────────────────────────────────────────────
// Props 接口
// ───────────────────────────────────────────────────────────────

export interface AutoSaveConfig {
  debounce?: number;
  /** 后端保存回调 */
  onSave?: (formData: Record<string, any>) => void | Promise<void>;
  /** localStorage 草稿 key，设置后自动保存到 localStorage */
  localStorageKey?: string;
  /** 是否显示保存状态提示 */
  showStatus?: boolean;
}

export interface FormRendererProps {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  onChange?: (formData: Record<string, any>) => void;
  onSubmit?: (formData: Record<string, any>) => void;
  autoSave?: AutoSaveConfig;
  children?: React.ReactNode;
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
  autoSave,
  children,
}) => {
  const { token } = theme.useToken();

  // ───────────────────────────────────────────────────────────────
  // 草稿恢复：从 localStorage 加载草稿数据
  // ───────────────────────────────────────────────────────────────
  const resolvedInitialData = React.useMemo(() => {
    if (!autoSave?.localStorageKey) return initialData;
    try {
      const draft = localStorage.getItem(autoSave.localStorageKey);
      if (draft) {
        const parsed = JSON.parse(draft);
        // 检查草稿是否是今天的（可选：根据需求调整）
        if (parsed._timestamp && Date.now() - parsed._timestamp < 7 * 24 * 60 * 60 * 1000) {
          const { _timestamp, ...data } = parsed;
          return { ...initialData, ...data };
        }
      }
    } catch {
      // ignore parse error
    }
    return initialData;
  }, [autoSave?.localStorageKey, initialData]);

  // 使用 useState lazy initializer 创建 store，避免 StrictMode 双渲染问题
  const [store] = useState(() => createFormStore({ schema, initialData: resolvedInitialData, readOnly }));

  // 当 schema 或 initialData 变化时重置 store
  useEffect(() => {
    store.getState().reset(readOnly);
    if (resolvedInitialData) {
      store.getState().setFieldValues(resolvedInitialData);
    }
    applyLinkageToAllFields(store, schema);
  }, [schema, resolvedInitialData, store, readOnly]);

  // 防抖定时器管理
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 自动保存状态
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

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

      // 跨字段验证实时检查
      const crossRules = schema["x-crossFieldValidation"];
      if (crossRules && crossRules.length > 0) {
        // 清除该字段相关的跨字段验证错误
        for (const rule of crossRules) {
          if (rule.targetFields?.includes(name)) {
            for (const target of rule.targetFields) {
              const currentErrors = state.getFieldState(target).errors || [];
              const filtered = currentErrors.filter(
                (e) => e !== rule.message && !e.startsWith("Cross-field validation error:")
              );
              state.setFieldError(target, filtered);
            }
          }
        }
        // 重新执行跨字段验证
        const crossErrors = validateCrossFieldRules(crossRules, state.formData);
        for (const err of crossErrors) {
          if (err.targetFields.length > 0) {
            for (const fieldName of err.targetFields) {
              const currentErrors = state.getFieldState(fieldName).errors || [];
              if (!currentErrors.includes(err.message)) {
                state.setFieldError(fieldName, [...currentErrors, err.message]);
              }
            }
          }
        }
      }

      // 自动保存
      if (autoSaveRef.current) {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }

        const config = autoSaveRef.current;
        const debounceMs = config.debounce ?? 3000;

        if (config.showStatus) {
          setSaveStatus('saving');
        }

        autoSaveTimerRef.current = setTimeout(() => {
          // 在回调中重新获取最新 state，避免闭包引用旧值
          const currentState = store.getState();
          const currentData = currentState.formData;

          // localStorage 草稿保存
          if (config.localStorageKey) {
            try {
              localStorage.setItem(config.localStorageKey, JSON.stringify({
                ...currentData,
                _timestamp: Date.now(),
              }));
            } catch {
              // ignore storage error (e.g. quota exceeded)
            }
          }

          // 后端保存回调
          if (config.onSave) {
            config.onSave(currentData);
          }

          if (config.showStatus) {
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 2000);
          }

          autoSaveTimerRef.current = null;
        }, debounceMs);
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

      // 检查条件 Schema 依赖：如果当前字段是某个条件规则的依赖项，强制重渲染
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        if (hasConditionalSchema(fieldSchema)) {
          const deps = getConditionDependencies(fieldSchema["x-condition"]!);
          if (deps.includes(name)) {
            forceUpdate();
            break; // 一次重渲染即可刷新所有条件字段
          }
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

      // 跨字段验证
      const crossRules = schema["x-crossFieldValidation"];
      if (crossRules && crossRules.length > 0) {
        const crossErrors = validateCrossFieldRules(crossRules, state.formData);
        for (const err of crossErrors) {
          if (err.targetFields.length > 0) {
            for (const fieldName of err.targetFields) {
              const existing = errorMap[fieldName] || [];
              existing.push(err.message);
              errorMap[fieldName] = existing;
            }
          }
          // 如果没有 targetFields，错误会被忽略（无法关联到具体字段）
          // 未来可以扩展到表单级别的错误展示
        }
      }

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

  // 字段渲染（使用 memoized FieldWrapper）
  const renderField = (name: string, baseSchema: RaosFieldSchema) => {
    const state = store.getState();
    const fieldState = state.getFieldState(name);

    // 应用条件 Schema（x-condition）
    let fieldSchema = baseSchema;
    if (hasConditionalSchema(baseSchema)) {
      fieldSchema = applyConditionalSchema(baseSchema, baseSchema["x-condition"]!, state.formData);
    }

    // 权限评估
    const permResult = evaluateFieldPermission(fieldSchema["x-permission"], userPermissions);
    if (!permResult.visible || !fieldState.visible) {
      return null;
    }

    const isFieldReadOnly = readOnly || fieldState.readonly || permResult.readOnly;

    return (
      <FieldWrapper
        key={name}
        name={name}
        fieldSchema={fieldSchema}
        fieldState={fieldState}
        value={state.getFieldValue(name)}
        errors={state.errors[name] || []}
        formData={state.formData}
        readOnly={isFieldReadOnly}
        onChange={handleFieldChange}
        onBlur={handleFieldBlur}
        asyncComponents={asyncComponents}
        loadingAsync={loadingAsync}
        onLoadAsync={loadAsyncComponent}
      />
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
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
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
      {children}
      {autoSave?.showStatus && saveStatus !== 'idle' && (
        <div style={{ textAlign: 'right', marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
          {saveStatus === 'saving' ? '保存中...' : '已自动保存'}
        </div>
      )}
    </Form>
  );
};

export default FormRenderer;
