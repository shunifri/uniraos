/**
 * 文档解析服务 — 借鉴 zerox 思路，支持中国大模型
 *
 * 核心流程（所有文档最终交给视觉大模型处理）：
 * - PDF: pdf2pic 逐页转图片 → 视觉模型 OCR → Markdown
 * - Word/PPT: LibreOffice 转 PDF → 同 PDF 流程
 * - Excel: xlsx 直接读取 → 结构化表格（表格数据无需 OCR）
 * - 图片: 直接送视觉模型 OCR
 * - 文本/CSV/JSON: 直接读取
 *
 * 无视觉模型时回退到纯文本提取（pdf-parse / mammoth / jszip）。
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from "fs";
import { resolve, extname, basename, join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

// OCR 系统提示词（对齐 zerox 项目，简洁有效）
const SYSTEM_PROMPT_BASE = `Convert the following document to markdown.
Return only the markdown with no explanation text. Do not include delimiters like \`\`\`markdown or \`\`\`html.

RULES:
- You must include all information on the page. Do not exclude headers, footers, or subtext.
- Return tables in markdown table format (| col1 | col2 | with |---|---| separator). Do NOT use HTML <table> tags.
- Charts & infographics must be interpreted to a markdown format. Prefer table format when applicable.
- Logos should be wrapped in brackets. Ex: <logo>Coca-Cola</logo>
- Watermarks should be wrapped in brackets. Ex: <watermark>OFFICIAL COPY</watermark>
- Page numbers should be wrapped in brackets. Ex: <page_number>14</page_number>
- Prefer using ☐ and ☑ for check boxes.
- If the content is in Chinese, output must also be in Chinese.`;

// 多页一致性提示词
const CONSISTENCY_PROMPT = (priorPage: string): string =>
  `Markdown must maintain consistent formatting with the following page: \n\n """${priorPage}"""`;

/** OCR 结构化块（含 bounding box） */
export interface OCRBlock {
  type: string;  // heading / paragraph / table / list / image_desc / other
  text: string;  // 该块的 markdown 内容
  bbox: [number, number, number, number]; // [x%, y%, w%, h%] 百分比坐标
}

/** 视觉模型调用配置 */
export interface VisionModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 解析结果 */
export interface DocParseResult {
  success: boolean;
  format: string;
  content: string;
  pages?: PageResult[];
  metadata?: Record<string, unknown>;
  tags?: string[];          // 自动提取的标签
  error?: string;
}

export interface PageResult {
  page: number;
  content: string;
  imageBase64?: string;  // 原始页面图片（base64 PNG），用于双视图展示
  blocks?: OCRBlock[];   // OCR 结构化块（含 bbox 坐标）
}

// ===== 视觉模型调用 =====

/**
 * 通过大模型从文档内容中自动提取标签
 * @param existingTags 已有标签列表，AI 会优先从中选择匹配的标签，避免重复创建
 */
export async function extractTags(
  content: string, 
  visionConfig: VisionModelConfig,
  existingTags: string[] = []
): Promise<string[]> {
  // 截取前 3000 字符用于标签提取，避免 token 过多
  const snippet = content.length > 3000 ? content.substring(0, 3000) : content;

  // 构建提示词，如果存在已有标签，告诉 AI 优先使用
  const existingTagsPrompt = existingTags.length > 0
    ? `\n\n系统已有以下标签（请优先从中选择匹配的标签，不要重复创建新标签）：\n[${existingTags.join(", ")}]`
    : "";

  const body = {
    model: visionConfig.model,
    messages: [
      {
        role: "user",
        content: `请从以下文档内容中提取 3-8 个关键分类标签。标签应简短（2-6个字），涵盖文档主题、行业、类型等维度。${existingTagsPrompt}

仅返回 JSON 数组格式，例如：["标签1", "标签2", "标签3"]
不要包含任何解释文字。

文档内容：
${snippet}`,
      },
    ],
    max_tokens: 256,
    temperature: 0,
  };

  try {
    const response = await fetch(`${visionConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${visionConfig.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content ?? "";
    // 从响应中提取 JSON 数组
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const tags = JSON.parse(match[0]);
      if (Array.isArray(tags)) return tags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim());
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 通过视觉模型 OCR 一张图片
 * @param priorPage 前一页的 OCR 结果，用于保持多页格式一致性
 */
async function ocrImage(imageBase64: string, visionConfig: VisionModelConfig, mimeType = "image/png", priorPage?: string): Promise<string> {
  let prompt = SYSTEM_PROMPT_BASE;
  if (priorPage) {
    prompt += "\n\n" + CONSISTENCY_PROMPT(priorPage.length > 1000 ? priorPage.slice(-1000) : priorPage);
  }

  const body = {
    model: visionConfig.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0,
  };

  const response = await fetch(`${visionConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${visionConfig.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vision API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ===== Bbox 感知 OCR =====

const SYSTEM_PROMPT_BBOX = `将文档页面转换为结构化 JSON。仅返回有效 JSON，无其他内容。不要使用 markdown 代码块包裹。

输出格式：
{
  "blocks": [
    {
      "type": "heading|paragraph|table|list|image_desc|other",
      "text": "<该区域的 markdown 内容>",
      "bbox": [x_pct, y_pct, w_pct, h_pct]
    }
  ]
}

bbox 坐标为相对页面图片尺寸的百分比 (0-100)：
- x_pct: 左边缘距左侧百分比
- y_pct: 上边缘距顶部百分比
- w_pct: 宽度占图片宽度百分比
- h_pct: 高度占图片高度百分比

近似 bbox 即可。将内容按逻辑块分组（段落、标题、表格等）。
表格使用 markdown 表格语法。中文内容保持中文输出。
必须包含页面上所有内容，不要遗漏页眉、页脚或注释。`;

/**
 * 通过视觉模型 OCR 一张图片，输出结构化 blocks + bbox
 * 解析失败时回退到普通 ocrImage()，返回单个全页 bbox
 */
async function ocrImageWithBbox(
  imageBase64: string,
  visionConfig: VisionModelConfig,
  mimeType = "image/png",
  priorPage?: string,
): Promise<{ blocks: OCRBlock[]; rawMarkdown: string }> {
  let prompt = SYSTEM_PROMPT_BBOX;
  if (priorPage) {
    prompt += "\n\n保持与前一页一致的格式风格。前一页内容摘要：\n" +
      (priorPage.length > 800 ? priorPage.slice(-800) : priorPage);
  }

  const body = {
    model: visionConfig.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0,
  };

  try {
    const response = await fetch(`${visionConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${visionConfig.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Vision API error ${response.status}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content ?? "";

    // 尝试解析 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
        const blocks: OCRBlock[] = parsed.blocks.map((b: any) => ({
          type: b.type || "paragraph",
          text: b.text || "",
          bbox: Array.isArray(b.bbox) && b.bbox.length === 4
            ? b.bbox.map((v: any) => Number(v) || 0) as [number, number, number, number]
            : [0, 0, 100, 100] as [number, number, number, number],
        }));
        const rawMarkdown = blocks.map((b) => b.text).join("\n\n");
        return { blocks, rawMarkdown };
      }
    }

    // JSON 解析失败，回退到普通文本
    throw new Error("JSON parse failed");
  } catch {
    // 回退：用普通 ocrImage，返回单个全页 bbox
    const content = await ocrImage(imageBase64, visionConfig, mimeType, priorPage);
    return {
      blocks: [{ type: "paragraph", text: content, bbox: [0, 0, 100, 100] }],
      rawMarkdown: content,
    };
  }
}

// ===== 通用工具函数 =====

/**
 * 将 PDF 逐页转为 PNG 图片（gm convert，保持原始比例）
 * 返回 pageNum → base64 映射
 */
async function generatePageImages(pdfPath: string, pageCount: number): Promise<Map<number, string>> {
  const pLimit = (await import("p-limit")).default;
  const tempDir = resolve(tmpdir(), `raos-img-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const limit = pLimit(5);
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
  const imageMap = new Map<number, string>();

  await Promise.all(
    pageNumbers.map((pageNum) =>
      limit(async () => {
        try {
          const outFile = join(tempDir, `page.${pageNum}.png`);
          execSync(
            `gm convert -density 150 "${pdfPath}[${pageNum - 1}]" -quality 85 "${outFile}"`,
            { timeout: 60_000, stdio: "pipe" },
          );
          imageMap.set(pageNum, readFileSync(outFile).toString("base64"));
        } catch {}
      })
    )
  );

  cleanupDir(tempDir);
  return imageMap;
}

/**
 * 评估 pdf-parse 提取的文本质量
 * 扫描件/图片 PDF 文本极少或有大量乱码
 */
function assessPdfTextQuality(text: string, pageCount: number): { isGoodQuality: boolean; reason: string } {
  const avgCharsPerPage = text.length / Math.max(pageCount, 1);
  if (avgCharsPerPage < 50) {
    return { isGoodQuality: false, reason: "too-few-chars" };
  }
  const garbageCount = (text.match(/[\ufffd\u0000-\u0008]/g) || []).length;
  if (garbageCount / text.length > 0.05) {
    return { isGoodQuality: false, reason: "garbage-chars" };
  }
  return { isGoodQuality: true, reason: "ok" };
}

/**
 * 通过 LLM（文本模式，非视觉）将原始文本整理为 markdown
 * 比视觉 OCR 快得多，适用于可提取文本的文档
 */
async function formatTextAsMarkdown(rawText: string, visionConfig: VisionModelConfig, priorPage?: string): Promise<string> {
  let prompt = `将以下从文档中提取的原始文本整理为格式良好的 Markdown。

规则：
- 严格保留所有原始信息，不增加不删减任何内容
- 使用适当的 markdown 标题、列表、表格格式
- 表格使用 markdown 表格语法
- 仅返回 markdown 内容，不要添加任何说明文字
- 中文内容保持中文输出

原始文本：
${rawText}`;
  if (priorPage) {
    prompt += "\n\n" + CONSISTENCY_PROMPT(priorPage.length > 1000 ? priorPage.slice(-1000) : priorPage);
  }

  const body = {
    model: visionConfig.model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4096,
    temperature: 0,
  };

  const response = await fetch(`${visionConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${visionConfig.apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`LLM format error ${response.status}`);
  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content ?? rawText;
}

/**
 * 简单 HTML 转 Markdown（用于 mammoth 输出）
 */
function htmlToSimpleMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, "#### $1\n\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ===== PDF 核心流程 =====

/**
 * PDF 转图片后 OCR（仅用于扫描件/图片 PDF 的回退路径）
 */
async function pdfToVisionOCR(pdfPath: string, visionConfig: VisionModelConfig, format: string): Promise<DocParseResult> {
  // @ts-ignore — pdf-parse v1 无类型定义
  const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
  const buffer = readFileSync(pdfPath);
  const pdfData = await pdfParse(buffer);
  const pageCount = pdfData.numpages;

  // 生成页面图片
  const imageMap = await generatePageImages(pdfPath, pageCount);

  // 按顺序 OCR，传递前一页结果保持格式一致性
  const pages: PageResult[] = [];
  let priorPage: string | undefined;
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);

  for (const pageNum of pageNumbers) {
    const base64 = imageMap.get(pageNum);
    if (!base64) {
      pages.push({ page: pageNum, content: "[图片转换失败]" });
      continue;
    }
    try {
      const { blocks, rawMarkdown } = await ocrImageWithBbox(base64, visionConfig, "image/png", priorPage);
      pages.push({ page: pageNum, content: rawMarkdown, imageBase64: base64, blocks });
      priorPage = rawMarkdown;
    } catch (e: any) {
      pages.push({ page: pageNum, content: `[OCR 失败: ${e.message}]`, imageBase64: base64 });
    }
  }

  pages.sort((a, b) => a.page - b.page);
  const fullContent = pages.map((p) => p.content).join("\n\n---\n\n");

  return {
    success: true,
    format,
    content: fullContent,
    pages,
    metadata: { pageCount, method: "vision-ocr" },
  };
}

/** 清理临时目录 */
function cleanupDir(dir: string): void {
  try {
    for (const f of readdirSync(dir)) unlinkSync(resolve(dir, f));
    rmdirSync(dir);
  } catch {}
}

// ===== LibreOffice 转 PDF =====

/**
 * 用 LibreOffice 将文档转为 PDF
 * @returns 转换后的 PDF 文件路径
 */
function convertToPDF(filePath: string, tempDir: string): string {
  mkdirSync(tempDir, { recursive: true });
  // soffice --headless --convert-to pdf --outdir <dir> <file>
  execSync(`soffice --headless --convert-to pdf --outdir "${tempDir}" "${filePath}"`, {
    timeout: 60000,
    stdio: "pipe",
  });

  // 查找生成的 PDF
  const baseName = basename(filePath).replace(/\.[^.]+$/, "");
  const pdfPath = join(tempDir, `${baseName}.pdf`);
  if (!existsSync(pdfPath)) {
    throw new Error(`LibreOffice 转换失败：未生成 PDF 文件`);
  }
  return pdfPath;
}

// ===== 各格式解析入口 =====

/**
 * 解析 PDF — 文本优先策略
 * 1. 先用 pdf-parse 提取文本，评估质量
 * 2. 文本质量好 → 直接使用（可选 LLM 整理格式）+ 后台生成页面图片
 * 3. 文本质量差（扫描件）→ 回退到视觉 OCR
 */
async function parsePDF(filePath: string, visionConfig: VisionModelConfig | null): Promise<DocParseResult> {
  // Step 1: 提取文本 + 评估质量
  let pdfText = "";
  let pageCount = 0;
  let perPageTexts: string[] = [];

  try {
    // @ts-ignore
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const buffer = readFileSync(filePath);
    const pageTexts: string[] = [];
    const data = await pdfParse(buffer, {
      pagerender: async (pageData: any) => {
        try {
          const textContent = await pageData.getTextContent();
          const text = textContent.items.map((item: any) => item.str).join(" ");
          pageTexts.push(text);
          return text;
        } catch {
          pageTexts.push("");
          return "";
        }
      },
    });
    pdfText = data.text;
    pageCount = data.numpages;
    perPageTexts = pageTexts;
  } catch (err: any) {
    console.warn(`pdf-parse failed: ${err.message}`);
  }

  const quality = assessPdfTextQuality(pdfText, pageCount);
  console.log(`[doc-parser] PDF quality: ${quality.reason}, avgChars=${Math.round(pdfText.length / Math.max(pageCount, 1))}, pages=${pageCount}`);

  // Step 2: 文本质量好 → 快速路径
  if (quality.isGoodQuality && pageCount > 0) {
    // 后台并行生成页面图片（不阻塞文本处理）
    const imagePromise = generatePageImages(filePath, pageCount).catch(() => new Map<number, string>());

    // 逐页整理文本
    const pages: PageResult[] = [];
    let priorPage: string | undefined;

    for (let i = 0; i < pageCount; i++) {
      const rawText = perPageTexts[i] || "";
      let content = rawText;

      // 有 LLM 配置且文本足够长时，用 LLM 整理格式（文本模式，非视觉，很快）
      if (visionConfig && rawText.trim().length > 30) {
        try {
          content = await formatTextAsMarkdown(rawText, visionConfig, priorPage);
        } catch {
          // LLM 整理失败，保留原始文本
        }
      }

      pages.push({
        page: i + 1,
        content,
        blocks: [{ type: "paragraph", text: content, bbox: [0, 0, 100, 100] as [number, number, number, number] }],
      });
      priorPage = content;
    }

    // 等待图片生成完成，附加到 pages
    const imageMap = await imagePromise;
    for (const p of pages) {
      const img = imageMap.get(p.page);
      if (img) p.imageBase64 = img;
    }

    const fullContent = pages.map((p) => p.content).join("\n\n---\n\n");
    return {
      success: true,
      format: "pdf",
      content: fullContent,
      pages,
      metadata: { pageCount, method: visionConfig ? "text-extraction+llm-format" : "text-extraction" },
    };
  }

  // Step 3: 文本质量差 → 视觉 OCR 回退（扫描件）
  if (visionConfig) {
    try {
      console.log(`[doc-parser] PDF text quality poor (${quality.reason}), falling back to vision OCR`);
      return await pdfToVisionOCR(filePath, visionConfig, "pdf");
    } catch (err: any) {
      console.warn(`PDF OCR failed, falling back to raw text: ${err.message}`);
    }
  }
  return parsePDFText(filePath);
}

/** PDF 纯文本提取（回退方案） */
async function parsePDFText(filePath: string): Promise<DocParseResult> {
  try {
    // @ts-ignore
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text.length > 100000 ? data.text.substring(0, 100000) + "\n...[内容已截断]" : data.text;
    return {
      success: true,
      format: "pdf",
      content: text,
      metadata: { pageCount: data.numpages, method: "text-extraction" },
    };
  } catch (err: any) {
    return { success: false, format: "pdf", content: "", error: err.message };
  }
}

/**
 * 解析 Word 文档 — mammoth 文本优先 + 后台生成页面图片
 */
async function parseWord(filePath: string, visionConfig: VisionModelConfig | null): Promise<DocParseResult> {
  // Step 1: mammoth 提取 HTML 转 markdown（主路径，极快）
  let mammothContent: string | null = null;
  try {
    const mammoth = await import("mammoth");
    const buffer = readFileSync(filePath);
    const htmlResult = await mammoth.convertToHtml({ buffer });
    mammothContent = htmlToSimpleMarkdown(htmlResult.value);
    // 如果 mammoth 提取的纯文本太少，尝试 extractRawText
    if (mammothContent.trim().length < 50) {
      const textResult = await mammoth.extractRawText({ buffer });
      if (textResult.value.trim().length > mammothContent.trim().length) {
        mammothContent = textResult.value;
      }
    }
  } catch {
    mammothContent = null;
  }

  // Step 2: 后台生成页面图片（LibreOffice → PDF → gm）
  const imagePromise = (async (): Promise<{ images: Map<number, string>; pageCount: number } | null> => {
    try {
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      // @ts-ignore
      const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
      const pdfData = await pdfParse(readFileSync(pdfPath));
      const images = await generatePageImages(pdfPath, pdfData.numpages);
      cleanupDir(tempDir);
      return { images, pageCount: pdfData.numpages };
    } catch {
      return null;
    }
  })();

  if (mammothContent && mammothContent.trim().length > 0) {
    console.log(`[doc-parser] Word: mammoth extracted ${mammothContent.length} chars, generating images in background`);
    let content = mammothContent.length > 100000
      ? mammothContent.substring(0, 100000) + "\n...[内容已截断]"
      : mammothContent;

    // 可选：用 LLM 整理 mammoth 输出为更好的 markdown
    if (visionConfig && content.trim().length > 30) {
      try {
        content = await formatTextAsMarkdown(content, visionConfig);
      } catch { /* 保留 mammoth 原始输出 */ }
    }

    // 等待图片生成
    let pages: PageResult[] | undefined;
    const imgResult = await imagePromise;
    if (imgResult) {
      pages = Array.from({ length: imgResult.pageCount }, (_, i) => ({
        page: i + 1,
        content: "",
        imageBase64: imgResult.images.get(i + 1),
      }));
    }

    return {
      success: true,
      format: "docx",
      content,
      pages,
      metadata: { textLength: mammothContent.length, method: visionConfig ? "mammoth+llm-format" : "mammoth" },
    };
  }

  // Step 3: mammoth 失败 → 视觉 OCR 回退
  if (visionConfig) {
    try {
      console.log(`[doc-parser] Word: mammoth failed, falling back to vision OCR`);
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      const result = await pdfToVisionOCR(pdfPath, visionConfig, "docx");
      cleanupDir(tempDir);
      return { ...result, format: "docx", metadata: { ...result.metadata, method: "libreoffice+vision-ocr" } };
    } catch (err: any) {
      console.warn(`Word vision OCR also failed: ${err.message}`);
    }
  }

  return { success: false, format: "docx", content: "", error: "Word 文档解析失败" };
}

/**
 * 解析 PPT — XML 文本提取优先 + 后台生成页面图片
 */
async function parsePPTX(filePath: string, visionConfig: VisionModelConfig | null): Promise<DocParseResult> {
  // Step 1: 从 PPTX XML 提取文本（主路径，极快）
  let extractedPages: PageResult[] | null = null;
  try {
    const JSZip = (await import("jszip")).default;
    const buffer = readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);

    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
        return na - nb;
      });

    if (slideFiles.length > 0) {
      extractedPages = [];
      let hasImages = false;
      for (let i = 0; i < slideFiles.length; i++) {
        const xml = await zip.files[slideFiles[i]].async("text");
        // 检测幻灯片是否包含图片（<a:blip> 或 <p:pic>）
        if (/<a:blip|<p:pic/.test(xml)) hasImages = true;
        const texts: string[] = [];
        const regex = /<a:t>([\s\S]*?)<\/a:t>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          const t = match[1].trim();
          if (t) texts.push(t);
        }
        extractedPages.push({ page: i + 1, content: texts.join("\n") || "(空白页)" });
      }
      // PPT 包含图片时，文本提取可能丢失图片信息，优先使用视觉 OCR
      if (hasImages && visionConfig) {
        console.log(`[doc-parser] PPT: contains images, falling back to vision OCR`);
        extractedPages = null; // 强制走视觉 OCR 路径
      }
    }
  } catch {
    extractedPages = null;
  }

  // Step 2: 后台生成页面图片（LibreOffice → PDF → gm）
  const imagePromise = (async (): Promise<Map<number, string>> => {
    try {
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      // @ts-ignore
      const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
      const pdfData = await pdfParse(readFileSync(pdfPath));
      const images = await generatePageImages(pdfPath, pdfData.numpages);
      cleanupDir(tempDir);
      return images;
    } catch {
      return new Map();
    }
  })();

  if (extractedPages && extractedPages.length > 0) {
    console.log(`[doc-parser] PPT: extracted ${extractedPages.length} slides, generating images in background`);

    // 等待图片并附加
    const images = await imagePromise;
    for (const p of extractedPages) {
      const img = images.get(p.page);
      if (img) p.imageBase64 = img;
    }

    const fullContent = extractedPages.map((p) => `### 第 ${p.page} 页\n\n${p.content}`).join("\n\n---\n\n");
    return {
      success: true,
      format: "pptx",
      content: fullContent,
      pages: extractedPages,
      metadata: { slideCount: extractedPages.length, method: "zip-xml-extract" },
    };
  }

  // Step 3: 文本提取失败 → 视觉 OCR 回退
  if (visionConfig) {
    try {
      console.log(`[doc-parser] PPT: text extraction failed, falling back to vision OCR`);
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      const result = await pdfToVisionOCR(pdfPath, visionConfig, "pptx");
      cleanupDir(tempDir);
      return { ...result, format: "pptx", metadata: { ...result.metadata, method: "libreoffice+vision-ocr" } };
    } catch (err: any) {
      console.warn(`PPT vision OCR also failed: ${err.message}`);
    }
  }

  return { success: false, format: "pptx", content: "", error: "PPT 解析失败" };
}

/**
 * 解析 Excel — 结构化数据直接读取 + LibreOffice 生成页面图片
 */
async function parseExcel(filePath: string): Promise<DocParseResult> {
  try {
    const xlsxModule = await import("xlsx");
    const XLSX = xlsxModule.default ?? xlsxModule;
    const workbook = XLSX.readFile(filePath);

    const sheets: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      if (jsonData.length === 0) continue;

      let md = `### ${sheetName}\n\n`;
      const headers = (jsonData[0] || []).map((h: any) => String(h ?? ""));
      md += "| " + headers.join(" | ") + " |\n";
      md += "| " + headers.map(() => "---").join(" | ") + " |\n";

      for (let i = 1; i < Math.min(jsonData.length, 500); i++) {
        const row = jsonData[i] || [];
        md += "| " + headers.map((_, j) => String(row[j] ?? "")).join(" | ") + " |\n";
      }

      if (jsonData.length > 500) {
        md += `\n...[共 ${jsonData.length} 行，仅显示前 500 行]\n`;
      }
      sheets.push(md);
    }

    const content = sheets.join("\n\n");

    // 后台生成页面图片（LibreOffice → PDF → gm），用于引用展示
    let pages: PageResult[] | undefined;
    try {
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      // @ts-ignore
      const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
      const pdfData = await pdfParse(readFileSync(pdfPath));
      const images = await generatePageImages(pdfPath, pdfData.numpages);
      cleanupDir(tempDir);
      pages = Array.from({ length: pdfData.numpages }, (_, i) => ({
        page: i + 1,
        content: "",
        imageBase64: images.get(i + 1),
      }));
      console.log(`[doc-parser] Excel: generated ${pdfData.numpages} page images`);
    } catch (err: any) {
      console.warn(`[doc-parser] Excel image generation failed: ${err.message}`);
    }

    return {
      success: true,
      format: "excel",
      content,
      pages,
      metadata: { sheetCount: workbook.SheetNames.length, sheetNames: workbook.SheetNames, method: "xlsx" },
    };
  } catch (err: any) {
    return { success: false, format: "excel", content: "", error: err.message };
  }
}

/**
 * 解析图片 — 直接 OCR
 */
async function parseImage(filePath: string, visionConfig: VisionModelConfig | null): Promise<DocParseResult> {
  if (!visionConfig) {
    return { success: false, format: "image", content: "", error: "图片解析需要配置视觉模型" };
  }

  try {
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
    };
    const mimeType = mimeMap[ext] || "image/png";
    const content = await ocrImage(base64, visionConfig, mimeType);

    return {
      success: true,
      format: "image",
      content,
      metadata: { method: "vision-ocr", mimeType },
    };
  } catch (err: any) {
    return { success: false, format: "image", content: "", error: err.message };
  }
}

/** 解析纯文本文件 */
function parseText(filePath: string): DocParseResult {
  try {
    const content = readFileSync(filePath, "utf-8");
    const truncated = content.length > 100000 ? content.substring(0, 100000) + "\n...[内容已截断]" : content;
    return { success: true, format: "text", content: truncated, metadata: { length: content.length, method: "direct-read" } };
  } catch (err: any) {
    return { success: false, format: "text", content: "", error: err.message };
  }
}

/** 解析 CSV/TSV */
function parseCSV(filePath: string): DocParseResult {
  try {
    const ext = extname(filePath).toLowerCase();
    const delimiter = ext === ".tsv" ? "\t" : ",";
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());

    if (lines.length === 0) {
      return { success: true, format: "csv", content: "(空文件)", metadata: {} };
    }

    const headers = lines[0].split(delimiter);
    let md = "| " + headers.join(" | ") + " |\n";
    md += "| " + headers.map(() => "---").join(" | ") + " |\n";

    for (let i = 1; i < Math.min(lines.length, 500); i++) {
      const cols = lines[i].split(delimiter);
      md += "| " + headers.map((_, j) => cols[j] ?? "").join(" | ") + " |\n";
    }

    if (lines.length > 500) {
      md += `\n...[共 ${lines.length} 行，仅显示前 500 行]\n`;
    }

    return { success: true, format: "csv", content: md, metadata: { rowCount: lines.length - 1, columns: headers.length, method: "direct-read" } };
  } catch (err: any) {
    return { success: false, format: "csv", content: "", error: err.message };
  }
}

/** 解析 JSON */
function parseJSON(filePath: string): DocParseResult {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    const content = JSON.stringify(data, null, 2);
    const truncated = content.length > 100000 ? content.substring(0, 100000) + "\n...[内容已截断]" : content;
    return { success: true, format: "json", content: truncated, metadata: { method: "direct-read" } };
  } catch (err: any) {
    return { success: false, format: "json", content: "", error: err.message };
  }
}

// ===== 文件类型分类 =====

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);
const TEXT_EXTS = new Set([".txt", ".md", ".log", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bat", ".py", ".js", ".ts", ".html", ".xml", ".css", ".sql"]);

/**
 * 主入口：解析文档文件
 *
 * @param filePath 文件绝对路径
 * @param visionConfig 视觉模型配置（可选，PDF/Word/PPT/图片 OCR 需要）
 * @param existingTags 已有标签列表（可选），用于指导 AI 优先使用已有标签，避免重复创建
 */
export async function parseDocument(
  filePath: string, 
  visionConfig: VisionModelConfig | null = null,
  existingTags: string[] = []
): Promise<DocParseResult> {
  if (!existsSync(filePath)) {
    return { success: false, format: "unknown", content: "", error: `文件不存在: ${filePath}` };
  }

  const ext = extname(filePath).toLowerCase();

  let result: DocParseResult;

  if (ext === ".pdf") result = await parsePDF(filePath, visionConfig);
  else if (ext === ".docx" || ext === ".doc") result = await parseWord(filePath, visionConfig);
  else if (ext === ".pptx" || ext === ".ppt") result = await parsePPTX(filePath, visionConfig);
  else if (ext === ".xlsx" || ext === ".xls") result = await parseExcel(filePath);
  else if (ext === ".csv" || ext === ".tsv") result = parseCSV(filePath);
  else if (ext === ".json") result = parseJSON(filePath);
  else if (IMAGE_EXTS.has(ext)) result = await parseImage(filePath, visionConfig);
  else if (TEXT_EXTS.has(ext)) result = parseText(filePath);
  else {
    try { result = parseText(filePath); }
    catch { return { success: false, format: "unknown", content: "", error: `不支持的文件格式: ${ext}` }; }
  }

  // 解析成功且有视觉模型时，自动提取标签
  if (result.success && visionConfig && result.content.length > 0) {
    try {
      result.tags = await extractTags(result.content, visionConfig, existingTags);
    } catch {
      // 标签提取失败不影响主流程
    }
  }

  return result;
}

/**
 * 获取文件的简短描述（用于聊天附件预览）
 */
export function getFileTypeDescription(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);
  const map: Record<string, string> = {
    ".pdf": "PDF 文档",
    ".docx": "Word 文档",
    ".doc": "Word 文档",
    ".pptx": "PPT 演示文稿",
    ".ppt": "PPT 演示文稿",
    ".xlsx": "Excel 表格",
    ".xls": "Excel 表格",
    ".csv": "CSV 数据",
    ".tsv": "TSV 数据",
    ".json": "JSON 数据",
    ".txt": "文本文件",
    ".md": "Markdown 文档",
    ".png": "图片",
    ".jpg": "图片",
    ".jpeg": "图片",
  };
  return `${name} (${map[ext] || ext})`;
}
