import type { DataSourceConfig, RaosFieldSchema } from '../types/form.js';

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
    case 'database':
      // Phase 15 实现
      return { options: [] };
    default:
      return { options: [] };
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

  return {
    options: filtered.map((opt) => ({
      label: opt.label,
      value: opt.value,
      extra: opt.extra,
      disabled: opt.disabled,
    })),
    total: filtered.length,
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
    let options: any[] = data;
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

    return {
      options: options.map((opt) => ({
        label: opt.label || opt.name || opt.title || String(opt.value ?? opt.id ?? opt.key ?? ''),
        value: opt.value ?? opt.id ?? opt.key,
        extra: opt.extra,
        disabled: opt.disabled,
      })),
      total: options.length,
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
