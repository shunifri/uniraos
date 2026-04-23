import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  RaosFormSchema,
  RaosFieldSchema,
  FormLayout,
  FormSection,
  FormAction,
  LinkageRule,
  DataSourceConfig,
  DatabaseSourceConfig,
  CascadeConfig,
  DataFilter,
  FieldState,
  ValidationResult,
} from "../../web/src/components/form-engine/types.js";
import type {
  RaosFormSchema as BackendRaosFormSchema,
  RaosFieldSchema as BackendRaosFieldSchema,
} from "../../src/types/form.js";

describe("Form Engine Types", () => {
  it("should allow creating a basic form schema", () => {
    const schema: RaosFormSchema = {
      type: "object",
      title: "用户注册表单",
      description: "用于新用户注册的表单",
      properties: {
        username: {
          type: "string",
          title: "用户名",
          default: "",
          minLength: 3,
          maxLength: 20,
          pattern: "^[a-zA-Z0-9_]+$",
          "ui:widget": "Input",
          "ui:placeholder": "请输入用户名",
          "ui:colSpan": 12,
        },
        email: {
          type: "string",
          title: "邮箱",
          format: "email",
          "ui:widget": "Input",
          "ui:placeholder": "请输入邮箱",
        },
        age: {
          type: "integer",
          title: "年龄",
          minimum: 0,
          maximum: 150,
          "ui:widget": "InputNumber",
        },
        isActive: {
          type: "boolean",
          title: "是否激活",
          default: true,
          "ui:widget": "Switch",
        },
      },
      required: ["username", "email"],
      layout: {
        type: "grid",
        columns: 2,
        gutter: 16,
      },
      actions: [
        { type: "submit", label: "提交", primary: true },
        { type: "reset", label: "重置" },
      ],
    };

    expect(schema.type).toBe("object");
    expect(schema.title).toBe("用户注册表单");
    expect(Object.keys(schema.properties)).toEqual([
      "username",
      "email",
      "age",
      "isActive",
    ]);
    expect(schema.required).toContain("username");
    expect(schema.layout?.type).toBe("grid");
    expect(schema.actions).toHaveLength(2);
  });

  it("should support nested object properties", () => {
    const schema: RaosFormSchema = {
      type: "object",
      title: "地址信息",
      properties: {
        name: {
          type: "string",
          title: "姓名",
        },
        address: {
          type: "object",
          title: "详细地址",
          properties: {
            province: {
              type: "string",
              title: "省份",
            },
            city: {
              type: "string",
              title: "城市",
            },
            district: {
              type: "string",
              title: "区县",
            },
            street: {
              type: "object",
              title: "街道信息",
              properties: {
                streetName: {
                  type: "string",
                  title: "街道名称",
                },
                streetNo: {
                  type: "string",
                  title: "门牌号",
                },
              },
            },
          },
        },
      },
    };

    expect(schema.properties.address.type).toBe("object");
    expect(
      Object.keys(schema.properties.address.properties ?? {})
    ).toEqual(["province", "city", "district", "street"]);
    expect(schema.properties.address.properties?.street.type).toBe("object");
    expect(
      Object.keys(schema.properties.address.properties?.street.properties ?? {})
    ).toEqual(["streetName", "streetNo"]);
  });

  it("should support array items", () => {
    const schema: RaosFormSchema = {
      type: "object",
      title: "订单表单",
      properties: {
        orderNo: {
          type: "string",
          title: "订单编号",
        },
        items: {
          type: "array",
          title: "商品列表",
          items: {
            type: "object",
            title: "商品项",
            properties: {
              productName: {
                type: "string",
                title: "商品名称",
              },
              quantity: {
                type: "integer",
                title: "数量",
                minimum: 1,
              },
              price: {
                type: "number",
                title: "单价",
                minimum: 0,
              },
            },
          },
        },
        tags: {
          type: "array",
          title: "标签",
          items: {
            type: "string",
            title: "标签值",
          },
        },
      },
    };

    const itemsField = schema.properties.items;
    expect(itemsField.type).toBe("array");
    expect(itemsField.items?.type).toBe("object");
    expect(
      Object.keys(itemsField.items?.properties ?? {})
    ).toEqual(["productName", "quantity", "price"]);

    const tagsField = schema.properties.tags;
    expect(tagsField.type).toBe("array");
    expect(tagsField.items?.type).toBe("string");
  });

  it("should support advanced field features", () => {
    const field: RaosFieldSchema = {
      type: "string",
      title: "部门",
      "ui:widget": "Select",
      "x-dataSource": {
        type: "remote",
        url: "/api/departments",
        method: "GET",
        headers: { Authorization: "Bearer token" },
        cascade: {
          dependency: "companyId",
          trigger: "onChange",
          debounce: 300,
          clearOnChange: true,
        },
      },
      "x-linkage": [
        {
          type: "visible",
          when: "{{companyId}} !== ''",
        },
      ],
      "x-permission": {
        read: ["admin", "user"],
        write: ["admin"],
      },
      "x-workflow": {
        variableName: "deptId",
        autoFillFromVar: true,
      },
      errorMessage: {
        required: "请选择部门",
        custom: "自定义错误信息",
      },
    };

    expect(field["x-dataSource"]?.type).toBe("remote");
    expect(field["x-linkage"]).toHaveLength(1);
    expect(field["x-permission"]?.write).toContain("admin");
  });

  it("should support database source config", () => {
    const dbConfig: DatabaseSourceConfig = {
      connectionId: "conn-001",
      connectionType: "postgresql",
      query: "SELECT id, name FROM users WHERE status = :status",
      queryParams: [
        {
          name: "status",
          value: "active",
          type: "string",
          source: "static",
        },
        {
          name: "userId",
          type: "number",
          source: "formField",
          sourceField: "id",
        },
      ],
      labelField: "name",
      valueField: "id",
      extraFields: ["email", "phone"],
      filters: [
        { field: "age", operator: "gte", value: 18, logic: "and" },
        { field: "name", operator: "contains", value: "张" },
      ],
      timeout: 5000,
      cache: 60,
      maxResults: 100,
    };

    expect(dbConfig.connectionType).toBe("postgresql");
    expect(dbConfig.queryParams).toHaveLength(2);
    expect(dbConfig.filters).toHaveLength(2);
    expect(dbConfig.labelField).toBe("name");
  });

  it("should support field state and validation", () => {
    const state: FieldState = {
      visible: true,
      disabled: false,
      readonly: false,
      required: true,
      options: [
        { label: "选项A", value: "a" },
        { label: "选项B", value: "b" },
      ],
      loading: false,
      errors: [],
      value: "a",
    };

    const validation: ValidationResult = {
      valid: false,
      errors: ["字段不能为空"],
    };

    expect(state.visible).toBe(true);
    expect(state.options).toHaveLength(2);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("字段不能为空");
  });

  it("should have compatible frontend and backend types", () => {
    // 编译期类型兼容验证：如果前后端类型不一致，此处会报 TS 错误
    expectTypeOf<BackendRaosFormSchema>().toMatchTypeOf<RaosFormSchema>();
    expectTypeOf<RaosFormSchema>().toMatchTypeOf<BackendRaosFormSchema>();
    expectTypeOf<BackendRaosFieldSchema>().toMatchTypeOf<RaosFieldSchema>();
    expectTypeOf<RaosFieldSchema>().toMatchTypeOf<BackendRaosFieldSchema>();
  });
});
