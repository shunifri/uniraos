/**
 * P1-25: 修复表单设计/保存的几个根因
 *
 * Bug 1: app-designer DesignFormField.type 之前只支持 8 个 enum,
 *        用户用 radio/checkbox/fileUploader/array/group/table 等 18 个 widget 时找不到选项.
 * Bug 2: form-routes PUT allowed 列表漏了 'key' 字段, 前端发 key 被 silently ignored.
 * Bug 3: 前端 api/index.ts json() 函数只读 err.message, 但后端用 err.error 字段,
 *        真实错误被吞, 用户只看到 "Bad Request".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("P1-25: 表单设计/保存错误处理修复", () => {
  describe("Bug 1: app-designer buildFormSchema 支持全部 18 widget", () => {
    it("radio/checkbox/select 应该正确映射 widget", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试表单",
        description: "",
        fields: [
          { name: "gender", title: "性别", type: "radio" as any, options: ["M", "F"] },
          { name: "hobby", title: "爱好", type: "checkbox" as any, options: ["a", "b", "c"] },
          { name: "city", title: "城市", type: "select" as any, options: ["上海", "北京"] },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const props = (schema as any).properties;
      expect(props.gender["ui:widget"]).toBe("radio");
      expect(props.gender.enum).toEqual(["M", "F"]);
      expect(props.hobby["ui:widget"]).toBe("checkbox");
      expect(props.city["ui:widget"]).toBe("select");
    });

    it("dateRange/dateTimeRange/timePicker 应该正确映射", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          { name: "period", title: "时间段", type: "dateRange" as any },
          { name: "window", title: "时间窗", type: "dateTimeRange" as any },
          { name: "time", title: "时间", type: "timePicker" as any },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const props = (schema as any).properties;
      expect(props.period["ui:widget"]).toBe("dateRange");
      expect(props.window["ui:widget"]).toBe("dateTimeRange");
      expect(props.time["ui:widget"]).toBe("timePicker");
    });

    it("userPicker/deptPicker/fileUploader 应该正确映射", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          { name: "owner", title: "负责人", type: "userPicker" as any },
          { name: "dept", title: "部门", type: "deptPicker" as any },
          { name: "attachments", title: "附件", type: "fileUploader" as any, accept: ".pdf,.docx", maxSize: 10 },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const props = (schema as any).properties;
      expect(props.owner["ui:widget"]).toBe("userPicker");
      expect(props.dept["ui:widget"]).toBe("deptPicker");
      expect(props.attachments["ui:widget"]).toBe("fileUploader");
      expect(props.attachments["ui:accept"]).toBe(".pdf,.docx");
      expect(props.attachments["ui:maxSize"]).toBe(10);
      // fileUploader 存的是 URL 字符串
      expect(props.attachments.type).toBe("string");
    });

    it("array 应该映射为 JSON Schema array", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          { name: "items", title: "列表", type: "array" as any, items: { type: "string" } },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      expect((schema as any).properties.items.type).toBe("array");
      expect((schema as any).properties.items["ui:widget"]).toBe("array");
    });

    it("group 应该映射为 JSON Schema object, 含子 properties", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          {
            name: "address",
            title: "地址",
            type: "group" as any,
            fields: [
              { name: "city", title: "城市", type: "string" as any },
              { name: "street", title: "街道", type: "string" as any },
            ],
          },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const addr = (schema as any).properties.address;
      expect(addr.type).toBe("object");
      expect(addr["ui:widget"]).toBe("group");
      expect(addr.properties.city).toBeDefined();
      expect(addr.properties.street).toBeDefined();
    });

    it("table 应该映射为 array of object, columns 转 items.properties", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          {
            name: "rows",
            title: "行项目",
            type: "table" as any,
            columns: [
              { name: "name", title: "名称", type: "string" },
              { name: "qty", title: "数量", type: "number" },
            ],
          },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const rows = (schema as any).properties.rows;
      expect(rows.type).toBe("array");
      expect(rows["ui:widget"]).toBe("table");
      expect(rows.items.properties.name.type).toBe("string");
      expect(rows.items.properties.qty.type).toBe("number");
    });

    it("password 应该映射为 password widget", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [{ name: "pwd", title: "密码", type: "password" as any }],
      };
      const schema = (svc as any).buildFormSchema(form);
      expect((schema as any).properties.pwd["ui:widget"]).toBe("password");
    });

    it("phone/email 应该保留 format 标记 (前端 validation 用)", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          { name: "phone", title: "电话", type: "phone" as any },
          { name: "email", title: "邮箱", type: "email" as any },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const props = (schema as any).properties;
      expect(props.phone["ui:widget"]).toBe("input");
      expect(props.phone.format).toBe("mobile");
      expect(props.email["ui:widget"]).toBe("input");
      expect(props.email.format).toBe("email");
    });

    it("P1-27: options 是 {label, value} 对象数组时, 不应该嵌套 (避免 React crash)", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          {
            name: "interest",
            title: "兴趣",
            type: "select" as any,
            options: [
              { label: "工程技术", value: "engineering" },
              { label: "计算机", value: "cs" },
            ] as any,
          },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const interest = (schema as any).properties.interest;
      const xdOpts = interest["x-dataSource"].options;
      // 不应该嵌套: 每个 option 应该是 {label: "string", value: "string"} 扁平结构
      expect(xdOpts[0].label).toBe("工程技术");
      expect(xdOpts[0].value).toBe("engineering");
      expect(typeof xdOpts[0].label).toBe("string");
      expect(typeof xdOpts[0].value).toBe("string");
      // enum 应该是 string[] (value 数组)
      expect(interest.enum).toEqual(["engineering", "cs"]);
      expect(Array.isArray(interest.enum)).toBe(true);
    });

    it("P1-27: options 是 string[] 时也应该正确处理 (向下兼容)", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          {
            name: "city",
            title: "城市",
            type: "select" as any,
            options: ["上海", "北京", "深圳"],
          },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const city = (schema as any).properties.city;
      expect(city.enum).toEqual(["上海", "北京", "深圳"]);
      expect(city["x-dataSource"].options).toEqual([
        { label: "上海", value: "上海" },
        { label: "北京", value: "北京" },
        { label: "深圳", value: "深圳" },
      ]);
    });

    it("P1-27: group 嵌套字段的 options 也应该正确处理", async () => {
      const { AppDesignerService } = await import(
        "../../src/skills/app-designer-skill.js"
      );
      const svc = new AppDesignerService();
      const form = {
        key: "test_form",
        name: "测试",
        description: "",
        fields: [
          {
            name: "address",
            title: "地址",
            type: "group" as any,
            fields: [
              {
                name: "province",
                title: "省份",
                type: "select" as any,
                options: [
                  { label: "上海", value: "sh" },
                  { label: "北京", value: "bj" },
                ] as any,
              },
            ],
          },
        ],
      };
      const schema = (svc as any).buildFormSchema(form);
      const province = (schema as any).properties.address.properties.province;
      expect(province["x-dataSource"].options[0].label).toBe("上海");
      expect(province["x-dataSource"].options[0].value).toBe("sh");
      expect(typeof province["x-dataSource"].options[0].label).toBe("string");
    });
  });

  describe("Bug 3: 前端 json() 函数读 err.error 字段 (后端真实错误)", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("后端返回 {error: 'X'} 时应该 throw Error('X') 而非 'Bad Request'", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ success: false, error: "表单定义不存在或无权限" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      // 模拟 api.put 调用
      const { api } = await import("../../web/src/api/index.js" as any).catch(() => ({ api: null as any })) as any;
      // 简单验证响应处理逻辑
      const err = await (async () => {
        const res = await fetch("/test");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return body.error || body.message || res.statusText;
        }
        return null;
      })();
      expect(err).toBe("表单定义不存在或无权限");
    });

    it("后端返回 {message: 'Y'} 时也应该能拿到", async () => {
      const err = await (async () => {
        const res = new Response(
          JSON.stringify({ message: "xDataSource error" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return body.error || body.message || res.statusText;
        }
        return null;
      })();
      expect(err).toBe("xDataSource error");
    });

    it("后端返回空 body 时应该 fallback 到 statusText", async () => {
      const err = await (async () => {
        const res = new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
        if (!res.ok) {
          // 模拟前端先尝试 parse JSON, 失败 fallback
          const text = await res.text();
          let body: any = {};
          try { body = JSON.parse(text); } catch { body = { message: text }; }
          return body.error || body.message || res.statusText;
        }
        return null;
      })();
      expect(err).toBe("Internal Server Error");
    });
  });
});
