import type { LinkageRule } from "../types";

// ───────────────────────────────────────────────────────────────
// 联动结果
// ───────────────────────────────────────────────────────────────

export interface LinkageResult {
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  value?: any;
}

// ───────────────────────────────────────────────────────────────
// 评估字段的所有联动规则
// ───────────────────────────────────────────────────────────────

export function evaluateLinkage(
  rules: LinkageRule[],
  formData: Record<string, any>
): LinkageResult {
  const result: LinkageResult = {
    visible: true,
    disabled: false,
    readonly: false,
    required: false,
  };

  for (const rule of rules) {
    const conditionMet = evaluateExpression(rule.when, formData);

    switch (rule.type) {
      case "visible":
        result.visible = conditionMet;
        break;
      case "hidden":
        result.visible = !conditionMet;
        break;
      case "disabled":
        result.disabled = conditionMet;
        break;
      case "enabled":
        result.disabled = !conditionMet;
        break;
      case "readonly":
        result.readonly = conditionMet;
        break;
      case "editable":
        result.readonly = !conditionMet;
        break;
      case "required":
        result.required = conditionMet;
        break;
      case "optional":
        result.required = !conditionMet;
        break;
      case "setValue":
        if (conditionMet) {
          result.value = rule.then;
        } else if (rule.else !== undefined) {
          result.value = rule.else;
        }
        break;
      case "clearValue":
        if (conditionMet) {
          result.value = undefined;
        }
        break;
      default:
        break;
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────
// 评估条件表达式
// ───────────────────────────────────────────────────────────────

export function evaluateExpression(
  expression: string,
  formData: Record<string, any>
): boolean {
  // 1. 替换所有 {{fieldName}} 为实际值
  let jsExpression = expression.replace(/\{\{(\w+)\}\}/g, (_match, fieldName) => {
    const value = formData[fieldName];
    if (value === undefined || value === null) {
      return "null";
    }
    if (typeof value === "string") {
      // 转义字符串中的双引号和反斜杠，然后用双引号包裹
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    // 对象/数组等转为 JSON
    return JSON.stringify(value);
  });

  // 2. 如果表达式以 'expr:' 开头，去掉前缀
  if (jsExpression.startsWith("expr:")) {
    jsExpression = jsExpression.slice(5);
  }

  // 3. 使用 new Function 在受限沙箱中执行
  try {
    const fn = new Function(
      "Math",
      "String",
      "Number",
      "Date",
      "Array",
      "Object",
      "JSON",
      `
        try { return (${jsExpression}); } catch (e) { return false; }
      `
    );
    const result = fn(Math, String, Number, Date, Array, Object, JSON);
    return Boolean(result);
  } catch (e) {
    console.warn(`[LinkageEngine] Expression evaluation failed: "${expression}" -> "${jsExpression}"`, e);
    return false;
  }
}

// ───────────────────────────────────────────────────────────────
// 查找依赖某字段的所有字段（用于级联更新）
// ───────────────────────────────────────────────────────────────

export function findDependentFields(
  changedField: string,
  schemaProperties: Record<string, any>
): string[] {
  const dependents = new Set<string>();

  for (const [fieldName, fieldSchema] of Object.entries(schemaProperties)) {
    if (!fieldSchema || typeof fieldSchema !== "object") {
      continue;
    }

    // 检查 x-linkage 中是否有规则的 when 包含 {{changedField}}
    const linkageRules = fieldSchema["x-linkage"];
    if (Array.isArray(linkageRules)) {
      for (const rule of linkageRules) {
        if (typeof rule.when === "string" && rule.when.includes(`{{${changedField}}}`)) {
          dependents.add(fieldName);
          break;
        }
      }
    }

    // 检查 x-dataSource.database.queryParams 中是否有 source === 'formField' 且 sourceField === changedField
    const dataSource = fieldSchema["x-dataSource"];
    if (dataSource?.database?.queryParams) {
      const params = Array.isArray(dataSource.database.queryParams)
        ? dataSource.database.queryParams
        : [];
      for (const param of params) {
        if (param.source === "formField" && param.sourceField === changedField) {
          dependents.add(fieldName);
          break;
        }
      }
    }
  }

  return Array.from(dependents);
}
