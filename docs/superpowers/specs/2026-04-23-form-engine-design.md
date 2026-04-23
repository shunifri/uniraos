# RAOS 低代码表单引擎设计文档

> **版本**: v1.0  
> **日期**: 2026-04-23  
> **状态**: 已确认，待实施

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [架构设计](#2-架构设计)
3. [Schema 协议](#3-schema-协议)
4. [组件系统](#4-组件系统)
5. [数据源与级联查询](#5-数据源与级联查询)
6. [验证引擎](#6-验证引擎)
7. [联动引擎](#7-联动引擎)
8. [后端 API 设计](#8-后端-api-设计)
9. [数据库模型](#9-数据库模型)
10. [与 Workflow 集成](#10-与-workflow-集成)
11. [ConfirmCard 替换策略](#11-confirmcard-替换策略)
12. [实施路线图](#12-实施路线图)
13. [技术栈](#13-技术栈)
14. [安全与性能](#14-安全与性能)

---

## 1. 背景与目标

### 1.1 现状问题

RAOS 当前表单能力由 `ConfirmCard` 提供，存在以下局限：

- **字段类型缺失**：仅支持 7 种基础类型（text/number/select/radio/checkbox/textarea/date），缺少 file/user/department 等类型
- **无验证能力**：只有 `required` 标记，后端定义的 `ValidationRule`（min/max/pattern/email）未实现
- **布局单一**：仅支持垂直排列，无网格、分组、条件显示
- **无联动能力**：字段间无法联动（显隐、禁用、赋值）
- **使用场景受限**：只能嵌入聊天界面，无法作为独立表单页面使用
- **与 Workflow 割裂**：审批流程的 `user_task` 无法自动渲染表单

### 1.2 目标

构建**自研轻量 JSON Schema 驱动表单引擎**，实现：

1. **丰富的组件生态**：20+ 内置组件 + 自定义注册机制
2. **强大的数据能力**：第三方数据库查询、HTTP API、级联联动、后置筛选
3. **完整的验证体系**：JSON Schema 标准验证 + 自定义表达式 + 异步验证
4. **灵活的联动引擎**：字段显隐/禁用/赋值/必填联动
5. **与 Workflow 深度集成**：审批节点自动绑定表单，数据双向同步
6. **替换 ConfirmCard**：向下兼容简单场景，统一表单渲染入口
7. **低代码扩展性**：Schema 协议为未来可视化设计器奠定基础

### 1.3 使用场景

- **A. 审批流程表单**：Workflow `user_task` 节点关联表单，审批人填写后提交
- **B. 通用独立表单**：数据收集、调查问卷、配置页面等独立页面表单
- **C. AI 对话表单**：替换现有 ConfirmCard，AI 通过 Skill 动态生成表单 Schema

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     RAOS Form Engine                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │
│  │   Designer  │  │  Form Store │  │   Workflow Bridge   │     │
│  │  (Phase 2)  │  │    (API)    │  │   (Integration)     │     │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘     │
│         │                │                     │                │
│         └────────────────┼─────────────────────┘                │
│                          ▼                                      │
│              ┌──────────────────────┐                           │
│              │    RaosFormSchema    │                           │
│              │ (JSON Schema + Ext)  │                           │
│              │  Stored in DB / JSON │                           │
│              └──────────┬───────────┘                           │
│                         │                                       │
│  ┌──────────────────────┼────────────────────────────────────┐  │
│  │                      ▼                                      │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │           FormRenderer (React)                       │   │  │
│  │  │  ┌────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │   │  │
│  │  │  │Schema  │ │Component │ │Linkage │ │Validation │  │   │  │
│  │  │  │Parser  │ │Registry  │ │Engine  │ │  Engine   │  │   │  │
│  │  │  └────────┘ └──────────┘ └────────┘ └───────────┘  │   │  │
│  │  │                      │                              │   │  │
│  │  │  ┌───────────────────┼──────────────────────────┐   │   │  │
│  │  │  │           Field Renderers                    │   │   │  │
│  │  │  │  Input · Select · Date · File · Table       │   │   │  │
│  │  │  │  UserPicker · DeptPicker · Radio · ...      │   │   │  │
│  │  │  └─────────────────────────────────────────────┘   │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                      │                                      │  │
│  │              Ant Design 5 + Tailwind CSS                   │  │
│  └──────────────────────┼────────────────────────────────────┘  │
│                         │                                       │
│              ┌──────────┴──────────┐                            │
│              │    Zustand Store     │                            │
│              │ (formData / errors / │                            │
│              │  fieldStates / meta) │                            │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流

```
1. 表单配置流:
   Admin/AI → API → form_definitions (DB) → FormRenderer ← Schema

2. 表单使用流:
   User → FormRenderer → Zustand Store → Validation → API → form_instances (DB)

3. 审批集成流:
   Workflow Engine → user_task → 加载关联 formSchema → 渲染审批表单
   → 用户填写提交 → formData 写入 workflow_variables → 引擎继续流转
```

### 2.3 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Schema 基础 | 扩展 JSON Schema | 标准兼容，业界通用，后端可直接验证 |
| 状态管理 | Zustand（复用现有） | 避免引入新依赖，团队已熟悉 |
| UI 组件 | Ant Design 5（复用现有） | 风格统一，组件成熟 |
| 联动语法 | 轻量表达式 `{{field.path}}` | 比 Formily 的响应式简单，比 X-Render 灵活 |
| 渲染策略 | 字段级独立更新 | `React.memo` + 细粒度 `onFieldChange`，避免整表单重渲染 |
| 数据源查询 | 后端执行（参数化 SQL） | 安全、支持大数据量、权限隔离、级联查询 |

---

## 3. Schema 协议

### 3.1 核心类型定义

```typescript
// ============ 根级 Schema ============
interface RaosFormSchema {
  type: 'object';
  title?: string;
  description?: string;
  properties: Record<string, RaosFieldSchema>;
  required?: string[];
  layout?: FormLayout;
  actions?: FormAction[];
}

// ============ 字段 Schema ============
interface RaosFieldSchema {
  // JSON Schema 标准属性
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title: string;
  description?: string;
  default?: any;

  // 验证规则（字段级 required 仅作为快捷标记，根级 required 数组为权威定义）
  required?: boolean;        // 快捷标记，最终生效以根级 required 数组为准
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

  // UI 配置（ui: 前缀）
  'ui:widget'?: string;
  'ui:props'?: Record<string, any>;
  'ui:colSpan'?: number;          // 默认值 24（占满整行）
  'ui:placeholder'?: string;
  'ui:help'?: string;
  'ui:hidden'?: boolean | string;
  'ui:disabled'?: boolean | string;
  'ui:readonly'?: boolean | string;

  // 联动规则
  'x-linkage'?: LinkageRule[];

  // ── 权限控制（字段级） ──
  'x-permission'?: {
    read?: string[];    // 可读取该字段的角色列表，空数组表示所有人
    write?: string[];   // 可编辑该字段的角色列表，空数组表示所有人
  };

  // 数据源
  'x-dataSource'?: DataSourceConfig;

  // 审批扩展
  'x-workflow'?: {
    variableName?: string;
    autoFillFromVar?: boolean;
  };
}

// ============ 布局配置 ============
interface FormLayout {
  type: 'vertical' | 'horizontal' | 'inline' | 'grid';
  columns?: number;
  gutter?: number;
  sections?: FormSection[];
}

interface FormSection {
  title?: string;
  key: string;
  fields: string[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

interface FormAction {
  type: 'submit' | 'reset' | 'saveDraft' | 'cancel' | 'custom';
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: string;
}

// ============ 表达式上下文 ============
// 表达式中可访问的上下文变量：
// - {{fieldName}}        — 表单字段值（支持嵌套如 {{user.name}}）
// - {{user.xxx}}         — 当前登录用户属性（id, name, email, deptId, role, directManager, deptManager）
// - {{workflowVar.xxx}}  — 流程变量（仅在审批场景可用）
// - expr:...             — JavaScript 表达式前缀，在受控沙箱中执行

// ============ 联动规则 ============
interface LinkageRule {
  type: 'visible' | 'hidden' | 'disabled' | 'enabled'
      | 'readonly' | 'editable' | 'required' | 'optional'
      | 'setValue' | 'clearValue' | 'setOptions' | 'validate';
  when: string;        // 条件表达式
  then?: any;          // 条件为真时的值/行为
  else?: any;          // 条件为假时的值/行为（可选）
}
```

### 3.2 完整示例：请假申请表单

```json
{
  "type": "object",
  "title": "请假申请表",
  "properties": {
    "leaveType": {
      "type": "string",
      "title": "请假类型",
      "ui:widget": "select",
      "ui:colSpan": 12,
      "x-dataSource": {
        "type": "static",
        "options": [
          { "label": "事假", "value": "personal" },
          { "label": "病假", "value": "sick" },
          { "label": "年假", "value": "annual" }
        ]
      }
    },
    "startDate": {
      "type": "string",
      "title": "开始日期",
      "format": "date",
      "ui:widget": "datePicker",
      "ui:colSpan": 12,
      "required": true
    },
    "endDate": {
      "type": "string",
      "title": "结束日期",
      "format": "date",
      "ui:widget": "datePicker",
      "ui:colSpan": 12,
      "required": true
    },
    "days": {
      "type": "number",
      "title": "请假天数",
      "ui:widget": "number",
      "ui:colSpan": 12,
      "ui:disabled": true,
      "x-linkage": [
        {
          "type": "setValue",
          "when": "{{startDate}} && {{endDate}}",
          "then": "expr:Math.ceil((new Date({{endDate}}) - new Date({{startDate}})) / 86400000) + 1"
        }
      ]
    },
    "reason": {
      "type": "string",
      "title": "请假原因",
      "ui:widget": "textarea",
      "ui:props": { "rows": 4, "showCount": true, "maxLength": 500 },
      "required": true
    },
    "attachment": {
      "type": "string",
      "title": "附件",
      "ui:widget": "fileUploader",
      "ui:props": { "accept": ".pdf,.jpg,.png", "maxSize": 10485760 },
      "x-linkage": [
        { "type": "visible", "when": "{{leaveType}} === 'sick'" }
      ]
    },
    "approver": {
      "type": "string",
      "title": "审批人",
      "ui:widget": "userPicker",
      "ui:props": { "multiple": false, "scope": "manager" },
      "required": true
    }
  },
  "required": ["leaveType", "startDate", "endDate", "reason"],
  "layout": {
    "type": "grid",
    "columns": 2,
    "gutter": 24,
    "sections": [
      { "title": "基本信息", "key": "basic", "fields": ["leaveType", "startDate", "endDate", "days"] },
      { "title": "申请详情", "key": "detail", "fields": ["reason", "attachment"] },
      { "title": "审批配置", "key": "approval", "fields": ["approver"] }
    ]
  },
  "actions": [
    { "type": "submit", "label": "提交申请", "primary": true },
    { "type": "reset", "label": "重置" },
    { "type": "saveDraft", "label": "保存草稿" }
  ]
}
```

---

## 4. 组件系统

### 4.1 组件注册表

```typescript
interface ComponentRegistry {
  [widgetType: string]: React.FC<FieldRendererProps>;
}

interface FieldRendererProps {
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

interface FieldState {
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  options?: Array<{label: string; value: any}>;
  loading?: boolean;
  errors?: string[];
}
```

### 4.2 内置组件清单（Phase 1）

```typescript
const builtInComponents: ComponentRegistry = {
  // 基础输入
  'input': TextInput,
  'textarea': TextArea,
  'number': NumberInput,
  'password': PasswordInput,

  // 选择类
  'select': SelectInput,
  'radio': RadioGroup,
  'checkbox': CheckboxGroup,
  'switch': SwitchInput,
  'slider': SliderInput,

  // 日期时间
  'datePicker': DatePicker,
  'dateRange': DateRangePicker,
  'timePicker': TimePicker,

  // 上传
  'fileUploader': FileUploader,
  'imageUploader': ImageUploader,

  // 业务组件（RAOS 特有）
  'userPicker': UserPicker,
  'deptPicker': DeptPicker,
  'richText': RichTextEditor,
  'markdown': MarkdownEditor,

  // 高级组件
  'table': TableField,
  'group': GroupField,
  'array': ArrayField,
  'rate': RateInput,
};

// 运行时扩展注册
formEngine.registerComponent('customWidget', CustomWidget);
```


---

## 5. 数据源与级联查询

### 5.1 数据源配置类型

```typescript
interface DataSourceConfig {
  type: 'static' | 'remote' | 'database' | 'workflowVar' | 'expression';
  // 注意：cascade 不是独立的 type，而是通过 cascade 配置项启用在任何数据源上

  // static: 硬编码选项
  options?: Array<{ label: string; value: any; children?: any[] }>;

  // remote: HTTP API
  url?: string;
  method?: 'GET' | 'POST';
  params?: Record<string, any>;
  headers?: Record<string, string>;
  path?: string;

  // database: 第三方数据库查询
  database?: DatabaseSourceConfig;

  // cascade: 级联配置
  cascade?: CascadeConfig;

  // workflowVar: 从流程变量读取
  variableName?: string;

  // expression: 从其他字段计算
  expression?: string;
}

// ============ 数据库数据源配置 ============
interface DatabaseSourceConfig {
  // 方式1: 引用预配置连接（推荐，生产环境）
  connectionId?: string;

  // 方式2: 内联配置（仅测试/开发）
  connectionType?: 'mysql' | 'postgresql' | 'sqlite' | 'mssql' | 'mongodb';

  // 查询定义
  query: string;
  queryParams?: Array<{
    name: string;
    value?: string | number | boolean;
    type?: 'string' | 'number' | 'boolean' | 'date';
    source?: 'static' | 'formField' | 'workflowVar' | 'userContext';
    sourceField?: string;
  }>;

  // 字段映射
  labelField: string;
  valueField: string;
  extraFields?: string[];

  // 后置逻辑筛选
  filters?: DataFilter[];

  // 性能控制
  timeout?: number;
  cache?: number;
  maxResults?: number;
}

// ============ 级联配置 ============
interface CascadeConfig {
  dependency: string | string[];
  trigger?: 'onChange' | 'onBlur';
  debounce?: number;
  clearOnChange?: boolean;
  loadingText?: string;
  placeholderText?: string;
  executeWhen?: 'allFilled' | 'anyFilled' | 'always';
}

// ============ 数据筛选器（后置逻辑筛选） ============
interface DataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
          | 'contains' | 'startsWith' | 'endsWith'
          | 'in' | 'notIn' | 'between' | 'isNull' | 'isNotNull';
  value?: any;
  logic?: 'and' | 'or';
}
```

### 5.2 级联查询数据流

```
用户选择部门 "dept_001"
    │
    ▼
FormRenderer 检测到 "department" 字段变化
    │
    ▼
检查所有字段的数据源，找出 queryParams 包含
source: "formField" 且 sourceField === "department" 的字段
    │
    ▼
employeeId 命中，标记为 needsReload
    │
    ▼
防抖 300ms → 进入 loading 状态 → 清空当前值（如果 clearOnChange）
    │
    ▼
POST /api/form/data-source/resolve
{
  "fieldSchema": { employeeId 的完整 schema },
  "formData": { "department": "dept_001", ... },
  "dependencyValues": { "department": "dept_001" }
}
    │
    ▼
后端 DataSourceResolver:
  1. 解析 queryParams: deptId = formData.department = "dept_001"
  2. 构建参数化 SQL: SELECT id, name FROM employees WHERE dept_id = ?
  3. 执行查询（超时 5000ms）
  4. 应用后置 filters
  5. 返回 { options: [...], total: 42 }
    │
    ▼
前端更新 employeeId.options = [...]
如果旧值不在新 options 中，自动清空
```

### 5.3 级联查询示例

```json
{
  "department": {
    "type": "string",
    "title": "所属部门",
    "ui:widget": "select",
    "x-dataSource": {
      "type": "database",
      "database": {
        "connectionId": "conn-hr-db",
        "query": "SELECT dept_id as id, dept_name as name FROM departments WHERE status = 'active'",
        "labelField": "name",
        "valueField": "id"
      }
    }
  },
  "employeeId": {
    "type": "string",
    "title": "选择员工",
    "ui:widget": "select",
    "ui:props": { "showSearch": true },
    "x-dataSource": {
      "type": "database",
      "database": {
        "connectionId": "conn-hr-db",
        "query": "SELECT id, name, email FROM employees WHERE dept_id = ? AND status = 'active'",
        "queryParams": [
          {
            "name": "deptId",
            "type": "string",
            "source": "formField",
            "sourceField": "department"
          }
        ],
        "labelField": "name",
        "valueField": "id"
      },
      "cascade": {
        "dependency": "department",
        "trigger": "onChange",
        "debounce": 300,
        "clearOnChange": true,
        "executeWhen": "allFilled"
      }
    }
  }
}
```

### 5.4 多字段依赖示例

```json
{
  "projectMember": {
    "type": "string",
    "title": "项目成员",
    "ui:widget": "select",
    "x-dataSource": {
      "type": "database",
      "database": {
        "query": "SELECT u.id, u.name FROM users u JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ? AND u.dept_id = ?",
        "queryParams": [
          { "name": "projectId", "type": "string", "source": "formField", "sourceField": "project" },
          { "name": "deptId", "type": "string", "source": "formField", "sourceField": "department" }
        ],
        "labelField": "name",
        "valueField": "id"
      },
      "cascade": {
        "dependency": ["project", "department"],
        "trigger": "onChange",
        "debounce": 500,
        "clearOnChange": true,
        "executeWhen": "allFilled"
      }
    }
  }
}
```

### 5.4 数据筛选器表达式

`DataFilter.value` 支持完整的表达式语法（与 `x-linkage.when` 一致）：

```json
{
  "filters": [
    { "field": "status", "operator": "eq", "value": "active" },
    { "field": "deptId", "operator": "eq", "value": "{{department}}" },
    { "field": "createTime", "operator": "gte", "value": "{{startDate}}", "logic": "and" }
  ]
}
```

### 5.5 性能优化策略

| 策略 | 实现 |
|------|------|
| **防抖（Debounce）** | 可配置，默认 300ms |
| **请求去重** | 相同参数并发请求合并为一次 |
| **前端缓存** | 最近 20 条查询结果内存缓存 |
| **后端缓存** | 可配置 cache TTL |
| **分页加载** | 虚拟滚动 + 分页查询 |
| **预加载** | 表单初始化时预加载无依赖参数的数据源 |

---

## 6. 验证引擎

### 6.1 验证层级

```typescript
interface ValidationConfig {
  // 第1层：JSON Schema 标准（同步、内置）
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: 'email' | 'url' | 'date' | 'datetime' | 'time' | 'mobile' | 'idCard';

  // 第2层：自定义同步验证（表达式）
  customValidator?: string;

  // 第3层：异步验证（后端接口）
  asyncValidator?: {
    url: string;
    params?: Record<string, any>;  // 支持 {{fieldName}} / {{user.xxx}} 表达式
    message: string;
    debounce?: number;
  };

  // 错误提示
  errorMessage?: string | {
    required?: string;
    minLength?: string;
    pattern?: string;
    custom?: string;
    async?: string;
  };
}
```

### 6.2 验证执行流程

1. **JSON Schema 标准验证**（同步，前端执行）
2. **联动依赖验证**：被联动隐藏的字段跳过所有验证；根级 `required` 数组中字段若被联动设置为 `optional` 则跳过 required 验证
3. **自定义表达式验证**（同步，前端受控沙箱执行，`expr:` 表达式仅可访问 Math/String/Date/Array 等标准对象，禁止访问 DOM/Window/Document）
4. **异步验证**（带防抖，仅在前三层通过后执行，后端 API 验证）

### 6.3 验证示例

```json
{
  "email": {
    "type": "string",
    "title": "邮箱",
    "format": "email",
    "required": true,
    "errorMessage": {
      "required": "请输入邮箱地址",
      "format": "邮箱格式不正确"
    }
  },
  "phone": {
    "type": "string",
    "title": "手机号",
    "pattern": "^1[3-9]\\d{9}$",
    "asyncValidator": {
      "url": "/api/form/validate/phone-unique",
      "message": "该手机号已被注册",
      "debounce": 500
    }
  },
  "confirmPassword": {
    "type": "string",
    "title": "确认密码",
    "customValidator": "expr:{{confirmPassword}} === {{password}}",
    "errorMessage": {
      "custom": "两次输入的密码不一致"
    }
  }
}
```

---

## 7. 联动引擎

### 7.1 联动规则

```typescript
interface LinkageRule {
  type: 'visible' | 'hidden' | 'disabled' | 'enabled'
      | 'readonly' | 'editable' | 'required' | 'optional'
      | 'setValue' | 'clearValue' | 'setOptions' | 'validate';
  when: string;
  then?: any;
  else?: any;
}
```

### 7.2 表达式语法

| 语法 | 示例 | 说明 |
|------|------|------|
| `{{fieldName}}` | `{{amount}}` | 引用表单字段值，支持嵌套如 `{{user.name}}` |
| `{{user.xxx}}` | `{{user.deptId}}` | 引用当前登录用户属性 |
| `{{workflowVar.xxx}}` | `{{workflowVar.applicant}}` | 引用流程变量（审批场景） |
| `expr:...` | `expr:Math.ceil({{days}})` | JavaScript 表达式，在前端受控沙箱执行 |

**表达式执行环境白名单**：
- ✅ 允许：`Math`, `String`, `Number`, `Date`, `Array`, `Object`, `JSON`, `console`
- ❌ 禁止：`window`, `document`, `fetch`, `XMLHttpRequest`, `eval`, `Function`, `setTimeout`, `setInterval`
- 表达式通过 `new Function()` 在隔离作用域中执行，超时限制 100ms

### 7.3 联动示例

```json
{
  "amount": {
    "type": "number",
    "title": "报销金额",
    "ui:widget": "number"
  },
  "highAmountReason": {
    "type": "string",
    "title": "大额报销说明",
    "ui:widget": "textarea",
    "x-linkage": [
      { "type": "visible", "when": "{{amount}} > 10000" },
      { "type": "required", "when": "{{amount}} > 10000" }
    ]
  },
  "approver": {
    "type": "string",
    "title": "审批人",
    "ui:widget": "userPicker",
    "x-linkage": [
      { "type": "setValue", "when": "{{amount}} <= 5000", "then": "{{user.directManager}}" },
      { "type": "setValue", "when": "{{amount}} > 5000 && {{amount}} <= 20000", "then": "{{user.deptManager}}" }
    ]
  }
}
```

---

## 8. 后端 API 设计

### 8.1 API 清单

```
// ============ 表单定义管理 ============
POST   /api/form/definitions
GET    /api/form/definitions
GET    /api/form/definitions/:id
PUT    /api/form/definitions/:id
DELETE /api/form/definitions/:id
POST   /api/form/definitions/:id/clone

// ============ 表单分类管理 ============
GET    /api/form/categories
POST   /api/form/categories

// ============ 表单实例（数据） ============
POST   /api/form/instances
GET    /api/form/instances
GET    /api/form/instances/:id
PUT    /api/form/instances/:id
POST   /api/form/instances/:id/submit

// ============ 数据源解析 ============
POST   /api/form/data-source/resolve
POST   /api/form/data-source/test-connection

// ============ 表单验证 ============
POST   /api/form/validate/field
POST   /api/form/validate/form

// ============ Workflow 集成 ============
GET    /api/workflow/tasks/:taskId/form-schema
POST   /api/workflow/tasks/:taskId/form-submit
```

### 8.2 核心请求/响应

**解析数据源**
```typescript
// POST /api/form/data-source/resolve
interface ResolveDataSourceRequest {
  fieldSchema: RaosFieldSchema;
  formData: Record<string, any>;
  searchKeyword?: string;
  page?: number;
  pageSize?: number;
}

interface ResolveDataSourceResponse {
  options: Array<{
    label: string;
    value: any;
    extra?: Record<string, any>;
    disabled?: boolean;
  }>;
  total?: number;
  hasMore?: boolean;
}
```

---

## 9. 数据库模型

### 9.1 核心表结构

```sql
-- ============ 表单定义表 ============
CREATE TABLE form_definitions (
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
CREATE TABLE form_categories (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  code        VARCHAR(64) UNIQUE NOT NULL,
  parent_id   VARCHAR(36),
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============ 表单实例表 ============
CREATE TABLE form_instances (
  id              VARCHAR(36) PRIMARY KEY,
  definition_id   VARCHAR(36) NOT NULL,
  definition_version INT DEFAULT 1,
  data_json       JSON NOT NULL,
  status          VARCHAR(20) DEFAULT 'draft',
  submitted_by    VARCHAR(36),
  submitted_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (definition_id) REFERENCES form_definitions(id)
);

-- ============ 表单与流程关联表 ============
CREATE TABLE workflow_form_bindings (
  id              VARCHAR(36) PRIMARY KEY,
  definition_key  VARCHAR(64) NOT NULL,
  node_id         VARCHAR(64) NOT NULL,
  form_id         VARCHAR(36) NOT NULL,
  form_version    INT DEFAULT 1,           -- 绑定的表单版本，-1 表示始终使用最新版
  is_required     BOOLEAN DEFAULT true,
  mapping_json    JSON,                    -- WorkflowFormMapping 配置
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_key, node_id)
);

-- ============ 表单数据与流程实例关联（数据快照，非引用） ============
CREATE TABLE workflow_form_instances (
  id              VARCHAR(36) PRIMARY KEY,
  instance_id     VARCHAR(36) NOT NULL,
  task_id         VARCHAR(36),
  form_id         VARCHAR(36) NOT NULL,
  form_version    INT NOT NULL,            -- 提交时的表单版本号
  schema_snapshot JSON NOT NULL,           -- 提交时的表单 Schema 快照
  data_json       JSON NOT NULL,           -- 表单填写数据快照
  submitted_by    VARCHAR(36),
  submitted_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 9.2 扩展现有 connections 表

```sql
-- 现有 connections 表扩展数据库连接支持
ALTER TABLE connections ADD COLUMN db_config JSON;
ALTER TABLE connections ADD COLUMN test_query VARCHAR(256);
```

---

## 10. 与 Workflow 集成

### 10.1 集成架构

```
Workflow Definition
  └── user_task "经理审批"
        └── workflow_form_bindings
              └── form_id = "leave_application_form"
                    └── 审批时自动加载该表单 Schema

Workflow Instance 运行时:
  1. 引擎到达 user_task "经理审批"
  2. 查询 workflow_form_bindings，获取关联表单
  3. 加载 form_definitions.schema_json
  4. 将 workflow_variables 映射为表单初始值
  5. 用户填写表单 -> 提交
  6. 表单数据写入 workflow_variables
  7. 引擎继续流转
```

### 10.2 数据映射

存储在 `workflow_form_bindings.mapping_json` 字段中：

```typescript
interface WorkflowFormMapping {
  variableName?: string;                    // 表单提交后写入的流程变量名（默认 "formData"）
  autoFillMappings?: Array<{
    variableName: string;                   // 来源流程变量名
    fieldPath: string;                      // 目标表单字段路径
  }>;
  outputMappings?: Array<{
    fieldPath: string;                      // 来源表单字段路径
    variableName: string;                   // 目标流程变量名
  }>;
}
```

### 10.3 审批页面

- **我的待办**：`GET /api/workflow/tasks?status=pending&assignee={userId}`
- **我发起的**：`GET /api/workflow/instances?starter={userId}`
- **已办**：`GET /api/workflow/tasks?status=completed&assignee={userId}`
- 审批详情页：加载任务 -> 加载关联表单 -> 渲染 DynamicForm -> 提交

---

## 11. ConfirmCard 替换策略

### 11.1 对比

| 维度 | ConfirmCard (旧) | DynamicForm (新) |
|------|------------------|------------------|
| 字段类型 | 7 种硬编码 | 20+ 组件注册表 |
| 验证 | 仅 required | JSON Schema + 自定义 + 异步 |
| 联动 | 无 | 完整联动引擎 |
| 布局 | 垂直单列表 | grid/sections/inline |
| 数据源 | 静态选项 | database/remote/cascade |
| 使用场景 | 仅聊天 | 聊天/审批/独立页面通用 |

### 11.2 迁移路径

1. **并行开发期**：新引擎开发期间，ConfirmCard 保持运行
2. **后端改造**：`user-confirm-skill.ts` 输出新 Schema 格式（`__formRender` 替代 `__userConfirm`）
3. **前端适配**：`ConfirmCard.tsx` 改造为 `DynamicForm` 的包装器（兼容旧消息恢复）
4. **完整替换**：全部验证通过后，移除旧代码

---

## 12. 实施路线图

### Phase 1：核心引擎（Week 1-4）

| 周 | 任务 |
|----|------|
| W1 | Schema 类型定义 + 基础渲染引擎框架 + 组件注册表机制 |
| W2 | 内置基础组件（Input/TextArea/Number/Select/Radio/Checkbox/DatePicker/Switch） |
| W2 | 表单状态管理（Zustand）+ 字段级独立更新 + 基础布局（vertical/grid） |
| W3 | JSON Schema 验证引擎（required/min/max/pattern/format） |
| W3 | 字段联动引擎（visible/disabled/required/setValue） |
| W4 | ConfirmCard 替换为 DynamicForm，保持向后兼容 |
| W4 | 单元测试覆盖（渲染器、联动、验证各 >= 80%） |

**交付物**：
- `web/src/components/form-engine/` 渲染引擎
- `web/src/components/form-engine/components/` 基础组件库
- `web/src/components/DynamicForm.tsx`
- `src/routes/form-routes.ts` 基础 API
- 数据库表 `form_definitions`, `form_instances`

### Phase 2：数据能力（Week 5-6）

| 周 | 任务 |
|----|------|
| W5 | 数据源解析服务 + HTTP remote + static 数据源 |
| W5 | 数据库连接管理（复用/扩展 connections 表）+ SQL 参数化查询执行器 |
| W6 | 级联数据源 + 联动查询数据流 + 防抖/缓存 |
| W6 | 后置筛选过滤器 + 业务组件（UserPicker/DeptPicker/FileUploader） |
| W6 | 文件上传存储方案（本地/OSS 可配置） |

**交付物**：
- `src/services/data-source-service.ts`
- `src/services/database-connector.ts`
- `POST /api/form/data-source/resolve`

### Phase 3：Workflow 深度集成（Week 7-8）

| 周 | 任务 |
|----|------|
| W7 | Workflow 节点绑定表单（`workflow_form_bindings` + `mapping_json`） |
| W7 | 审批任务自动加载关联表单 Schema + 流程变量自动填充 |
| W8 | 表单数据写入 workflow_variables |
| W8 | 审批中心前端页面（我的待办/已办/我发起的） |

**交付物**：
- `src/workflow/form-integration.ts`
- `web/src/pages/Approvals/` 审批中心
- 表单数据与流程变量双向同步

### Phase 4：高级能力（Week 9-10）

| 周 | 任务 |
|----|------|
| W9 | 自定义组件注册机制（插件化）+ 异步验证 |
| W9 | 子表格（TableField）+ 动态列表（ArrayField）+ 分组（GroupField） |
| W10 | 表单数据权限（字段级读写权限 + 表单定义 ACL） |
| W10 | 性能优化（虚拟滚动、大数据 Select、表单草稿自动保存） |
| W10 | 国际化支持（Schema 中的 title/description/errorMessage 支持多语言键） |

### Phase 5：可视化设计器（后续迭代）

| 时间 | 任务 |
|------|------|
| 后续 | 基于自研引擎 Schema 的拖拽设计器 |
| 后续 | 组件属性面板配置 |
| 后续 | 实时预览 + Schema 导出 |

---

## 13. 技术栈

| 层级 | 技术选择 |
|------|---------|
| 前端框架 | React 18 + TypeScript |
| UI 组件 | Ant Design 5 |
| 状态管理 | Zustand |
| Schema 验证 | 自研轻量验证器（JSON Schema 子集） |
| SQL 执行 | `mysql2` / `pg` / `better-sqlite3` |
| 连接池 | `generic-pool` 或驱动原生连接池 |
| 密码加密 | `crypto` AES-256-GCM |
| 文件存储 | 本地存储（开发）/ 阿里云 OSS / MinIO（生产，可配置） |

---

## 14. 安全与性能

### 14.1 安全设计

| 维度 | 措施 |
|------|------|
| SQL 注入 | 强制参数化查询，禁止字符串拼接 |
| 密码安全 | AES-256-GCM 加密存储，密钥存环境变量 |
| 查询超时 | 默认 5s，可配置 |
| 结果限制 | 默认最大 1000 条 |
| 权限控制 | 数据源连接配置仅限 Admin |
| 审计日志 | 记录所有数据库查询 |

### 14.2 性能设计

| 策略 | 实现 |
|------|------|
| 字段级渲染 | `React.memo` + 细粒度 `onFieldChange` |
| 防抖 | 联动查询默认 300ms |
| 请求去重 | 相同参数并发请求合并 |
| 前端缓存 | 最近 20 条查询结果内存缓存 |
| 后端缓存 | 可配置 cache TTL |
| 虚拟滚动 | 大数据 Select 组件 |
| 预加载 | 无依赖参数数据源表单初始化时加载 |

---

## 附录

### A. 参考开源方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| Formily | 最完整，分布式状态管理，自带设计器 | 学习成本高，包体积大 |
| X-Render | 易用，配套设计器，阿里内部大规模使用 | Schema 格式耦合，定制受限 |
| FormEngine | JSON-first，UI 无关，MIT 开源 | 设计器商业版 |
| react-jsonschema-form | 简单，标准 JSON Schema | UI 耦合 bootstrap |

### B. 术语表

| 术语 | 说明 |
|------|------|
| Schema | 表单结构描述（JSON） |
| Widget | 组件类型标识（如 `select`, `datePicker`） |
| Linkage | 字段间联动规则 |
| Cascade | 级联数据源查询 |
| DataSource | 字段选项数据来源 |
| Snapshot | 表单提交时的 Schema 和数据快照，确保历史记录可正确渲染 |

### C. 表单版本管理策略

1. **版本创建**：表单定义每次发布（publish）时版本号 +1，草稿状态不增加版本号
2. **版本冻结**：已发布的表单定义不可直接修改，只能克隆为新版本或创建副本
3. **流程绑定**：`workflow_form_bindings.form_version` 控制绑定行为：
   - `form_version = -1`：始终使用最新发布版本（默认）
   - `form_version = N`：固定使用第 N 版本
4. **历史兼容**：`workflow_form_instances.schema_snapshot` 保存提交时的完整 Schema，确保历史记录永远可正确渲染
5. **数据迁移**：表单定义更新后，旧版 `form_instances` 数据保持原样，仅新提交使用新版 Schema

### D. 文件上传存储方案

```typescript
interface FileUploadConfig {
  storage: 'local' | 'oss' | 'minio';
  // local: 存储在服务器 uploads/ 目录
  // oss: 阿里云 OSS
  // minio: 自建 MinIO 对象存储

  // OSS / MinIO 配置
  endpoint?: string;
  bucket?: string;
  accessKey?: string;       // 加密存储
  secretKey?: string;       // 加密存储
  region?: string;

  // 上传限制
  maxSize?: number;         // 单文件最大字节，默认 10MB
  maxCount?: number;        // 最多上传文件数，默认 10
  accept?: string;          // 允许的文件类型，如 ".pdf,.jpg,.png"

  // 返回格式
  returnType?: 'url' | 'id'; // 表单中存储的是 URL 还是文件 ID
}
```

上传流程：
1. 前端选择文件 → 调用 `POST /api/upload/prepare` 获取预签名 URL 或临时凭证
2. 前端直传文件到存储服务（避免经过应用服务器）
3. 存储服务返回文件 URL/ID → 前端写入表单字段
4. 表单提交时仅提交 URL/ID，不重复上传

---

*文档结束*
