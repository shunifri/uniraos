import { describe, it, expect } from "vitest";
import {
  validateField,
  getErrorMessage,
  validateFormat,
} from "../../web/src/components/form-engine/core/ValidationEngine";
import type { RaosFieldSchema } from "../../web/src/components/form-engine/types";

describe("ValidationEngine", () => {
  describe("validateField", () => {
    it("required 字段为空", async () => {
      const schema: RaosFieldSchema = { type: "string", title: "Name" };
      const result = await validateField(schema, "", { name: "" }, true);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("此字段为必填项");
    });

    it("email 格式验证", async () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Email",
        format: "email",
      };
      const result = await validateField(schema, "invalid", {}, false);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("邮箱");
    });

    it("minLength 验证", async () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Code",
        minLength: 3,
      };
      const result = await validateField(schema, "ab", {}, false);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("3");
    });

    it("pattern 验证", async () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Phone",
        pattern: "^1[3-9]\\d{9}$",
      };
      const result = await validateField(schema, "123", {}, false);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("格式");
    });

    it("最大值验证", async () => {
      const schema: RaosFieldSchema = {
        type: "number",
        title: "Age",
        maximum: 100,
      };
      const result = await validateField(schema, 150, {}, false);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("100");
    });

    it("有效字段通过", async () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Name",
        required: true,
      };
      const result = await validateField(schema, "John", {}, true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("隐藏字段跳过验证", async () => {
      const schema: RaosFieldSchema = { type: "string", title: "Secret" };
      const result = await validateField(
        schema,
        "",
        {},
        true,
        { isHidden: true }
      );
      expect(result.valid).toBe(true);
    });

    it("自定义错误提示", async () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Name",
        minLength: 3,
        errorMessage: { minLength: "太短了" },
      };
      const result = await validateField(schema, "ab", {}, false);
      expect(result.errors[0]).toBe("太短了");
    });
  });

  describe("getErrorMessage", () => {
    it("返回字符串类型的 errorMessage", () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Test",
        errorMessage: "统一错误",
      };
      expect(getErrorMessage(schema, "required", "默认")).toBe("统一错误");
    });

    it("返回对象中对应 key 的错误提示", () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Test",
        errorMessage: { required: "必填" },
      };
      expect(getErrorMessage(schema, "required", "默认")).toBe("必填");
    });

    it("对象中无对应 key 时返回默认值", () => {
      const schema: RaosFieldSchema = {
        type: "string",
        title: "Test",
        errorMessage: { required: "必填" },
      };
      expect(getErrorMessage(schema, "minLength", "默认")).toBe("默认");
    });

    it("无 errorMessage 时返回默认值", () => {
      const schema: RaosFieldSchema = { type: "string", title: "Test" };
      expect(getErrorMessage(schema, "required", "默认")).toBe("默认");
    });
  });

  describe("validateFormat", () => {
    it("email 格式通过", () => {
      expect(validateFormat("test@example.com", "email")).toBeNull();
    });

    it("email 格式失败", () => {
      expect(validateFormat("invalid", "email")).toContain("邮箱");
    });

    it("url 格式通过", () => {
      expect(validateFormat("https://example.com", "url")).toBeNull();
    });

    it("url 格式失败", () => {
      expect(validateFormat("invalid", "url")).toContain("URL");
    });

    it("mobile 格式通过", () => {
      expect(validateFormat("13800138000", "mobile")).toBeNull();
    });

    it("mobile 格式失败", () => {
      expect(validateFormat("123", "mobile")).toContain("手机");
    });

    it("date 格式通过", () => {
      expect(validateFormat("2024-01-15", "date")).toBeNull();
    });

    it("date 格式失败", () => {
      expect(validateFormat("2024/01/15", "date")).toContain("日期");
    });

    it("datetime 格式通过", () => {
      expect(validateFormat("2024-01-15T12:30:45", "datetime")).toBeNull();
    });

    it("datetime 格式失败", () => {
      expect(validateFormat("2024-01-15", "datetime")).toContain("日期时间");
    });

    it("未知格式直接通过", () => {
      expect(validateFormat("anything", "unknown")).toBeNull();
    });
  });
});
