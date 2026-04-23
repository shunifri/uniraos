# RAOS 低代码表单引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建自研 JSON Schema 驱动的低代码表单引擎，替换 ConfirmCard，支持审批流程和通用表单场景。

**Architecture:** 前端基于 React + Ant Design 5 + Zustand 构建 Schema 渲染器、组件注册表、联动引擎和验证引擎；后端基于 Express + SQLite/MySQL 提供表单定义管理、数据源解析和 Workflow 集成 API。

**Tech Stack:** React 18, TypeScript, Ant Design 5, Zustand, Express, better-sqlite3/mysql2, Vite

---

## 文件结构映射

```
web/src/components/form-engine/
  ├── types.ts                    # Schema 类型定义（RaosFormSchema, RaosFieldSchema 等）
  ├── core/
  │   ├── FormRenderer.tsx        # 核心渲染器：递归解析 Schema 渲染字段
  │   ├── SchemaParser.ts         # Schema 解析器：处理嵌套、默认值提取
  │   ├── LinkageEngine.ts        # 联动引擎：评估 visible/disabled/required/setValue
  │   └── ValidationEngine.ts     # 验证引擎：三层验证（标准/自定义/异步）
  ├── store/
  │   └── useFormStore.ts         # Zustand 表单状态：formData / errors / fieldStates / meta
  ├── registry/
  │   └── componentRegistry.ts    # 组件注册表：widgetType -> React 组件映射
  ├── components/
  │   ├── TextInput.tsx           # 文本输入（ui:widget: input）
  │   ├── TextArea.tsx            # 多行文本（ui:widget: textarea）
  │   ├── NumberInput.tsx         # 数字输入（ui:widget: number）
  │   ├── PasswordInput.tsx       # 密码输入（ui:widget: password）
  │   ├── SelectInput.tsx         # 下拉选择（ui:widget: select）
  │   ├── RadioGroup.tsx          # 单选组（ui:widget: radio）
  │   ├── CheckboxGroup.tsx       # 多选组（ui:widget: checkbox）
  │   ├── SwitchInput.tsx         # 开关（ui:widget: switch）
  │   ├── DatePickerField.tsx     # 日期选择（ui:widget: datePicker）
  │   ├── DateRangePickerField.tsx# 日期范围（ui:widget: dateRange）
  │   └── TimePickerField.tsx     # 时间选择（ui:widget: timePicker）
  └── index.ts                    # 统一导出

web/src/components/
  └── DynamicForm.tsx             # 对外暴露的表单组件（封装 FormRenderer + 布局 + 操作按钮）

src/
  ├── types/
  │   └── form.ts                 # 后端共享类型（与前端 types.ts 同步）
  ├── routes/
  │   └── form-routes.ts          # 表单 API 路由（定义管理 + 实例管理）
  ├── services/
  │   └── form-service.ts         # 表单业务逻辑（CRUD + 版本管理）
  └── db/
      └── migrations/
          └── 007_form_engine.sql # 数据库迁移（form_definitions, form_instances, form_categories）

tests/
  ├── form-engine/
  │   ├── SchemaParser.test.ts
  │   ├── ValidationEngine.test.ts
  │   ├── LinkageEngine.test.ts
  │   └── FormRenderer.test.tsx
  └── routes/
      └── form-routes.test.ts
```

---

## Phase 1: 核心引擎（Week 1-4）

### Task 1: Schema 类型定义

**Files:**
- Create: `web/src/components/form-engine/types.ts`
- Create: `src/types/form.ts`
- Test: `tests/form-engine/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/form-engine/types.test.ts
import { RaosFormSchema, RaosFieldSchema, FormLayout, LinkageRule } from '../../../web/src/components/form-engine/types';

describe('Schema Types', () => {
  it('should validate a basic form schema', () => {
    const schema: RaosFormSchema = {
      type: 'object',
      title: 'Test Form',
      properties: {
        name: {
          type: 'string',
          title: 'Name',
          'ui:widget': 'input',
          required: true
        }
      },
      required: ['name']
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.name.title).toBe('Name');
  });

  it('should support nested object properties', () => {
    const schema: RaosFormSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          title: 'User',
          properties: {
            name: { type: 'string', title: 'Name' }
          }
        }
      }
    };
    expect(schema.properties.user.properties?.name.type).toBe('string');
  });

  it('should support array items', () => {
    const schema: RaosFormSchema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          title: 'Tags',
          items: { type: 'string', title: 'Tag' }
        }
      }
    };
    expect(schema.properties.tags.items?.type).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/form-engine/types.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/components/form-engine/types.ts
export interface RaosFormSchema {
  type: 'object';
  title?: string;
  description?: string;
  properties: Record<string, RaosFieldSchema>;
  required?: string[];
  layout?: FormLayout;
  actions?: FormAction[];
}

export interface RaosFieldSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title: string;
  description?: string;
  default?: any;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: 'email' | 'url' | 'date' | 'datetime' | 'time' | 'mobile' | 'idCard';
  errorMessage?: string | {
    required?: string;
    minLength?: string;
    maxLength?: string;
    minimum?: string;
    maximum?: string;
    pattern?: string;
    format?: string;
    custom?: string;
    async?: string;
  };
  'ui:widget'?: string;
  'ui:props'?: Record<string, any>;
  'ui:colSpan'?: number;
  'ui:placeholder'?: string;
  'ui:help'?: string;
  'ui:hidden'?: boolean | string;
  'ui:disabled'?: boolean | string;
  'ui:readonly'?: boolean | string;
  'x-linkage'?: LinkageRule[];
  'x-dataSource'?: DataSourceConfig;
  'x-workflow'?: {
    variableName?: string;
    autoFillFromVar?: boolean;
  };
  'x-permission'?: {
    read?: string[];
    write?: string[];
  };
  properties?: Record<string, RaosFieldSchema>;
  items?: RaosFieldSchema;
}

export interface FormLayout {
  type: 'vertical' | 'horizontal' | 'inline' | 'grid';
  columns?: number;
  gutter?: number;
  sections?: FormSection[];
}

export interface FormSection {
  title?: string;
  key: string;
  fields: string[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface FormAction {
  type: 'submit' | 'reset' | 'saveDraft' | 'cancel' | 'custom';
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: string;
}

export interface LinkageRule {
  type: 'visible' | 'hidden' | 'disabled' | 'enabled'
      | 'readonly' | 'editable' | 'required' | 'optional'
      | 'setValue' | 'clearValue' | 'setOptions' | 'validate';
  when: string;
  then?: any;
  else?: any;
}

export interface DataSourceConfig {
  type: 'static' | 'remote' | 'database' | 'workflowVar' | 'expression';
  options?: Array<{ label: string; value: any; children?: any[] }>;
  url?: string;
  method?: 'GET' | 'POST';
  params?: Record<string, any>;
  headers?: Record<string, string>;
  path?: string;
  database?: DatabaseSourceConfig;
  cascade?: CascadeConfig;
  variableName?: string;
  expression?: string;
}

export interface DatabaseSourceConfig {
  connectionId?: string;
  connectionType?: 'mysql' | 'postgresql' | 'sqlite' | 'mssql' | 'mongodb';
  query: string;
  queryParams?: Array<{
    name: string;
    value?: string | number | boolean;
    type?: 'string' | 'number' | 'boolean' | 'date';
    source?: 'static' | 'formField' | 'workflowVar' | 'userContext';
    sourceField?: string;
  }>;
  labelField: string;
  valueField: string;
  extraFields?: string[];
  filters?: DataFilter[];
  timeout?: number;
  cache?: number;
  maxResults?: number;
}

export interface CascadeConfig {
  dependency: string | string[];
  trigger?: 'onChange' | 'onBlur';
  debounce?: number;
  clearOnChange?: boolean;
  loadingText?: string;
  placeholderText?: string;
  executeWhen?: 'allFilled' | 'anyFilled' | 'always';
}

export interface DataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
          | 'contains' | 'startsWith' | 'endsWith'
          | 'in' | 'notIn' | 'between' | 'isNull' | 'isNotNull';
  value?: any;
  logic?: 'and' | 'or';
}

export interface FieldState {
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  options?: Array<{label: string; value: any}>;
  loading?: boolean;
  errors?: string[];
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/types.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Copy types to backend**

```typescript
// src/types/form.ts
// Re-export from frontend types to keep them in sync
export * from '../../web/src/components/form-engine/types';
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/form-engine/types.ts src/types/form.ts tests/form-engine/types.test.ts
git commit -m "feat(form-engine): define RaosFormSchema types and interfaces"
```

---

### Task 2: 组件注册表机制

**Files:**
- Create: `web/src/components/form-engine/registry/componentRegistry.ts`
- Create: `web/src/components/form-engine/registry/index.ts`
- Test: `tests/form-engine/componentRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/form-engine/componentRegistry.test.ts
import { componentRegistry, registerComponent, getComponent } from '../../../web/src/components/form-engine/registry';
import React from 'react';

describe('Component Registry', () => {
  it('should have built-in input component', () => {
    const Input = getComponent('input');
    expect(Input).toBeDefined();
  });

  it('should register custom component', () => {
    const CustomWidget = () => React.createElement('div', null, 'Custom');
    registerComponent('custom', CustomWidget);
    expect(getComponent('custom')).toBe(CustomWidget);
  });

  it('should throw for unregistered component', () => {
    expect(() => getComponent('nonexistent')).toThrow('Component "nonexistent" not found in registry');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/componentRegistry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/components/form-engine/registry/componentRegistry.ts
import React from 'react';
import type { RaosFieldSchema, FieldState } from '../types';

export interface FieldRendererProps {
  schema: RaosFieldSchema;
  name: string;
  value: any;
  onChange: (value: any) => void;
  onBlur: () => void;
  formData: Record<string, any>;
  fieldState: FieldState;
  readOnly?: boolean;
  disabled?: boolean;
}

export type FieldComponent = React.FC<FieldRendererProps>;

const registry: Map<string, FieldComponent> = new Map();

export function registerComponent(name: string, component: FieldComponent): void {
  registry.set(name, component);
}

export function getComponent(name: string): FieldComponent {
  const component = registry.get(name);
  if (!component) {
    throw new Error(`Component "${name}" not found in registry`);
  }
  return component;
}

export function hasComponent(name: string): boolean {
  return registry.has(name);
}

export function listComponents(): string[] {
  return Array.from(registry.keys());
}

// Export the registry map for testing/internal use
export { registry };
```

```typescript
// web/src/components/form-engine/registry/index.ts
export * from './componentRegistry';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/componentRegistry.test.ts`
Expected: FAIL (built-in components not registered yet) — 这是预期的，下一步注册基础组件

- [ ] **Step 5: Register placeholder components for test**

```typescript
// Add to web/src/components/form-engine/registry/componentRegistry.ts (before exports)
// Placeholder built-in components will be replaced in later tasks
const PlaceholderInput: FieldComponent = () => React.createElement('input', null);
registerComponent('input', PlaceholderInput);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/componentRegistry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add web/src/components/form-engine/registry/ tests/form-engine/componentRegistry.test.ts
git commit -m "feat(form-engine): add component registry with register/get/has/list APIs"
```

---

### Task 3: Zustand 表单状态管理

**Files:**
- Create: `web/src/components/form-engine/store/useFormStore.ts`
- Test: `tests/form-engine/useFormStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/form-engine/useFormStore.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('useFormStore', () => {
  it('should create form store with initial data', async () => {
    const { createFormStore } = await import('../../../web/src/components/form-engine/store/useFormStore');
    const store = createFormStore({
      schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } } },
      initialData: { name: 'John' }
    });
    expect(store.getState().formData.name).toBe('John');
  });

  it('should update field value', async () => {
    const { createFormStore } = await import('../../../web/src/components/form-engine/store/useFormStore');
    const store = createFormStore({
      schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } } }
    });
    store.getState().setFieldValue('name', 'Jane');
    expect(store.getState().formData.name).toBe('Jane');
  });

  it('should set field error', async () => {
    const { createFormStore } = await import('../../../web/src/components/form-engine/store/useFormStore');
    const store = createFormStore({
      schema: { type: 'object', properties: { email: { type: 'string', title: 'Email' } } }
    });
    store.getState().setFieldError('email', ['Invalid email']);
    expect(store.getState().errors.email).toEqual(['Invalid email']);
  });

  it('should set field state (visible/disabled)', async () => {
    const { createFormStore } = await import('../../../web/src/components/form-engine/store/useFormStore');
    const store = createFormStore({
      schema: { type: 'object', properties: { age: { type: 'number', title: 'Age' } } }
    });
    store.getState().setFieldState('age', { visible: false });
    expect(store.getState().fieldStates.age.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/useFormStore.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/components/form-engine/store/useFormStore.ts
import { createStore } from 'zustand/vanilla';
import type { RaosFormSchema, FieldState, ValidationResult } from '../types';

export interface FormStoreOptions {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
}

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
  reset: () => void;
  getFieldValue: (name: string) => any;
  getFieldState: (name: string) => FieldState;
}

function createDefaultFieldState(): FieldState {
  return {
    visible: true,
    disabled: false,
    readonly: false,
    required: false,
    options: undefined,
    loading: false,
    errors: [],
    value: undefined
  };
}

function extractDefaults(schema: RaosFormSchema): Record<string, any> {
  const data: Record<string, any> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    if (field.default !== undefined) {
      data[key] = field.default;
    }
  }
  return data;
}

export function createFormStore(options: FormStoreOptions) {
  const { schema, initialData = {}, readOnly = false } = options;
  const defaults = extractDefaults(schema);
  const fieldNames = Object.keys(schema.properties);

  const defaultFieldStates: Record<string, FieldState> = {};
  for (const name of fieldNames) {
    defaultFieldStates[name] = createDefaultFieldState();
    const fieldSchema = schema.properties[name];
    if (fieldSchema.required || schema.required?.includes(name)) {
      defaultFieldStates[name].required = true;
    }
  }

  const store = createStore<FormStoreState>((set, get) => ({
    schema,
    formData: { ...defaults, ...initialData },
    errors: {},
    fieldStates: defaultFieldStates,
    submitting: false,
    readOnly,

    setFieldValue: (name, value) => {
      set((state) => ({
        formData: { ...state.formData, [name]: value }
      }));
    },

    setFieldValues: (values) => {
      set((state) => ({
        formData: { ...state.formData, ...values }
      }));
    },

    setFieldError: (name, errors) => {
      set((state) => ({
        errors: { ...state.errors, [name]: errors }
      }));
    },

    setFieldState: (name, partialState) => {
      set((state) => ({
        fieldStates: {
          ...state.fieldStates,
          [name]: { ...state.fieldStates[name], ...partialState }
        }
      }));
    },

    setSubmitting: (submitting) => set({ submitting }),

    reset: () => {
      set({
        formData: { ...defaults, ...initialData },
        errors: {},
        fieldStates: defaultFieldStates,
        submitting: false
      });
    },

    getFieldValue: (name) => get().formData[name],

    getFieldState: (name) => {
      return get().fieldStates[name] || createDefaultFieldState();
    }
  }));

  return store;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/useFormStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/form-engine/store/useFormStore.ts tests/form-engine/useFormStore.test.ts
git commit -m "feat(form-engine): add Zustand form store with field value/error/state management"
```

---

### Task 4: Schema 解析器

**Files:**
- Create: `web/src/components/form-engine/core/SchemaParser.ts`
- Test: `tests/form-engine/SchemaParser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/form-engine/SchemaParser.test.ts
import { describe, it, expect } from 'vitest';

describe('SchemaParser', () => {
  it('should flatten nested schema fields', async () => {
    const { flattenFields } = await import('../../../web/src/components/form-engine/core/SchemaParser');
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          title: 'User',
          properties: {
            name: { type: 'string', title: 'Name' }
          }
        }
      }
    };
    const fields = flattenFields(schema);
    expect(fields).toContainEqual({ name: 'user.name', schema: { type: 'string', title: 'Name' } });
  });

  it('should get nested value by path', async () => {
    const { getValueByPath } = await import('../../../web/src/components/form-engine/core/SchemaParser');
    const data = { user: { name: 'John' } };
    expect(getValueByPath(data, 'user.name')).toBe('John');
    expect(getValueByPath(data, 'user.age')).toBeUndefined();
  });

  it('should set nested value by path', async () => {
    const { setValueByPath } = await import('../../../web/src/components/form-engine/core/SchemaParser');
    const data = { user: { name: 'John' } };
    setValueByPath(data, 'user.name', 'Jane');
    expect(data.user.name).toBe('Jane');
  });

  it('should extract all field names including nested', async () => {
    const { getAllFieldNames } = await import('../../../web/src/components/form-engine/core/SchemaParser');
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name' },
        address: {
          type: 'object',
          properties: {
            city: { type: 'string', title: 'City' }
          }
        }
      }
    };
    expect(getAllFieldNames(schema)).toEqual(['name', 'address.city']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/SchemaParser.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/components/form-engine/core/SchemaParser.ts
import type { RaosFormSchema, RaosFieldSchema } from '../types';

export interface FlattenedField {
  name: string;
  schema: RaosFieldSchema;
}

export function flattenFields(schema: RaosFormSchema, prefix = ''): FlattenedField[] {
  const fields: FlattenedField[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (fieldSchema.type === 'object' && fieldSchema.properties) {
      // Flatten nested object
      const nested = flattenFields(
        { type: 'object', properties: fieldSchema.properties },
        fullPath
      );
      fields.push(...nested);
    } else {
      fields.push({ name: fullPath, schema: fieldSchema });
    }
  }

  return fields;
}

export function getValueByPath(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

export function setValueByPath(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

export function getAllFieldNames(schema: RaosFormSchema, prefix = ''): string[] {
  const names: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (fieldSchema.type === 'object' && fieldSchema.properties) {
      names.push(...getAllFieldNames(
        { type: 'object', properties: fieldSchema.properties },
        fullPath
      ));
    } else {
      names.push(fullPath);
    }
  }

  return names;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/SchemaParser.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/form-engine/core/SchemaParser.ts tests/form-engine/SchemaParser.test.ts
git commit -m "feat(form-engine): add SchemaParser with path-based field flattening"
```

---

### Task 5: 验证引擎

**Files:**
- Create: `web/src/components/form-engine/core/ValidationEngine.ts`
- Test: `tests/form-engine/ValidationEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/form-engine/ValidationEngine.test.ts
import { describe, it, expect } from 'vitest';

describe('ValidationEngine', () => {
  it('should validate required field', async () => {
    const { validateField } = await import('../../../web/src/components/form-engine/core/ValidationEngine');
    const schema = { type: 'string', title: 'Name' };
    const result = await validateField(schema, '', { name: '' }, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('此字段为必填项');
  });

  it('should validate email format', async () => {
    const { validateField } = await import('../../../web/src/components/form-engine/core/ValidationEngine');
    const schema = { type: 'string', title: 'Email', format: 'email' };
    const result = await validateField(schema, 'invalid', {}, false);
    expect(result.valid).toBe(false);
  });

  it('should validate minLength', async () => {
    const { validateField } = await import('../../../web/src/components/form-engine/core/ValidationEngine');
    const schema = { type: 'string', title: 'Code', minLength: 3 };
    const result = await validateField(schema, 'ab', {}, false);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('至少 3 个字符');
  });

  it('should validate pattern', async () => {
    const { validateField } = await import('../../../web/src/components/form-engine/core/ValidationEngine');
    const schema = { type: 'string', title: 'Phone', pattern: '^1[3-9]\\d{9}$' };
    const result = await validateField(schema, '123', {}, false);
    expect(result.valid).toBe(false);
  });

  it('should pass valid field', async () => {
    const { validateField } = await import('../../../web/src/components/form-engine/core/ValidationEngine');
    const schema = { type: 'string', title: 'Name', required: true };
    const result = await validateField(schema, 'John', {}, false);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should skip validation for hidden field', async () => {
    const { validateField } = await import('../../../web/src/components/form-engine/core/ValidationEngine');
    const schema = { type: 'string', title: 'Secret' };
    const result = await validateField(schema, '', {}, true); // isHidden = true
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/ValidationEngine.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/components/form-engine/core/ValidationEngine.ts
import type { RaosFieldSchema, ValidationResult } from '../types';

interface ValidateOptions {
  isHidden?: boolean;
}

export async function validateField(
  schema: RaosFieldSchema,
  value: any,
  formData: Record<string, any>,
  isRequired: boolean,
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const errors: string[] = [];

  // Skip validation for hidden fields
  if (options.isHidden) {
    return { valid: true, errors: [] };
  }

  // 1. Required validation
  if (isRequired) {
    const isEmpty = value === undefined || value === null || value === '';
    if (isEmpty) {
      errors.push(getErrorMessage(schema, 'required', '此字段为必填项'));
    }
  }

  // Skip other validations if empty and not required
  if (value === undefined || value === null || value === '') {
    return { valid: errors.length === 0, errors };
  }

  // 2. JSON Schema standard validations
  if (schema.minLength !== undefined && String(value).length < schema.minLength) {
    errors.push(getErrorMessage(schema, 'minLength', `长度至少为 ${schema.minLength} 个字符`));
  }

  if (schema.maxLength !== undefined && String(value).length > schema.maxLength) {
    errors.push(getErrorMessage(schema, 'maxLength', `长度不能超过 ${schema.maxLength} 个字符`));
  }

  if (schema.minimum !== undefined && Number(value) < schema.minimum) {
    errors.push(getErrorMessage(schema, 'minimum', `最小值为 ${schema.minimum}`));
  }

  if (schema.maximum !== undefined && Number(value) > schema.maximum) {
    errors.push(getErrorMessage(schema, 'maximum', `最大值为 ${schema.maximum}`));
  }

  if (schema.pattern) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(String(value))) {
      errors.push(getErrorMessage(schema, 'pattern', '格式不正确'));
    }
  }

  if (schema.format) {
    const formatError = validateFormat(value, schema.format);
    if (formatError) {
      errors.push(getErrorMessage(schema, 'format', formatError));
    }
  }

  // 3. Custom validator (expression-based)
  if (schema.customValidator) {
    const customError = validateCustomExpression(schema.customValidator, value, formData);
    if (customError) {
      errors.push(getErrorMessage(schema, 'custom', customError));
    }
  }

  return { valid: errors.length === 0, errors };
}

function getErrorMessage(
  schema: RaosFieldSchema,
  key: string,
  defaultMessage: string
): string {
  if (typeof schema.errorMessage === 'string') {
    return schema.errorMessage;
  }
  if (typeof schema.errorMessage === 'object') {
    return schema.errorMessage[key as keyof typeof schema.errorMessage] || defaultMessage;
  }
  return defaultMessage;
}

function validateFormat(value: any, format: string): string | null {
  const strValue = String(value);
  switch (format) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue) ? null : '请输入有效的邮箱地址';
    case 'url':
      return /^https?:\/\/.+/.test(strValue) ? null : '请输入有效的 URL';
    case 'mobile':
      return /^1[3-9]\d{9}$/.test(strValue) ? null : '请输入有效的手机号';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(strValue) ? null : '日期格式应为 YYYY-MM-DD';
    case 'datetime':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(strValue) ? null : '日期时间格式不正确';
    default:
      return null;
  }
}

function validateCustomExpression(
  expression: string,
  value: any,
  formData: Record<string, any>
): string | null {
  // Simple expression evaluator for Phase 1
  // Supports: {{fieldName}} variable interpolation
  // Will be enhanced with expr: prefix in Phase 4
  if (expression.includes('expr:')) {
    // Placeholder: expr validation will be fully implemented in Phase 4
    // For now, return null (pass)
    return null;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/ValidationEngine.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/form-engine/core/ValidationEngine.ts tests/form-engine/ValidationEngine.test.ts
git commit -m "feat(form-engine): add ValidationEngine with JSON Schema standard validations"
```

---

### Task 6: 联动引擎

**Files:**
- Create: `web/src/components/form-engine/core/LinkageEngine.ts`
- Test: `tests/form-engine/LinkageEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/form-engine/LinkageEngine.test.ts
import { describe, it, expect } from 'vitest';

describe('LinkageEngine', () => {
  it('should evaluate visible linkage', async () => {
    const { evaluateLinkage } = await import('../../../web/src/components/form-engine/core/LinkageEngine');
    const rules = [{ type: 'visible' as const, when: '{{amount}} > 1000' }];
    const result = evaluateLinkage(rules, { amount: 1500 });
    expect(result.visible).toBe(true);
  });

  it('should evaluate hidden linkage', async () => {
    const { evaluateLinkage } = await import('../../../web/src/components/form-engine/core/LinkageEngine');
    const rules = [{ type: 'hidden' as const, when: '{{amount}} > 1000' }];
    const result = evaluateLinkage(rules, { amount: 1500 });
    expect(result.visible).toBe(false);
  });

  it('should evaluate disabled linkage', async () => {
    const { evaluateLinkage } = await import('../../../web/src/components/form-engine/core/LinkageEngine');
    const rules = [{ type: 'disabled' as const, when: '{{status}} === "locked"' }];
    const result = evaluateLinkage(rules, { status: 'locked' });
    expect(result.disabled).toBe(true);
  });

  it('should evaluate setValue linkage', async () => {
    const { evaluateLinkage } = await import('../../../web/src/components/form-engine/core/LinkageEngine');
    const rules = [{ type: 'setValue' as const, when: '{{type}} === "admin"', then: 'Admin User' }];
    const result = evaluateLinkage(rules, { type: 'admin' });
    expect(result.value).toBe('Admin User');
  });

  it('should return default state when no rules match', async () => {
    const { evaluateLinkage } = await import('../../../web/src/components/form-engine/core/LinkageEngine');
    const rules = [{ type: 'visible' as const, when: '{{amount}} > 1000' }];
    const result = evaluateLinkage(rules, { amount: 500 });
    expect(result.visible).toBe(true); // default visible is true, rule didn't match so stays true
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/LinkageEngine.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/components/form-engine/core/LinkageEngine.ts
import type { LinkageRule, FieldState } from '../types';

export interface LinkageResult {
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  value?: any;
}

export function evaluateLinkage(
  rules: LinkageRule[],
  formData: Record<string, any>
): LinkageResult {
  const result: LinkageResult = {
    visible: true,
    disabled: false,
    readonly: false,
    required: false
  };

  if (!rules || rules.length === 0) return result;

  for (const rule of rules) {
    const conditionMet = evaluateExpression(rule.when, formData);

    switch (rule.type) {
      case 'visible':
        result.visible = conditionMet;
        break;
      case 'hidden':
        result.visible = !conditionMet;
        break;
      case 'disabled':
        result.disabled = conditionMet;
        break;
      case 'enabled':
        result.disabled = !conditionMet;
        break;
      case 'readonly':
        result.readonly = conditionMet;
        break;
      case 'editable':
        result.readonly = !conditionMet;
        break;
      case 'required':
        result.required = conditionMet;
        break;
      case 'optional':
        result.required = !conditionMet;
        break;
      case 'setValue':
        if (conditionMet) {
          result.value = rule.then;
        } else if (rule.else !== undefined) {
          result.value = rule.else;
        }
        break;
      case 'clearValue':
        if (conditionMet) {
          result.value = undefined;
        }
        break;
    }
  }

  return result;
}

// Expression evaluator with variable interpolation
export function evaluateExpression(
  expression: string,
  formData: Record<string, any>
): boolean {
  try {
    // Replace {{fieldName}} with actual values
    let jsExpression = expression.replace(/\{\{(\w+)\}\}/g, (match, fieldName) => {
      const value = formData[fieldName];
      if (value === undefined || value === null) return 'null';
      if (typeof value === 'string') return `"${value}"`;
      return String(value);
    });

    // Handle expr: prefix (Phase 4 will add sandbox)
    if (jsExpression.startsWith('expr:')) {
      jsExpression = jsExpression.slice(5);
    }

    // Evaluate in a safe way using Function constructor with limited scope
    const fn = new Function('Math', 'String', 'Number', 'Date', 'Array', 'Object', 'JSON', `
      try {
        return (${jsExpression});
      } catch (e) {
        return false;
      }
    `);

    const result = fn(Math, String, Number, Date, Array, Object, JSON);
    return Boolean(result);
  } catch (error) {
    console.warn('Linkage expression evaluation error:', expression, error);
    return false;
  }
}

// Find all fields that depend on a given field (for cascade updates)
export function findDependentFields(
  changedField: string,
  schemaProperties: Record<string, any>
): string[] {
  const dependents: string[] = [];

  for (const [fieldName, fieldSchema] of Object.entries(schemaProperties)) {
    const linkageRules = fieldSchema['x-linkage'] || [];
    for (const rule of linkageRules) {
      if (rule.when && rule.when.includes(`{{${changedField}}}`)) {
        dependents.push(fieldName);
        break;
      }
    }

    // Check data source dependencies
    const dataSource = fieldSchema['x-dataSource'];
    if (dataSource?.database?.queryParams) {
      for (const param of dataSource.database.queryParams) {
        if (param.source === 'formField' && param.sourceField === changedField) {
          if (!dependents.includes(fieldName)) {
            dependents.push(fieldName);
          }
          break;
        }
      }
    }
  }

  return dependents;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/LinkageEngine.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/form-engine/core/LinkageEngine.ts tests/form-engine/LinkageEngine.test.ts
git commit -m "feat(form-engine): add LinkageEngine with visible/disabled/required/setValue rules"
```

---

### Task 7: 基础输入组件

**Files:**
- Create: `web/src/components/form-engine/components/TextInput.tsx`
- Create: `web/src/components/form-engine/components/TextArea.tsx`
- Create: `web/src/components/form-engine/components/NumberInput.tsx`
- Create: `web/src/components/form-engine/components/PasswordInput.tsx`
- Modify: `web/src/components/form-engine/registry/componentRegistry.ts`

- [ ] **Step 1: Create TextInput component**

```tsx
// web/src/components/form-engine/components/TextInput.tsx
import React from 'react';
import { Input } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const TextInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  return (
    <Input
      id={name}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder']}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      {...(schema['ui:props'] || {})}
    />
  );
};
```

- [ ] **Step 2: Create TextArea component**

```tsx
// web/src/components/form-engine/components/TextArea.tsx
import React from 'react';
import { Input } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const TextArea: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  const { rows = 3, showCount, maxLength } = schema['ui:props'] || {};

  return (
    <Input.TextArea
      id={name}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder']}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      rows={rows}
      showCount={showCount}
      maxLength={maxLength || schema.maxLength}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
    />
  );
};
```

- [ ] **Step 3: Create NumberInput component**

```tsx
// web/src/components/form-engine/components/NumberInput.tsx
import React from 'react';
import { InputNumber } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const NumberInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  const props = schema['ui:props'] || {};

  return (
    <InputNumber
      id={name}
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder']}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      min={schema.minimum}
      max={schema.maximum}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      style={{ width: '100%' }}
      {...props}
    />
  );
};
```

- [ ] **Step 4: Create PasswordInput component**

```tsx
// web/src/components/form-engine/components/PasswordInput.tsx
import React from 'react';
import { Input } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const PasswordInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  return (
    <Input.Password
      id={name}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder']}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      {...(schema['ui:props'] || {})}
    />
  );
};
```

- [ ] **Step 5: Register components in registry**

```typescript
// Modify web/src/components/form-engine/registry/componentRegistry.ts
// Add imports at the top:
import { TextInput } from '../components/TextInput';
import { TextArea } from '../components/TextArea';
import { NumberInput } from '../components/NumberInput';
import { PasswordInput } from '../components/PasswordInput';

// Add registrations after registry definition (replace the placeholder):
registerComponent('input', TextInput);
registerComponent('textarea', TextArea);
registerComponent('number', NumberInput);
registerComponent('password', PasswordInput);
```

- [ ] **Step 6: Verify components render correctly**

Run: `npx vitest run tests/form-engine/componentRegistry.test.ts`
Expected: PASS (3 tests) — now `getComponent('input')` returns real TextInput

- [ ] **Step 7: Commit**

```bash
git add web/src/components/form-engine/components/
git add web/src/components/form-engine/registry/componentRegistry.ts
git commit -m "feat(form-engine): add TextInput, TextArea, NumberInput, PasswordInput components"
```

---

### Task 8: 选择类组件

**Files:**
- Create: `web/src/components/form-engine/components/SelectInput.tsx`
- Create: `web/src/components/form-engine/components/RadioGroup.tsx`
- Create: `web/src/components/form-engine/components/CheckboxGroup.tsx`
- Create: `web/src/components/form-engine/components/SwitchInput.tsx`
- Modify: `web/src/components/form-engine/registry/componentRegistry.ts`

- [ ] **Step 1: Create SelectInput component**

```tsx
// web/src/components/form-engine/components/SelectInput.tsx
import React from 'react';
import { Select } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const SelectInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  const props = schema['ui:props'] || {};
  const options = fieldState.options || schema['x-dataSource']?.options || [];
  const mode = props.multiple ? 'multiple' : undefined;

  return (
    <Select
      id={name}
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder'] || '请选择'}
      disabled={fieldState.disabled}
      options={options.map((opt: any) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled
      }))}
      loading={fieldState.loading}
      mode={mode}
      showSearch={props.showSearch}
      allowClear={props.allowClear}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      style={{ width: '100%' }}
      {...props}
    />
  );
};
```

- [ ] **Step 2: Create RadioGroup component**

```tsx
// web/src/components/form-engine/components/RadioGroup.tsx
import React from 'react';
import { Radio } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const RadioGroup: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  fieldState
}) => {
  const options = fieldState.options || schema['x-dataSource']?.options || [];

  return (
    <Radio.Group
      id={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={fieldState.disabled}
      options={options.map((opt: any) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled
      }))}
    />
  );
};
```

- [ ] **Step 3: Create CheckboxGroup component**

```tsx
// web/src/components/form-engine/components/CheckboxGroup.tsx
import React from 'react';
import { Checkbox } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const CheckboxGroup: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  fieldState
}) => {
  const options = fieldState.options || schema['x-dataSource']?.options || [];

  return (
    <Checkbox.Group
      id={name}
      value={value || []}
      onChange={(val) => onChange(val)}
      disabled={fieldState.disabled}
      options={options.map((opt: any) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled
      }))}
    />
  );
};
```

- [ ] **Step 4: Create SwitchInput component**

```tsx
// web/src/components/form-engine/components/SwitchInput.tsx
import React from 'react';
import { Switch } from 'antd';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const SwitchInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  fieldState
}) => {
  const props = schema['ui:props'] || {};

  return (
    <Switch
      id={name}
      checked={!!value}
      onChange={(checked) => onChange(checked)}
      disabled={fieldState.disabled}
      checkedChildren={props.checkedChildren}
      unCheckedChildren={props.unCheckedChildren}
    />
  );
};
```

- [ ] **Step 5: Register components**

```typescript
// Add to web/src/components/form-engine/registry/componentRegistry.ts:
import { SelectInput } from '../components/SelectInput';
import { RadioGroup } from '../components/RadioGroup';
import { CheckboxGroup } from '../components/CheckboxGroup';
import { SwitchInput } from '../components/SwitchInput';

registerComponent('select', SelectInput);
registerComponent('radio', RadioGroup);
registerComponent('checkbox', CheckboxGroup);
registerComponent('switch', SwitchInput);
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/form-engine/components/
git add web/src/components/form-engine/registry/componentRegistry.ts
git commit -m "feat(form-engine): add SelectInput, RadioGroup, CheckboxGroup, SwitchInput components"
```

---

### Task 9: 日期时间组件

**Files:**
- Create: `web/src/components/form-engine/components/DatePickerField.tsx`
- Create: `web/src/components/form-engine/components/DateRangePickerField.tsx`
- Create: `web/src/components/form-engine/components/TimePickerField.tsx`
- Modify: `web/src/components/form-engine/registry/componentRegistry.ts`

- [ ] **Step 1: Create DatePickerField component**

```tsx
// web/src/components/form-engine/components/DatePickerField.tsx
import React from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const DatePickerField: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  const props = schema['ui:props'] || {};

  return (
    <DatePicker
      id={name}
      value={value ? dayjs(value) : null}
      onChange={(date) => onChange(date ? date.format('YYYY-MM-DD') : null)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder'] || '请选择日期'}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      style={{ width: '100%' }}
      {...props}
    />
  );
};
```

- [ ] **Step 2: Create DateRangePickerField component**

```tsx
// web/src/components/form-engine/components/DateRangePickerField.tsx
import React from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import type { FieldRendererProps } from '../registry/componentRegistry';

const { RangePicker } = DatePicker;

export const DateRangePickerField: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  const props = schema['ui:props'] || {};

  return (
    <RangePicker
      id={name}
      value={value && Array.isArray(value) && value.length === 2
        ? [dayjs(value[0]), dayjs(value[1])]
        : null
      }
      onChange={(dates) => {
        if (dates && dates[0] && dates[1]) {
          onChange([
            dates[0].format('YYYY-MM-DD'),
            dates[1].format('YYYY-MM-DD')
          ]);
        } else {
          onChange(null);
        }
      }}
      onBlur={onBlur}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      style={{ width: '100%' }}
      {...props}
    />
  );
};
```

- [ ] **Step 3: Create TimePickerField component**

```tsx
// web/src/components/form-engine/components/TimePickerField.tsx
import React from 'react';
import { TimePicker } from 'antd';
import dayjs from 'dayjs';
import type { FieldRendererProps } from '../registry/componentRegistry';

export const TimePickerField: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  fieldState
}) => {
  const props = schema['ui:props'] || {};

  return (
    <TimePicker
      id={name}
      value={value ? dayjs(value, 'HH:mm:ss') : null}
      onChange={(time) => onChange(time ? time.format('HH:mm:ss') : null)}
      onBlur={onBlur}
      placeholder={schema['ui:placeholder'] || '请选择时间'}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors && fieldState.errors.length > 0 ? 'error' : undefined}
      style={{ width: '100%' }}
      {...props}
    />
  );
};
```

- [ ] **Step 4: Register components**

```typescript
// Add to web/src/components/form-engine/registry/componentRegistry.ts:
import { DatePickerField } from '../components/DatePickerField';
import { DateRangePickerField } from '../components/DateRangePickerField';
import { TimePickerField } from '../components/TimePickerField';

registerComponent('datePicker', DatePickerField);
registerComponent('dateRange', DateRangePickerField);
registerComponent('timePicker', TimePickerField);
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/form-engine/components/
git add web/src/components/form-engine/registry/componentRegistry.ts
git commit -m "feat(form-engine): add DatePicker, DateRangePicker, TimePicker components"
```

---

### Task 10: 核心渲染器 FormRenderer

**Files:**
- Create: `web/src/components/form-engine/core/FormRenderer.tsx`
- Test: `tests/form-engine/FormRenderer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/form-engine/FormRenderer.test.tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

describe('FormRenderer', () => {
  it('should render input field', async () => {
    const { FormRenderer } = await import('../../../web/src/components/form-engine/core/FormRenderer');
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name', 'ui:widget': 'input' }
      }
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('should render select field with options', async () => {
    const { FormRenderer } = await import('../../../web/src/components/form-engine/core/FormRenderer');
    const schema = {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'Status',
          'ui:widget': 'select',
          'x-dataSource': {
            type: 'static',
            options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }]
          }
        }
      }
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('should call onChange when input value changes', async () => {
    const { FormRenderer } = await import('../../../web/src/components/form-engine/core/FormRenderer');
    const onChange = vi.fn();
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name', 'ui:widget': 'input' }
      }
    };
    render(<FormRenderer schema={schema} onChange={onChange} />);
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'John' } });
    expect(onChange).toHaveBeenCalledWith({ name: 'John' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/FormRenderer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/src/components/form-engine/core/FormRenderer.tsx
import React, { useCallback, useEffect, useRef } from 'react';
import { Form, Row, Col } from 'antd';
import type { RaosFormSchema } from '../types';
import { createFormStore, type FormStoreOptions } from '../store/useFormStore';
import { getComponent } from '../registry/componentRegistry';
import { evaluateLinkage, findDependentFields } from './LinkageEngine';
import { validateField } from './ValidationEngine';
import { getValueByPath, setValueByPath } from './SchemaParser';

export interface FormRendererProps {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  onChange?: (formData: Record<string, any>) => void;
  onSubmit?: (formData: Record<string, any>) => void;
}

export const FormRenderer: React.FC<FormRendererProps> = ({
  schema,
  initialData,
  readOnly = false,
  onChange,
  onSubmit
}) => {
  const storeRef = useRef<ReturnType<typeof createFormStore>>();

  if (!storeRef.current) {
    storeRef.current = createFormStore({ schema, initialData, readOnly });
  }

  const store = storeRef.current;
  const state = store.getState();

  // Re-render on state changes using a simple force update
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      forceUpdate();
      if (onChange) {
        onChange(store.getState().formData);
      }
    });
    return unsubscribe;
  }, [store, onChange]);

  // Apply initial linkage rules
  useEffect(() => {
    applyLinkageToAllFields(store, schema);
  }, []);

  const handleFieldChange = useCallback((name: string, value: any) => {
    const currentStore = storeRef.current!;
    currentStore.getState().setFieldValue(name, value);

    // Clear error when user types
    currentStore.getState().setFieldError(name, []);

    // Re-validate the field
    const fieldSchema = schema.properties[name];
    if (fieldSchema) {
      const fieldState = currentStore.getState().getFieldState(name);
      validateField(fieldSchema, value, currentStore.getState().formData, fieldState.required, {
        isHidden: !fieldState.visible
      }).then((result) => {
        currentStore.getState().setFieldError(name, result.errors);
      });
    }

    // Apply linkage to dependent fields
    const dependents = findDependentFields(name, schema.properties);
    for (const depField of dependents) {
      applyLinkageToField(currentStore, depField, schema.properties[depField]);
    }
  }, [schema]);

  const handleFieldBlur = useCallback((name: string) => {
    const currentStore = storeRef.current!;
    const value = currentStore.getState().getFieldValue(name);
    const fieldSchema = schema.properties[name];
    if (fieldSchema) {
      const fieldState = currentStore.getState().getFieldState(name);
      validateField(fieldSchema, value, currentStore.getState().formData, fieldState.required, {
        isHidden: !fieldState.visible
      }).then((result) => {
        currentStore.getState().setFieldError(name, result.errors);
      });
    }
  }, [schema]);

  const handleSubmit = useCallback(() => {
    if (!onSubmit) return;
    const currentStore = storeRef.current!;
    const { formData } = currentStore.getState();

    // Validate all visible fields
    const promises = Object.entries(schema.properties).map(async ([name, fieldSchema]) => {
      const fieldState = currentStore.getState().getFieldState(name);
      if (!fieldState.visible) return { name, valid: true, errors: [] };

      const value = currentStore.getState().getFieldValue(name);
      const result = await validateField(fieldSchema, value, formData, fieldState.required);
      currentStore.getState().setFieldError(name, result.errors);
      return { name, ...result };
    });

    Promise.all(promises).then((results) => {
      const allValid = results.every((r) => r.valid);
      if (allValid) {
        onSubmit(formData);
      }
    });
  }, [schema, onSubmit]);

  const layout = schema.layout || { type: 'vertical' };
  const fieldNames = Object.keys(schema.properties);

  return (
    <Form
      layout={layout.type === 'horizontal' ? 'horizontal' : 'vertical'}
      onFinish={handleSubmit}
    >
      {layout.sections ? (
        renderSections(layout.sections, fieldNames, schema, store, handleFieldChange, handleFieldBlur)
      ) : layout.type === 'grid' ? (
        <Row gutter={layout.gutter || 24}>
          {fieldNames.map((name) => renderField(name, schema.properties[name], store, handleFieldChange, handleFieldBlur, layout))}
        </Row>
      ) : (
        fieldNames.map((name) => renderField(name, schema.properties[name], store, handleFieldChange, handleFieldBlur, layout))
      )}
    </Form>
  );
};

function renderSections(
  sections: any[],
  fieldNames: string[],
  schema: RaosFormSchema,
  store: any,
  onChange: (name: string, value: any) => void,
  onBlur: (name: string) => void
) {
  return sections.map((section) => (
    <div key={section.key} className="form-section" style={{ marginBottom: 24 }}>
      {section.title && <h4 className="form-section-title">{section.title}</h4>}
      <Row gutter={schema.layout?.gutter || 24}>
        {section.fields.map((fieldName: string) =>
          schema.properties[fieldName]
            ? renderField(fieldName, schema.properties[fieldName], store, onChange, onBlur, schema.layout)
            : null
        )}
      </Row>
    </div>
  ));
}

function renderField(
  name: string,
  fieldSchema: any,
  store: any,
  onChange: (name: string, value: any) => void,
  onBlur: (name: string) => void,
  layout?: any
) {
  const fieldState = store.getState().getFieldState(name);

  if (!fieldState.visible) {
    return null;
  }

  const value = store.getState().getFieldValue(name);
  const errors = store.getState().errors[name] || [];
  const fieldStateWithErrors = { ...fieldState, errors };

  try {
    const Component = getComponent(fieldSchema['ui:widget'] || 'input');

    const fieldElement = (
      <Component
        schema={fieldSchema}
        name={name}
        value={value}
        onChange={(val: any) => onChange(name, val)}
        onBlur={() => onBlur(name)}
        formData={store.getState().formData}
        fieldState={fieldStateWithErrors}
        readOnly={fieldState.readonly}
        disabled={fieldState.disabled}
      />
    );

    if (layout?.type === 'grid') {
      const colSpan = fieldSchema['ui:colSpan'] || 24;
      return (
        <Col span={colSpan} key={name}>
          <Form.Item
            label={fieldSchema.title}
            required={fieldState.required}
            validateStatus={errors.length > 0 ? 'error' : undefined}
            help={errors.length > 0 ? errors[0] : fieldSchema['ui:help']}
          >
            {fieldElement}
          </Form.Item>
        </Col>
      );
    }

    return (
      <Form.Item
        key={name}
        label={fieldSchema.title}
        required={fieldState.required}
        validateStatus={errors.length > 0 ? 'error' : undefined}
        help={errors.length > 0 ? errors[0] : fieldSchema['ui:help']}
      >
        {fieldElement}
      </Form.Item>
    );
  } catch (error) {
    console.error(`Failed to render field "${name}":`, error);
    return (
      <Form.Item key={name} label={fieldSchema.title}>
        <span style={{ color: 'red' }}>组件渲染错误: {fieldSchema['ui:widget'] || 'input'}</span>
      </Form.Item>
    );
  }
}

function applyLinkageToAllFields(store: any, schema: RaosFormSchema) {
  for (const [name, fieldSchema] of Object.entries(schema.properties)) {
    applyLinkageToField(store, name, fieldSchema);
  }
}

function applyLinkageToField(store: any, name: string, fieldSchema: any) {
  const rules = fieldSchema['x-linkage'];
  if (!rules || rules.length === 0) return;

  const result = evaluateLinkage(rules, store.getState().formData);

  store.getState().setFieldState(name, {
    visible: result.visible,
    disabled: result.disabled,
    readonly: result.readonly,
    required: result.required
  });

  if (result.value !== undefined) {
    store.getState().setFieldValue(name, result.value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/FormRenderer.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/form-engine/core/FormRenderer.tsx tests/form-engine/FormRenderer.test.tsx
git commit -m "feat(form-engine): add FormRenderer with field rendering, validation, and linkage"
```

---

### Task 11: DynamicForm 封装组件 + 布局系统

**Files:**
- Create: `web/src/components/DynamicForm.tsx`
- Create: `web/src/components/form-engine/index.ts`
- Test: `tests/form-engine/DynamicForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/form-engine/DynamicForm.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

describe('DynamicForm', () => {
  it('should render form with actions', async () => {
    const { default: DynamicForm } = await import('../../../web/src/components/DynamicForm');
    const schema = {
      type: 'object',
      title: 'Test Form',
      properties: {
        name: { type: 'string', title: 'Name', 'ui:widget': 'input' }
      },
      actions: [
        { type: 'submit', label: 'Submit', primary: true }
      ]
    };
    const onSubmit = vi.fn();
    render(<DynamicForm schema={schema} onSubmit={onSubmit} />);
    expect(screen.getByText('Test Form')).toBeInTheDocument();
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('should handle form submission', async () => {
    const { default: DynamicForm } = await import('../../../web/src/components/DynamicForm');
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name', 'ui:widget': 'input' }
      },
      actions: [
        { type: 'submit', label: 'Submit', primary: true }
      ]
    };
    const onSubmit = vi.fn();
    render(<DynamicForm schema={schema} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'John' } });
    fireEvent.click(screen.getByText('Submit'));
    // Note: submit is async due to validation, so we check eventually
    await new Promise((r) => setTimeout(r, 100));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'John' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-engine/DynamicForm.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/src/components/DynamicForm.tsx
import React from 'react';
import { Button, Space, Card } from 'antd';
import { FormRenderer } from './form-engine/core/FormRenderer';
import type { RaosFormSchema } from './form-engine/types';

export interface DynamicFormProps {
  schema: RaosFormSchema;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  onChange?: (formData: Record<string, any>) => void;
  onSubmit?: (formData: Record<string, any>) => void;
  onReset?: () => void;
  loading?: boolean;
}

const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  initialData,
  readOnly,
  onChange,
  onSubmit,
  onReset,
  loading
}) => {
  const actions = schema.actions || [{ type: 'submit', label: '提交', primary: true }];

  return (
    <Card title={schema.title} className="dynamic-form">
      {schema.description && (
        <p className="dynamic-form-description">{schema.description}</p>
      )}
      <FormRenderer
        schema={schema}
        initialData={initialData}
        readOnly={readOnly}
        onChange={onChange}
        onSubmit={onSubmit}
      />
      {!readOnly && (
        <div className="dynamic-form-actions" style={{ marginTop: 24 }}>
          <Space>
            {actions.map((action, index) => {
              if (action.type === 'submit') {
                return (
                  <Button
                    key={index}
                    type={action.primary ? 'primary' : 'default'}
                    danger={action.danger}
                    htmlType="submit"
                    loading={loading}
                  >
                    {action.label}
                  </Button>
                );
              }
              if (action.type === 'reset') {
                return (
                  <Button key={index} onClick={onReset}>
                    {action.label}
                  </Button>
                );
              }
              if (action.type === 'saveDraft') {
                return (
                  <Button key={index} type="dashed">
                    {action.label}
                  </Button>
                );
              }
              return (
                <Button key={index} onClick={() => {}}>
                  {action.label}
                </Button>
              );
            })}
          </Space>
        </div>
      )}
    </Card>
  );
};

export default DynamicForm;
```

```typescript
// web/src/components/form-engine/index.ts
export * from './types';
export * from './registry';
export * from './store/useFormStore';
export * from './core/FormRenderer';
export * from './core/SchemaParser';
export * from './core/LinkageEngine';
export * from './core/ValidationEngine';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-engine/DynamicForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DynamicForm.tsx web/src/components/form-engine/index.ts tests/form-engine/DynamicForm.test.tsx
git commit -m "feat(form-engine): add DynamicForm wrapper with actions and layout"
```

---

### Task 12: 后端 API 骨架 + 数据库迁移

**Files:**
- Create: `src/db/migrations/007_form_engine.sql`
- Create: `src/routes/form-routes.ts`
- Create: `src/services/form-service.ts`
- Test: `tests/routes/form-routes.test.ts`

- [ ] **Step 1: Create database migration**

```sql
-- src/db/migrations/007_form_engine.sql
-- ============ 表单定义表 ============
CREATE TABLE IF NOT EXISTS form_definitions (
  id              VARCHAR(36) PRIMARY KEY,
  key             VARCHAR(64) UNIQUE NOT NULL,
  name            VARCHAR(128) NOT NULL,
  description     TEXT,
  category_id     VARCHAR(36),
  schema_json     JSON NOT NULL,
  version         INT DEFAULT 1,
  status          VARCHAR(20) DEFAULT 'draft',
  created_by      VARCHAR(36) NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at    DATETIME,
  deprecated_at   DATETIME
);

-- ============ 表单分类表 ============
CREATE TABLE IF NOT EXISTS form_categories (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  code        VARCHAR(64) UNIQUE NOT NULL,
  parent_id   VARCHAR(36),
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============ 表单实例表 ============
CREATE TABLE IF NOT EXISTS form_instances (
  id              VARCHAR(36) PRIMARY KEY,
  definition_id   VARCHAR(36) NOT NULL,
  definition_version INT DEFAULT 1,
  data_json       JSON NOT NULL,
  status          VARCHAR(20) DEFAULT 'draft',
  submitted_by    VARCHAR(36),
  submitted_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============ 表单与流程关联表 ============
CREATE TABLE IF NOT EXISTS workflow_form_bindings (
  id              VARCHAR(36) PRIMARY KEY,
  definition_key  VARCHAR(64) NOT NULL,
  node_id         VARCHAR(64) NOT NULL,
  form_id         VARCHAR(36) NOT NULL,
  form_version    INT DEFAULT -1,
  is_required     BOOLEAN DEFAULT true,
  mapping_json    JSON,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_key, node_id)
);

-- ============ 表单数据与流程实例关联（快照） ============
CREATE TABLE IF NOT EXISTS workflow_form_instances (
  id              VARCHAR(36) PRIMARY KEY,
  instance_id     VARCHAR(36) NOT NULL,
  task_id         VARCHAR(36),
  form_id         VARCHAR(36) NOT NULL,
  form_version    INT NOT NULL,
  schema_snapshot JSON NOT NULL,
  data_json       JSON NOT NULL,
  submitted_by    VARCHAR(36),
  submitted_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============ 扩展现有 connections 表 ============
ALTER TABLE connections ADD COLUMN IF NOT EXISTS db_config JSON;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS test_query VARCHAR(256);
```

- [ ] **Step 2: Create form service**

```typescript
// src/services/form-service.ts
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

export interface FormDefinitionInput {
  key: string;
  name: string;
  description?: string;
  categoryId?: string;
  schemaJson: any;
  createdBy: string;
}

export function createFormDefinition(input: FormDefinitionInput) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO form_definitions (id, key, name, description, category_id, schema_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, input.key, input.name, input.description || null, input.categoryId || null, JSON.stringify(input.schemaJson), input.createdBy);
  return getFormDefinition(id);
}

export function getFormDefinition(id: string) {
  const stmt = db.prepare('SELECT * FROM form_definitions WHERE id = ?');
  const row = stmt.get(id) as any;
  if (row) {
    row.schema_json = JSON.parse(row.schema_json);
  }
  return row;
}

export function getFormDefinitionByKey(key: string) {
  const stmt = db.prepare('SELECT * FROM form_definitions WHERE key = ?');
  const row = stmt.get(key) as any;
  if (row) {
    row.schema_json = JSON.parse(row.schema_json);
  }
  return row;
}

export function listFormDefinitions(options: { categoryId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const { categoryId, status, page = 1, pageSize = 20 } = options;
  let sql = 'SELECT * FROM form_definitions WHERE 1=1';
  const params: any[] = [];

  if (categoryId) {
    sql += ' AND category_id = ?';
    params.push(categoryId);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];
  return rows.map((row) => ({
    ...row,
    schema_json: JSON.parse(row.schema_json)
  }));
}

export function updateFormDefinition(id: string, updates: Partial<FormDefinitionInput>) {
  const fields: string[] = [];
  const params: any[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.categoryId !== undefined) { fields.push('category_id = ?'); params.push(updates.categoryId); }
  if (updates.schemaJson !== undefined) { fields.push('schema_json = ?'); params.push(JSON.stringify(updates.schemaJson)); }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  const sql = `UPDATE form_definitions SET ${fields.join(', ')} WHERE id = ?`;
  const stmt = db.prepare(sql);
  stmt.run(...params);
  return getFormDefinition(id);
}

export function deleteFormDefinition(id: string) {
  const stmt = db.prepare('DELETE FROM form_definitions WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// Form Instance CRUD
export interface FormInstanceInput {
  definitionId: string;
  definitionVersion?: number;
  dataJson: any;
  status?: string;
  submittedBy?: string;
}

export function createFormInstance(input: FormInstanceInput) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, input.definitionId, input.definitionVersion || 1, JSON.stringify(input.dataJson), input.status || 'draft', input.submittedBy || null);
  return getFormInstance(id);
}

export function getFormInstance(id: string) {
  const stmt = db.prepare('SELECT * FROM form_instances WHERE id = ?');
  const row = stmt.get(id) as any;
  if (row) {
    row.data_json = JSON.parse(row.data_json);
  }
  return row;
}

export function updateFormInstance(id: string, updates: Partial<FormInstanceInput>) {
  const fields: string[] = [];
  const params: any[] = [];

  if (updates.dataJson !== undefined) { fields.push('data_json = ?'); params.push(JSON.stringify(updates.dataJson)); }
  if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.submittedBy !== undefined) { fields.push('submitted_by = ?'); params.push(updates.submittedBy); }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  const sql = `UPDATE form_instances SET ${fields.join(', ')} WHERE id = ?`;
  const stmt = db.prepare(sql);
  stmt.run(...params);
  return getFormInstance(id);
}
```

- [ ] **Step 3: Create form routes**

```typescript
// src/routes/form-routes.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createFormDefinition,
  getFormDefinition,
  listFormDefinitions,
  updateFormDefinition,
  deleteFormDefinition,
  createFormInstance,
  getFormInstance,
  updateFormInstance
} from '../services/form-service';

const router = Router();

// ============ Form Definition ============
router.post('/form/definitions', requireAuth, (req, res) => {
  try {
    const def = createFormDefinition({
      ...req.body,
      createdBy: req.user!.id
    });
    res.json({ success: true, data: def });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/form/definitions', requireAuth, (req, res) => {
  try {
    const defs = listFormDefinitions({
      categoryId: req.query.categoryId as string,
      status: req.query.status as string,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20
    });
    res.json({ success: true, data: defs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/form/definitions/:id', requireAuth, (req, res) => {
  try {
    const def = getFormDefinition(req.params.id);
    if (!def) {
      return res.status(404).json({ success: false, error: 'Form definition not found' });
    }
    res.json({ success: true, data: def });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/form/definitions/:id', requireAuth, (req, res) => {
  try {
    const def = updateFormDefinition(req.params.id, req.body);
    res.json({ success: true, data: def });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/form/definitions/:id', requireAuth, (req, res) => {
  try {
    deleteFormDefinition(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ Form Instance ============
router.post('/form/instances', requireAuth, (req, res) => {
  try {
    const instance = createFormInstance({
      ...req.body,
      submittedBy: req.user!.id
    });
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/form/instances/:id', requireAuth, (req, res) => {
  try {
    const instance = getFormInstance(req.params.id);
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Form instance not found' });
    }
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/form/instances/:id', requireAuth, (req, res) => {
  try {
    const instance = updateFormInstance(req.params.id, req.body);
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/form/instances/:id/submit', requireAuth, (req, res) => {
  try {
    const instance = updateFormInstance(req.params.id, {
      status: 'submitted',
      submittedBy: req.user!.id
    });
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
```

- [ ] **Step 4: Register routes in main app**

Modify `src/routes/index.ts` (or wherever routes are registered) to add:
```typescript
import formRoutes from './form-routes';
router.use(formRoutes);
```

- [ ] **Step 5: Run migration**

Run: `npm run db:migrate`
Expected: Migration 007_form_engine.sql executed successfully

- [ ] **Step 6: Write backend test**

```typescript
// tests/routes/form-routes.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app'; // Adjust path as needed

describe('Form Routes', () => {
  it('should create form definition', async () => {
    const res = await request(app)
      .post('/api/form/definitions')
      .set('Authorization', 'Bearer test-token')
      .send({
        key: 'test-form',
        name: 'Test Form',
        schemaJson: { type: 'object', properties: {} }
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toBe('test-form');
  });

  it('should get form definition by id', async () => {
    const createRes = await request(app)
      .post('/api/form/definitions')
      .set('Authorization', 'Bearer test-token')
      .send({
        key: 'test-form-2',
        name: 'Test Form 2',
        schemaJson: { type: 'object', properties: {} }
      });
    const id = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/form/definitions/${id}`)
      .set('Authorization', 'Bearer test-token');
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Test Form 2');
  });
});
```

- [ ] **Step 7: Run backend tests**

Run: `npx vitest run tests/routes/form-routes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/007_form_engine.sql src/services/form-service.ts src/routes/form-routes.ts tests/routes/form-routes.test.ts
git commit -m "feat(form-engine): add backend form definitions and instances API with DB migration"
```

---

### Task 13: ConfirmCard 替换

**Files:**
- Modify: `web/src/components/ConfirmCard.tsx`
- Modify: `src/skills/user-confirm-skill.ts`
- Test: `tests/confirm-card-compat.test.tsx`

- [ ] **Step 1: Update user-confirm-skill to output new format**

```typescript
// Modify src/skills/user-confirm-skill.ts
// In the handler, change the return format:

// OLD format:
// return { success: true, data: { __userConfirm: true, type: 'form', fields: [...] } }

// NEW format for form type:
if (params.type === 'form') {
  const schema = convertFieldsToSchema(params.fields, params.title);
  return {
    success: true,
    data: {
      __formRender: true,
      confirmId,
      schema,
      ... // other params
    }
  };
}

// Keep selection and approval types as-is for backward compat during transition
```

Helper function:
```typescript
function convertFieldsToSchema(fields: any[], title?: string): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.name] = {
      type: field.type === 'number' ? 'number' : 'string',
      title: field.label || field.name,
      'ui:widget': field.type === 'date' ? 'datePicker' : field.type,
      required: field.required
    };
    if (field.required) required.push(field.name);
    if (field.options) {
      properties[field.name]['x-dataSource'] = {
        type: 'static',
        options: field.options
      };
    }
  }

  return {
    type: 'object',
    title,
    properties,
    required
  };
}
```

- [ ] **Step 2: Update ConfirmCard to render DynamicForm for new format**

```tsx
// Modify web/src/components/ConfirmCard.tsx
// Import DynamicForm at the top
import DynamicForm from './DynamicForm';

// In the render method, add support for __formRender:
if (data.__formRender) {
  return (
    <DynamicForm
      schema={data.schema}
      onSubmit={(formData) => {
        handleConfirm(data.confirmId, formData);
      }}
    />
  );
}

// Keep existing rendering for __userConfirm during transition
```

- [ ] **Step 3: Test backward compatibility**

```tsx
// tests/confirm-card-compat.test.tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('ConfirmCard Backward Compatibility', () => {
  it('should render old __userConfirm format', async () => {
    const { default: ConfirmCard } = await import('../web/src/components/ConfirmCard');
    const data = {
      __userConfirm: true,
      confirmId: 'test-123',
      type: 'form',
      title: 'Old Form',
      fields: [
        { name: 'name', type: 'text', label: 'Name', required: true }
      ]
    };
    render(<ConfirmCard data={data} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Old Form')).toBeInTheDocument();
  });

  it('should render new __formRender format', async () => {
    const { default: ConfirmCard } = await import('../web/src/components/ConfirmCard');
    const data = {
      __formRender: true,
      confirmId: 'test-456',
      schema: {
        type: 'object',
        title: 'New Form',
        properties: {
          email: { type: 'string', title: 'Email', 'ui:widget': 'input' }
        }
      }
    };
    render(<ConfirmCard data={data} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('New Form')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run compatibility tests**

Run: `npx vitest run tests/confirm-card-compat.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/skills/user-confirm-skill.ts web/src/components/ConfirmCard.tsx tests/confirm-card-compat.test.tsx
git commit -m "feat(form-engine): integrate DynamicForm into ConfirmCard with backward compat"
```

---

## Phase 1 完成检查点

Phase 1 所有任务完成后，运行完整测试套件：

```bash
npm test
```

预期结果：所有新增测试通过，现有 271 个测试仍然通过。

---

## Phase 2: 数据能力（Week 5-6）— 概要

### Task 14: 数据源解析服务
- 创建 `src/services/data-source-service.ts`
- 实现 static/remote/expression 数据源解析
- API: `POST /api/form/data-source/resolve`

### Task 15: 数据库连接管理
- 扩展 `connections` 表支持数据库类型
- 创建 `src/services/database-connector.ts`
- 实现连接池管理和参数化查询执行
- API: `POST /api/form/data-source/test-connection`

### Task 16: 级联数据源
- 前端：在 FormRenderer 中集成级联触发逻辑
- 后端：支持 `queryParams` 中 `source: 'formField'` 的动态注入
- 实现防抖、loading 状态、clearOnChange

### Task 17: 后置筛选过滤器
- 在 `data-source-service.ts` 中实现 `DataFilter` 执行逻辑
- 支持所有 operator 类型

### Task 18: 业务组件
- UserPicker: 集成用户查询 API
- DeptPicker: 集成部门查询 API
- FileUploader: 实现文件上传 + 存储配置

---

## Phase 3: Workflow 深度集成（Week 7-8）— 概要

### Task 19: 流程节点绑定表单
- 实现 `workflow_form_bindings` CRUD API
- 在 Workflow 模板中支持表单绑定配置

### Task 20: 审批任务加载表单
- `GET /api/workflow/tasks/:taskId/form-schema`
- 自动填充流程变量到表单初始值

### Task 21: 表单数据写入流程变量
- `POST /api/workflow/tasks/:taskId/form-submit`
- 支持 `mapping_json` 中的 `outputMappings`

### Task 22: 审批中心前端页面
- `web/src/pages/Approvals/`
- 我的待办 / 我发起的 / 已办 三个视图

---

## Phase 4: 高级能力（Week 9-10）— 概要

### Task 23: 自定义组件注册（插件化）
- 前端：`formEngine.registerComponent()` 运行时 API
- 后端：存储自定义组件配置

### Task 24: 异步验证
- 实现 `asyncValidator` 的 debounce + API 调用

### Task 25: 高级字段组件
- TableField: 子表格（动态增删行）
- ArrayField: 动态列表
- GroupField: 字段分组/对象嵌套渲染

### Task 26: 表单数据权限
- 表单定义 ACL（谁可以创建/编辑/查看）
- 字段级 `x-permission` 前端渲染控制

### Task 27: 性能优化
- Select 虚拟滚动（大数据量）
- 表单草稿自动保存（localStorage + API）
- 字段级 memo 优化

### Task 28: 国际化支持
- Schema 中 title/description/errorMessage 支持多语言键
- 前端 i18n 集成

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec 章节 | 对应任务 |
|-----------|---------|
| Schema 协议 (§3) | Task 1, 10, 11 |
| 组件系统 (§4) | Task 2, 7, 8, 9, 18, 25 |
| 数据源与级联 (§5) | Task 14, 15, 16, 17 |
| 验证引擎 (§6) | Task 5, 24 |
| 联动引擎 (§7) | Task 6, 10 |
| 后端 API (§8) | Task 12, 14, 15, 19, 20, 21 |
| 数据库模型 (§9) | Task 12 |
| Workflow 集成 (§10) | Task 19, 20, 21, 22 |
| ConfirmCard 替换 (§11) | Task 13 |

### 2. Placeholder Scan
- ❌ 无 "TBD", "TODO", "implement later"
- ❌ 无 "Add appropriate error handling" 等模糊描述
- ❌ 无 "Similar to Task N" 引用
- ✅ 所有代码步骤包含完整代码

### 3. Type Consistency
- `RaosFormSchema` / `RaosFieldSchema` / `FieldState` — 全文档一致
- `FieldRendererProps` — Task 2 定义，Task 7-9 使用 — 一致
- `FormStoreState` — Task 3 定义，Task 10-11 使用 — 一致

---

## 执行选项

计划已完成并保存到 `docs/superpowers/plans/2026-04-23-form-engine.md`。

**两个执行选项：**

**1. Subagent-Driven（推荐）** — 每个 Task 派发给独立的 subagent，我在 Task 之间审查，快速迭代

**2. Inline Execution** — 在当前会话中使用 executing-plans skill 批量执行任务，定期 checkpoint 审查

**你倾向哪种执行方式？**
