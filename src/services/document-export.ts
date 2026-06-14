/**
 * RAOS Document Export — Markdown to PDF/DOCX/PPTX conversion utilities.
 *
 * Pure logic, no Express dependencies.
 */

// ───────────────────────────────────────────────────────────────
// PDF Export
// ───────────────────────────────────────────────────────────────

export async function convertToPdf(md: string): Promise<Buffer> {
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

// ───────────────────────────────────────────────────────────────
// DOCX Export
// ───────────────────────────────────────────────────────────────

export async function convertToDocx(md: string): Promise<Buffer> {
  const { marked } = await import("marked");
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;

  const tokens = marked.lexer(md);
  const children: any[] = [];

  for (const token of tokens) {
    if (token.type === "heading") {
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
          children: parseInlineTokens(item.tokens?.[0]?.type === "text" ? (item.tokens[0] as any).tokens || item.tokens : item.tokens || [], TextRun),
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
      const bqText = token.tokens?.map((t: any) => t.text || t.raw || "").join("\n") || token.raw;
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
      const rawText = (token as any).text || (token as any).raw || "";
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

// ───────────────────────────────────────────────────────────────
// PPTX Theme System
// ───────────────────────────────────────────────────────────────

export interface PptxTheme {
  name: string;
  label: string;
  background: string;
  backgroundGrad?: { color: string; color2: string; type: "linear" };
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

export const PPTX_THEMES: Record<string, PptxTheme> = {
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

export function parsePptxFrontmatter(md: string): { theme: string; content: string } {
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fmMatch) return { theme: "business-blue", content: md };
  const fmBlock = fmMatch[1];
  const themeMatch = fmBlock.match(/theme:\s*(.+)/);
  const theme = themeMatch ? themeMatch[1].trim() : "business-blue";
  const content = md.slice(fmMatch[0].length);
  return { theme, content };
}

/** Resolve theme by name, optionally querying a custom resolver for non-built-in themes */
export async function resolvePptxTheme(
  name: string,
  customResolver?: (name: string) => Promise<PptxTheme | null>
): Promise<PptxTheme> {
  if (PPTX_THEMES[name]) return PPTX_THEMES[name];
  if (customResolver) {
    const custom = await customResolver(name).catch(() => null);
    if (custom) return custom;
  }
  return PPTX_THEMES["business-blue"];
}

/** Strip HTML tags, keep plain text */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .trim();
}

/** Convert HTML <table> to markdown table */
export function htmlTableToMarkdown(tableHtml: string): string {
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

/** Clean slide HTML content into plain markdown */
export function cleanSlideHtml(raw: string): string {
  let text = raw;

  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  text = text.replace(/<(\d)[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
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


// ───────────────────────────────────────────────────────────────
// PPTX Export
// ───────────────────────────────────────────────────────────────

export async function convertToPptx(
  md: string,
  themeName?: string,
  customResolver?: (name: string) => Promise<PptxTheme | null>
): Promise<Buffer> {
  const pptxgenjs = await import("pptxgenjs");
  const PptxGenJS = pptxgenjs.default || pptxgenjs;
  const pptx = new (PptxGenJS as any)();
  pptx.layout = "LAYOUT_WIDE";

  const parsed = parsePptxFrontmatter(md);
  const resolvedTheme = themeName || parsed.theme;
  const theme = await resolvePptxTheme(resolvedTheme, customResolver);

  const content = parsed.content;
  const slides = content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  for (let si = 0; si < slides.length; si++) {
    const slideContent = slides[si];
    const slide = pptx.addSlide();

    slide.background = { color: theme.background };

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
      inTable = false;

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

    slide.addShape("rect" as any, {
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
      slide.addShape("rect" as any, {
        x: 4, y: 3.0, w: 5.3, h: 0.04,
        fill: { color: theme.accentColor },
      });
    } else {
      if (title) {
        slide.addText(title, {
          x: 0.6, y: 0.25, w: "88%", h: 0.9,
          fontSize: theme.titleSize, bold: true,
          color: theme.titleColor, fontFace: theme.titleFont,
          align: "left", valign: "middle",
        });
        slide.addShape("rect" as any, {
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

        const pptxRows: any[][] = tableRows.map((row, ri) => {
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
