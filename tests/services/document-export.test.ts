import { describe, it, expect, vi } from "vitest";

const mockMarkedFn = vi.fn((md: string) => `<p>${md}</p>`);
(mockMarkedFn as any).lexer = vi.fn((md: string) => {
  if (md.includes("# ")) {
    return [{ type: "heading", depth: 1, text: md.replace("# ", ""), tokens: [{ type: "text", text: md.replace("# ", "") }] }];
  }
  return [{ type: "paragraph", text: md, tokens: [{ type: "text", text: md }] }];
});

vi.mock("marked", () => ({
  marked: mockMarkedFn,
  default: mockMarkedFn,
}));

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn(() => Promise.resolve({
      newPage: vi.fn(() => Promise.resolve({
        setContent: vi.fn(() => Promise.resolve()),
        pdf: vi.fn(() => Promise.resolve(Buffer.from("pdf-content"))),
      })),
      close: vi.fn(() => Promise.resolve()),
    })),
  }
}));

vi.mock("docx", () => ({
  Document: vi.fn(function() { return {}; }),
  Packer: { toBuffer: vi.fn(() => Promise.resolve(Buffer.from("docx-content"))) },
  Paragraph: vi.fn(function(opts) { return opts; }),
  TextRun: vi.fn(function(opts) { return opts; }),
  HeadingLevel: { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 },
  BorderStyle: { SINGLE: "single" },
}));

vi.mock("pptxgenjs", () => ({
  default: function() {
    return {
      layout: "",
      addSlide: vi.fn(() => ({
        background: {},
        addShape: vi.fn(),
        addText: vi.fn(),
        addTable: vi.fn(),
      })),
      write: vi.fn(() => Promise.resolve(Buffer.from("pptx-content"))),
    };
  },
}));

const {
  convertToPdf,
  convertToDocx,
  convertToPptx,
  parsePptxFrontmatter,
  resolvePptxTheme,
  stripHtmlTags,
  htmlTableToMarkdown,
  cleanSlideHtml,
  PPTX_THEMES,
} = await import("../../src/services/document-export.js");

describe("Document Export", () => {
  describe("parsePptxFrontmatter", () => {
    it("should parse theme from frontmatter", () => {
      const md = "---\ntheme: tech-dark\n---\n\n# Title";
      const result = parsePptxFrontmatter(md);
      expect(result.theme).toBe("tech-dark");
      expect(result.content).toBe("# Title");
    });

    it("should default to business-blue when no frontmatter", () => {
      const md = "# Title\n\nContent";
      const result = parsePptxFrontmatter(md);
      expect(result.theme).toBe("business-blue");
      expect(result.content).toBe(md);
    });

    it("should default to business-blue when no theme in frontmatter", () => {
      const md = "---\nauthor: Test\n---\n\n# Title";
      const result = parsePptxFrontmatter(md);
      expect(result.theme).toBe("business-blue");
    });
  });

  describe("resolvePptxTheme", () => {
    it("should resolve built-in theme", async () => {
      const theme = await resolvePptxTheme("tech-dark");
      expect(theme.name).toBe("tech-dark");
    });

    it("should fallback to business-blue for unknown theme", async () => {
      const theme = await resolvePptxTheme("unknown-theme");
      expect(theme.name).toBe("business-blue");
    });

    it("should use custom resolver", async () => {
      const customTheme = { name: "custom", label: "Custom" } as any;
      const resolver = vi.fn(() => Promise.resolve(customTheme));
      const theme = await resolvePptxTheme("custom", resolver);
      expect(theme.name).toBe("custom");
    });

    it("should fallback when custom resolver returns null", async () => {
      const resolver = vi.fn(() => Promise.resolve(null));
      const theme = await resolvePptxTheme("custom", resolver);
      expect(theme.name).toBe("business-blue");
    });
  });

  describe("stripHtmlTags", () => {
    it("should remove HTML tags", () => {
      expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello");
    });

    it("should replace br tags with space", () => {
      expect(stripHtmlTags("Hello<br>World")).toBe("Hello World");
      expect(stripHtmlTags("Hello<br/>World")).toBe("Hello World");
    });

    it("should decode HTML entities", () => {
      expect(stripHtmlTags("&lt;div&gt;")).toBe("<div>");
      expect(stripHtmlTags("&amp;")).toBe("&");
      expect(stripHtmlTags("&quot;test&quot;")).toBe('"test"');
    });

    it("should handle empty string", () => {
      expect(stripHtmlTags("")).toBe("");
    });

    it("should handle text without tags", () => {
      expect(stripHtmlTags("plain text")).toBe("plain text");
    });
  });

  describe("htmlTableToMarkdown", () => {
    it("should convert HTML table to markdown", () => {
      const html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
      const md = htmlTableToMarkdown(html);
      expect(md).toContain("| A | B |");
      expect(md).toContain("| --- | --- |");
      expect(md).toContain("| 1 | 2 |");
    });

    it("should return empty string for empty table", () => {
      expect(htmlTableToMarkdown("<table></table>")).toBe("");
    });

    it("should normalize column counts", () => {
      const html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>";
      const md = htmlTableToMarkdown(html);
      expect(md).toContain("| 1 |  |");
    });
  });

  describe("cleanSlideHtml", () => {
    it("should clean slide HTML", () => {
      const html = "<h1>Title</h1><p>Content</p>";
      expect(cleanSlideHtml(html)).toContain("Title");
      expect(cleanSlideHtml(html)).toContain("Content");
    });

    it("should convert tables", () => {
      const html = "<table><tr><td>A</td></tr></table>";
      expect(cleanSlideHtml(html)).toContain("| A |");
    });

    it("should remove style tags", () => {
      const html = "<style>body{}</style><p>Text</p>";
      expect(cleanSlideHtml(html)).not.toContain("style");
    });

    it("should handle headings with levels", () => {
      const html = "<h2>Subtitle</h2>";
      expect(cleanSlideHtml(html)).toContain("Subtitle");
    });
  });

  describe("PPTX_THEMES", () => {
    it("should contain business-blue theme", () => {
      expect(PPTX_THEMES["business-blue"]).toBeDefined();
      expect(PPTX_THEMES["business-blue"].label).toBe("商务蓝");
    });

    it("should contain tech-dark theme", () => {
      expect(PPTX_THEMES["tech-dark"]).toBeDefined();
      expect(PPTX_THEMES["tech-dark"].background).toBe("1A1A2E");
    });
  });

  describe("convertToPdf", () => {
    it("should convert markdown to PDF buffer", async () => {
      const buffer = await convertToPdf("# Hello");
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString()).toBe("pdf-content");
    });
  });

  describe("convertToDocx", () => {
    it("should convert markdown to DOCX buffer", async () => {
      const buffer = await convertToDocx("# Hello");
      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe("convertToPptx", () => {
    it("should convert markdown to PPTX buffer", async () => {
      const buffer = await convertToPptx("# Hello");
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it("should use provided theme name", async () => {
      const buffer = await convertToPptx("---\ntheme: tech-dark\n---\n# Hello", "minimal-white");
      expect(buffer).toBeInstanceOf(Buffer);
    });
  });
});
