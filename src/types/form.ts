/**
 * RAOS Form Engine - Schema Type Definitions (Backend)
 *
 * 本文件与前端 web/src/components/form-engine/types.ts 保持内容同步。
 * 由于前后端 tsconfig 的 rootDir / include 限制，此处为独立副本，
 * 任何修改请同步到前端对应文件。
 */

// ───────────────────────────────────────────────────────────────
// 根级 Schema
// ───────────────────────────────────────────────────────────────

export interface RaosFormSchema {
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, RaosFieldSchema>;
  required?: string[];
  layout?: FormLayout;
  actions?: FormAction[];
}

// ───────────────────────────────────────────────────────────────
// 字段 Schema
// ───────────────────────────────────────────────────────────────

export interface RaosFieldSchema {
  type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object";
  title: string;
  description?: string;
  default?: any;
  required?: boolean; // 快捷标记
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?:
    | "email"
    | "url"
    | "date"
    | "datetime"
    | "time"
    | "mobile"
    | "idCard";
  errorMessage?:
    | string
    | {
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
  "ui:widget"?: string;
  "ui:props"?: Record<string, any>;
  "ui:colSpan"?: number; // 默认 24
  "ui:placeholder"?: string;
  "ui:help"?: string;
  "ui:hidden"?: boolean | string;
  "ui:disabled"?: boolean | string;
  "ui:readonly"?: boolean | string;
  "x-linkage"?: LinkageRule[];
  "x-dataSource"?: DataSourceConfig;
  "x-workflow"?: {
    variableName?: string;
    autoFillFromVar?: boolean;
  };
  "x-permission"?: {
    read?: string[];
    write?: string[];
  };
  "x-asyncValidator"?: AsyncValidatorConfig;
  properties?: Record<string, RaosFieldSchema>; // type: 'object' 时
  items?: RaosFieldSchema; // type: 'array' 时
}

export interface AsyncValidatorConfig {
  type: "remote";
  url: string;
  method?: "GET" | "POST";
  fieldParam?: string;
  debounce?: number;
}

// ───────────────────────────────────────────────────────────────
// 布局
// ───────────────────────────────────────────────────────────────

export interface FormLayout {
  type: "vertical" | "horizontal" | "inline" | "grid";
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
  type: "submit" | "reset" | "saveDraft" | "cancel" | "custom";
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: string;
}

// ───────────────────────────────────────────────────────────────
// 联动规则
// ───────────────────────────────────────────────────────────────

export interface LinkageRule {
  type:
    | "visible"
    | "hidden"
    | "disabled"
    | "enabled"
    | "readonly"
    | "editable"
    | "required"
    | "optional"
    | "setValue"
    | "clearValue"
    | "setOptions"
    | "validate";
  when: string;
  then?: any;
  else?: any;
}

// ───────────────────────────────────────────────────────────────
// 数据源
// ───────────────────────────────────────────────────────────────

export interface DataSourceConfig {
  type: "static" | "remote" | "database" | "workflowVar" | "expression";
  options?: Array<{ label: string; value: any; children?: any[] }>;
  url?: string;
  method?: "GET" | "POST";
  params?: Record<string, any>;
  headers?: Record<string, string>;
  path?: string;
  database?: DatabaseSourceConfig;
  cascade?: CascadeConfig;
  variableName?: string;
  expression?: string;
  filters?: DataFilter[];
}

export interface DatabaseSourceConfig {
  connectionId?: string;
  connectionType?: "mysql" | "postgresql" | "sqlite" | "mssql" | "mongodb";
  query: string;
  queryParams?: Array<{
    name: string;
    value?: string | number | boolean;
    type?: "string" | "number" | "boolean" | "date";
    source?: "static" | "formField" | "workflowVar" | "userContext";
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
  trigger?: "onChange" | "onBlur";
  debounce?: number;
  clearOnChange?: boolean;
  loadingText?: string;
  placeholderText?: string;
  executeWhen?: "allFilled" | "anyFilled" | "always";
}

export interface DataFilter {
  field: string;
  operator:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "startsWith"
    | "endsWith"
    | "in"
    | "notIn"
    | "between"
    | "isNull"
    | "isNotNull";
  value?: any;
  logic?: "and" | "or";
}

// ───────────────────────────────────────────────────────────────
// 字段状态 & 校验
// ───────────────────────────────────────────────────────────────

export interface FieldState {
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  options?: Array<{ label: string; value: any }>;
  loading?: boolean;
  errors?: string[];
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
