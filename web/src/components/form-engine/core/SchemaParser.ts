/**
 * RAOS Form Engine - Schema Parser
 *
 * 提供 Schema 扁平化和路径操作工具函数。
 */

import type { RaosFormSchema, RaosFieldSchema } from "../types";

export interface FlattenedField {
  name: string;
  schema: RaosFieldSchema;
}

/**
 * 将嵌套 Schema 扁平化为字段列表
 * @param schema - 表单 Schema
 * @param prefix - 路径前缀，用于构建嵌套路径
 * @returns 扁平化后的字段列表
 */
export function flattenFields(
  schema: RaosFormSchema,
  prefix = ""
): FlattenedField[] {
  const results: FlattenedField[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (fieldSchema.type === "object" && fieldSchema.properties) {
      // 递归扁平化嵌套对象
      const nestedSchema: RaosFormSchema = {
        type: "object",
        properties: fieldSchema.properties,
      };
      results.push(...flattenFields(nestedSchema, path));
    } else if (
      fieldSchema.type === "array" &&
      fieldSchema.items &&
      fieldSchema.items.type === "object" &&
      fieldSchema.items.properties
    ) {
      // 递归扁平化数组 items 内部的对象
      const nestedSchema: RaosFormSchema = {
        type: "object",
        properties: fieldSchema.items.properties,
      };
      results.push(...flattenFields(nestedSchema, path));
    } else {
      // 基础类型直接加入结果
      results.push({ name: path, schema: fieldSchema });
    }
  }

  return results;
}

/**
 * 通过点分隔路径获取对象中的值
 * @param obj - 目标对象
 * @param path - 点分隔路径，如 "user.name"
 * @returns 路径对应的值，路径不存在返回 undefined
 */
export function getValueByPath(obj: any, path: string): any {
  if (obj == null) return undefined;

  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * 通过点分隔路径在对象中设置值
 * @param obj - 目标对象
 * @param path - 点分隔路径，如 "user.name"
 * @param value - 要设置的值
 */
export function setValueByPath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * 获取 Schema 中所有字段的完整路径名称
 * @param schema - 表单 Schema
 * @param prefix - 路径前缀
 * @returns 所有字段名的字符串数组
 */
export function getAllFieldNames(
  schema: RaosFormSchema,
  prefix = ""
): string[] {
  const names: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (fieldSchema.type === "object" && fieldSchema.properties) {
      // 递归获取嵌套对象字段名
      const nestedSchema: RaosFormSchema = {
        type: "object",
        properties: fieldSchema.properties,
      };
      names.push(...getAllFieldNames(nestedSchema, path));
    } else if (
      fieldSchema.type === "array" &&
      fieldSchema.items &&
      fieldSchema.items.type === "object" &&
      fieldSchema.items.properties
    ) {
      // 递归获取数组 items 内部的对象字段名
      const nestedSchema: RaosFormSchema = {
        type: "object",
        properties: fieldSchema.items.properties,
      };
      names.push(...getAllFieldNames(nestedSchema, path));
    } else {
      names.push(path);
    }
  }

  return names;
}
