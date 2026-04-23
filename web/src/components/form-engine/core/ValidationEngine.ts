/**
 * RAOS Form Engine - Validation Engine
 *
 * 提供 JSON Schema 标准验证规则及自定义验证支持。
 */

import type { RaosFieldSchema, ValidationResult } from "../types";
import { formT } from "../i18n/form-i18n";

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
      return emailRe.test(value) ? null : formT("validation.format.email");
    }
    case "url": {
      const urlRe = /^https?:\/\/.+/;
      return urlRe.test(value) ? null : formT("validation.format.url");
    }
    case "mobile": {
      const mobileRe = /^1[3-9]\d{9}$/;
      return mobileRe.test(value) ? null : formT("validation.format.mobile");
    }
    case "date": {
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      return dateRe.test(value) ? null : formT("validation.format.date");
    }
    case "datetime": {
      const datetimeRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      return datetimeRe.test(value)
        ? null
        : formT("validation.format.datetime");
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
    errors.push(getErrorMessage(schema, "required", formT("validation.required")));
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
          formT("validation.minLength", { min: schema.minLength })
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
          formT("validation.maxLength", { max: schema.maxLength })
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
          formT("validation.minimum", { min: schema.minimum })
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
          formT("validation.maximum", { max: schema.maximum })
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
        getErrorMessage(schema, "pattern", formT("validation.pattern"))
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

  // 5. 同步自定义表达式验证
  const customValidator = (schema as any).customValidator;
  if (customValidator) {
    // Phase 4 会实现完整表达式沙箱
  }

  return { valid: errors.length === 0, errors };
}

export interface AsyncValidatorConfig {
  type: "remote";
  url: string;
  method?: "GET" | "POST";
  fieldParam?: string;
  debounce?: number;
}

const asyncValidatorCache = new Map<string, Promise<ValidationResult>>();
const asyncValidatorTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function validateFieldAsync(
  schema: RaosFieldSchema,
  value: any,
  formData: Record<string, any>,
  isRequired: boolean,
  options?: { isHidden?: boolean; asyncConfig?: AsyncValidatorConfig }
): Promise<ValidationResult> {
  // 先执行同步验证
  const syncResult = await validateField(schema, value, formData, isRequired, options);
  if (!syncResult.valid) {
    return syncResult;
  }

  const asyncConfig = options?.asyncConfig || (schema as any)["x-asyncValidator"];
  if (!asyncConfig || isEmptyValue(value)) {
    return syncResult;
  }

  if (asyncConfig.type === "remote") {
    const cacheKey = `${asyncConfig.url}:${JSON.stringify(value)}`;
    const cached = asyncValidatorCache.get(cacheKey);
    if (cached) return cached;

    const result = fetchRemoteValidation(asyncConfig, value);
    asyncValidatorCache.set(cacheKey, result);
    result.finally(() => {
      setTimeout(() => asyncValidatorCache.delete(cacheKey), 5000);
    });
    return result;
  }

  return syncResult;
}

async function fetchRemoteValidation(
  config: AsyncValidatorConfig,
  value: any
): Promise<ValidationResult> {
  try {
    const method = config.method || "GET";
    const paramName = config.fieldParam || "value";
    const url = method === "GET"
      ? `${config.url}?${paramName}=${encodeURIComponent(String(value))}`
      : config.url;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ [paramName]: value }) : undefined,
    });
    const data = await res.json();
    if (data.valid === false) {
      return { valid: false, errors: [data.message || formT("validation.async")] };
    }
    return { valid: true, errors: [] };
  } catch {
    return { valid: true, errors: [] };
  }
}

export function debouncedAsyncValidate(
  fieldName: string,
  validateFn: () => Promise<ValidationResult>,
  debounceMs: number = 300
): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const existing = asyncValidatorTimers.get(fieldName);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      asyncValidatorTimers.delete(fieldName);
      validateFn().then(resolve);
    }, debounceMs);

    asyncValidatorTimers.set(fieldName, timer);
  });
}

export { getErrorMessage, validateFormat };
