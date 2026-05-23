import { Router } from "express";
import type { Request, Response } from "express";
import express from "express";
import multer from "multer";
import { fileTypeFromFile } from "file-type";
import { join, dirname } from "path";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync, rmSync, createReadStream, writeFileSync, unlinkSync } from "fs";
import { requireAuth, requirePermission } from "../permissions/middleware/auth-middleware.js";
import { getDb, isMySQL } from "../db/database.js";
import { parseDocument, type VisionModelConfig } from "../services/doc-parser.js";
import type { Paragraph, TextRun } from "docx";
import { extractPptxStyle } from "../services/pptx-style-extractor.js";
import { getKnowledgeBase } from "../skills/knowledge-skills.js";
import { ShareRepository } from "../db/share-repository.js";
import { getUserRoles, getUserById } from "../db/user-repository.js";
import { getDepartmentById } from "../db/department-repository.js";
import { requestContext } from "../user/request-context.js";
import type { RouteDependencies } from "./types.js";

// MySQL adapter helper
async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('../db/mysql-adapter.js');
  return getAdapter();
}

const WS_BASE = join(process.cwd(), ".raos", "workspace");

// ===== File parse cache =====
const fileParseCache = new Map<string, { status: "parsing" | "done" | "error"; content?: string; error?: string; format?: string; tags?: string[]; pageCount?: number }>();

// MAX file size 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// P1 安全修复：文件扩展名白名单
const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".xml", ".yaml", ".yml",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
  ".mp3", ".mp4", ".wav", ".webm", ".ogg", ".mov", ".avi",
  ".zip", ".tar", ".gz", ".rar", ".7z",
]);

function isAllowedFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function getImageDir(relativePath: string): string {
  const wsBase = join(process.cwd(), ".raos", "workspace");
  const parentDir = dirname(join(wsBase, relativePath));
  const baseName = relativePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "file";
  const safe = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, "_");
  return join(parentDir, ".parse-images", safe);
}

function savePageImages(relativePath: string, pages: Array<{ page: number; imageBase64: string }>): void {
  if (pages.length === 0) return;
  const dir = getImageDir(relativePath);
  mkdirSync(dir, { recursive: true });
  for (const p of pages) {
    const buf = Buffer.from(p.imageBase64, "base64");
    writeFileSync(join(dir, `page-${p.page}.png`), buf);
  }
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages.map((p) => p.page)));
}

function getPageImageList(relativePath: string): number[] {
  const indexFile = join(getImageDir(relativePath), "pages.json");
  if (!existsSync(indexFile)) return [];
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8"));
  } catch { return []; }
}

function asyncParseFile(filePath: string, relativePath: string, getVisionConfig: () => VisionModelConfig | null): void {
  fileParseCache.set(relativePath, { status: "parsing" });
  const visionConfig = getVisionConfig();
  const absPath = join(process.cwd(), ".raos", "workspace", relativePath);
  parseDocument(absPath, visionConfig).then((result) => {
    if (result.success) {
      let content = result.content;
      if (content.length > 10000) content = content.slice(0, 10000) + "\n...[内容已截断]";
      const pageImages = result.pages?.filter((p) => p.imageBase64).map((p) => ({ page: p.page, imageBase64: p.imageBase64! })) || [];
      if (pageImages.length > 0) savePageImages(relativePath, pageImages);
      fileParseCache.set(relativePath, { status: "done", content, format: result.format, tags: result.tags || [], pageCount: pageImages.length });
    } else {
      fileParseCache.set(relativePath, { status: "error", error: result.error });
    }
    setTimeout(() => fileParseCache.delete(relativePath), 10 * 60 * 1000);
  }).catch((err: unknown) => {
    fileParseCache.set(relativePath, { status: "error", error: err instanceof Error ? err.message : String(err) });
  });
}

function parseMultipart(buf: Buffer, boundary: string): Array<{ filename: string; data: Buffer }> {
  const files: Array<{ filename: string; data: Buffer }> = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = 0;

  while (true) {
    const idx = buf.indexOf(boundaryBuf, start);
    if (idx < 0) break;
    const nextIdx = buf.indexOf(boundaryBuf, idx + boundaryBuf.length);
    if (nextIdx < 0) break;

    const part = buf.subarray(idx + boundaryBuf.length, nextIdx);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) { start = nextIdx; continue; }

    const headers = part.subarray(0, headerEnd).toString();
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (!filenameMatch) { start = nextIdx; continue; }

    const data = part.subarray(headerEnd + 4, part.length - 2);
    files.push({ filename: filenameMatch[1], data });
    start = nextIdx;
  }

  return files;
}

// ===== PPTX Theme System =====

interface PptxTheme {
  name: string;
  label: string;
  background: string;
  backgroundGrad?: { color: string; color2: string; type: "linear"; };
  titleColor: string;
  bodyColor: string;
  accentColor: string;
  titleFont: string;
  bodyFont: string;
  titleSize: number;
  bodySize: number;
  coverTitleSize: number;
  coverSubtitleSize: number;
}

const PPTX_THEMES: Record<string, PptxTheme> = {
  "business-blue": {
    name: "business-blue", label: "商务蓝",
    background: "FFFFFF",
    titleColor: "1B3A5C", bodyColor: "444444", accentColor: "2B7AE0",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
  },
  "tech-dark": {
    name: "tech-dark", label: "科技深色",
    background: "1A1A2E",
    backgroundGrad: { color: "1A1A2E", color2: "16213E", type: "linear" },
    titleColor: "E0E0FF", bodyColor: "B0B0CC", accentColor: "00D4FF",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 38, coverSubtitleSize: 18,
  },
  "minimal-white": {
    name: "minimal-white", label: "简约白",
    background: "FAFAFA",
    titleColor: "222222", bodyColor: "555555", accentColor: "888888",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 26, bodySize: 15, coverTitleSize: 34, coverSubtitleSize: 16,
  },
  "vibrant-orange": {
    name: "vibrant-orange", label: "活力橙",
    background: "FFFAF5",
    titleColor: "D4520A", bodyColor: "4A4A4A", accentColor: "FF6B2B",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
  },
  "academic-green": {
    name: "academic-green", label: "学术绿",
    background: "F5FAF5",
    titleColor: "1B5E20", bodyColor: "3E3E3E", accentColor: "43A047",
    titleFont: "Microsoft YaHei", bodyFont: "Microsoft YaHei",
    titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
  },
};

function parsePptxFrontmatter(md: string): { theme: string; content: string } {
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fmMatch) return { theme: "business-blue", content: md };
  const fmBlock = fmMatch[1];
  const themeMatch = fmBlock.match(/theme:\s*(.+)/);
  const theme = themeMatch ? themeMatch[1].trim() : "business-blue";
  const content = md.slice(fmMatch[0].length);
  return { theme, content };
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .trim();
}

function htmlTableToMarkdown(tableHtml: string): string {
  const rows: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push(stripHtmlTags(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    while (r.length < colCount) r.push("");
    return r;
  });

  const lines: string[] = [];
  lines.push("| " + normalized[0].join(" | ") + " |");
  lines.push("| " + normalized[0].map(() => "---").join(" | ") + " |");
  for (let i = 1; i < normalized.length; i++) {
    lines.push("| " + normalized[i].join(" | ") + " |");
  }
  return lines.join("\n");
}

function cleanSlideHtml(raw: string): string {
  let text = raw;

  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  text = text.replace(/<h(\d)[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
    const clean = stripHtmlTags(content);
    return clean ? `${"#".repeat(parseInt(level))} ${clean}` : "";
  });

  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    return htmlTableToMarkdown(inner);
  });

  text = text.replace(/<(?:div|p)[^>]*>([\s\S]*?)<\/(?:div|p)>/gi, (_m, inner) => {
    const cleaned = stripHtmlTags(inner);
    return cleaned || "";
  });

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");

  text = text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  const lines = text.split("\n");
  const deduped: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && deduped.length > 0 && deduped[deduped.length - 1].trim() === trimmed) continue;
    deduped.push(line);
  }

  return deduped.join("\n");
}

async function convertToPdf(md: string): Promise<Buffer> {
  const { marked } = await import("marked");
  const html = await marked(md);
  const styledHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
  h1 { font-size: 24px; border-bottom: 2px solid #eee; padding-bottom: 8px; }
  h2 { font-size: 20px; margin-top: 24px; }
  h3 { font-size: 16px; margin-top: 20px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 16px 0; padding: 8px 16px; color: #666; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
</style></head><body>${html}</body></html>`;

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(styledHtml, { waitUntil: "networkidle0" });
    const pdfBuf = await page.pdf({ format: "A4", margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }, printBackground: true });
    return Buffer.from(pdfBuf);
  } finally {
    await browser.close();
  }
}

async function convertToDocx(md: string): Promise<Buffer> {
  const { marked } = await import("marked");
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const tokens = marked.lexer(md);
  const children: Paragraph[] = [];

  for (const token of tokens) {
    if (token.type === "heading") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // docx HeadingLevel union is complex; keeping any for simplicity
      const levelMap: Record<number, any> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      children.push(new Paragraph({
        text: token.text,
        heading: levelMap[token.depth] || HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      }));
    } else if (token.type === "paragraph") {
      children.push(new Paragraph({
        children: parseInlineTokens(token.tokens || [], TextRun),
        spacing: { after: 120 },
      }));
    } else if (token.type === "list") {
      for (const item of token.items) {
        children.push(new Paragraph({
          children: parseInlineTokens(item.tokens?.[0]?.type === "text" ? (item.tokens[0].tokens || item.tokens) : item.tokens || [], TextRun),
          bullet: { level: 0 },
          spacing: { after: 60 },
        }));
      }
    } else if (token.type === "code") {
      children.push(new Paragraph({
        children: [new TextRun({ text: token.text, font: { name: "Courier New" }, size: 20 })],
        spacing: { before: 120, after: 120 },
      }));
    } else if (token.type === "blockquote") {
      const bqText = token.tokens?.map((t: { text?: string; raw?: string }) => t.text || t.raw || "").join("\n") || token.raw;
      children.push(new Paragraph({
        children: [new TextRun({ text: bqText, italics: true, color: "666666" })],
        indent: { left: 720 },
        spacing: { before: 120, after: 120 },
      }));
    } else if (token.type === "hr") {
      children.push(new Paragraph({
        children: [new TextRun({ text: "" })],
        border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
        spacing: { before: 240, after: 240 },
      }));
    } else if (token.type === "space") {
      // skip
    } else {
      const rawText = (token as { text?: string; raw?: string }).text || (token as { raw?: string }).raw || "";
      if (rawText.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: rawText })],
          spacing: { after: 120 },
        }));
      }
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// docx TextRun and marked inline-token shapes are complex external types
function parseInlineTokens(tokens: any[], TextRun: any): any[] {
  const runs: any[] = [];
  for (const t of tokens) {
    if (t.type === "text") {
      runs.push(new TextRun({ text: t.text || t.raw || "" }));
    } else if (t.type === "strong") {
      runs.push(new TextRun({ text: t.text || "", bold: true }));
    } else if (t.type === "em") {
      runs.push(new TextRun({ text: t.text || "", italics: true }));
    } else if (t.type === "codespan") {
      runs.push(new TextRun({ text: t.text || "", font: { name: "Courier New" }, size: 20 }));
    } else if (t.type === "link") {
      runs.push(new TextRun({ text: t.text || t.href || "" }));
    } else {
      runs.push(new TextRun({ text: t.text || t.raw || "" }));
    }
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text: "" }));
  }
  return runs;
}

async function convertToPptx(md: string, themeName?: string): Promise<Buffer> {
  const pptxgenjs = await import("pptxgenjs");
  const PptxGenJS = pptxgenjs.default || pptxgenjs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // PptxGenJS constructor shape is opaque via dynamic import
  const pptx = new (PptxGenJS as any)();
  pptx.layout = "LAYOUT_WIDE";

  const parsed = parsePptxFrontmatter(md);
  const resolvedTheme = themeName || parsed.theme;
  let theme: PptxTheme = PPTX_THEMES[resolvedTheme] || PPTX_THEMES["business-blue"];

  if (!PPTX_THEMES[resolvedTheme]) {
    try {
      const row = getDb().prepare("SELECT * FROM custom_pptx_themes WHERE id = ? OR name = ?").get(resolvedTheme, resolvedTheme) as { colors_json: string; fonts_json: string; id: string; name: string } | undefined;
      if (row) {
        const colors = JSON.parse(row.colors_json);
        const fonts = JSON.parse(row.fonts_json);
        theme = {
          name: row.id,
          label: row.name,
          background: colors.background || "FFFFFF",
          titleColor: colors.text || colors.primary || "333333",
          bodyColor: "444444",
          accentColor: colors.secondary || colors.accent || "4472C4",
          titleFont: fonts.heading || "Microsoft YaHei",
          bodyFont: fonts.body || "Microsoft YaHei",
          titleSize: 28, bodySize: 16, coverTitleSize: 36, coverSubtitleSize: 18,
        };
      }
    } catch { /* DB query failure uses default theme */ }
  }

  const content = parsed.content;
  const slides = content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  for (let si = 0; si < slides.length; si++) {
    const slideContent = slides[si];
    const slide = pptx.addSlide();

    if (theme.backgroundGrad) {
      slide.background = { color: theme.background };
    } else {
      slide.background = { color: theme.background };
    }

    const cleanedContent = cleanSlideHtml(slideContent);
    const lines = cleanedContent.split("\n");
    let title = "";
    let subtitle = "";
    const bullets: string[] = [];
    const tableRows: string[][] = [];
    let isCover = false;
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { inTable = false; continue; }

      if (/^\|.+\|$/.test(trimmed)) {
        if (/^\|[\s\-:|]+\|$/.test(trimmed)) { inTable = true; continue; }
        const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.length > 0) { tableRows.push(cells); inTable = true; }
        continue;
      }

      if (!title && /^#{1,3}\s+/.test(trimmed)) {
        title = trimmed.replace(/^#{1,3}\s+/, "");
        if (si === 0 && /^#\s+/.test(trimmed)) isCover = true;
      } else if (/^>\s+/.test(trimmed) && !subtitle) {
        subtitle = trimmed.replace(/^>\s+/, "");
      } else if (/^[-*+]\s+/.test(trimmed)) {
        bullets.push(trimmed.replace(/^[-*+]\s+/, ""));
      } else if (trimmed && !title) {
        title = trimmed;
      } else if (trimmed) {
        bullets.push(trimmed);
      }
    }

    // Top decorative line
    slide.addShape("rect", {
      x: 0, y: 0, w: "100%", h: 0.06,
      fill: { color: theme.accentColor },
    });

    if (isCover || (si === 0 && !bullets.length && tableRows.length === 0)) {
      if (title) {
        slide.addText(title, {
          x: 0.8, y: 1.5, w: "85%", h: 1.5,
          fontSize: theme.coverTitleSize, bold: true,
          color: theme.titleColor, fontFace: theme.titleFont,
          align: "center", valign: "middle",
        });
      }
      if (subtitle) {
        slide.addText(subtitle, {
          x: 0.8, y: 3.2, w: "85%", h: 0.8,
          fontSize: theme.coverSubtitleSize, color: theme.bodyColor,
          fontFace: theme.bodyFont, align: "center", valign: "top",
        });
      }
      slide.addShape("rect", {
        x: 4, y: 3.0, w: 5.3, h: 0.04,
        fill: { color: theme.accentColor },
      });
    } else {
      if (title) {
        slide.addText(title, {
          x: 0.6, y: 0.25, w: 88, h: 0.9,
          fontSize: theme.titleSize, bold: true,
          color: theme.titleColor, fontFace: theme.titleFont,
          align: "left", valign: "middle",
        });
        slide.addShape("rect", {
          x: 0.6, y: 1.15, w: 1.5, h: 0.04,
          fill: { color: theme.accentColor },
        });
      }

      const contentY = title ? 1.4 : 0.4;
      let currentY = contentY;

      if (tableRows.length > 0) {
        const colCount = Math.max(...tableRows.map((r) => r.length));
        const tableWidth = 11.5;
        const colW = tableWidth / colCount;

        const pptxRows: Array<Array<{ text: string; options: Record<string, unknown> }>> = tableRows.map((row, ri) => {
          while (row.length < colCount) row.push("");
          return row.map((cell) => ({
            text: cell,
            options: {
              fontSize: ri === 0 ? 12 : 11,
              bold: ri === 0,
              color: ri === 0 ? "FFFFFF" : theme.bodyColor,
              fontFace: theme.bodyFont,
              align: "center" as const,
              valign: "middle" as const,
              fill: ri === 0 ? { color: theme.accentColor } : undefined,
            },
          }));
        });

        const rowH = 0.4;
        const tableH = Math.min(pptxRows.length * rowH, 4.5);

        slide.addTable(pptxRows, {
          x: 0.6, y: currentY, w: tableWidth,
          colW: Array(colCount).fill(colW),
          rowH,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
          autoPage: false,
        });

        currentY += tableH + 0.2;
      }

      if (bullets.length > 0) {
        const remainH = 6.0 - currentY;
        const bodyText = bullets.map((b) => ({
          text: b,
          options: {
            fontSize: theme.bodySize, color: theme.bodyColor,
            fontFace: theme.bodyFont,
            bullet: { type: "bullet" as const },
            breakLine: true,
            lineSpacingMultiple: 1.5,
          },
        }));
        slide.addText(bodyText, {
          x: 0.6, y: currentY, w: "88%", h: remainH > 0.5 ? remainH : 4.5,
          valign: "top",
          paraSpaceAfter: 6,
        });
      }
    }

    if (si > 0 || (!isCover && bullets.length > 0)) {
      slide.addText(`${si + 1}`, {
        x: "90%", y: "92%", w: 0.8, h: 0.3,
        fontSize: 10, color: theme.bodyColor,
        fontFace: theme.bodyFont, align: "right",
      });
    }
  }

  const arrBuf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(arrBuf as ArrayBuffer);
}

// Ensure uploads directory exists
const UPLOADS_DIR = join(WS_BASE, "uploads");
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function createFileRoutes(deps: RouteDependencies): Router {
  const { engine, getOrchestrator, getVisionConfig } = deps;
  const router = Router();

  // ===== P1-16 修复：流式文件上传（multer diskStorage）=====
  const tempUploadDir = join(process.cwd(), ".raos", "temp-uploads");
  if (!existsSync(tempUploadDir)) mkdirSync(tempUploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: tempUploadDir,
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
        cb(null, unique);
      },
    }),
    limits: { fileSize: MAX_FILE_SIZE, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (isAllowedFile(file.originalname)) cb(null, true);
      else cb(new Error(`文件类型不允许: ${file.originalname}`));
    },
  });

  router.post("/upload", requireAuth, requirePermission("files.write"), upload.array("files"), async (req: Request, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    if (!uploadedFiles || uploadedFiles.length === 0) {
      res.status(400).json({ success: false, error: "未发现文件" });
      return;
    }

    try {
      const mode = (req.query.mode as string) || "auto";
      const folder = (req.query.folder as string) || "";
      const results = [];

      for (const file of uploadedFiles) {
        // P1 安全修复：实际文件头 MIME 校验
        const ft = await fileTypeFromFile(file.path);
        if (!ft || !isAllowedFile(`.${ft.ext}`)) {
          unlinkSync(file.path);
          res.status(415).json({
            success: false,
            error: `文件 "${file.originalname}" 实际类型不允许（检测为 ${ft?.mime ?? 'unknown'}）`,
          });
          return;
        }

        const data = readFileSync(file.path);
        unlinkSync(file.path); // 立即清理临时文件

        const skillParams: Record<string, unknown> = {
          filename: file.originalname,
          content: data.toString("base64"),
          uploadedBy: req.user?.id || "default",
          mode,
        };
        if (folder) skillParams.targetDir = folder;
        const ctx = {
          userId: req.user!.id || "default",
          userName: req.user!.username,
          userDisplayName: req.user!.displayName,
        };
        const result = await requestContext.run(ctx, () => engine.execute("file_upload", skillParams));
        if (result.success) {
          const fileData = result.data as { path: string; duplicate?: boolean };
          results.push(fileData);
          if (fileData.path && !fileData.duplicate) {
            asyncParseFile(fileData.path, fileData.path, getVisionConfig);
          }
        }
      }

      res.json({
        success: true,
        data: {
          files: results,
          message: `已上传 ${results.length} 个文件`,
        },
      });
    } catch (err) {
      // 清理任何残留的临时文件
      if (uploadedFiles) {
        for (const f of uploadedFiles) {
          try { unlinkSync(f.path); } catch { /* ignore */ }
        }
      }
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

   // Parse status (for async preview)
   router.get("/upload/parse-status", requireAuth, requirePermission("files.read"), (req, res) => {
     const path = req.query.path as string;
     if (!path) {
       res.status(400).json({ success: false, error: "path required" });
       return;
     }
     const status = fileParseCache.get(path);
     if (!status) {
       res.json({ success: true, status: "unknown" });
     } else {
       const diskPages = getPageImageList(path);
       const pageCount = status.pageCount || diskPages.length;
       res.json({ success: true, ...status, hasPageImages: pageCount > 0, pageCount });
     }
   });

   // Parse images
   router.get("/upload/parse-images", requireAuth, requirePermission("files.read"), (req, res) => {
     const path = req.query.path as string;
     const page = req.query.page as string;
     if (!path) {
       res.status(400).json({ success: false, error: "path required" });
       return;
     }

     const imgDir = getImageDir(path);

     if (page) {
       const imgPath = join(imgDir, `page-${page}.png`);
       if (!existsSync(imgPath)) {
         res.status(404).json({ success: false, error: "page not found" });
         return;
       }
       res.setHeader("Content-Type", "image/png");
       res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
       createReadStream(imgPath).pipe(res);
       return;
     }

     const pages = getPageImageList(path);
     res.json({ success: true, pages });
   });

   // List uploaded files
  router.get("/upload", requireAuth, requirePermission("files.read"), async (req, res) => {
    try {
      const ctx = {
        userId: req.user!.id || "default",
        userName: req.user!.username,
        userDisplayName: req.user!.displayName,
      };
      const result = await requestContext.run(ctx, () => engine.execute("file_upload_list", {}));
      res.json(result);
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ===== File management API =====

  // File tree
  router.get("/files/tree", requireAuth, requirePermission("files.read"), async (req, res) => {

    interface TreeNode {
      key: string;
      title: string;
      isLeaf: boolean;
      children?: TreeNode[];
      size?: number;
      modifiedAt?: number;
      ext?: string;
    }

    const userId = req.user!.id;
    const userBase = join(WS_BASE, "uploads", userId);
    if (!existsSync(userBase)) {
      res.json({ success: true, tree: [] });
      return;
    }

    const EXCLUDED_DIRS = new Set(["excel_content", "node_modules", "__MACOSX", "Excel解包文件"]);
    const EXCLUDED_EXTS = new Set([".db", ".db-shm", ".db-wal", ".tmp", ".lock"]);

    function buildTree(dir: string, prefix: string): TreeNode[] {
      const entries: TreeNode[] = [];
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          if (item.startsWith(".")) continue;
          if (EXCLUDED_DIRS.has(item) || item.includes("解包")) continue;
          const fullPath = join(dir, item);
          const relativePath = prefix ? `${prefix}/${item}` : item;
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              entries.push({
                key: relativePath,
                title: item,
                isLeaf: false,
                children: buildTree(fullPath, relativePath),
              });
            } else {
              const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
              if (EXCLUDED_EXTS.has(ext)) continue;
              entries.push({
                key: relativePath,
                title: item,
                isLeaf: true,
                size: stat.size,
                modifiedAt: stat.mtimeMs,
                ext,
              });
            }
          } catch { /* skip inaccessible */ }
        }
      } catch { /* dir not readable */ }

      const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
      const deduped = new Map<string, TreeNode>();
      for (const e of entries) {
        const key = e.isLeaf ? stripTs(e.title) : e.title;
        const existing = deduped.get(key);
        if (!existing || (e.isLeaf && e.modifiedAt && existing.modifiedAt && e.modifiedAt > existing.modifiedAt)) {
          deduped.set(key, e);
        }
      }
      const result = Array.from(deduped.values());

      result.sort((a, b) => {
        if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
        return a.title.localeCompare(b.title);
      });
      return result;
    }

    res.json({ success: true, tree: buildTree(userBase, "") });
  });

  // List directory files
  router.get("/files/list", requireAuth, requirePermission("files.read"), (req, res) => {
    const userId = req.user!.id;
    const userBase = join(WS_BASE, "uploads", userId);
    const dirPath = (req.query.path as string) || "";
    const absDir = join(userBase, dirPath);
    if (!absDir.startsWith(userBase)) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    if (!existsSync(absDir)) {
      res.json({ success: true, files: [] });
      return;
    }

    try {
      const EXCL_DIRS = new Set(["excel_content", "node_modules", "__MACOSX", "Excel解包文件"]);
      const EXCL_EXTS = new Set([".db", ".db-shm", ".db-wal", ".tmp", ".lock"]);
      const items = readdirSync(absDir);
      const files = items
        .filter((i) => !i.startsWith("."))
        .map((item) => {
          const fullPath = join(absDir, item);
          const stat = statSync(fullPath);
          const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
          return {
            name: item,
            path: dirPath ? `${dirPath}/${item}` : item,
            isDir: stat.isDirectory(),
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            ext,
          };
        })
        .filter((f) => f.isDir ? (!EXCL_DIRS.has(f.name) && !f.name.includes("解包")) : !EXCL_EXTS.has(f.ext));

      const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
      const deduped = new Map<string, typeof files[0]>();
      for (const f of files) {
        const key = f.isDir ? f.name : stripTs(f.name);
        const existing = deduped.get(key);
        if (!existing || (f.modifiedAt > existing.modifiedAt)) {
          deduped.set(key, f);
        }
      }
      const result = Array.from(deduped.values());

      result.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ success: true, files: result });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // KB status for files
  router.get("/files/kb-status", requireAuth, requirePermission("files.read"), async (req, res) => {
    const userId = req.user?.id || "default";
    try {
      const kb = getKnowledgeBase(userId);
      const docs = await kb.listDocuments();
      const kbNames = docs.map((d) => d.name);
      const kbDocs: Record<string, { docId: string; vectorized: number; vectorTotal: number; chunkCount: number; status: string }> = {};
      const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
      for (const d of docs) {
        let status = "done";
        if (d.chunkCount === 0) status = "parsing";
        else if (d.vectorized < d.vectorTotal) status = "vectorizing";
        const info = { docId: d.docId, vectorized: d.vectorized, vectorTotal: d.vectorTotal, chunkCount: d.chunkCount, status };
        // 通过 name 索引
        kbDocs[d.name] = info;
        // 通过 source 路径（文件系统上的存储名）索引，解决命名不一致问题
        if (d.source) {
          const sourceBase = d.source.split('/').pop() || d.source;
          kbDocs[sourceBase] = info;
          kbDocs[stripTs(sourceBase)] = info;
        }
      }
      res.json({ success: true, kbNames, kbDocs });
    } catch {
      res.json({ success: true, kbNames: [], kbDocs: {} });
    }
  });

  // Shared files - 获取分享给我的文件列表
  router.get("/files/shared", requireAuth, requirePermission("files.read"), async (req, res) => {
    try {
      const userId = req.user!.id;
      const roles = await getUserRoles(userId);
      const roleIds = roles.map((r) => r.id);

      // 获取用户部门路径
      const user = await getUserById(userId);
      let deptPath = "/";
      if (user?.departmentId) {
        const dept = await getDepartmentById(user.departmentId);
        if (dept) deptPath = dept.path;
      }

      // 查询分享给我的文件
      const shareRepo = new ShareRepository(isMySQL() ? undefined : getDb());
      const sharedFileIds = await shareRepo.getSharedResourceIds("file", userId, roleIds, deptPath);

      // 获取文件详情（从 upload_records 表或文件系统）
      const files: Array<{
        id: string;
        name: string;
        path: string;
        size: number;
        owner: string;
        ownerName?: string;
        sharedAt: number;
        permission: string;
      }> = [];

      // 从 upload_records 查询文件信息 (SQLite only)
      if (sharedFileIds.length > 0 && !isMySQL()) {
        const db = getDb();
        for (const fileId of sharedFileIds) {
          // 尝试从 upload_records 获取
          const uploadRow = db
            .prepare("SELECT * FROM upload_records WHERE id = ? OR file_path LIKE ?")
            .get(fileId, `%${fileId}%`) as { id: string; original_name?: string; file_path: string; file_size: number; uploaded_by: string; created_at: number } | undefined;

          if (uploadRow) {
            files.push({
              id: uploadRow.id,
              name: uploadRow.original_name || uploadRow.file_path.split("/").pop() || fileId,
              path: uploadRow.file_path,
              size: uploadRow.file_size || 0,
              owner: uploadRow.uploaded_by || "unknown",
              sharedAt: uploadRow.created_at || Date.now(),
              permission: "read", // 默认可读
            });
          } else {
            // 如果找不到记录，尝试从文件系统获取（简化处理）
            files.push({
              id: fileId,
              name: fileId.split("/").pop() || fileId,
              path: fileId,
              size: 0,
              owner: "unknown",
              sharedAt: Date.now(),
              permission: "read",
            });
          }
        }
      }

      res.json({ success: true, files, total: files.length });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Shared files tree - 用于前端展示"共享文件"虚拟文件夹
  router.get("/files/tree-with-shared", requireAuth, requirePermission("files.read"), async (req, res) => {
    interface TreeNode {
      key: string;
      title: string;
      isLeaf: boolean;
      children?: TreeNode[];
      size?: number;
      modifiedAt?: number;
      ext?: string;
      isShared?: boolean;
      owner?: string;
    }

    const EXCLUDED_DIRS = new Set(["excel_content", "node_modules", "__MACOSX", "Excel解包文件"]);
    const EXCLUDED_EXTS = new Set([".db", ".db-shm", ".db-wal", ".tmp", ".lock"]);

    function buildTree(dir: string, prefix: string): TreeNode[] {
      const entries: TreeNode[] = [];
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          if (item.startsWith(".")) continue;
          if (EXCLUDED_DIRS.has(item) || item.includes("解包")) continue;
          const fullPath = join(dir, item);
          const relativePath = prefix ? `${prefix}/${item}` : item;
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              entries.push({
                key: relativePath,
                title: item,
                isLeaf: false,
                children: buildTree(fullPath, relativePath),
              });
            } else {
              const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
              if (EXCLUDED_EXTS.has(ext)) continue;
              entries.push({
                key: relativePath,
                title: item,
                isLeaf: true,
                size: stat.size,
                modifiedAt: stat.mtimeMs,
                ext,
              });
            }
          } catch { /* skip inaccessible */ }
        }
      } catch { /* dir not readable */ }

      const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
      const deduped = new Map<string, TreeNode>();
      for (const e of entries) {
        const key = e.isLeaf ? stripTs(e.title) : e.title;
        const existing = deduped.get(key);
        if (!existing || (e.isLeaf && e.modifiedAt && existing.modifiedAt && e.modifiedAt > existing.modifiedAt)) {
          deduped.set(key, e);
        }
      }
      const result = Array.from(deduped.values());

      result.sort((a, b) => {
        if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
        return a.title.localeCompare(b.title);
      });
      return result;
    }

    // 构建常规文件树
    const tree = buildTree(WS_BASE, "");

    // 添加"共享文件"虚拟文件夹
    try {
      const userId = req.user!.id;
      const roles = await getUserRoles(userId);
      const roleIds = roles.map((r) => r.id);

      const user = await getUserById(userId);
      let deptPath = "/";
      if (user?.departmentId) {
        const dept = await getDepartmentById(user.departmentId);
        if (dept) deptPath = dept.path;
      }

      const shareRepo = new ShareRepository(isMySQL() ? undefined : getDb());
      const sharedFileIds = await shareRepo.getSharedResourceIds("file", userId, roleIds, deptPath);

      if (sharedFileIds.length > 0) {
        const sharedChildren: TreeNode[] = [];
        const db = getDb();

        for (const fileId of sharedFileIds) {
          const uploadRow = db
            .prepare("SELECT * FROM upload_records WHERE id = ? OR file_path LIKE ?")
            .get(fileId, `%${fileId}%`) as { id: string; original_name?: string; file_path: string; file_size: number; uploaded_by: string; created_at: number } | undefined;

          if (uploadRow) {
            const name = uploadRow.original_name || uploadRow.file_path.split("/").pop() || fileId;
            const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
            sharedChildren.push({
              key: `shared://${fileId}`,
              title: name,
              isLeaf: true,
              size: uploadRow.file_size || 0,
              modifiedAt: uploadRow.created_at || Date.now(),
              ext,
              isShared: true,
              owner: uploadRow.uploaded_by || "unknown",
            });
          }
        }

        if (sharedChildren.length > 0) {
          // 按名称排序
          sharedChildren.sort((a, b) => a.title.localeCompare(b.title));

          tree.unshift({
            key: "__SHARED__",
            title: "📁 共享文件",
            isLeaf: false,
            children: sharedChildren,
          });
        }
      }
    } catch { /* ignore shared files errors */ }

    res.json({ success: true, tree });
  });

  // User documents (aggregate uploads + KB status)
  router.get("/files/user-documents", requireAuth, requirePermission("files.read"), async (req, res) => {
    const userId = req.user!.id;
    const userUploadDir = join(WS_BASE, "uploads", userId);

    interface UserDoc {
      originalName: string;
      path: string;
      size: number;
      modifiedAt: number;
      ext: string;
      kbStatus: { inKb: boolean; docId?: string; vectorized?: number; vectorTotal?: number; status?: string } | null;
    }

    const fileMap = new Map<string, UserDoc>();

    const stripTimestamp = (name: string): string => {
      return name.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
    };

    if (existsSync(userUploadDir)) {
      try {
        const items = readdirSync(userUploadDir);
        for (const item of items) {
          if (item.startsWith(".")) continue;
          const fullPath = join(userUploadDir, item);
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) continue;
            const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
            const originalName = stripTimestamp(item);
            const existing = fileMap.get(originalName);
            if (!existing || stat.mtimeMs > existing.modifiedAt) {
              fileMap.set(originalName, {
                originalName,
                path: `uploads/${userId}/${item}`,
                size: stat.size,
                modifiedAt: stat.mtimeMs,
                ext,
                kbStatus: null,
              });
            }
          } catch { /* skip */ }
        }
      } catch { /* dir not readable */ }
    }

    try {
      const kb = getKnowledgeBase(userId);
      const docs = await kb.listDocuments();
      for (const d of docs) {
        let status = "done";
        if (d.chunkCount === 0) status = "parsing";
        else if (d.vectorized < d.vectorTotal) status = "vectorizing";
        const kbInfo = { inKb: true, docId: d.docId, vectorized: d.vectorized, vectorTotal: d.vectorTotal, status };

        const existing = fileMap.get(d.name);
        if (existing) {
          existing.kbStatus = kbInfo;
        }
        if (!existing) {
          fileMap.set(d.name, {
            originalName: d.name,
            path: d.source || "",
            size: 0,
            modifiedAt: d.ingestedAt || 0,
            ext: d.name.includes(".") ? d.name.slice(d.name.lastIndexOf(".")).toLowerCase() : "",
            kbStatus: kbInfo,
          });
        }
      }
    } catch { /* no KB */ }

    const documents = Array.from(fileMap.values()).sort((a, b) => b.modifiedAt - a.modifiedAt);
    res.json({ success: true, documents });
  });

  // Create directory
  router.post("/files/mkdir", requireAuth, requirePermission("files.write"), (req, res) => {
    const { path: dirPath } = req.body as { path: string };
    if (!dirPath) {
      res.status(400).json({ success: false, error: "path required" });
      return;
    }
    const absPath = join(WS_BASE, dirPath);
    if (!absPath.startsWith(WS_BASE)) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    try {
      mkdirSync(absPath, { recursive: true });
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Move/rename file
  router.post("/files/move", requireAuth, requirePermission("files.write"), (req, res) => {
    const { from, to } = req.body as { from: string; to: string };
    if (!from || !to) {
      res.status(400).json({ success: false, error: "from and to required" });
      return;
    }
    const absFrom = join(WS_BASE, from);
    const absTo = join(WS_BASE, to);
    if (!absFrom.startsWith(WS_BASE) || !absTo.startsWith(WS_BASE)) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    try {
      mkdirSync(dirname(absTo), { recursive: true });
      renameSync(absFrom, absTo);
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Delete file/directory
  router.delete("/files", requireAuth, requirePermission("files.write"), (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, error: "path required" });
      return;
    }
    const absPath = join(WS_BASE, filePath);
    if (!absPath.startsWith(WS_BASE) || absPath === WS_BASE) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    try {
      rmSync(absPath, { recursive: true, force: true });
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // AI file organizer
  router.post("/files/organize", requireAuth, requirePermission("files.write"), async (req, res) => {
    try {
      function collectFiles(dir: string, prefix: string): Array<{ name: string; path: string; size: number; ext: string }> {
        const result: Array<{ name: string; path: string; size: number; ext: string }> = [];
        try {
          const items = readdirSync(dir);
          for (const item of items) {
            if (item.startsWith(".")) continue;
            const fullPath = join(dir, item);
            const relativePath = prefix ? `${prefix}/${item}` : item;
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              result.push(...collectFiles(fullPath, relativePath));
            } else {
              const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
              result.push({ name: item, path: relativePath, size: stat.size, ext });
            }
          }
        } catch {}
        return result;
      }

      const allFiles = collectFiles(WS_BASE, "");
      if (allFiles.length === 0) {
        res.json({ success: true, message: "没有文件需要整理", moves: [] });
        return;
      }

      const fileList = allFiles.map((f) => `${f.path} (${f.ext}, ${(f.size / 1024).toFixed(1)}KB)`).join("\n");

      const prompt = `你是一个文件整理助手。请分析以下文件列表，将它们整理到合理的文件夹结构中。

当前文件列表：
${fileList}

要求：
1. 根据文件类型、名称语义进行智能分类
2. 合理的文件夹命名（中文即可）
3. 已经在合理文件夹中的文件无需移动
4. uploads/ 下的上传文件保持不动
5. 数据库文件（.db/.db-shm/.db-wal）归到"数据库"文件夹
6. 代码脚本（.py/.js/.ts）归到"脚本"文件夹
7. 文档（.docx/.pdf/.pptx/.xlsx/.md/.txt）按内容语义分类
8. 已在有意义的文件夹中（非uploads）的文件可保持不动

输出 JSON 数组（仅 JSON，无 markdown）：
[{"from": "原始路径", "to": "目标路径"}, ...]
只输出需要移动的文件。不需要移动的不要输出。`;

      const orch = getOrchestrator();
      const provider = orch?.["deps"]?.provider;
      if (!provider) {
        res.status(500).json({ success: false, error: "LLM provider not available" });
        return;
      }

      const response = await provider.chat([{ role: "user", content: prompt }]);
      const content = response.content?.trim() ?? "[]";
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        res.json({ success: true, message: "AI 分析完成，无需移动", moves: [] });
        return;
      }

      const moves = JSON.parse(jsonMatch[0]) as Array<{ from: string; to: string }>;

      const executed: Array<{ from: string; to: string; success: boolean; error?: string }> = [];
      for (const m of moves) {
        const absFrom = join(WS_BASE, m.from);
        const absTo = join(WS_BASE, m.to);
        if (!absFrom.startsWith(WS_BASE) || !absTo.startsWith(WS_BASE)) {
          executed.push({ ...m, success: false, error: "path security violation" });
          continue;
        }
        if (!existsSync(absFrom)) {
          executed.push({ ...m, success: false, error: "source not found" });
          continue;
        }
        try {
          mkdirSync(dirname(absTo), { recursive: true });
          renameSync(absFrom, absTo);
          executed.push({ ...m, success: true });
        } catch (e: unknown) {
          executed.push({ ...m, success: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      res.json({ success: true, message: `已整理 ${executed.filter((e) => e.success).length} 个文件`, moves: executed });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ===== Markdown preview & conversion download API =====

  router.get("/file/content", requireAuth, requirePermission("files.read"), (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, error: "path required" });
      return;
    }
    const wsBase = join(process.cwd(), ".raos", "workspace");
    const absPath = join(wsBase, filePath);
    if (!absPath.startsWith(wsBase)) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    if (!existsSync(absPath)) {
      res.status(404).json({ success: false, error: "file not found" });
      return;
    }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    createReadStream(absPath).pipe(res);
  });

  // Markdown conversion download
  router.get("/download/convert", requireAuth, requirePermission("files.read"), async (req, res) => {
    const filePath = req.query.path as string;
    const format = req.query.format as string;
    if (!filePath || !format) {
      res.status(400).json({ success: false, error: "path and format required" });
      return;
    }
    if (!["pdf", "docx", "pptx"].includes(format)) {
      res.status(400).json({ success: false, error: "format must be pdf, docx, or pptx" });
      return;
    }
    const wsBase = join(process.cwd(), ".raos", "workspace");
    const absPath = join(wsBase, filePath);
    if (!absPath.startsWith(wsBase)) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    if (!existsSync(absPath)) {
      res.status(404).json({ success: false, error: "file not found" });
      return;
    }

    try {
      const mdContent = readFileSync(absPath, "utf-8");
      const baseName = (filePath.split("/").pop() || "document").replace(/\.md$/i, "");

      if (format === "pdf") {
        const buf = await convertToPdf(mdContent);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ".pdf")}`);
        res.send(buf);
      } else if (format === "docx") {
        const buf = await convertToDocx(mdContent);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ".docx")}`);
        res.send(buf);
      } else if (format === "pptx") {
        const theme = req.query.theme as string | undefined;
        const buf = await convertToPptx(mdContent, theme);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ".pptx")}`);
        res.send(buf);
      }
    } catch (e: unknown) {
      console.error("Convert error:", e);
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // PPTX themes list API
  router.get("/pptx/themes", requireAuth, requirePermission("files.read"), async (req: Request, res: Response) => {
    const builtIn = Object.values(PPTX_THEMES).map((t) => ({
      name: t.name, label: t.label, custom: false,
      preview: { bg: t.background, title: t.titleColor, accent: t.accentColor },
    }));

    let custom: Array<{ id: string; name: string; label: string; custom: boolean; sourceFile: string; preview: { bg: string; title: string; accent: string } }> = [];
    try {
      const userId = req.user?.id;
      if (userId) {
        let rows: Array<{ id: string; name: string; colors_json: string; source_file: string }>;
        if (isMySQL()) {
          const adapter = await getMySQLAdapter();
          rows = await adapter.query("SELECT * FROM custom_pptx_themes WHERE user_id = ? ORDER BY created_at DESC", [userId]);
        } else {
          rows = getDb().prepare("SELECT * FROM custom_pptx_themes WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Array<{ id: string; name: string; colors_json: string; source_file: string }>;
        }
        custom = rows.map((r) => {
          const colors = JSON.parse(r.colors_json);
          return {
            id: r.id,
            name: r.name,
            label: r.name,
            custom: true,
            sourceFile: r.source_file,
            preview: { bg: colors.background || "FFFFFF", title: colors.text || colors.primary, accent: colors.secondary || colors.accent },
          };
        });
      }
    } catch { /* table may not exist */ }

    res.json({ success: true, themes: [...builtIn, ...custom] });
  });

  // PPTX style learning
  router.post("/pptx/themes/learn", requireAuth, requirePermission("files.write"), express.raw({ type: "multipart/form-data", limit: "50mb" }), async (req: Request, res: Response) => {
    try {
      const contentType = req.headers["content-type"] as string;
      const boundaryMatch = contentType?.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        res.status(400).json({ success: false, error: "缺少 multipart boundary" });
        return;
      }

      const parts = parseMultipart(req.body as Buffer, boundaryMatch[1]);
      // 文件大小验证
      for (const part of parts) {
        if (part.data.length > MAX_FILE_SIZE) {
          res.status(413).json({
            success: false,
            error: `文件 "${part.filename}" 过大，最大允许 ${MAX_FILE_SIZE / 1024 / 1024}MB`
          });
          return;
        }
      }

      const pptxFile = parts.find((p) => p.filename.toLowerCase().endsWith(".pptx"));
      if (!pptxFile) {
        res.status(400).json({ success: false, error: "请上传 .pptx 文件" });
        return;
      }

      const themeName = (req.query.name as string) || undefined;

      const style = await extractPptxStyle(pptxFile.data, pptxFile.filename, themeName);

      const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "未认证" });
        return;
      }

      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        await adapter.execute(
          "INSERT INTO custom_pptx_themes (id, user_id, name, colors_json, fonts_json, source_file, created_at) VALUES (?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
          [id, userId, style.name, JSON.stringify(style.colors), JSON.stringify(style.fonts), style.sourceFile]
        );
      } else {
        getDb().prepare(
          "INSERT INTO custom_pptx_themes (id, user_id, name, colors_json, fonts_json, source_file) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(id, userId, style.name, JSON.stringify(style.colors), JSON.stringify(style.fonts), style.sourceFile);
      }

      res.json({
        success: true,
        theme: {
          id,
          name: style.name,
          colors: style.colors,
          fonts: style.fonts,
          sourceFile: style.sourceFile,
        },
      });
    } catch (e: unknown) {
      console.error("PPTX style learn error:", e);
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Delete custom PPTX theme
  router.delete("/pptx/themes/:id", requireAuth, requirePermission("files.write"), async (req: Request, res: Response) => {
    try {
      const themeId = req.params.id;
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "未认证" });
        return;
      }

      let success = false;
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const result = await adapter.execute("DELETE FROM custom_pptx_themes WHERE id = ? AND user_id = ?", [themeId, userId]);
        success = result.affectedRows > 0;
      } else {
        const result = getDb().prepare("DELETE FROM custom_pptx_themes WHERE id = ? AND user_id = ?").run(themeId, userId);
        success = result.changes > 0;
      }
      if (!success) {
        res.status(404).json({ success: false, error: "主题不存在或无权删除" });
        return;
      }

      res.json({ success: true, deleted: themeId });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ===== File download API =====

  // Single file download
  router.get("/download", requireAuth, requirePermission("files.read"), (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, error: "path required" });
      return;
    }
    const absPath = join(process.cwd(), ".raos", "workspace", filePath);
    if (!absPath.startsWith(join(process.cwd(), ".raos", "workspace"))) {
      res.status(403).json({ success: false, error: "access denied" });
      return;
    }
    if (!existsSync(absPath)) {
      res.status(404).json({ success: false, error: "file not found" });
      return;
    }
    const fileName = filePath.split("/").pop() || "download";
    const encodedName = encodeURIComponent(fileName);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedName}`);
    res.setHeader("Content-Length", statSync(absPath).size);
    createReadStream(absPath).pipe(res);
  });

  // Multi-file zip download
  router.post("/download/zip", requireAuth, requirePermission("files.read"), async (req, res) => {
    const { files } = req.body as { files: string[] };
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ success: false, error: "files array required" });
      return;
    }

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const wsBase = join(process.cwd(), ".raos", "workspace");

      for (const f of files) {
        const absPath = join(wsBase, f);
        if (!absPath.startsWith(wsBase) || !existsSync(absPath)) continue;
        const fileName = f.split("/").pop() || f;
        zip.file(fileName, readFileSync(absPath));
      }

      const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="files_${Date.now()}.zip"`);
      res.send(buf);
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}
