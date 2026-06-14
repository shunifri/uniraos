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

import { readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmdirSync, statSync } from "fs";
import { resolve, extname, basename, join } from "path";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { extractDocumentImages, describeImages, type ImageWithDescription } from "../utils/image-extractor.js";
import type { VisionModelConfig } from "./doc-parser.types.js";

// P1 修复：安全文件读取，限制最大 100MB，防止 OOM
export const MAX_PARSE_FILE_SIZE = 100 * 1024 * 1024;

export function safeReadFile(filePath: string): Buffer {
  const stats = statSync(filePath);
  if (stats.size > MAX_PARSE_FILE_SIZE) {
    throw new Error(`File too large to parse: ${stats.size} bytes (max ${MAX_PARSE_FILE_SIZE} bytes)`);
  }
  return readFileSync(filePath);
}

/**
 * 清理 PDF 解析后的文本空格
 * PDF 解析往往会在字符之间添加空格，需要清理：
 * 1. 中文字符之间的空格
 * 2. 连续的单个英文字母之间的空格（如 S k i l l -> Skill）
 * 3. 中文标点与文字之间的空格
 */
function cleanPdfText(text: string): string {
  if (!text) return text;
  
  let cleaned = text;
  
  // 1. 处理中文字符之间的空格（执行多次以处理连续空格）
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
  }
  
  // 2. 处理连续的单个英文字母之间的空格（如 S k i l l -> Skill）
  // 但保留正常的英文单词之间的空格
  // 匹配模式：单个字母 + 空格 + 单个字母（连续出现）
  cleaned = cleaned.replace(/([a-zA-Z])\s+(?=[a-zA-Z])/g, "$1");
  
  // 2.1 处理下划线周围的空格（如 navigation _planner -> navigation_planner）
  cleaned = cleaned.replace(/([a-zA-Z0-9])\s+_/g, "$1_");
  cleaned = cleaned.replace(/_\s+([a-zA-Z0-9])/g, "_$1");
  
  // 2.2 处理数字和标点之间的空格（如 1 . -> 1.）
  cleaned = cleaned.replace(/(\d)\s+([.])/g, "$1$2");
  cleaned = cleaned.replace(/([.])\s+(\d)/g, "$1$2");
  
  // 3. 处理中文标点与文字之间的空格
  cleaned = cleaned.replace(/([\u4e00-\u9fff])\s*([，。、；：？！""''（）【】《》])/g, "$1$2");
  cleaned = cleaned.replace(/([，。、；：？！""''（）【】《》])\s*([\u4e00-\u9fff])/g, "$1$2");
  
  // 4. 规范中英文/数字之间的空格（保留单个空格）
  cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([a-zA-Z0-9])/g, "$1 $2");
  cleaned = cleaned.replace(/([a-zA-Z0-9])\s+([\u4e00-\u9fff])/g, "$1 $2");
  
  // 5. 清理多余的连续空格（保留最多一个）
  cleaned = cleaned.replace(/ {2,}/g, " ");
  
  return cleaned;
}

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

/** @deprecated 请从 ./doc-parser.types.js 导入 VisionModelConfig */
export type { VisionModelConfig } from "./doc-parser.types.js";

/** 解析结果 */
export interface DocParseResult {
  success: boolean;
  format: string;
  content: string;
  pages?: PageResult[];
  images?: DocImage[];     // 文档内嵌图片（流程图、架构图、操作说明截图等）
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

/** 文档内嵌图片 */
export interface DocImage {
  id: string;
  name: string;
  ext: string;
  page?: number;
  mimeType: string;
  description: string;   // LLM 生成的图片描述
  base64: string;        // base64 编码数据
}

// Minimal OpenAI-style chat completion response
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// Minimal pdf-parse types
interface PdfParseResult {
  numpages: number;
  text: string;
}

interface PdfParseFunction {
  (buffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;
}

interface PdfPageData {
  getTextContent: () => Promise<{
    items: Array<{ str?: string }>;
  }>;
}

function getPdfParse(module: unknown): PdfParseFunction {
  const m = module as Record<string, unknown>;
  return (m.default as PdfParseFunction | undefined) ?? (module as PdfParseFunction);
}

// Minimal OCR block from LLM JSON
interface OcrBlockRaw {
  type?: string;
  text?: string;
  bbox?: unknown[];
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
    const response = await fetchWithTimeout(`${visionConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${visionConfig.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    // 从响应中提取 JSON 数组
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const tags = JSON.parse(match[0]);
      if (Array.isArray(tags)) return tags.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0).map((t: string) => t.trim());
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

  const response = await fetchWithTimeout(`${visionConfig.baseUrl}/chat/completions`, {
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

  const data = (await response.json()) as ChatCompletionResponse;
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
    const response = await fetchWithTimeout(`${visionConfig.baseUrl}/chat/completions`, {
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

    const data = (await response.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content ?? "";

    // 尝试解析 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
        const blocks: OCRBlock[] = (parsed.blocks as OcrBlockRaw[]).map((b) => ({
          type: b.type || "paragraph",
          text: b.text || "",
          bbox: Array.isArray(b.bbox) && b.bbox.length === 4
            ? b.bbox.map((v) => Number(v) || 0) as [number, number, number, number]
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
 * 直接生成到目标目录，不缓存所有base64到内存，减少内存峰值
 * 返回生成成功的页数集合
 */
async function generatePageImages(
  pdfPath: string, 
  pageCount: number, 
  outputDir: string
): Promise<Set<number>> {
  const pLimit = (await import("p-limit")).default;
  mkdirSync(outputDir, { recursive: true });
  const limit = pLimit(5);
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
  const successPages = new Set<number>();

  await Promise.all(
    pageNumbers.map((pageNum) =>
      limit(async () => {
        try {
          const outFile = join(outputDir, `page.${pageNum}.png`);
          execSync(
            `gm convert -density 150 "${pdfPath}[${pageNum - 1}]" -quality 85 "${outFile}"`,
            { timeout: 60_000, stdio: "pipe" },
          );
          if (existsSync(outFile)) {
            successPages.add(pageNum);
          }
        } catch {}
      })
    )
  );

  return successPages;
}

/**
 * 清理中文文本中的多余空格
 * 移除中文字符之间的空格，但保留中英文之间的适当空格
 */
function cleanChineseSpacing(text: string): string {
  // 移除中文字符之间的空格
  // 使用 lookbehind 和 lookahead 来匹配中文字符之间的空格
  return text
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2"); // 执行两次以处理连续空格
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

  const response = await fetchWithTimeout(`${visionConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${visionConfig.apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`LLM format error ${response.status}`);
  const data = (await response.json()) as ChatCompletionResponse;
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
  // @ts-expect-error — pdf-parse v1 无类型定义
  const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = getPdfParse(pdfParseModule);
  const buffer = safeReadFile(pdfPath);
  const pdfData = await pdfParse(buffer);
  const pageCount = pdfData.numpages;

  // 生成页面图片（临时目录保存，OCR处理后立即清理）
  const pLimit = (await import("p-limit")).default;
  const tempDir = resolve(tmpdir(), `raos-ocr-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  await generatePageImages(pdfPath, pageCount, tempDir);

  // 按顺序 OCR，传递前一页结果保持格式一致性
  const pages: PageResult[] = [];
  let priorPage: string | undefined;
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
  const limit = pLimit(2);

  await Promise.all(pageNumbers.map(pageNum => limit(async () => {
    const imageFile = join(tempDir, `page.${pageNum}.png`);
    if (!existsSync(imageFile)) {
      pages.push({ page: pageNum, content: "[图片转换失败]" });
      return;
    }
    const base64 = safeReadFile(imageFile).toString("base64");
    try {
      const { blocks, rawMarkdown } = await ocrImageWithBbox(base64, visionConfig, "image/png", priorPage);
      pages.push({ page: pageNum, content: rawMarkdown, imageBase64: base64, blocks });
      priorPage = rawMarkdown;
    } catch (e: unknown) {
      pages.push({ page: pageNum, content: `[OCR 失败: ${(e instanceof Error ? e.message : String(e))}]`, imageBase64: base64 });
    }
  })));

  // 排序并清理临时目录
  pages.sort((a, b) => a.page - b.page);
  cleanupDir(tempDir);
  const fullContent = pages.map((p) => p.content).join("\n\n---\n\n");

  return {
    success: true,
    format,
    content: fullContent,
    pages,
    metadata: { pageCount, method: "vision-ocr" },
  };
}

/** 清理临时目录（P2 安全修复：防止目录遍历） */
function cleanupDir(dir: string): void {
  try {
    for (const f of readdirSync(dir)) {
      const filePath = resolve(dir, f);
      // 确保解析后的路径仍在目标目录内
      if (!filePath.startsWith(resolve(dir))) continue;
      unlinkSync(filePath);
    }
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
  // macOS 需要额外参数防止窗口弹出
  const isMac = process.platform === 'darwin';
  const cmd = isMac
    ? `soffice --headless --norestore --nofirststartwizard --nologo --convert-to pdf --outdir "${tempDir}" "${filePath}"`
    : `soffice --headless --convert-to pdf --outdir "${tempDir}" "${filePath}"`;

  // 设置环境变量确保 headless 模式
  const env = { ...process.env };
  if (isMac) {
    // macOS 上防止窗口弹出
    env['JAVA_HOME'] = '';
  }

  execSync(cmd, {
    timeout: 60000,
    stdio: "pipe",
    env,
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
    // @ts-expect-error - 第三方库无类型定义
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = getPdfParse(pdfParseModule);
    const buffer = safeReadFile(filePath);
    const pageTexts: string[] = [];
    const data = await pdfParse(buffer, {
      pagerender: async (pageData: PdfPageData) => {
        try {
          const textContent = await pageData.getTextContent();
          // 智能连接文本项：中文内容不加空格，英文内容加空格
          const items = textContent.items.map((item) => item.str || "");
          let text = "";
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (i === 0) {
              text = item;
            } else {
              const prevChar = text.slice(-1);
              const currChar = item.charAt(0);
              // 如果前后都是中文字符，不加空格；否则加空格
              const isPrevCJK = /[\u4e00-\u9fff]/.test(prevChar);
              const isCurrCJK = /[\u4e00-\u9fff]/.test(currChar);
              if (isPrevCJK && isCurrCJK) {
                text += item;
              } else {
                text += " " + item;
              }
            }
          }
          pageTexts.push(text);
          return text;
        } catch {
          pageTexts.push("");
          return "";
        }
      },
    });
    // 使用我们自己处理的页面文本，而不是 data.text（data.text 是 pdf-parse 原始提取的）
    pageCount = data.numpages;
    perPageTexts = pageTexts;
    // 组装完整的 PDF 文本（使用处理后的页面文本）
    pdfText = pageTexts.join("\n\n");
  } catch (err: unknown) {
    console.warn(`pdf-parse failed: ${(err instanceof Error ? err.message : String(err))}`);
  }

  const quality = assessPdfTextQuality(pdfText, pageCount);
  console.log(`[doc-parser] PDF质量评估: 质量=${quality.reason}, 平均每页字符数=${Math.round(pdfText.length / Math.max(pageCount, 1))}, 总页数=${pageCount}`);

  // P1-22 设计变更: 文本质量好 → 直接用文本, 不再生成页面图片 (避免 30s+ libreOffice 路径)
  if (quality.isGoodQuality && pageCount > 0) {
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

    const fullContent = pages.map((p) => p.content).join("\n\n---\n\n");
    return {
      success: true,
      format: "pdf",
      content: fullContent,
      pages,
      metadata: { pageCount, method: visionConfig ? "text-extraction+llm-format" : "text-extraction" },
    };
  }

  // Step 2: 文本质量差 → 视觉 OCR 回退（扫描件）
  if (visionConfig) {
    try {
      console.log(`[doc-parser] PDF文本质量差(${quality.reason})，使用视觉模型OCR(扫描件)`);
      const result = await pdfToVisionOCR(filePath, visionConfig, "pdf");
      console.log(`[doc-parser] 视觉模型OCR完成，内容长度: ${result.content.length}`);
      return result;
    } catch (err: unknown) {
      console.warn(`[doc-parser] 视觉模型OCR失败，回退到纯文本: ${(err instanceof Error ? err.message : String(err))}`);
    }
  } else {
    console.log(`[doc-parser] 无视觉模型配置，回退到纯文本提取`);
  }
  return parsePDFText(filePath);
}

/** PDF 纯文本提取（回退方案） */
async function parsePDFText(filePath: string): Promise<DocParseResult> {
  try {
    // @ts-expect-error - 第三方库无类型定义
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = getPdfParse(pdfParseModule);
    const buffer = safeReadFile(filePath);
    const data = await pdfParse(buffer);
    const text = data.text.length > 100000 ? data.text.substring(0, 100000) + "\n...[内容已截断]" : data.text;
    return {
      success: true,
      format: "pdf",
      content: text,
      metadata: { pageCount: data.numpages, method: "text-extraction" },
    };
  } catch (err: unknown) {
    return { success: false, format: "pdf", content: "", error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * 解析 Word 文档 — mammoth 文本优先 + 后台生成页面图片
 */
async function parseWord(filePath: string, visionConfig: VisionModelConfig | null): Promise<DocParseResult> {
  // Step 1: mammoth 提取 HTML 转 markdown（主路径，极快）
  // P1-22 设计变更: 正常 docx (mammoth 能抽出文本) 不再生成页面图片用于"双视图".
  //   - 原因: LibreOffice + gm 生成图片经常 30s+, 把 Node 事件循环卡死
  //   - 用户的 docx 即使 73MB / 主要是图, mammoth 也能抽出 11K+ 字符 (标题/正文), 够 KB 检索/问答
  //   - 视觉 OCR 只在 mammoth 完全失败时 fallback (扫描件 / 纯图片 docx)
  let mammothContent: string | null = null;
  try {
    const mammoth = await import("mammoth");
    const buffer = safeReadFile(filePath);
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

  if (mammothContent && mammothContent.trim().length > 0) {
    console.log(`[doc-parser] Word: mammoth extracted ${mammothContent.length} chars, using text directly (no image generation)`);
    let content = mammothContent.length > 100000
      ? mammothContent.substring(0, 100000) + "\n...[内容已截断]"
      : mammothContent;

    // 可选：用 LLM 整理 mammoth 输出为更好的 markdown
    if (visionConfig && content.trim().length > 30) {
      try {
        content = await formatTextAsMarkdown(content, visionConfig);
      } catch { /* 保留 mammoth 原始输出 */ }
    }

    // 不再生成页面图片, pages 留空 (用户可以后续手动调 generatePageImages API 按需生成)
    return {
      success: true,
      format: "docx",
      content,
      pages: undefined,
      metadata: { textLength: mammothContent.length, method: visionConfig ? "mammoth+llm-format" : "mammoth" },
    };
  }

  // Step 2: mammoth 完全失败 → 视觉 OCR 回退 (扫描件 / 纯图片 docx)
  if (visionConfig) {
    try {
      console.log(`[doc-parser] Word: mammoth failed, falling back to vision OCR`);
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      const result = await pdfToVisionOCR(pdfPath, visionConfig, "docx");
      cleanupDir(tempDir);
      return { ...result, format: "docx", metadata: { ...result.metadata, method: "libreoffice+vision-ocr" } };
    } catch (err: unknown) {
      console.warn(`Word vision OCR also failed: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }

  return { success: false, format: "docx", content: "", error: "Word 文档解析失败" };
}

/**
 * 解析 PPT — XML 文本提取优先 + 后台生成页面图片
 */
async function parsePPTX(filePath: string, visionConfig: VisionModelConfig | null): Promise<DocParseResult> {
  // Step 1: 从 PPTX XML 提取文本（主路径，极快）
  // P1-22 设计变更: 跟 parseWord 一致, 文本能抽出来就不生成图片.
  //   PPT 包含图但有标题/正文, 文本就够 KB 检索, 不需要走 30s+ 的 LibreOffice 图像生成
  let extractedPages: PageResult[] | null = null;
  try {
    const JSZip = (await import("jszip")).default;
    const buffer = safeReadFile(filePath);
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
      for (let i = 0; i < slideFiles.length; i++) {
        const xml = await zip.files[slideFiles[i]].async("text");
        const texts: string[] = [];
        const regex = /<a:t>([\s\S]*?)<\/a:t>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          const t = match[1].trim();
          if (t) texts.push(t);
        }
        extractedPages.push({ page: i + 1, content: texts.join("\n") || "(空白页)" });
      }
    }
  } catch {
    extractedPages = null;
  }

  if (extractedPages && extractedPages.length > 0) {
    console.log(`[doc-parser] PPT: extracted ${extractedPages.length} slides, using text directly (no image generation)`);

    const fullContent = extractedPages.map((p) => `### 第 ${p.page} 页\n\n${p.content}`).join("\n\n---\n\n");
    return {
      success: true,
      format: "pptx",
      content: fullContent,
      // 不再生成页面图片, pages 留空 (避免 30s+ 的 libreOffice 路径)
      pages: extractedPages.map((p) => ({ page: p.page, content: p.content })),
      metadata: { slideCount: extractedPages.length, method: "zip-xml-extract" },
    };
  }

  // Step 2: 文本提取失败 → 视觉 OCR 回退 (罕见的纯图片 PPT)
  if (visionConfig) {
    try {
      console.log(`[doc-parser] PPT: text extraction failed, falling back to vision OCR`);
      const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
      const pdfPath = convertToPDF(filePath, tempDir);
      const result = await pdfToVisionOCR(pdfPath, visionConfig, "pptx");
      cleanupDir(tempDir);
      return { ...result, format: "pptx", metadata: { ...result.metadata, method: "libreoffice+vision-ocr" } };
    } catch (err: unknown) {
      console.warn(`PPT vision OCR also failed: ${(err instanceof Error ? err.message : String(err))}`);
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

      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
      if (jsonData.length === 0) continue;

      let md = `### ${sheetName}\n\n`;
      const headers = (jsonData[0] || []).map((h) => String(h ?? ""));
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
    const imagePromise = (async (): Promise<PageResult[] | undefined> => {
      try {
        const tempDir = resolve(tmpdir(), `raos-doc-${Date.now()}`);
        const pdfPath = convertToPDF(filePath, tempDir);
        // @ts-expect-error - 第三方库无类型定义
        const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
        const pdfParse = getPdfParse(pdfParseModule);
        const pdfData = await pdfParse(safeReadFile(pdfPath));

        const imageTempDir = resolve(tmpdir(), `raos-excel-img-${Date.now()}`);
        mkdirSync(imageTempDir, { recursive: true });
        const successPages = await generatePageImages(pdfPath, pdfData.numpages, imageTempDir);

        const pages = Array.from({ length: pdfData.numpages }, (_, i) => {
          const pageNum = i + 1;
          if (!successPages.has(pageNum)) {
            return { page: pageNum, content: "" };
          }
          const imageFile = join(imageTempDir, `page.${pageNum}.png`);
          return {
            page: pageNum,
            content: "",
            imageBase64: safeReadFile(imageFile).toString("base64"),
          };
        });

        cleanupDir(tempDir);
        cleanupDir(imageTempDir);
        console.log(`[doc-parser] Excel: generated ${pdfData.numpages} page images`);
        return pages;
      } catch (err: unknown) {
        console.warn(`[doc-parser] Excel image generation failed: ${(err instanceof Error ? err.message : String(err))}`);
        return undefined;
      }
    })();

    // 不等待图片生成，直接返回文本内容（图片可以在后台生成但不阻塞主流程）
    let pages: PageResult[] | undefined;
    // 使用 setTimeout 来避免长时间等待，如果图片在 1 秒内没生成好就放弃
    const imgResult = await Promise.race([
      imagePromise,
      new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1000))
    ]);
    if (imgResult) {
      pages = imgResult;
    }

    return {
      success: true,
      format: "excel",
      content,
      pages,
      metadata: { sheetCount: workbook.SheetNames.length, sheetNames: workbook.SheetNames, method: "xlsx" },
    };
  } catch (err: unknown) {
    return { success: false, format: "excel", content: "", error: (err instanceof Error ? err.message : String(err)) };
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
    const buffer = safeReadFile(filePath);
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
  } catch (err: unknown) {
    return { success: false, format: "image", content: "", error: (err instanceof Error ? err.message : String(err)) };
  }
}

/** 解析纯文本文件 */
function parseText(filePath: string): DocParseResult {
  try {
    const content = readFileSync(filePath, "utf-8");
    const truncated = content.length > 100000 ? content.substring(0, 100000) + "\n...[内容已截断]" : content;
    return { success: true, format: "text", content: truncated, metadata: { length: content.length, method: "direct-read" } };
  } catch (err: unknown) {
    return { success: false, format: "text", content: "", error: (err instanceof Error ? err.message : String(err)) };
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
  } catch (err: unknown) {
    return { success: false, format: "csv", content: "", error: (err instanceof Error ? err.message : String(err)) };
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
  } catch (err: unknown) {
    return { success: false, format: "json", content: "", error: (err instanceof Error ? err.message : String(err)) };
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

  // 解析成功时，清理 PDF 文本空格
  if (result.success && result.content) {
    result.content = cleanPdfText(result.content);
    // 同时清理每个页面的内容
    if (result.pages) {
      result.pages = result.pages.map(page => ({
        ...page,
        content: cleanPdfText(page.content),
      }));
    }
  }

  // 解析成功且有视觉模型时，自动提取标签（超时保护）
  if (result.success && visionConfig && result.content.length > 0) {
    try {
      // 设置 10 秒超时，防止标签提取卡住
      const tagsPromise = extractTags(result.content, visionConfig, existingTags);
      const timeoutPromise = new Promise<string[]>(resolve => setTimeout(() => resolve([]), 10000));
      result.tags = await Promise.race([tagsPromise, timeoutPromise]);
    } catch {
      // 标签提取失败不影响主流程
      result.tags = [];
    }
  }

  // 对可解析文本的含图文档（Word/PPT/PDF），提取内嵌图片并生成描述
  const IMAGE_DOC_EXTS = new Set([".pdf", ".docx", ".doc", ".pptx", ".ppt"]);
  if (result.success && IMAGE_DOC_EXTS.has(ext) && visionConfig) {
    try {
      console.log(`[doc-parser] 开始提取文档内嵌图片: ${filePath}`);
      const extracted = await extractDocumentImages(filePath);
      if (extracted.length > 0) {
        console.log(`[doc-parser] 提取到 ${extracted.length} 张图片，开始生成描述...`);
        const described = await describeImages(extracted, visionConfig);
        result.images = described.map((img: ImageWithDescription) => ({
          id: img.id,
          name: img.name,
          ext: img.ext,
          page: img.page,
          mimeType: img.mimeType,
          description: img.description,
          base64: img.base64,
        }));
        console.log(`[doc-parser] 图片处理完成: ${described.length} 张`);
      }
    } catch (err: unknown) {
      console.error(`[doc-parser] 图片提取失败（不影响主流程）:`, (err instanceof Error ? err.message : String(err)));
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
