import type { DataSourceConfig, DataFilter, RaosFieldSchema } from '../types/form.js';

export interface ResolveDataSourceRequest {
  fieldSchema: RaosFieldSchema;
  formData: Record<string, any>;
  searchKeyword?: string;
  page?: number;
  pageSize?: number;
}

export interface DataSourceOption {
  label: string;
  value: any;
  extra?: Record<string, any>;
  disabled?: boolean;
}

export interface ResolveDataSourceResponse {
  options: DataSourceOption[];
  total?: number;
  hasMore?: boolean;
}

export async function resolveDataSource(
  request: ResolveDataSourceRequest
): Promise<ResolveDataSourceResponse> {
  const { fieldSchema, formData } = request;
  const dataSource = fieldSchema['x-dataSource'];

  if (!dataSource) {
    return { options: [] };
  }

  switch (dataSource.type) {
    case 'static':
      return resolveStatic(dataSource, request);
    case 'remote':
      return resolveRemote(dataSource, request);
    case 'expression':
      return resolveExpression(dataSource, formData);
    case 'workflowVar':
      return resolveWorkflowVar(dataSource, formData);
    case 'database': {
      const dbConfig = dataSource.database;
      if (!dbConfig) return { options: [] };

      // 解析 queryParams，替换 formField 来源的值
      const params: any[] = [];
      for (const param of dbConfig.queryParams || []) {
        if (param.source === 'formField' && param.sourceField) {
          params.push(request.formData[param.sourceField] ?? null);
        } else if (param.source === 'static') {
          params.push(param.value ?? null);
        } else if (param.source === 'userContext') {
          // TODO: 从 req.user 获取
          params.push(null);
        } else {
          params.push(param.value ?? null);
        }
      }

      try {
        const { executeQuery } = await import('./database-connector.js');
        const rows = await executeQuery(
          dbConfig.connectionId!,
          dbConfig.query,
          params,
          dbConfig.timeout || 5000
        );

        let options: DataSourceOption[] = rows.map((row: any) => ({
          label: row[dbConfig.labelField],
          value: row[dbConfig.valueField],
          extra: dbConfig.extraFields?.reduce((acc: any, field: string) => {
            acc[field] = row[field];
            return acc;
          }, {}),
        }));

        if (dataSource.filters) {
          options = applyFilters(options, dataSource.filters, request.formData);
        }

        return {
          options,
          total: options.length,
        };
      } catch (error) {
        console.error('Database query failed:', error);
        return { options: [] };
      }
    }
    default:
      return { options: [] };
  }
}

export function applyFilters(
  options: DataSourceOption[],
  filters: DataFilter[],
  formData: Record<string, any>
): DataSourceOption[] {
  if (!filters || filters.length === 0) return options;

  return options.filter((option) => {
    let result = true;

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const fieldValue = option.extra?.[filter.field] ?? option[filter.field as keyof DataSourceOption];

      // 解析 value 中的 {{fieldName}} 表达式
      const filterValue = resolveFilterValue(filter.value, formData);

      const match = evaluateFilter(fieldValue, filter.operator, filterValue);

      if (i === 0) {
        result = match;
      } else {
        const logic = filter.logic || 'and';
        if (logic === 'and') {
          result = result && match;
        } else {
          result = result || match;
        }
      }
    }

    return result;
  });
}

function resolveFilterValue(value: any, formData: Record<string, any>): any {
  if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
    const fieldName = value.slice(2, -2);
    return formData[fieldName];
  }
  return value;
}

function evaluateFilter(fieldValue: any, operator: string, filterValue: any): boolean {
  switch (operator) {
    case 'eq': return fieldValue == filterValue;
    case 'ne': return fieldValue != filterValue;
    case 'gt': return fieldValue > filterValue;
    case 'gte': return fieldValue >= filterValue;
    case 'lt': return fieldValue < filterValue;
    case 'lte': return fieldValue <= filterValue;
    case 'contains': return String(fieldValue).includes(String(filterValue));
    case 'startsWith': return String(fieldValue).startsWith(String(filterValue));
    case 'endsWith': return String(fieldValue).endsWith(String(filterValue));
    case 'in': return Array.isArray(filterValue) && filterValue.includes(fieldValue);
    case 'notIn': return Array.isArray(filterValue) && !filterValue.includes(fieldValue);
    case 'between':
      return Array.isArray(filterValue) && filterValue.length === 2
        && fieldValue >= filterValue[0] && fieldValue <= filterValue[1];
    case 'isNull': return fieldValue === null || fieldValue === undefined;
    case 'isNotNull': return fieldValue !== null && fieldValue !== undefined;
    default: return true;
  }
}

function resolveStatic(
  config: DataSourceConfig,
  request: ResolveDataSourceRequest
): ResolveDataSourceResponse {
  const options = config.options || [];
  let filtered = options;

  // 如果提供了 searchKeyword，在 label 中过滤
  if (request.searchKeyword) {
    const keyword = request.searchKeyword.toLowerCase();
    filtered = options.filter((opt) => opt.label.toLowerCase().includes(keyword));
  }

  let result: DataSourceOption[] = filtered.map((opt) => ({
    label: opt.label,
    value: opt.value,
    extra: (opt as any).extra,
    disabled: (opt as any).disabled,
  }));

  if (config.filters) {
    result = applyFilters(result, config.filters, request.formData);
  }

  return {
    options: result,
    total: result.length,
  };
}

async function resolveRemote(
  config: DataSourceConfig,
  request: ResolveDataSourceRequest
): Promise<ResolveDataSourceResponse> {
  const { url, method = 'GET', params = {}, headers = {}, path } = config;

  if (!url) {
    return { options: [] };
  }

  // 替换 URL 中的 {{fieldName}} 占位符
  const resolvedUrl = url.replace(/\{\{(\w+)\}\}/g, (_match, fieldName) => {
    return encodeURIComponent(request.formData[fieldName] ?? '');
  });

  // 替换 params 中的占位符
  const resolvedParams: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const fieldName = value.slice(2, -2);
      resolvedParams[key] = request.formData[fieldName];
    } else {
      resolvedParams[key] = value;
    }
  }

  // 添加 searchKeyword 到 params（如果远程接口支持搜索）
  if (request.searchKeyword) {
    resolvedParams.keyword = request.searchKeyword;
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    let response: Response;

    if (method === 'GET') {
      const queryString = new URLSearchParams(
        Object.entries(resolvedParams).map(([k, v]) => [k, String(v ?? '')])
      ).toString();
      const fullUrl = queryString ? `${resolvedUrl}?${queryString}` : resolvedUrl;
      response = await fetch(fullUrl, fetchOptions);
    } else {
      fetchOptions.body = JSON.stringify(resolvedParams);
      response = await fetch(resolvedUrl, fetchOptions);
    }

    if (!response.ok) {
      return { options: [] };
    }

    const data = await response.json();

    // 从响应中提取选项数组
    let options: any = data;
    if (path) {
      // 支持路径如 "data.list"
      const parts = path.split('.');
      for (const part of parts) {
        options = options?.[part];
      }
    }

    if (!Array.isArray(options)) {
      return { options: [] };
    }

    let result: DataSourceOption[] = options.map((opt) => ({
      label: opt.label || opt.name || opt.title || String(opt.value ?? opt.id ?? opt.key ?? ''),
      value: opt.value ?? opt.id ?? opt.key,
      extra: opt.extra,
      disabled: opt.disabled,
    }));

    if (config.filters) {
      result = applyFilters(result, config.filters, request.formData);
    }

    return {
      options: result,
      total: result.length,
    };
  } catch (error) {
    console.error('Remote data source fetch failed:', error);
    return { options: [] };
  }
}

function resolveExpression(
  config: DataSourceConfig,
  formData: Record<string, any>
): ResolveDataSourceResponse {
  const expression = config.expression;
  if (!expression) return { options: [] };

  // 简单表达式：从其他字段拼接
  // 示例："{{deptId}}-{{userId}}"
  const value = expression.replace(/\{\{(\w+)\}\}/g, (_match, fieldName) => {
    return String(formData[fieldName] ?? '');
  });

  return {
    options: [{ label: value, value }],
  };
}

function resolveWorkflowVar(
  config: DataSourceConfig,
  formData: Record<string, any>
): ResolveDataSourceResponse {
  const varName = config.variableName;
  if (!varName) return { options: [] };

  // 从 formData 中查找 workflowVar.xxx 的值
  const value = formData[varName] ?? formData[`workflowVar.${varName}`];

  if (Array.isArray(value)) {
    return {
      options: value.map((v: any) => ({
        label: typeof v === 'object' ? v.label || v.name || String(v.value ?? v.id ?? '') : String(v),
        value: typeof v === 'object' ? (v.value ?? v.id ?? v.key) : v,
      })),
    };
  }

  if (value !== undefined && value !== null) {
    return {
      options: [{ label: String(value), value }],
    };
  }

  return { options: [] };
}
