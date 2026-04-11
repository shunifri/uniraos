/**
 * 网络检索 Skill 家族
 *
 * 提供网页抓取、搜索引擎查询、URL 内容提取等能力，
 * 让智能体能够从互联网获取信息。
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";

// ===== 网页抓取 =====

function createWebFetchSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "web_fetch",
      description:
        "抓取网页内容并提取纯文本。参数: url(string), selector?(string, CSS 选择器提取特定部分), maxLength?(number, 最大返回字符数, 默认 50000)",
      timeout: 30000,
      handler: async (params) => {
        const url = params.url as string;
        if (!url) return { success: false, error: new Error("url 参数必填") };

        const maxLength = (params.maxLength as number) ?? 50000;

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 25000);

          const response = await fetch(url, {
            headers: {
              "User-Agent": "RAOS-Bot/1.0 (Recursive Agent Operating System)",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            signal: controller.signal,
            redirect: "follow",
          });
          clearTimeout(timer);

          if (!response.ok) {
            return { success: false, error: new Error(`HTTP ${response.status}: ${response.statusText}`) };
          }

          const contentType = response.headers.get("content-type") ?? "";
          let text: string;

          let rawHtml = "";
          if (contentType.includes("application/json")) {
            const json = await response.json();
            text = JSON.stringify(json, null, 2);
          } else {
            rawHtml = await response.text();
            // 简单的 HTML 转纯文本
            text = htmlToText(rawHtml, params.selector as string | undefined);
          }

          if (text.length > maxLength) {
            text = text.substring(0, maxLength) + "\n...[truncated]";
          }

          return {
            success: true,
            data: {
              url,
              contentType,
              text,
              length: text.length,
              title: extractTitle(rawHtml),
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
      name: "web_search",
      description:
        "通过搜索引擎检索信息。参数: query(string, 搜索关键词), count?(number, 结果数量, 默认 5), engine?('google'|'bing'|'duckduckgo', 默认 duckduckgo)",
      timeout: 30000,
      handler: async (params) => {
        const query = params.query as string;
        if (!query) return { success: false, error: new Error("query 参数必填") };

        const count = (params.count as number) ?? 5;
        const engineName = (params.engine as string) ?? "duckduckgo";

        try {
          const results = await searchWeb(query, count, engineName);
          return {
            success: true,
            data: {
              query,
              engine: engineName,
              results,
              resultCount: results.length,
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
      name: "web_extract_links",
      description:
        "从网页中提取所有链接。参数: url(string), filter?(string, 正则过滤链接)",
      timeout: 20000,
      handler: async (params) => {
        const url = params.url as string;
        if (!url) return { success: false, error: new Error("url 参数必填") };

        try {
          const response = await fetch(url, {
            headers: { "User-Agent": "RAOS-Bot/1.0" },
          });
          const html = await response.text();
          const links = extractLinks(html, url);

          let filtered = links;
          if (params.filter) {
            const regex = new RegExp(params.filter as string, "i");
            filtered = links.filter((l) => regex.test(l.href) || regex.test(l.text));
          }

          return {
            success: true,
            data: { links: filtered.slice(0, 100), total: filtered.length },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "web_screenshot",
      description:
        "获取网页的文本快照（标题、元描述、主要内容摘要）。参数: url(string)",
      timeout: 20000,
      handler: async (params) => {
        const url = params.url as string;
        if (!url) return { success: false, error: new Error("url 参数必填") };

        try {
          const response = await fetch(url, {
            headers: { "User-Agent": "RAOS-Bot/1.0" },
          });
          const html = await response.text();

          const title = extractTitle(html);
          const description = extractMeta(html, "description");
          const keywords = extractMeta(html, "keywords");
          const text = htmlToText(html);
          const summary = text.substring(0, 2000);

          return {
            success: true,
            data: {
              url,
              title,
              description,
              keywords,
              summary,
              fullTextLength: text.length,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );
}

// ===== 辅助函数 =====

function htmlToText(html: string, selector?: string): string {
  // 如果指定了选择器，尝试提取对应内容
  if (selector) {
    // 简单的标签匹配（不依赖 DOM 解析库）
    const tagMatch = selector.match(/^(\w+)$/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
      const matches: string[] = [];
      let match;
      while ((match = regex.exec(html)) !== null) {
        matches.push(match[1]);
      }
      if (matches.length > 0) {
        html = matches.join("\n");
      }
    }
  }

  return html
    // 移除 script 和 style 标签及内容
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    // 块级标签转换为换行
    .replace(/<\/?(div|p|h[1-6]|li|tr|br|hr|blockquote|pre|section|article)[^>]*>/gi, "\n")
    // 移除所有其他 HTML 标签
    .replace(/<[^>]+>/g, " ")
    // 解码常见 HTML 实体
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // 清理多余空白
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : "";
}

function extractMeta(html: string, name: string): string {
  const regex = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*?)["']`, "i");
  const match = html.match(regex);
  if (match) return match[1];

  // 尝试 property 属性（OG 标签）
  const ogRegex = new RegExp(`<meta[^>]*property=["']og:${name}["'][^>]*content=["']([^"']*?)["']`, "i");
  const ogMatch = html.match(ogRegex);
  return ogMatch ? ogMatch[1] : "";
}

function extractLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const regex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let href = match[1].trim();
    const text = match[2].replace(/<[^>]+>/g, "").trim();

    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

    // 相对路径转绝对路径
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (text) {
      links.push({ href, text: text.substring(0, 200) });
    }
  }

  return links;
}

async function searchWeb(query: string, count: number, engine: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  // 默认使用百度搜索
  return searchBaidu(query, count);
}

async function searchBaidu(query: string, count: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${Math.min(count, 10)}`;
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timer);
    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // 安全解析：逐个提取 mu= 属性的 URL，避免灾难性回溯
    const muRegex = /mu="(https?:\/\/[^"]+)"/g;
    let match;
    const urls: string[] = [];
    while ((match = muRegex.exec(html)) !== null) {
      const u = match[1].replace(/&amp;/g, "&");
      if (!u.includes("baidu.com") && !urls.includes(u)) {
        urls.push(u);
      }
    }

    // 对每个 URL，向前搜索标题和摘要
    for (const url of urls) {
      if (results.length >= count) break;
      const pos = html.indexOf(`mu="${url.replace(/&/g, "&amp;")}"`);
      if (pos < 0) continue;

      // 向后取 2000 字符作为块内容
      const block = html.slice(pos, pos + 2000);

      let title = "";
      const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (titleMatch) {
        title = titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      }

      let snippet = "";
      const snippetMatch = block.match(/content-right_[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)
        || block.match(/c-abstract[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
      if (snippetMatch) {
        snippet = snippetMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
      }

      results.push({ title: title || url, url, snippet });
    }

    return results;
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      return [{ title: "搜索超时", url: "", snippet: "百度搜索请求超时，请稍后重试" }];
    }
    throw e;
  }
}

// ===== 浏览器渲染 Skill =====

function createBrowserSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "web_browse",
      description:
        "使用真实浏览器内核打开 URL 并提取渲染后的页面内容。适用于需要 JavaScript 渲染的网站（SPA、动态页面等）。参数: url(string 必填), waitFor?(string CSS选择器 等待特定元素出现), waitMs?(number 额外等待毫秒数 默认3000), extractSelector?(string CSS选择器 提取特定区域), screenshot?(boolean 是否截图 默认false)",
      timeout: 60000,
      handler: async (params) => {
        const url = params.url as string;
        if (!url) return { success: false, error: new Error("url 参数必填") };

        const waitFor = params.waitFor as string | undefined;
        const waitMs = (params.waitMs as number) ?? 3000;
        const extractSelector = params.extractSelector as string | undefined;
        const takeScreenshot = params.screenshot as boolean ?? false;

        let browser;
        try {
          const puppeteer = await import("puppeteer");
          browser = await puppeteer.default.launch({
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-gpu",
            ],
          });

          const page = await browser.newPage();
          await page.setUserAgent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          );
          await page.setViewport({ width: 1280, height: 900 });

          // 导航到页面
          await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // 等待特定选择器
          if (waitFor) {
            try {
              await page.waitForSelector(waitFor, { timeout: 10000 });
            } catch {
              // 选择器超时不阻塞
            }
          }

          // 额外等待渲染
          if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, Math.min(waitMs, 10000)));
          }

          // 获取页面标题
          const title = await page.title();

          // 提取内容
          let textContent: string;
          if (extractSelector) {
            textContent = await page.$$eval(extractSelector, (els) =>
              els.map((el) => (el as HTMLElement).innerText).join("\n\n")
            ).catch(() => "");
          } else {
            // 提取主要内容，排除 script/style/nav/footer
            textContent = await page.evaluate(() => {
              // 移除不需要的元素
              const remove = document.querySelectorAll("script, style, nav, footer, header, iframe, noscript, svg");
              remove.forEach((el) => el.remove());

              // 提取 body 文本
              const body = document.body;
              if (!body) return "";

              return body.innerText
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .join("\n")
                .slice(0, 50000);
            });
          }

          // 提取 meta 信息
          const meta = await page.evaluate(() => {
            const getMeta = (name: string) =>
              document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)
                ?.getAttribute("content") || "";
            return {
              description: getMeta("description") || getMeta("og:description"),
              keywords: getMeta("keywords"),
              ogTitle: getMeta("og:title"),
            };
          });

          // 提取链接
          const links = await page.$$eval("a[href]", (els) =>
            els
              .slice(0, 30)
              .map((el) => ({
                text: (el as HTMLAnchorElement).innerText.trim().slice(0, 100),
                href: (el as HTMLAnchorElement).href,
              }))
              .filter((l) => l.text && l.href.startsWith("http"))
          );

          // 可选截图
          let screenshotBase64 = "";
          if (takeScreenshot) {
            const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
            screenshotBase64 = Buffer.from(buf).toString("base64").slice(0, 100000); // 限制大小
          }

          await browser.close();

          return {
            success: true,
            data: {
              url,
              title,
              meta,
              content: textContent.slice(0, 30000),
              contentLength: textContent.length,
              links: links.slice(0, 20),
              ...(screenshotBase64 ? { screenshot: screenshotBase64 } : {}),
            },
          };
        } catch (err: any) {
          if (browser) await browser.close().catch(() => {});
          return { success: false, error: new Error(`浏览器渲染失败: ${err.message}`) };
        }
      },
    })
  );
}

// ===== 注册所有网络检索 Skills =====

export function createWebSkills(registry: SkillRegistry): void {
  createWebFetchSkills(registry);
  createBrowserSkills(registry);
  console.log("   Web skills registered (web_fetch/web_search/web_extract_links/web_screenshot/web_browse)");
}
