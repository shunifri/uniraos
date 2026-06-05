import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * P1-22 设计变更: docx/pptx 不再为正常文档生成页面图片.
 * 这个测试用 grep 验证源码里没有遗留 imagePromise / convertToPDF 在 docx/pptx 主路径上.
 * (Vision OCR 仍保留, 但只在文本提取完全失败时 fallback, 这部分我们手动 review)
 *
 * 真正的行为测试需要 mammoth/jszip/libreoffice 实际跑, 留给 e2e.
 */
describe("P1-22: docx/pptx skip image generation in fast path", () => {
  const source = readFileSync(
    join(process.cwd(), "src/services/doc-parser.ts"),
    "utf-8",
  );

  it("parseWord should not call convertToPDF in the main text path", () => {
    // parseWord 函数的整个体里不应该有 convertToPDF 调用, 除非在 vision OCR fallback
    const parseWordMatch = source.match(/async function parseWord[\s\S]+?\n\}/);
    expect(parseWordMatch).not.toBeNull();
    const parseWordBody = parseWordMatch![0];
    // count convertToPDF occurrences in parseWord body
    const convertToPdfCount = (parseWordBody.match(/convertToPDF/g) || []).length;
    // 应该只在 vision OCR fallback 里出现一次
    expect(convertToPdfCount).toBeLessThanOrEqual(1);
  });

  it("parseWord should not have imagePromise in main path", () => {
    const parseWordMatch = source.match(/async function parseWord[\s\S]+?\n\}/);
    expect(parseWordMatch).not.toBeNull();
    const parseWordBody = parseWordMatch![0];
    expect(parseWordBody).not.toMatch(/imagePromise\s*=\s*\(/);
    // 不应该有 generatePageImages 的实际调用 (允许注释里出现, 所以匹配 "调用" 形式)
    expect(parseWordBody).not.toMatch(/await\s+generatePageImages/);
  });

  it("parsePPTX should not call convertToPDF in the main text path", () => {
    const parsePPTXMatch = source.match(/async function parsePPTX[\s\S]+?\n\}/);
    expect(parsePPTXMatch).not.toBeNull();
    const parsePPTXBody = parsePPTXMatch![0];
    const convertToPdfCount = (parsePPTXBody.match(/convertToPDF/g) || []).length;
    expect(convertToPdfCount).toBeLessThanOrEqual(1);
    expect(parsePPTXBody).not.toMatch(/imagePromise\s*=\s*\(/);
    expect(parsePPTXBody).not.toMatch(/await\s+generatePageImages/);
  });

  it("parsePDF should skip image generation when text quality is good", () => {
    // PDF 的"good quality"分支 (line ~686) 不应该再调 imagePromise
    const parsePDFMatch = source.match(/async function parsePDF\([\s\S]+?\n\}/);
    expect(parsePDFMatch).not.toBeNull();
    const parsePDFBody = parsePDFMatch![0];
    // 在 quality.isGoodQuality 分支里, 不应该有 imagePromise 或 generatePageImages
    // (它们只在 "bad quality" vision OCR 路径里出现, 即 pdfToVisionOCR 内部)
    const goodQualitySection = parsePDFBody.match(
      /if \(quality\.isGoodQuality[\s\S]+?(?=\/\/ Step|if \(vision config\))/i,
    );
    if (goodQualitySection) {
      expect(goodQualitySection[0]).not.toMatch(/imagePromise/);
      expect(goodQualitySection[0]).not.toMatch(/generatePageImages/);
    }
  });
});
