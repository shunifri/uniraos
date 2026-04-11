/**
 * API 文档自动生成 Skill 家族
 *
 * 上传 API 文档（OpenAPI/Swagger/自定义 JSON），自动解析并生成可调用的 Skill。
 * 支持多种认证方式：API Key、Bearer Token、Basic Auth、OAuth2、自定义 Header、
 * HMAC 签名、AWS Signature V4 等。
 *
 * Skills:
 *   api_import      — 从 API 文档导入并自动生成 Skills
 *   api_auth_config — 配置 API 认证信息
 *   api_list        — 列出所有已导入的 API 及其 Skills
 *   api_delete      — 删除已导入的 API
 *   api_test        — 测试 API Skill 调用
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillDefinition } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import Database from "better-sqlite3";
import { join, resolve } from "path";
import { mkdirSync, existsSync, readFileSync } from "fs";

// ===== 认证体系 =====

/** 支持的认证类型 */
type AuthType =
  | "none"
  | "api_key"        // API Key in header/query
  | "bearer"         // Bearer token
  | "basic"          // Basic auth (username:password)
  | "oauth2"         // OAuth2 with token refresh
  | "custom_header"  // 自定义 header
  | "hmac"           // HMAC 签名
  | "aws_v4"         // AWS Signature V4
  | "digest";        // Digest auth

interface AuthConfig {
  type: AuthType;

  // api_key
  apiKey?: string;
  apiKeyName?: string;       // header/query 参数名
  apiKeyLocation?: "header" | "query"; // 默认 header

  // bearer
  token?: string;

  // basic
  username?: string;
  password?: string;

  // oauth2
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiry?: number;
  scopes?: string[];

  // custom_header
  headers?: Record<string, string>;

  // hmac
  hmacSecret?: string;
  hmacAlgorithm?: string;    // sha256, sha1, etc.
  hmacHeader?: string;       // 签名放在哪个 header
  hmacTimestampHeader?: string;

  // aws_v4
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  awsService?: string;
}

/** 将认证配置应用到请求 */
async function applyAuth(
  auth: AuthConfig,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<void> {
  switch (auth.type) {
    case "none":
      break;

    case "api_key": {
      const keyName = auth.apiKeyName ?? "X-API-Key";
      const keyValue = auth.apiKey ?? "";
      if (auth.apiKeyLocation === "query") {
        const u = new URL(url);
        u.searchParams.set(keyName, keyValue);
        // URL 会在调用时使用
      } else {
        headers[keyName] = keyValue;
      }
      break;
    }

    case "bearer":
      headers["Authorization"] = `Bearer ${auth.token ?? ""}`;
      break;

    case "basic": {
      const credentials = Buffer.from(`${auth.username ?? ""}:${auth.password ?? ""}`).toString("base64");
      headers["Authorization"] = `Basic ${credentials}`;
      break;
    }

    case "oauth2": {
      // 检查 token 是否过期
      if (!auth.accessToken || (auth.accessTokenExpiry && Date.now() > auth.accessTokenExpiry)) {
        if (auth.tokenUrl && (auth.refreshToken || (auth.clientId && auth.clientSecret))) {
          try {
            const tokenResponse = await fetch(auth.tokenUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: auth.refreshToken ? "refresh_token" : "client_credentials",
                ...(auth.refreshToken ? { refresh_token: auth.refreshToken } : {}),
                ...(auth.clientId ? { client_id: auth.clientId } : {}),
                ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
                ...(auth.scopes?.length ? { scope: auth.scopes.join(" ") } : {}),
              }).toString(),
            });

            if (tokenResponse.ok) {
              const tokenData = (await tokenResponse.json()) as any;
              auth.accessToken = tokenData.access_token;
              auth.accessTokenExpiry = Date.now() + (tokenData.expires_in ?? 3600) * 1000;
              if (tokenData.refresh_token) auth.refreshToken = tokenData.refresh_token;
            }
          } catch {
            // Token 刷新失败，使用旧 token
          }
        }
      }
      if (auth.accessToken) {
        headers["Authorization"] = `Bearer ${auth.accessToken}`;
      }
      break;
    }

    case "custom_header":
      if (auth.headers) {
        Object.assign(headers, auth.headers);
      }
      break;

    case "hmac": {
      const { createHmac } = await import("crypto");
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signPayload = `${method}\n${url}\n${timestamp}\n${body ?? ""}`;
      const signature = createHmac(auth.hmacAlgorithm ?? "sha256", auth.hmacSecret ?? "")
        .update(signPayload)
        .digest("hex");
      headers[auth.hmacHeader ?? "X-Signature"] = signature;
      if (auth.hmacTimestampHeader) {
        headers[auth.hmacTimestampHeader] = timestamp;
      }
      break;
    }

    case "aws_v4": {
      // 简化版 AWS V4 签名
      const { createHmac: createHmac2, createHash } = await import("crypto");
      const now = new Date();
      const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
      const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

      headers["X-Amz-Date"] = amzDate;

      const parsedUrl = new URL(url);
      const credentialScope = `${dateStamp}/${auth.awsRegion ?? "us-east-1"}/${auth.awsService ?? "execute-api"}/aws4_request`;

      const canonicalHeaders = `host:${parsedUrl.host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = "host;x-amz-date";
      const payloadHash = createHash("sha256").update(body ?? "").digest("hex");

      const canonicalRequest = [
        method,
        parsedUrl.pathname,
        parsedUrl.searchParams.toString(),
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join("\n");

      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        createHash("sha256").update(canonicalRequest).digest("hex"),
      ].join("\n");

      const kDate = createHmac2("sha256", `AWS4${auth.awsSecretAccessKey ?? ""}`).update(dateStamp).digest();
      const kRegion = createHmac2("sha256", kDate).update(auth.awsRegion ?? "us-east-1").digest();
      const kService = createHmac2("sha256", kRegion).update(auth.awsService ?? "execute-api").digest();
      const kSigning = createHmac2("sha256", kService).update("aws4_request").digest();
      const signature2 = createHmac2("sha256", kSigning).update(stringToSign).digest("hex");

      headers["Authorization"] =
        `AWS4-HMAC-SHA256 Credential=${auth.awsAccessKeyId ?? ""}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature2}`;
      break;
    }

    case "digest":
      // Digest auth 需要先发一个请求获取 nonce，这里简化处理
      if (auth.username && auth.password) {
        headers["Authorization"] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
      }
      break;
  }
}

// ===== OpenAPI 解析 =====

interface ParsedEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header" | "body";
    required: boolean;
    type: string;
    description: string;
  }>;
  requestBody?: {
    contentType: string;
    schema: any;
  };
  responses: Record<string, { description: string }>;
}

function parseOpenAPI(doc: any): { baseUrl: string; endpoints: ParsedEndpoint[]; title: string; authSchemes: string[] } {
  const endpoints: ParsedEndpoint[] = [];

  // 判断版本
  const isV3 = doc.openapi?.startsWith("3.");
  const isV2 = doc.swagger?.startsWith("2.");

  // 基础 URL
  let baseUrl = "";
  if (isV3 && doc.servers?.length) {
    baseUrl = doc.servers[0].url;
  } else if (isV2) {
    const scheme = doc.schemes?.[0] ?? "https";
    baseUrl = `${scheme}://${doc.host ?? "localhost"}${doc.basePath ?? ""}`;
  }

  // 认证方案
  const authSchemes: string[] = [];
  const securityDefs = isV3 ? doc.components?.securitySchemes : doc.securityDefinitions;
  if (securityDefs) {
    for (const [, scheme] of Object.entries(securityDefs as Record<string, any>)) {
      if (scheme.type === "apiKey") authSchemes.push("api_key");
      else if (scheme.type === "http" && scheme.scheme === "bearer") authSchemes.push("bearer");
      else if (scheme.type === "http" && scheme.scheme === "basic") authSchemes.push("basic");
      else if (scheme.type === "oauth2") authSchemes.push("oauth2");
    }
  }

  // 解析路径
  const paths = doc.paths ?? {};
  for (const [path, methods] of Object.entries(paths as Record<string, any>)) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      if (["get", "post", "put", "delete", "patch"].indexOf(method) < 0) continue;

      const params: ParsedEndpoint["parameters"] = [];

      // 路径/查询/header 参数
      const opParams = operation.parameters ?? [];
      for (const p of opParams) {
        params.push({
          name: p.name,
          in: p.in,
          required: p.required ?? false,
          type: p.schema?.type ?? p.type ?? "string",
          description: p.description ?? "",
        });
      }

      // 请求体（V3）
      let requestBody: ParsedEndpoint["requestBody"];
      if (isV3 && operation.requestBody) {
        const content = operation.requestBody.content ?? {};
        const contentType = Object.keys(content)[0] ?? "application/json";
        requestBody = {
          contentType,
          schema: content[contentType]?.schema ?? {},
        };

        // 从 schema 提取字段作为参数
        const schema = requestBody.schema;
        if (schema.properties) {
          for (const [name, prop] of Object.entries(schema.properties as Record<string, any>)) {
            params.push({
              name,
              in: "body",
              required: (schema.required ?? []).includes(name),
              type: prop.type ?? "string",
              description: prop.description ?? "",
            });
          }
        }
      }

      // 请求体（V2）
      if (isV2) {
        const bodyParam = opParams.find((p: any) => p.in === "body");
        if (bodyParam?.schema?.properties) {
          for (const [name, prop] of Object.entries(bodyParam.schema.properties as Record<string, any>)) {
            params.push({
              name,
              in: "body",
              required: (bodyParam.schema.required ?? []).includes(name),
              type: prop.type ?? "string",
              description: prop.description ?? "",
            });
          }
        }
      }

      const operationId =
        operation.operationId ??
        `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")}`;

      endpoints.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? "",
        description: operation.description ?? "",
        parameters: params,
        requestBody,
        responses: operation.responses ?? {},
      });
    }
  }

  return {
    baseUrl,
    endpoints,
    title: doc.info?.title ?? "Untitled API",
    authSchemes: [...new Set(authSchemes)],
  };
}

// ===== 持久化 =====

const API_DB_PATH = join(process.cwd(), ".raos", "api-registry.db");

function getApiDb(): Database.Database {
  mkdirSync(resolve(API_DB_PATH, ".."), { recursive: true });
  const db = new Database(API_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_services (
      service_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      doc_format TEXT DEFAULT 'openapi',
      auth_config TEXT DEFAULT '{}',
      endpoint_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS api_endpoints (
      endpoint_id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      skill_name TEXT NOT NULL UNIQUE,
      operation_id TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      summary TEXT DEFAULT '',
      parameters TEXT DEFAULT '[]',
      request_body TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (service_id) REFERENCES api_services(service_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ep_service ON api_endpoints(service_id);
  `);
  return db;
}

let apiDb: Database.Database | null = null;
function ensureApiDb(): Database.Database {
  if (!apiDb) apiDb = getApiDb();
  return apiDb;
}

// 缓存认证配置
const authConfigCache = new Map<string, AuthConfig>();

function getAuthConfig(serviceId: string): AuthConfig {
  if (authConfigCache.has(serviceId)) return authConfigCache.get(serviceId)!;

  const db = ensureApiDb();
  const row = db.prepare("SELECT auth_config FROM api_services WHERE service_id = ?").get(serviceId) as any;
  if (!row) return { type: "none" };

  const config = JSON.parse(row.auth_config) as AuthConfig;
  authConfigCache.set(serviceId, config);
  return config;
}

// ===== Skill 生成 =====

function generateSkillForEndpoint(
  serviceId: string,
  serviceName: string,
  baseUrl: string,
  endpoint: ParsedEndpoint,
  registry: SkillRegistry,
): string {
  const skillName = `api_${serviceName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${endpoint.operationId.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  // 构建参数描述
  const paramDesc = endpoint.parameters
    .map((p) => `${p.name}(${p.type}${p.required ? "" : "?"})`)
    .join(", ");

  const description = `[API] ${endpoint.summary || endpoint.description || `${endpoint.method} ${endpoint.path}`}${paramDesc ? `. 参数: ${paramDesc}` : ""}`;

  const skill = defineSystemSkill({
    name: skillName,
    description,
    timeout: 30000,
    capabilities: ["api", `api:${serviceName}`],
    handler: async (params) => {
      try {
        // 构建 URL
        let url = baseUrl + endpoint.path;

        // 替换路径参数
        for (const p of endpoint.parameters.filter((p) => p.in === "path")) {
          const value = params[p.name];
          if (value !== undefined) {
            url = url.replace(`{${p.name}}`, encodeURIComponent(String(value)));
          } else if (p.required) {
            return { success: false, error: new Error(`缺少必填路径参数: ${p.name}`) };
          }
        }

        // 添加查询参数
        const queryParams = new URLSearchParams();
        for (const p of endpoint.parameters.filter((p) => p.in === "query")) {
          const value = params[p.name];
          if (value !== undefined) {
            queryParams.set(p.name, String(value));
          } else if (p.required) {
            return { success: false, error: new Error(`缺少必填查询参数: ${p.name}`) };
          }
        }
        const qs = queryParams.toString();
        if (qs) url += (url.includes("?") ? "&" : "?") + qs;

        // 构建请求头
        const headers: Record<string, string> = {};
        for (const p of endpoint.parameters.filter((p) => p.in === "header")) {
          const value = params[p.name];
          if (value !== undefined) headers[p.name] = String(value);
        }

        // 构建请求体
        let body: string | undefined;
        const bodyParams = endpoint.parameters.filter((p) => p.in === "body");
        if (bodyParams.length > 0) {
          const bodyObj: any = {};
          for (const p of bodyParams) {
            if (params[p.name] !== undefined) bodyObj[p.name] = params[p.name];
          }
          if (Object.keys(bodyObj).length > 0) {
            body = JSON.stringify(bodyObj);
            headers["Content-Type"] = endpoint.requestBody?.contentType ?? "application/json";
          }
        }
        // 直接传入 body 参数
        if (params.body !== undefined && !body) {
          body = typeof params.body === "string" ? params.body : JSON.stringify(params.body);
          if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
        }

        // 应用认证
        const auth = getAuthConfig(serviceId);
        await applyAuth(auth, endpoint.method, url, headers, body);

        // API Key in query 特殊处理
        if (auth.type === "api_key" && auth.apiKeyLocation === "query") {
          const u = new URL(url);
          u.searchParams.set(auth.apiKeyName ?? "api_key", auth.apiKey ?? "");
          url = u.toString();
        }

        // 发起请求
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);

        const response = await fetch(url, {
          method: endpoint.method,
          headers,
          body: ["GET", "HEAD"].includes(endpoint.method) ? undefined : body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const contentType = response.headers.get("content-type") ?? "";
        let responseBody: unknown;

        if (contentType.includes("application/json")) {
          responseBody = await response.json();
        } else {
          const text = await response.text();
          responseBody = text.length > 50000 ? text.substring(0, 50000) + "...[truncated]" : text;
        }

        return {
          success: response.ok,
          data: {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody,
          },
          error: response.ok ? undefined : new Error(`API ${response.status}: ${response.statusText}`),
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
  });

  registry.register(skill);
  return skillName;
}

// ===== 注册 Skills =====

export function createApiGenSkills(registry: SkillRegistry): void {
  const WORKSPACE_BASE = resolve(process.cwd(), ".raos", "workspace");

  registry.register(
    defineSystemSkill({
      name: "api_import",
      description:
        "从 API 文档导入并自动生成 Skills。参数: doc?(object, OpenAPI/Swagger JSON), path?(string, workspace中的文档路径), url?(string, 远程文档 URL), name?(string, 服务名), auth?(object, 认证配置 {type, apiKey, token, username, password, ...})",
      timeout: 60000,
      handler: async (params) => {
        let doc: any;
        const name = params.name as string | undefined;

        // 从不同来源获取 API 文档
        if (params.doc) {
          doc = params.doc;
        } else if (params.path) {
          const path = params.path as string;
          const fullPath = resolve(WORKSPACE_BASE, path);
          if (!fullPath.startsWith(WORKSPACE_BASE)) {
            return { success: false, error: new Error("路径安全违规") };
          }
          if (!existsSync(fullPath)) {
            return { success: false, error: new Error(`文件不存在: ${path}`) };
          }
          const content = readFileSync(fullPath, "utf-8");
          try {
            doc = JSON.parse(content);
          } catch {
            // 尝试 YAML（简易解析）
            return { success: false, error: new Error("仅支持 JSON 格式的 API 文档。YAML 支持需要安装 js-yaml") };
          }
        } else if (params.url) {
          try {
            const response = await fetch(params.url as string, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) {
              return { success: false, error: new Error(`获取文档失败: ${response.status}`) };
            }
            const contentType = response.headers.get("content-type") ?? "";
            if (contentType.includes("json")) {
              doc = await response.json();
            } else {
              const text = await response.text();
              try { doc = JSON.parse(text); } catch {
                return { success: false, error: new Error("无法解析 API 文档，仅支持 JSON 格式") };
              }
            }
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        } else {
          return { success: false, error: new Error("需要提供 doc、path 或 url 参数之一") };
        }

        try {
          // 解析 OpenAPI 文档
          const parsed = parseOpenAPI(doc);
          const serviceName = name ?? parsed.title.replace(/\s+/g, "_");
          const serviceId = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          // 认证配置
          const authConfig: AuthConfig = (params.auth as AuthConfig) ?? { type: "none" };
          if (authConfig.type === "none" && parsed.authSchemes.length > 0) {
            authConfig.type = parsed.authSchemes[0] as AuthType;
          }

          // 持久化服务信息
          const db = ensureApiDb();
          db.prepare(
            "INSERT INTO api_services (service_id, name, base_url, endpoint_count, created_at, auth_config, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(
            serviceId,
            serviceName,
            parsed.baseUrl,
            parsed.endpoints.length,
            Date.now(),
            JSON.stringify(authConfig),
            JSON.stringify({ title: parsed.title, authSchemes: parsed.authSchemes }),
          );

          // 缓存认证配置
          authConfigCache.set(serviceId, authConfig);

          // 为每个端点生成 Skill
          const generatedSkills: string[] = [];
          const insertEp = db.prepare(
            "INSERT INTO api_endpoints (endpoint_id, service_id, skill_name, operation_id, method, path, summary, parameters, request_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );

          for (const endpoint of parsed.endpoints) {
            const skillName = generateSkillForEndpoint(serviceId, serviceName, parsed.baseUrl, endpoint, registry);
            generatedSkills.push(skillName);

            const epId = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            insertEp.run(
              epId,
              serviceId,
              skillName,
              endpoint.operationId,
              endpoint.method,
              endpoint.path,
              endpoint.summary,
              JSON.stringify(endpoint.parameters),
              endpoint.requestBody ? JSON.stringify(endpoint.requestBody) : null,
              Date.now(),
            );
          }

          return {
            success: true,
            data: {
              serviceId,
              serviceName,
              baseUrl: parsed.baseUrl,
              endpointCount: parsed.endpoints.length,
              generatedSkills,
              authSchemes: parsed.authSchemes,
              authType: authConfig.type,
              message: `已从 "${serviceName}" 导入 ${generatedSkills.length} 个 API Skills。${
                authConfig.type !== "none" ? `认证方式: ${authConfig.type}` : "未配置认证，请使用 api_auth_config 设置"
              }`,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "api_auth_config",
      description:
        "配置 API 服务的认证信息。参数: serviceId(string), auth(object, {type: 'api_key'|'bearer'|'basic'|'oauth2'|'custom_header'|'hmac'|'aws_v4', ...具体字段})",
      handler: async (params) => {
        const serviceId = params.serviceId as string;
        const auth = params.auth as AuthConfig;
        if (!serviceId || !auth) {
          return { success: false, error: new Error("serviceId 和 auth 参数必填") };
        }

        // 验证认证类型
        const validTypes: AuthType[] = ["none", "api_key", "bearer", "basic", "oauth2", "custom_header", "hmac", "aws_v4", "digest"];
        if (!validTypes.includes(auth.type)) {
          return {
            success: false,
            error: new Error(`不支持的认证类型: ${auth.type}。支持: ${validTypes.join(", ")}`),
          };
        }

        try {
          const db = ensureApiDb();
          const result = db
            .prepare("UPDATE api_services SET auth_config = ?, updated_at = ? WHERE service_id = ?")
            .run(JSON.stringify(auth), Date.now(), serviceId);

          if (result.changes === 0) {
            return { success: false, error: new Error(`服务不存在: ${serviceId}`) };
          }

          // 更新缓存
          authConfigCache.set(serviceId, auth);

          return {
            success: true,
            data: { serviceId, authType: auth.type, message: `认证配置已更新: ${auth.type}` },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "api_list",
      description: "列出所有已导入的 API 服务及其 Skills",
      handler: async () => {
        try {
          const db = ensureApiDb();
          const services = db.prepare("SELECT * FROM api_services ORDER BY created_at DESC").all() as any[];

          const result = services.map((svc: any) => {
            const endpoints = db
              .prepare("SELECT skill_name, method, path, summary FROM api_endpoints WHERE service_id = ?")
              .all(svc.service_id) as any[];

            return {
              serviceId: svc.service_id,
              name: svc.name,
              baseUrl: svc.base_url,
              authType: JSON.parse(svc.auth_config).type ?? "none",
              endpointCount: svc.endpoint_count,
              skills: endpoints.map((ep: any) => ({
                name: ep.skill_name,
                method: ep.method,
                path: ep.path,
                summary: ep.summary,
              })),
              createdAt: svc.created_at,
            };
          });

          return { success: true, data: { services: result, total: result.length } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "api_delete",
      description: "删除已导入的 API 服务及其所有 Skills。参数: serviceId(string)",
      handler: async (params) => {
        const serviceId = params.serviceId as string;
        if (!serviceId) return { success: false, error: new Error("serviceId 参数必填") };

        try {
          const db = ensureApiDb();

          // 获取并注销相关 Skills
          const endpoints = db
            .prepare("SELECT skill_name FROM api_endpoints WHERE service_id = ?")
            .all(serviceId) as any[];

          for (const ep of endpoints) {
            try {
              registry.unregister(ep.skill_name);
            } catch { /* Skill 可能已不存在 */ }
          }

          // 删除数据库记录
          db.prepare("DELETE FROM api_endpoints WHERE service_id = ?").run(serviceId);
          const result = db.prepare("DELETE FROM api_services WHERE service_id = ?").run(serviceId);

          authConfigCache.delete(serviceId);

          return {
            success: result.changes > 0,
            data: {
              deleted: result.changes > 0,
              serviceId,
              skillsRemoved: endpoints.length,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "api_test",
      description: "测试 API Skill 调用。参数: skillName(string, 要测试的 Skill 名称), params?(object, 调用参数)",
      timeout: 30000,
      handler: async (params) => {
        const skillName = params.skillName as string;
        if (!skillName) return { success: false, error: new Error("skillName 参数必填") };

        const skill = registry.lookup(skillName);
        if (!skill) return { success: false, error: new Error(`Skill 不存在: ${skillName}`) };

        const callParams = (params.params as Record<string, unknown>) ?? {};

        try {
          const result = await skill.handler(callParams, {
            traceId: `api_test_${Date.now()}`,
            depth: 0,
            maxDepth: 1,
            callBudget: { remaining: 1 },
            callStack: [],
            trace: [],
          });

          return {
            success: result.success,
            data: {
              skillName,
              result: result.data,
              error: result.error?.message,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  // 启动时恢复已注册的 API Skills
  try {
    const db = ensureApiDb();
    const services = db.prepare("SELECT * FROM api_services").all() as any[];

    let restoredCount = 0;
    for (const svc of services) {
      const endpoints = db
        .prepare("SELECT * FROM api_endpoints WHERE service_id = ?")
        .all(svc.service_id) as any[];

      const authConfig = JSON.parse(svc.auth_config) as AuthConfig;
      authConfigCache.set(svc.service_id, authConfig);

      for (const ep of endpoints) {
        const endpoint: ParsedEndpoint = {
          operationId: ep.operation_id,
          method: ep.method,
          path: ep.path,
          summary: ep.summary,
          description: "",
          parameters: JSON.parse(ep.parameters),
          requestBody: ep.request_body ? JSON.parse(ep.request_body) : undefined,
          responses: {},
        };

        try {
          generateSkillForEndpoint(svc.service_id, svc.name, svc.base_url, endpoint, registry);
          restoredCount++;
        } catch {
          // 恢复失败不影响启动
        }
      }
    }

    if (restoredCount > 0) {
      console.log(`   API skills restored: ${restoredCount} endpoints from ${services.length} services`);
    }
  } catch {
    // 首次启动，DB 还没有数据
  }

  console.log("   API generation skills registered (api_import/api_auth_config/api_list/api_delete/api_test)");
}
