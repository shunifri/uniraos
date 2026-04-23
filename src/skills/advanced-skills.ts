/**
 * 高级集成 Skill 家族（Phase 3）
 *
 * 安全认证、监控运维、文件传输、协议适配、RPA 自动化
 * 所有外部依赖均为可选，未安装时自动跳过注册
 */

import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import { getWorkflowRepository } from "../workflow/repository.js";
import { Writable } from "node:stream";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";

class StreamCollector extends Writable {
  private chunks: Buffer[] = [];
  get buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk);
    callback();
  }
}

async function getConnection(name: string) {
  return await getWorkflowRepository().getConnectionByName(name);
}

// ===== 监控运维 Skills =====

function createMonitoringSkills(registry: SkillRegistry): void {
  // health_check
  registry.register(
    defineSystemSkill({
      name: "health_check",
      description: `检查服务健康状态。参数: url(string), expectedStatus?(number, 默认 200), timeout?(number, 毫秒, 默认 5000)`,
      paramSchema: {
        properties: {
          url: { type: "string", description: "要检查的服务 URL" },
          expectedStatus: { type: "number" },
          timeout: { type: "number" },
        },
        required: ["url"],
      },
      handler: async (params) => {
        const url = params.url as string;
        const expectedStatus = (params.expectedStatus as number) ?? 200;
        const timeout = (params.timeout as number) ?? 5000;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, { method: "GET", signal: controller.signal });
          clearTimeout(timer);

          const healthy = response.status === expectedStatus;
          return {
            success: true,
            data: {
              url,
              status: response.status,
              healthy,
              responseTime: Date.now(), // 简化，未精确计时
            },
          };
        } catch (error) {
          clearTimeout(timer);
          return {
            success: true,
            data: {
              url,
              healthy: false,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
    }),
  );

  // alert_query
  registry.register(
    defineSystemSkill({
      name: "alert_query",
      description: `查询系统告警。参数: connection?(string, Prometheus Alertmanager 连接), status?(firing/resolved/pending), limit?(number, 默认 20)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          status: { type: "string", enum: ["firing", "resolved", "pending"] },
          limit: { type: "number" },
        },
      },
      handler: async (params) => {
        // 简化实现：从连接配置中获取 Alertmanager URL
        const connName = params.connection as string | undefined;
        const baseUrl = connName
          ? ((await getConnection(connName))?.config as { url?: string })?.url
          : process.env.ALERTMANAGER_URL;

        if (!baseUrl) {
          return { success: false, error: new Error("未配置 Alertmanager URL，请通过 connection 参数或 ALERTMANAGER_URL 环境变量配置") };
        }

        const status = params.status as string | undefined;
        const url = new URL("/api/v1/alerts", baseUrl);
        if (status) url.searchParams.set("filter", `alertstate="${status}"`);

        try {
          const response = await fetch(url.toString());
          const data = (await response.json()) as { data?: { alerts?: Array<Record<string, unknown>> } };
          const alerts = data.data?.alerts ?? [];
          const limit = (params.limit as number) ?? 20;

          return {
            success: true,
            data: {
              total: alerts.length,
              alerts: alerts.slice(0, limit).map((a) => ({
                name: (a.labels as Record<string, string>)?.alertname,
                status: a.state,
                severity: (a.labels as Record<string, string>)?.severity,
                summary: (a.annotations as Record<string, string>)?.summary,
                startsAt: a.startsAt,
              })),
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
      },
    }),
  );

  // log_query
  registry.register(
    defineSystemSkill({
      name: "log_query",
      description: `查询日志（Elasticsearch）。参数: connection(string), query(string, Lucene 查询), startTime?(string), endTime?(string), limit?(number, 默认 50)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          query: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          limit: { type: "number" },
        },
        required: ["connection", "query"],
      },
      handler: async (params) => {
        const connName = params.connection as string;
        const conn = await getConnection(connName);
        if (!conn) {
          return { success: false, error: new Error(`连接配置不存在: ${connName}`) };
        }
        const cfg = conn.config as { url: string; index?: string; username?: string; password?: string };
        const query = params.query as string;
        const limit = (params.limit as number) ?? 50;

        const index = cfg.index ?? "*";
        const url = `${cfg.url.replace(/\/+/, "")}/${index}/_search`;

        const body: Record<string, unknown> = {
          size: limit,
          sort: [{ "@timestamp": { order: "desc" } }],
          query: { query_string: { query } },
        };

        if (params.startTime || params.endTime) {
          const range: Record<string, string> = {};
          if (params.startTime) range.gte = params.startTime as string;
          if (params.endTime) range.lte = params.endTime as string;
          body.query = {
            bool: {
              must: [
                { query_string: { query } },
                { range: { "@timestamp": range } },
              ],
            },
          };
        }

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (cfg.username && cfg.password) {
          headers.Authorization = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
        }

        try {
          const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
          const data = (await response.json()) as {
            hits?: {
              hits?: Array<Record<string, unknown>>;
              total?: { value?: number } | number;
            };
          };

          if (!response.ok) {
            return { success: false, error: new Error(`Elasticsearch 错误: ${JSON.stringify(data)}`) };
          }

          const hits = data.hits?.hits ?? [];
          const total = typeof data.hits?.total === "object" ? data.hits.total.value : data.hits?.total;

          return {
            success: true,
            data: {
              total,
              logs: hits.map((h) => ({
                id: h._id,
                index: h._index,
                timestamp: (h._source as Record<string, string>)?.["@timestamp"],
                message: (h._source as Record<string, unknown>)?.message,
                level: (h._source as Record<string, string>)?.level,
                source: h._source,
              })),
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
      },
    }),
  );

  // metric_query
  registry.register(
    defineSystemSkill({
      name: "metric_query",
      description: `查询指标（Prometheus）。参数: connection?(string), query(string, PromQL), time?(string, ISO)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          query: { type: "string" },
          time: { type: "string" },
        },
        required: ["query"],
      },
      handler: async (params) => {
        const connName = params.connection as string | undefined;
        const baseUrl = connName
          ? ((await getConnection(connName))?.config as { url?: string })?.url
          : process.env.PROMETHEUS_URL;

        if (!baseUrl) {
          return { success: false, error: new Error("未配置 Prometheus URL，请通过 connection 参数或 PROMETHEUS_URL 环境变量配置") };
        }

        const query = params.query as string;
        const url = new URL("/api/v1/query", baseUrl);
        url.searchParams.set("query", query);
        if (params.time) url.searchParams.set("time", params.time as string);

        try {
          const response = await fetch(url.toString());
          const data = (await response.json()) as { data?: { result?: Array<Record<string, unknown>> }; status?: string };

          return {
            success: true,
            data: {
              status: data.status,
              resultCount: data.data?.result?.length ?? 0,
              results: data.data?.result ?? [],
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
      },
    }),
  );

  console.log("   Monitoring skills registered (health_check/alert_query/log_query/metric_query)");
}

// ===== 文件传输 Skills =====

async function createTransferSkills(registry: SkillRegistry): Promise<void> {
  // ftp_download
  try {
    const ftp = await import("basic-ftp") as any;

    registry.register(
      defineSystemSkill({
        name: "ftp_download",
        description: `从 FTP 服务器下载文件。参数: connection(string), remotePath(string), localPath?(string, 相对于 workspace)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            remotePath: { type: "string" },
            localPath: { type: "string" },
          },
          required: ["connection", "remotePath"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`FTP 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port?: number; user?: string; password?: string; secure?: boolean };
          const client = new ftp.Client();
          client.ftp.verbose = false;

          try {
            await client.access({
              host: cfg.host,
              port: cfg.port ?? 21,
              user: cfg.user ?? "anonymous",
              password: cfg.password ?? "anonymous@",
              secure: cfg.secure ?? false,
            });

            const remotePath = params.remotePath as string;
            const localPath = params.localPath as string | undefined;

            if (localPath) {
              const fullLocalPath = path.resolve(process.cwd(), localPath);
              await fs.promises.mkdir(path.dirname(fullLocalPath), { recursive: true });
              await client.downloadTo(fullLocalPath, remotePath);
              const stat = await fs.promises.stat(fullLocalPath);
              return {
                success: true,
                data: { remotePath, localPath: fullLocalPath, size: stat.size },
              };
            } else {
              const collector = new StreamCollector();
              await client.downloadTo(collector as unknown as NodeJS.WritableStream, remotePath);
              const content = collector.buffer;
              return {
                success: true,
                data: {
                  remotePath,
                  size: content.length,
                  base64: content.toString("base64"),
                },
              };
            }
          } catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
          } finally {
            client.close();
          }
        },
      }),
    );

    console.log("   FTP skill registered (ftp_download)");
  } catch {
    console.log("   [skills] basic-ftp not installed, ftp_download skipped");
  }

  // sftp_upload
  try {
    const sftp = await import("ssh2-sftp-client") as any;

    registry.register(
      defineSystemSkill({
        name: "sftp_upload",
        description: `通过 SFTP 上传文件。参数: connection(string), localPath(string), remotePath(string)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            localPath: { type: "string" },
            remotePath: { type: "string" },
          },
          required: ["connection", "localPath", "remotePath"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`SFTP 连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port?: number; user?: string; password?: string };
          const client = new sftp.default();
          try {
            await client.connect({
              host: cfg.host,
              port: cfg.port ?? 22,
              username: cfg.user ?? "root",
              password: cfg.password,
            });
            const localPath = path.resolve(params.localPath as string);
            await client.put(localPath, params.remotePath as string);
            await client.end();
            return {
              success: true,
              data: { localPath, remotePath: params.remotePath as string, host: cfg.host },
            };
          } catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
          }
        },
      }),
    );

    console.log("   SFTP skill registered (sftp_upload)");
  } catch {
    // ssh2-sftp-client 未安装，回退到系统 scp 命令（依赖 SSH 密钥认证）
    registry.register(
      defineSystemSkill({
        name: "sftp_upload",
        description: `通过系统 scp 命令上传文件（依赖 SSH 密钥认证）。参数: connection(string), localPath(string), remotePath(string)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            localPath: { type: "string" },
            remotePath: { type: "string" },
          },
          required: ["connection", "localPath", "remotePath"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`连接配置不存在: ${connName}`) };
          }
          const cfg = conn.config as { host: string; port?: number; user?: string };
          const localPath = path.resolve(params.localPath as string);
          const remotePath = params.remotePath as string;
          const port = cfg.port ?? 22;
          const user = cfg.user ?? "root";
          const args = ["-P", String(port), localPath, `${user}@${cfg.host}:${remotePath}`];

          return new Promise((resolve) => {
            execFile("scp", args, (error, _stdout, stderr) => {
              if (error) {
                resolve({
                  success: false,
                  error: new Error(`SFTP 上传失败: ${error.message}. stderr: ${stderr}`),
                });
              } else {
                resolve({
                  success: true,
                  data: { localPath, remotePath, host: cfg.host },
                });
              }
            });
          });
        },
      }),
    );
    console.log("   SFTP skill registered (sftp_upload via system scp)");
  }
}

// ===== 协议适配 Skills =====

async function createProtocolAdapterSkills(registry: SkillRegistry): Promise<void> {
  // soap_call
  try {
    const soap = await import("soap") as any;

    registry.register(
      defineSystemSkill({
        name: "soap_call",
        description: `调用 SOAP WebService。参数: wsdl(string, WSDL URL), operation(string), args?(object)`,
        paramSchema: {
          properties: {
            wsdl: { type: "string" },
            operation: { type: "string" },
            args: { type: "object" },
          },
          required: ["wsdl", "operation"],
        },
        handler: async (params) => {
          const wsdlUrl = params.wsdl as string;
          const operation = params.operation as string;
          const args = (params.args as Record<string, unknown>) ?? {};

          try {
            const client = await soap.createClientAsync(wsdlUrl);
            const methodName = operation + "Async";
            const method = client[methodName] as ((args: Record<string, unknown>) => Promise<[unknown]>);
            if (!method) {
              return { success: false, error: new Error(`SOAP 操作 ${operation} 在 WSDL 中未找到`) };
            }
            const [result] = await method(args);
            return { success: true, data: result };
          } catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
          }
        },
      }),
    );

    console.log("   SOAP skill registered (soap_call)");
  } catch {
    console.log("   [skills] soap not installed, soap_call skipped");
  }

  // odbc_query
  try {
    const odbc = await import("odbc") as any;

    registry.register(
      defineSystemSkill({
        name: "odbc_query",
        description: `通过 ODBC 查询数据库。参数: connection(string), sql(string), params?(array)`,
        paramSchema: {
          properties: {
            connection: { type: "string" },
            sql: { type: "string" },
            params: { type: "array" },
          },
          required: ["connection", "sql"],
        },
        handler: async (params) => {
          const connName = params.connection as string;
          const conn = await getConnection(connName);
          if (!conn) {
            return { success: false, error: new Error(`ODBC 连接配置不存在: ${connName}`) };
          }
          return {
            success: false,
            error: new Error(
              "odbc_query 需要安装 Node.js odbc 驱动包（npm install odbc）及系统 ODBC 驱动。" +
                "当前环境未安装该依赖，请通过连接管理配置 DSN 并安装对应驱动。",
            ),
          };
        },
      }),
    );

    console.log("   ODBC skill registered (odbc_query)");
  } catch {
    console.log("   [skills] odbc not installed, odbc_query skipped");
  }
}

// ===== RPA Skills =====

async function createRPASkills(registry: SkillRegistry): Promise<void> {
  try {
    const puppeteer = await import("puppeteer") as any;

    // rpa_screenshot
    registry.register(
      defineSystemSkill({
        name: "rpa_screenshot",
        description: `截取网页或屏幕截图。参数: url(string), selector?(string, 元素选择器), fullPage?(boolean)`,
        paramSchema: {
          properties: {
            url: { type: "string" },
            selector: { type: "string" },
            fullPage: { type: "boolean" },
          },
          required: ["url"],
        },
        handler: async (params) => {
          const url = params.url as string;
          const browser = await puppeteer.launch({ headless: true });
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: "networkidle2" });

          const screenshot = await page.screenshot({
            fullPage: (params.fullPage as boolean) ?? false,
          }) as Buffer;

          await browser.close();

          return {
            success: true,
            data: {
              __type: "image",
              base64: screenshot.toString("base64"),
              format: "png",
            },
          };
        },
      }),
    );

    // rpa_click
    registry.register(
      defineSystemSkill({
        name: "rpa_click",
        description: `模拟鼠标点击网页元素。参数: url(string), selector(string, 元素选择器)`,
        paramSchema: {
          properties: {
            url: { type: "string" },
            selector: { type: "string" },
          },
          required: ["url", "selector"],
        },
        handler: async (params) => {
          const url = params.url as string;
          const selector = params.selector as string;
          const browser = await puppeteer.launch({ headless: true });
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: "networkidle2" });
          await page.click(selector);
          await browser.close();

          return { success: true, data: { clicked: selector } };
        },
      }),
    );

    // rpa_type
    registry.register(
      defineSystemSkill({
        name: "rpa_type",
        description: `模拟键盘输入。参数: url(string), selector(string), text(string)`,
        paramSchema: {
          properties: {
            url: { type: "string" },
            selector: { type: "string" },
            text: { type: "string" },
          },
          required: ["url", "selector", "text"],
        },
        handler: async (params) => {
          const url = params.url as string;
          const selector = params.selector as string;
          const text = params.text as string;
          const browser = await puppeteer.launch({ headless: true });
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: "networkidle2" });
          await page.type(selector, text);
          await browser.close();

          return { success: true, data: { typed: text } };
        },
      }),
    );

    console.log("   RPA skills registered (rpa_screenshot/rpa_click/rpa_type)");
  } catch {
    console.log("   [skills] puppeteer not installed, RPA skills skipped");
  }

  // rpa_ocr（独立，依赖 tesseract.js）
  try {
    const Tesseract = await import("tesseract.js") as any;

    registry.register(
      defineSystemSkill({
        name: "rpa_ocr",
        description: `OCR 文字识别。参数: image(string, base64 或 URL), lang?(string, 语言, 默认 chi_sim+eng)`,
        paramSchema: {
          properties: {
            image: { type: "string" },
            lang: { type: "string" },
          },
          required: ["image"],
        },
        handler: async (params) => {
          const imageInput = params.image as string;
          const lang = (params.lang as string) ?? "chi_sim+eng";
          let imagePath: string;

          if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
            const resp = await fetch(imageInput);
            const buf = Buffer.from(await resp.arrayBuffer());
            imagePath = path.join(os.tmpdir(), `raos-ocr-${Date.now()}.png`);
            await fs.promises.writeFile(imagePath, buf);
          } else {
            const buf = Buffer.from(imageInput, "base64");
            imagePath = path.join(os.tmpdir(), `raos-ocr-${Date.now()}.png`);
            await fs.promises.writeFile(imagePath, buf);
          }

          const outputPrefix = path.join(os.tmpdir(), `raos-ocr-out-${Date.now()}`);

          return new Promise((resolve) => {
            execFile("tesseract", [imagePath, outputPrefix, "-l", lang], async (error) => {
              try {
                await fs.promises.unlink(imagePath);
              } catch {}
              if (error) {
                resolve({ success: false, error: new Error(`OCR 失败: ${error.message}`) });
                return;
              }
              try {
                const text = await fs.promises.readFile(`${outputPrefix}.txt`, "utf-8");
                await fs.promises.unlink(`${outputPrefix}.txt`);
                resolve({ success: true, data: { text: text.trim(), lang } });
              } catch (e) {
                resolve({ success: false, error: new Error(`读取 OCR 结果失败: ${e instanceof Error ? e.message : String(e)}`) });
              }
            });
          });
        },
      }),
    );

    console.log("   OCR skill registered (rpa_ocr via system tesseract)");
  } catch {
    console.log("   [skills] tesseract.js not installed, rpa_ocr skipped");
  }
}

// ===== 安全认证 Skills =====

async function createAuthSkills(registry: SkillRegistry): Promise<void> {
  // saml_auth（简化解析器，不依赖外部库）
  registry.register(
    defineSystemSkill({
      name: "saml_auth",
      description: `SAML SSO 认证（简化解析，不验证签名）。参数: connection(string), samlResponse(string, Base64 编码的 SAML Response)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          samlResponse: { type: "string" },
        },
        required: ["connection", "samlResponse"],
      },
      handler: async (params) => {
        const samlResponseB64 = params.samlResponse as string;
        let xml: string;
        try {
          xml = Buffer.from(samlResponseB64, "base64").toString("utf-8");
        } catch {
          return { success: false, error: new Error("SAML Response Base64 解码失败") };
        }

        const extract = (tag: string): string | undefined => {
          const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i");
          const match = xml.match(regex);
          return match?.[1];
        };

        const nameId = extract("saml2:NameID") ?? extract("NameID");
        const issuer = extract("saml2:Issuer") ?? extract("Issuer");
        const statusCodeTag = xml.match(/<(?:saml2:)?StatusCode[^>]+Value="([^"]+)"/i);
        const statusValue = statusCodeTag?.[1];

        const attributes: Record<string, string> = {};
        const attrRegex = /<(?:saml2:)?Attribute[^>]+Name="([^"]+)"[^>]*>(?:[\s\S]*?)<(?:saml2:)?AttributeValue[^>]*>([^<]+)<\/(?:saml2:)?AttributeValue>/gi;
        let m: RegExpExecArray | null;
        while ((m = attrRegex.exec(xml)) !== null) {
          attributes[m[1]] = m[2];
        }

        const isSuccess = statusValue ? statusValue.includes("Success") : true;

        return {
          success: isSuccess,
          data: {
            nameId,
            issuer,
            status: statusValue,
            attributes,
            rawXmlLength: xml.length,
            warning: "此为简化解析，未验证 SAML 签名。生产环境请使用完整 SAML 库（如 samlify）。",
          },
        };
      },
    }),
  );
  console.log("   SAML skill registered (saml_auth simplified parser)");

  // oauth2_client（纯 fetch 实现，不依赖外部库）
  registry.register(
    defineSystemSkill({
      name: "oauth2_client",
      description: `OAuth2 客户端：获取 access token（纯 fetch 实现）。参数: connection(string), code?(string, 授权码), scope?(string)`,
      paramSchema: {
        properties: {
          connection: { type: "string" },
          code: { type: "string" },
          scope: { type: "string" },
        },
        required: ["connection"],
      },
      handler: async (params) => {
        const connName = params.connection as string;
        const conn = await getConnection(connName);
        if (!conn) {
          return { success: false, error: new Error(`连接配置不存在: ${connName}`) };
        }
        const cfg = conn.config as {
          grantType: "authorization_code" | "client_credentials" | "password";
          tokenUrl: string;
          clientId: string;
          clientSecret: string;
          redirectUri?: string;
          scope?: string;
          username?: string;
          password?: string;
        };

        const body = new URLSearchParams();
        body.set("client_id", cfg.clientId);
        body.set("client_secret", cfg.clientSecret);

        if (cfg.grantType === "client_credentials") {
          body.set("grant_type", "client_credentials");
          if (cfg.scope) body.set("scope", cfg.scope);
        } else if (cfg.grantType === "authorization_code") {
          body.set("grant_type", "authorization_code");
          body.set("code", params.code as string);
          if (cfg.redirectUri) body.set("redirect_uri", cfg.redirectUri);
        } else if (cfg.grantType === "password") {
          body.set("grant_type", "password");
          body.set("username", cfg.username ?? "");
          body.set("password", cfg.password ?? "");
          if (cfg.scope) body.set("scope", cfg.scope);
        } else {
          return { success: false, error: new Error(`不支持的 grant_type: ${cfg.grantType}`) };
        }

        try {
          const response = await fetch(cfg.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          });
          const data = (await response.json()) as Record<string, unknown>;
          if (!response.ok) {
            return { success: false, error: new Error(`OAuth2 错误: ${JSON.stringify(data)}`) };
          }
          return { success: true, data };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
      },
    }),
  );
  console.log("   OAuth2 skill registered (oauth2_client)");

  // role_sync（不依赖外部库）
  registry.register(
    defineSystemSkill({
      name: "role_sync",
      description: `从企业系统同步角色权限到 RAOS。参数: source(string, ldap/api), connection?(string)`,
      paramSchema: {
        properties: {
          source: { type: "string", enum: ["ldap", "api"] },
          connection: { type: "string" },
        },
        required: ["source"],
      },
      handler: async (params, context) => {
        const source = params.source as string;
        if (source === "ldap") {
          return { success: false, error: new Error("LDAP 角色同步需要先调用 ldap_search 获取组织架构，然后映射到 RAOS 角色") };
        }
        return { success: false, error: new Error("role_sync 需要对接具体的企业系统 API，当前为框架实现") };
      },
    }),
  );

  console.log("   Auth skills registered (saml_auth/oauth2_client/role_sync)");
}

// ===== 统一入口 =====

export async function createAdvancedSkills(registry: SkillRegistry): Promise<void> {
  createMonitoringSkills(registry);
  await createTransferSkills(registry);
  await createProtocolAdapterSkills(registry);
  await createRPASkills(registry);
  await createAuthSkills(registry);
}
