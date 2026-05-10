/**
 * Form Designer - Constants & Field Templates
 */

import type { FieldTemplate, FieldCategory } from "./types";
import type { RaosFieldSchema } from "@/components/form-engine/types";

export const FIELD_CATEGORIES: FieldCategory[] = [
  { key: "basic", label: "基础", icon: "FileTextOutlined" },
  { key: "selection", label: "选择", icon: "CheckCircleOutlined" },
  { key: "datetime", label: "日期时间", icon: "CalendarOutlined" },
  { key: "advanced", label: "高级", icon: "ThunderboltOutlined" },
  { key: "layout", label: "布局", icon: "LayoutOutlined" },
];

function makeFieldSchema(
  type: RaosFieldSchema["type"],
  title: string,
  overrides: Partial<RaosFieldSchema> = {}
): RaosFieldSchema {
  return {
    type,
    title,
    ...overrides,
  };
}

export const FIELD_TEMPLATES: FieldTemplate[] = [
  // ─── Basic ───
  {
    type: "text",
    label: "文本",
    icon: "FontSizeOutlined",
    category: "basic",
    defaultSchema: makeFieldSchema("string", "文本", {
      "ui:widget": "input",
      "ui:placeholder": "请输入",
    }),
  },
  {
    type: "textarea",
    label: "多行文本",
    icon: "AlignLeftOutlined",
    category: "basic",
    defaultSchema: makeFieldSchema("string", "多行文本", {
      "ui:widget": "textarea",
      "ui:placeholder": "请输入",
    }),
  },
  {
    type: "number",
    label: "数字",
    icon: "FieldNumberOutlined",
    category: "basic",
    defaultSchema: makeFieldSchema("number", "数字", {
      "ui:widget": "number",
      "ui:placeholder": "请输入数字",
    }),
  },
  {
    type: "password",
    label: "密码",
    icon: "LockOutlined",
    category: "basic",
    defaultSchema: makeFieldSchema("string", "密码", {
      "ui:widget": "password",
      "ui:placeholder": "请输入密码",
    }),
  },

  // ─── Selection ───
  {
    type: "select",
    label: "下拉选择",
    icon: "DownCircleOutlined",
    category: "selection",
    defaultSchema: makeFieldSchema("string", "下拉选择", {
      "ui:widget": "select",
      "ui:placeholder": "请选择",
      "x-dataSource": {
        type: "static",
        options: [
          { label: "选项1", value: "option1" },
          { label: "选项2", value: "option2" },
        ],
      },
    }),
  },
  {
    type: "radio",
    label: "单选",
    icon: "CheckCircleOutlined",
    category: "selection",
    defaultSchema: makeFieldSchema("string", "单选", {
      "ui:widget": "radio",
      "x-dataSource": {
        type: "static",
        options: [
          { label: "选项1", value: "option1" },
          { label: "选项2", value: "option2" },
        ],
      },
    }),
  },
  {
    type: "checkbox",
    label: "多选",
    icon: "CheckSquareOutlined",
    category: "selection",
    defaultSchema: makeFieldSchema("array", "多选", {
      "ui:widget": "checkbox",
      items: { type: "string", title: "" },
      "x-dataSource": {
        type: "static",
        options: [
          { label: "选项1", value: "option1" },
          { label: "选项2", value: "option2" },
        ],
      },
    }),
  },
  {
    type: "switch",
    label: "开关",
    icon: "SwitchOutlined",
    category: "selection",
    defaultSchema: makeFieldSchema("boolean", "开关", {
      "ui:widget": "switch",
      default: false,
    }),
  },

  // ─── Date/Time ───
  {
    type: "datePicker",
    label: "日期",
    icon: "CalendarOutlined",
    category: "datetime",
    defaultSchema: makeFieldSchema("string", "日期", {
      "ui:widget": "datePicker",
      format: "date",
    }),
  },
  {
    type: "dateRange",
    label: "日期范围",
    icon: "CalendarOutlined",
    category: "datetime",
    defaultSchema: makeFieldSchema("array", "日期范围", {
      "ui:widget": "dateRange",
      items: { type: "string", title: "", format: "date" },
    }),
  },
  {
    type: "dateTimeRange",
    label: "日期时间范围",
    icon: "ClockCircleOutlined",
    category: "datetime",
    defaultSchema: makeFieldSchema("array", "日期时间范围", {
      "ui:widget": "dateTimeRange",
      items: { type: "string", title: "", format: "datetime" },
    }),
  },
  {
    type: "timePicker",
    label: "时间",
    icon: "ClockCircleOutlined",
    category: "datetime",
    defaultSchema: makeFieldSchema("string", "时间", {
      "ui:widget": "timePicker",
      format: "time",
    }),
  },

  // ─── Advanced ───
  {
    type: "fileUploader",
    label: "文件上传",
    icon: "UploadOutlined",
    category: "advanced",
    defaultSchema: makeFieldSchema("array", "文件上传", {
      "ui:widget": "fileUploader",
      items: { type: "string", title: "" },
    }),
  },
  {
    type: "userPicker",
    label: "人员选择",
    icon: "UserOutlined",
    category: "advanced",
    defaultSchema: makeFieldSchema("string", "人员选择", {
      "ui:widget": "userPicker",
      "ui:placeholder": "请选择人员",
    }),
  },
  {
    type: "deptPicker",
    label: "部门选择",
    icon: "TeamOutlined",
    category: "advanced",
    defaultSchema: makeFieldSchema("string", "部门选择", {
      "ui:widget": "deptPicker",
      "ui:placeholder": "请选择部门",
    }),
  },
  {
    type: "table",
    label: "表格",
    icon: "TableOutlined",
    category: "advanced",
    defaultSchema: makeFieldSchema("array", "表格", {
      "ui:widget": "table",
      items: {
        type: "object",
        title: "",
        properties: {
          col1: { type: "string", title: "列1", "ui:widget": "input" },
          col2: { type: "string", title: "列2", "ui:widget": "input" },
        },
      },
    }),
  },
  {
    type: "array",
    label: "数组",
    icon: "OrderedListOutlined",
    category: "advanced",
    defaultSchema: makeFieldSchema("array", "数组", {
      "ui:widget": "array",
      items: { type: "string", title: "" },
    }),
  },
  {
    type: "group",
    label: "分组",
    icon: "ContainerOutlined",
    category: "advanced",
    defaultSchema: makeFieldSchema("object", "分组", {
      "ui:widget": "group",
      properties: {},
    }),
  },

  // ─── Layout ───
  {
    type: "divider",
    label: "分割线",
    icon: "MinusOutlined",
    category: "layout",
    defaultSchema: makeFieldSchema("string", "", {
      "ui:widget": "divider",
      "ui:hidden": true,
    }),
  },
  {
    type: "sectionHeader",
    label: "区块标题",
    icon: "TitleOutlined",
    category: "layout",
    defaultSchema: makeFieldSchema("string", "区块标题", {
      "ui:widget": "sectionHeader",
      "ui:hidden": true,
    }),
  },
];

export const WIDGET_ICONS: Record<string, string> = {
  input: "FontSizeOutlined",
  textarea: "AlignLeftOutlined",
  number: "FieldNumberOutlined",
  password: "LockOutlined",
  select: "DownCircleOutlined",
  radio: "CheckCircleOutlined",
  checkbox: "CheckSquareOutlined",
  switch: "SwitchOutlined",
  datePicker: "CalendarOutlined",
  dateRange: "CalendarOutlined",
  dateTimeRange: "ClockCircleOutlined",
  timePicker: "ClockCircleOutlined",
  fileUploader: "UploadOutlined",
  userPicker: "UserOutlined",
  deptPicker: "TeamOutlined",
  table: "TableOutlined",
  array: "OrderedListOutlined",
  group: "ContainerOutlined",
  divider: "MinusOutlined",
  sectionHeader: "TitleOutlined",
};

export function getFieldTemplate(type: string): FieldTemplate | undefined {
  return FIELD_TEMPLATES.find((t) => t.type === type);
}

export function generateFieldKey(type: string, existingKeys: string[]): string {
  let index = 1;
  let key = `${type}_${index}`;
  while (existingKeys.includes(key)) {
    index++;
    key = `${type}_${index}`;
  }
  return key;
}
