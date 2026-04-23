/**
 * RAOS Form Engine - Validation Engine
 *
 * 提供 JSON Schema 标准验证规则及自定义验证支持。
 */

import type { RaosFieldSchema, ValidationResult } from "../types";

/**
 * 获取字段验证错误提示
 * @param schema - 字段 Schema
 * @param key - 错误类型 key
 * @param defaultMessage - 默认错误提示
 * @returns 最终错误提示字符串
 */
function getErrorMessage(
  schema: RaosFieldSchema,
  key: string,
  defaultMessage: string
): string {
  if (typeof schema.errorMessage === "string") {
    return schema.errorMessage;
  }
  if (
    schema.errorMessage &&
    typeof schema.errorMessage === "object" &&
    key in schema.errorMessage
  ) {
    const msg = (schema.errorMessage as Record<string, string>)[key];
    if (msg) return msg;
  }
  return defaultMessage;
}

/**
 * 验证字符串格式
 * @param value - 待验证值
 * @param format - 格式类型
 * @returns null 表示通过，否则返回错误提示
 */
function validateFormat(value: string, format: string): string | null {
  switch (format) {
    case "email": {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRe.test(value) ? null : "请输入正确的邮箱格式";
    }
    case "url": {
      const urlRe = /^https?:\/\/.+/;
      return urlRe.test(value) ? null : "请输入正确的 URL 格式";
    }
    case "mobile": {
      const mobileRe = /^1[3-9]\d{9}$/;
      return mobileRe.test(value) ? null : "请输入正确的手机号码格式";
    }
    case "date": {
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      return dateRe.test(value) ? null : "请输入正确的日期格式（YYYY-MM-DD）";
    }
    case "datetime": {
      const datetimeRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      return datetimeRe.test(value)
        ? null
        : "请输入正确的日期时间格式（YYYY-MM-DDTHH:mm:ss）";
    }
    default:
      return null;
  }
}

/**
 * 判断值是否为空（undefined / null / 空字符串）
 */
function isEmptyValue(value: any): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * 验证单个字段
 * @param schema - 字段 Schema
 * @param value - 当前值
 * @param formData - 表单数据（预留，用于 Phase 4 表达式验证）
 * @param isRequired - 是否必填
 * @param options - 可选配置
 * @returns 验证结果
 */
export async function validateField(
  schema: RaosFieldSchema,
  value: any,
  formData: Record<string, any>,
  isRequired: boolean,
  options?: { isHidden?: boolean }
): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. 联动隐藏字段跳过
  if (options?.isHidden === true) {
    return { valid: true, errors: [] };
  }

  // 2. Required 验证
  if (isRequired === true && isEmptyValue(value)) {
    errors.push(getErrorMessage(schema, "required", "此字段为必填项"));
  }

  // 3. 空值短路
  if (isEmptyValue(value)) {
    return { valid: errors.length === 0, errors };
  }

  // 4. JSON Schema 标准验证

  // minLength
  if (schema.minLength !== undefined) {
    const strValue = typeof value === "string" ? value : String(value);
    if (strValue.length < schema.minLength) {
      errors.push(
        getErrorMessage(
          schema,
          "minLength",
          `长度不能少于 ${schema.minLength} 个字符`
        )
      );
    }
  }

  // maxLength
  if (schema.maxLength !== undefined) {
    const strValue = typeof value === "string" ? value : String(value);
    if (strValue.length > schema.maxLength) {
      errors.push(
        getErrorMessage(
          schema,
          "maxLength",
          `长度不能超过 ${schema.maxLength} 个字符`
        )
      );
    }
  }

  // minimum
  if (schema.minimum !== undefined) {
    const numValue = typeof value === "number" ? value : Number(value);
    if (!isNaN(numValue) && numValue < schema.minimum) {
      errors.push(
        getErrorMessage(
          schema,
          "minimum",
          `数值不能小于 ${schema.minimum}`
        )
      );
    }
  }

  // maximum
  if (schema.maximum !== undefined) {
    const numValue = typeof value === "number" ? value : Number(value);
    if (!isNaN(numValue) && numValue > schema.maximum) {
      errors.push(
        getErrorMessage(
          schema,
          "maximum",
          `数值不能大于 ${schema.maximum}`
        )
      );
    }
  }

  // pattern
  if (schema.pattern) {
    const strValue = typeof value === "string" ? value : String(value);
    const regex = new RegExp(schema.pattern);
    if (!regex.test(strValue)) {
      errors.push(
        getErrorMessage(schema, "pattern", "格式不匹配")
      );
    }
  }

  // format
  if (schema.format) {
    const strValue = typeof value === "string" ? value : String(value);
    const formatError = validateFormat(strValue, schema.format);
    if (formatError) {
      errors.push(
        getErrorMessage(schema, "format", formatError)
      );
    }
  }

  // 5. 自定义表达式验证（Phase 1 占位）
  const customValidator = (schema as any).customValidator;
  if (customValidator) {
    // Phase 4 会实现完整表达式沙箱
    // 目前无论是否以 expr: 开头都返回 null（pass）
  }

  return { valid: errors.length === 0, errors };
}

export { getErrorMessage, validateFormat };
