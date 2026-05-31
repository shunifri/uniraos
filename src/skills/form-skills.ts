/**
 * Form Skills — 通用表单数据查询
 *
 * - form_data_query: 根据表单 key 查询表单实例数据，支持列表、统计、分组、schema 获取
 */
import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { isMySQL } from "../db/database.js";
import { getMySQLAdapter } from "../db/mysql-adapter.js";
import { getDb } from "../db/database.js";

interface FormField {
  name: string;
  type: string;
  title?: string;
}

interface FormDefinition {
  id: string;
  key: string;
  name: string;
  schema_json: {
    properties?: Record<string, { type?: string; title?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

/** 合法的表单字段名：字母、数字、下划线 */
const VALID_FIELD_NAME = /^[a-zA-Z0-9_]+$/;

function assertValidFieldName(field: string): void {
  if (!VALID_FIELD_NAME.test(field)) {
    throw new Error(`非法的字段名: "${field}"，只允许字母、数字、下划线`);
  }
}

/** JSON 字段提取表达式（适配 MySQL / SQLite） */
function jsonExpr(field: string, alias?: string): string {
  assertValidFieldName(field);
  if (isMySQL()) {
    const expr = `JSON_UNQUOTE(JSON_EXTRACT(fi.data_json, '$.${field}'))`;
    return alias ? `${expr} AS \`${alias}\`` : expr;
  }
  const expr = `json_extract(fi.data_json, '$.${field}')`;
  return alias ? `${expr} AS "${alias}"` : expr;
}

/** JSON 字段条件表达式 */
function jsonCondition(field: string, paramIndex: number): string {
  assertValidFieldName(field);
  if (isMySQL()) {
    return `JSON_UNQUOTE(JSON_EXTRACT(fi.data_json, '$.${field}')) = ?`;
  }
  return `json_extract(fi.data_json, '$.${field}') = ?${paramIndex + 1}`;
}

/** 获取表单定义 */
async function getFormDef(formKey: string): Promise<FormDefinition | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query('SELECT id, `key`, name, schema_json FROM form_definitions WHERE `key` = ?', [formKey]);
    const row = rows[0] as any;
    if (!row) return null;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      schema_json: typeof row.schema_json === 'string' ? JSON.parse(row.schema_json) : row.schema_json,
    };
  }
  const db = getDb();
  const row = db.prepare('SELECT id, key, name, schema_json FROM form_definitions WHERE key = ?').get(formKey) as any;
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    schema_json: JSON.parse(row.schema_json),
  };
}

/** 解析表单字段列表 */
function extractFields(schema: FormDefinition['schema_json']): FormField[] {
  const props = schema?.properties ?? {};
  return Object.entries(props).map(([name, def]) => ({
    name,
    type: def.type ?? 'string',
    title: def.title ?? name,
  }));
}

/** 构建基础 WHERE 条件 */
function buildWhereConditions(
  definitionId: string,
  filters: Record<string, unknown>,
  startDate?: string,
  endDate?: string,
): { sql: string; params: unknown[] } {
  const conditions: string[] = ['fi.definition_id = ?'];
  const params: unknown[] = [definitionId];

  if (startDate && endDate) {
    conditions.push('fi.submitted_at BETWEEN ? AND ?');
    params.push(startDate, endDate);
  }

  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (!VALID_FIELD_NAME.test(field)) continue; // 跳过非法字段名，防止注入
    conditions.push(jsonCondition(field, params.length));
    params.push(String(value));
  }

  return { sql: conditions.join(' AND '), params };
}

/** 执行查询（MySQL / SQLite 适配） */
async function executeQuery(sql: string, params: unknown[]): Promise<{ rows: unknown[]; columns: string[] }> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(sql, params);
    if (!Array.isArray(rows) || rows.length === 0) {
      return { rows: [], columns: [] };
    }
    return { rows, columns: Object.keys(rows[0] as object) };
  }
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as unknown[];
  if (rows.length === 0) {
    return { rows: [], columns: [] };
  }
  return { rows, columns: Object.keys(rows[0] as object) };
}

export function createFormSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "form_data_query",
      description:
        "通用表单数据查询 Skill。根据表单 key 查询表单实例数据，自动获取表单 schema 并返回结构化结果。参数: formKey(string), queryType('list'|'count'|'group'|'stats'|'schema'), filters?(object), groupBy?(string[]), metrics?(Array<{field,type:'count'|'sum'|'avg'|'min'|'max'}>), startDate?, endDate?, limit?(number), offset?(number), orderBy?(string), orderDesc?(boolean)",
      timeout: 30000,
      paramSchema: {
        properties: {
          formKey: { type: "string", description: "表单 key，如 intent_registration" },
          queryType: {
            type: "string",
            enum: ["list", "count", "group", "stats", "schema"],
            description: "查询类型：list(列表), count(计数), group(分组统计), stats(指标统计), schema(获取表单结构)",
          },
          filters: { type: "object", description: "字段过滤条件，如 { intended_major: '计算机' }" },
          groupBy: { type: "array", items: { type: "string" }, description: "分组字段列表" },
          metrics: {
            type: "array",
            description: "统计指标，如 [{ field: 'age', type: 'avg' }]",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                type: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
              },
            },
          },
          startDate: { type: "string", description: "开始时间，如 2024-01-01" },
          endDate: { type: "string", description: "结束时间，如 2024-12-31" },
          limit: { type: "number", description: "分页限制，默认 50" },
          offset: { type: "number", description: "分页偏移，默认 0" },
          orderBy: { type: "string", description: "排序字段" },
          orderDesc: { type: "boolean", description: "是否降序" },
        },
        required: ["formKey", "queryType"],
      },
      handler: async (params) => {
        const formKey = params.formKey as string;
        const queryType = params.queryType as string;

        if (!formKey || !queryType) {
          return { success: false, error: new Error("formKey 和 queryType 必填") };
        }

        // 1. 获取表单定义
        const formDef = await getFormDef(formKey);
        if (!formDef) {
          return { success: false, error: new Error(`表单 "${formKey}" 不存在`) };
        }

        const fields = extractFields(formDef.schema_json);

        // schema 类型直接返回结构
        if (queryType === "schema") {
          return {
            success: true,
            data: {
              formKey: formDef.key,
              formName: formDef.name,
              definitionId: formDef.id,
              fields,
              schema: formDef.schema_json,
            },
          };
        }

        const filters = (params.filters as Record<string, unknown>) ?? {};
        const startDate = params.startDate as string | undefined;
        const endDate = params.endDate as string | undefined;

        // 2. 构建 WHERE 条件
        const { sql: whereSql, params: whereParams } = buildWhereConditions(
          formDef.id,
          filters,
          startDate,
          endDate,
        );

        try {
          let sql: string;
          let queryParams = [...whereParams];

          switch (queryType) {
            case "count": {
              sql = `SELECT COUNT(*) as total FROM form_instances fi WHERE ${whereSql}`;
              const result = await executeQuery(sql, queryParams);
              return {
                success: true,
                data: {
                  formKey,
                  formName: formDef.name,
                  total: (result.rows[0] as any)?.total ?? (result.rows[0] as any)?.COUNT ?? 0,
                  filters,
                  dateRange: startDate && endDate ? { startDate, endDate } : undefined,
                },
              };
            }

            case "group": {
              const groupBy = (params.groupBy as string[]) ?? [];
              if (groupBy.length === 0) {
                return { success: false, error: new Error("group 查询需要指定 groupBy 字段") };
              }
              const selectFields = groupBy.map((f) => jsonExpr(f, f));
              const groupExpr = groupBy.map((f) => jsonExpr(f)).join(", ");
              sql = `SELECT ${selectFields.join(", ")}, COUNT(*) as count FROM form_instances fi WHERE ${whereSql} GROUP BY ${groupExpr}`;
              const result = await executeQuery(sql, queryParams);
              return {
                success: true,
                data: {
                  formKey,
                  formName: formDef.name,
                  groupBy,
                  rows: result.rows,
                  columns: result.columns,
                },
              };
            }

            case "stats": {
              let metrics = (params.metrics as Array<{ field: string; type: string }>) ?? [];
              // 如果未指定 metrics，默认返回 COUNT(*)
              if (metrics.length === 0) {
                metrics = [{ field: '*', type: 'count' }];
              }
              const selectMetrics = metrics.map((m) => {
                // COUNT(*) 特殊处理，不需要字段表达式
                if (m.type === 'count' && m.field === '*') {
                  return isMySQL() ? `COUNT(*) as \`total_count\`` : `COUNT(*) as "total_count"`;
                }
                const fieldExpr = jsonExpr(m.field);
                if (isMySQL()) {
                  switch (m.type) {
                    case "sum":
                      return `SUM(CAST(${fieldExpr} AS DECIMAL(18,2))) as \`${m.field}_sum\``;
                    case "avg":
                      return `AVG(CAST(${fieldExpr} AS DECIMAL(18,2))) as \`${m.field}_avg\``;
                    case "min":
                      return `MIN(CAST(${fieldExpr} AS DECIMAL(18,2))) as \`${m.field}_min\``;
                    case "max":
                      return `MAX(CAST(${fieldExpr} AS DECIMAL(18,2))) as \`${m.field}_max\``;
                    case "count":
                    default:
                      return `COUNT(*) as \`${m.field}_count\``;
                  }
                } else {
                  switch (m.type) {
                    case "sum":
                      return `SUM(CAST(${fieldExpr} AS REAL)) as "${m.field}_sum"`;
                    case "avg":
                      return `AVG(CAST(${fieldExpr} AS REAL)) as "${m.field}_avg"`;
                    case "min":
                      return `MIN(CAST(${fieldExpr} AS REAL)) as "${m.field}_min"`;
                    case "max":
                      return `MAX(CAST(${fieldExpr} AS REAL)) as "${m.field}_max"`;
                    case "count":
                    default:
                      return `COUNT(*) as "${m.field}_count"`;
                  }
                }
              });
              sql = `SELECT ${selectMetrics.join(", ")} FROM form_instances fi WHERE ${whereSql}`;
              const result = await executeQuery(sql, queryParams);
              return {
                success: true,
                data: {
                  formKey,
                  formName: formDef.name,
                  metrics,
                  result: result.rows[0] ?? {},
                  columns: result.columns,
                },
              };
            }

            case "list":
            default: {
              const limit = Math.min((params.limit as number) ?? 50, 200);
              const offset = (params.offset as number) ?? 0;
              const orderBy = params.orderBy as string | undefined;
              const orderDesc = params.orderDesc as boolean | undefined;

              // 选择常用字段 + data_json
              const selectList = [
                "fi.id",
                "fi.status",
                "fi.submitted_by",
                "fi.submitted_at",
                "fi.created_at",
                "fi.data_json",
              ];

              sql = `SELECT ${selectList.join(", ")} FROM form_instances fi WHERE ${whereSql}`;

              if (orderBy) {
                const orderExpr = jsonExpr(orderBy);
                const direction = orderDesc ? "DESC" : "ASC";
                sql += ` ORDER BY ${orderExpr} ${direction}`;
              } else {
                sql += " ORDER BY fi.submitted_at DESC";
              }

              sql += ` LIMIT ${limit} OFFSET ${offset}`;

              const result = await executeQuery(sql, queryParams);

              // 解析 data_json 为结构化数据
              const rows = result.rows.map((row: any) => {
                let data = row.data_json;
                if (typeof data === "string") {
                  try { data = JSON.parse(data); } catch { /* keep string */ }
                }
                return { ...row, data_json: data };
              });

              return {
                success: true,
                data: {
                  formKey,
                  formName: formDef.name,
                  fields,
                  rows,
                  columns: result.columns,
                  pagination: { limit, offset },
                },
              };
            }
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
    }),
  );

  // ===== form_submit: 表单创建并提交 =====
  registry.register(
    defineSystemSkill({
      name: "form_submit",
      description: `创建并提交表单实例。
参数:
  formKey(string): 表单标识，如 "intent_registration"
  data(object): 表单字段数据，如 { name: "张三", age: 18 }
使用示例:
  - "提交报名表" → formKey="intent_registration", data={name: "张三", phone: "13800138000"}`,
      paramSchema: {
        properties: {
          formKey: { type: "string", description: "表单标识" },
          data: { type: "object", description: "表单字段数据" },
        },
        required: ["formKey", "data"],
      },
      handler: async (params, context) => {
        try {
          const formKey = params.formKey as string;
          const data = (params.data as Record<string, unknown>) ?? {};
          const userId = context.user?.id || "anonymous";

          // 1. 查找表单定义
          const formDef = await getFormDef(formKey);
          if (!formDef) {
            return { success: false, error: new Error(`表单不存在: ${formKey}`) };
          }

          // 2. 创建表单实例（draft 状态）
          const instanceId = crypto.randomUUID();
          if (isMySQL()) {
            const adapter = await getMySQLAdapter();
            await adapter.execute(
              `INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [instanceId, formDef.id, 1, JSON.stringify(data), "draft", userId]
            );
            // 3. 提交表单实例
            await adapter.execute(
              `UPDATE form_instances SET status = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              ["submitted", instanceId]
            );
          } else {
            const db = getDb();
            db.prepare(
              `INSERT INTO form_instances (id, definition_id, definition_version, data_json, status, submitted_by)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(instanceId, formDef.id, 1, JSON.stringify(data), "draft", userId);
            const submittedAt = new Date().toISOString();
            db.prepare(
              `UPDATE form_instances SET status = ?, submitted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
            ).run("submitted", submittedAt, instanceId);
          }

          return {
            success: true,
            data: {
              instanceId,
              formKey,
              formName: formDef.name,
              status: "submitted",
              message: `表单「${formDef.name}」已提交成功`,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
    }),
  );

  console.log("   Form skills registered (form_data_query, form_submit)");
}
