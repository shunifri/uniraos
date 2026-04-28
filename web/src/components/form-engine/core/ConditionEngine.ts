/**
 * RAOS Form Engine - Condition Engine
 *
 * 条件 Schema 引擎：根据表单数据动态评估字段级 if/then/else 规则。
 * 支持 {{fieldName}} 变量插值语法，与 LinkageEngine 保持一致。
 */

import type { RaosFieldSchema, ConditionalSchemaRule } from "../types";

/**
 * 评估条件表达式
 * @param expression - 条件表达式，如 "{{country}} === '中国'"
 * @param formData - 表单数据
 * @returns boolean
 */
export function evaluateCondition(
  expression: string,
  formData: Record<string, any>
): boolean {
  // 替换 {{fieldName}} 为实际值
  let jsExpression = expression.replace(/\{\{([\w.\-\[\]]+)\}\}/g, (_match, fieldName) => {
    const value = formData[fieldName];
    if (value === undefined || value === null) return "null";
    if (typeof value === "string") {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  });

  // 支持 expr: 前缀
  if (jsExpression.startsWith("expr:")) {
    jsExpression = jsExpression.slice(5);
  }

  try {
    const fn = new Function(
      "Math", "String", "Number", "Date", "Array", "Object", "JSON",
      `try { return (${jsExpression}); } catch (e) { return false; }`
    );
    const result = fn(Math, String, Number, Date, Array, Object, JSON);
    return Boolean(result);
  } catch (e) {
    console.warn(`[ConditionEngine] Expression evaluation failed: "${expression}" -> "${jsExpression}"`, e);
    return false;
  }
}

/**
 * 应用条件规则到字段 schema
 * @param baseSchema - 基础字段 schema
 * @param rules - 条件规则数组
 * @param formData - 表单数据
 * @returns 合并后的 schema
 */
export function applyConditionalSchema(
  baseSchema: RaosFieldSchema,
  rules: ConditionalSchemaRule[],
  formData: Record<string, any>
): RaosFieldSchema {
  let result: RaosFieldSchema = { ...baseSchema };

  for (const rule of rules) {
    const conditionMet = evaluateCondition(rule.when, formData);
    const override = conditionMet ? rule.then : rule.else;

    if (override) {
      result = deepMergeSchema(result, override);
    }
  }

  return result;
}

/**
 * 深度合并 schema（浅层属性覆盖，嵌套对象递归合并）
 */
function deepMergeSchema(
  base: RaosFieldSchema,
  override: Partial<RaosFieldSchema>
): RaosFieldSchema {
  const result: any = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    // 对嵌套对象进行递归合并
    if (
      key === "ui:props" &&
      typeof value === "object" &&
      typeof result[key] === "object"
    ) {
      result[key] = { ...result[key], ...value };
    } else if (
      key === "x-dataSource" &&
      typeof value === "object" &&
      typeof result[key] === "object"
    ) {
      result[key] = { ...result[key], ...value };
    } else if (
      key === "properties" &&
      typeof value === "object" &&
      typeof result[key] === "object"
    ) {
      result[key] = { ...result[key], ...value };
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 检查字段是否有条件 schema
 */
export function hasConditionalSchema(
  schema: RaosFieldSchema
): boolean {
  return Array.isArray(schema["x-condition"]) && schema["x-condition"].length > 0;
}

/**
 * 获取条件规则依赖的字段名（用于确定哪些字段变化时需要重新评估）
 */
export function getConditionDependencies(
  rules: ConditionalSchemaRule[]
): string[] {
  const deps = new Set<string>();
  const regex = /\{\{([\w.\-\[\]]+)\}\}/g;

  for (const rule of rules) {
    let match;
    while ((match = regex.exec(rule.when)) !== null) {
      deps.add(match[1]);
    }
  }

  return Array.from(deps);
}
