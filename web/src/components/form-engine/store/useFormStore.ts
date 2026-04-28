/**
 * RAOS Form Engine - Zustand Form Store
 *
 * 使用 Zustand vanilla createStore 构建的表单状态管理 store。
 * FormRenderer 通过 useRef 持有 store 实例，不直接使用 React hook 版本。
 */

import { createStore } from "zustand/vanilla";
import type { RaosFormSchema, RaosFieldSchema, FieldState } from "../types";

// ───────────────────────────────────────────────────────────────
// Store 选项
// ───────────────────────────────────────────────────────────────

export interface FormStoreOptions {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
}

// ───────────────────────────────────────────────────────────────
// Store State
// ───────────────────────────────────────────────────────────────

export interface FormStoreState {
  schema: RaosFormSchema;
  formData: Record<string, any>;
  errors: Record<string, string[]>;
  fieldStates: Record<string, FieldState>;
  submitting: boolean;
  readOnly: boolean;

  // Actions
  setFieldValue: (name: string, value: any) => void;
  setFieldValues: (values: Record<string, any>) => void;
  setFieldError: (name: string, errors: string[]) => void;
  setFieldState: (name: string, state: Partial<FieldState>) => void;
  setSubmitting: (submitting: boolean) => void;
  reset: (readOnly?: boolean) => void;
  getFieldValue: (name: string) => any;
  getFieldState: (name: string) => FieldState;
}

// ───────────────────────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────────────────────

/**
 * 返回默认字段状态
 */
export function createDefaultFieldState(): FieldState {
  return {
    visible: true,
    disabled: false,
    readonly: false,
    required: false,
  };
}

/**
 * 从 Schema 的 properties 中提取有 default 值的字段
 */
export function extractDefaults(
  schema: RaosFormSchema
): Record<string, any> {
  const defaults: Record<string, any> = {};
  const properties = schema.properties ?? {};

  for (const [name, fieldSchema] of Object.entries(properties)) {
    if (fieldSchema.default !== undefined) {
      defaults[name] = fieldSchema.default;
    }
  }

  return defaults;
}

/**
 * 判断字段是否为必填
 */
function isFieldRequired(
  name: string,
  fieldSchema: RaosFieldSchema,
  schema: RaosFormSchema
): boolean {
  if (fieldSchema.required === true) {
    return true;
  }
  if (schema.required?.includes(name)) {
    return true;
  }
  return false;
}

/**
 * 创建初始 fieldStates
 */
function createInitialFieldStates(
  schema: RaosFormSchema,
  readOnly: boolean = false
): Record<string, FieldState> {
  const fieldStates: Record<string, FieldState> = {};
  const properties = schema.properties ?? {};

  for (const [name, fieldSchema] of Object.entries(properties)) {
    fieldStates[name] = {
      ...createDefaultFieldState(),
      required: isFieldRequired(name, fieldSchema, schema),
      readonly: readOnly,
      disabled: readOnly,
    };
  }

  return fieldStates;
}

// ───────────────────────────────────────────────────────────────
// Store 创建
// ───────────────────────────────────────────────────────────────

export function createFormStore(options: FormStoreOptions) {
  const { schema, initialData = {}, readOnly = false } = options;

  const defaultData = extractDefaults(schema);
  const initialFormData = { ...defaultData, ...initialData };
  const initialFieldStates = createInitialFieldStates(schema, readOnly);

  const store = createStore<FormStoreState>((set, get) => ({
    schema,
    formData: initialFormData,
    errors: {},
    fieldStates: initialFieldStates,
    submitting: false,
    readOnly,

    setFieldValue: (name, value) =>
      set((state) => ({
        formData: { ...state.formData, [name]: value },
      })),

    setFieldValues: (values) =>
      set((state) => ({
        formData: { ...state.formData, ...values },
      })),

    setFieldError: (name, errors) =>
      set((state) => ({
        errors: { ...state.errors, [name]: errors },
      })),

    setFieldState: (name, partialState) =>
      set((state) => ({
        fieldStates: {
          ...state.fieldStates,
          [name]: {
            ...(state.fieldStates[name] ?? createDefaultFieldState()),
            ...partialState,
          },
        },
      })),

    setSubmitting: (submitting) => set({ submitting }),

    reset: (resetReadOnly?: boolean) =>
      set((state) => ({
        formData: initialFormData,
        errors: {},
        fieldStates: createInitialFieldStates(schema, resetReadOnly ?? state.readOnly),
        submitting: false,
        readOnly: resetReadOnly ?? state.readOnly,
      })),

    getFieldValue: (name) => get().formData[name],

    getFieldState: (name) =>
      get().fieldStates[name] ?? createDefaultFieldState(),
  }));

  return store;
}
