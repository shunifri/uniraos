/**
 * 文档内嵌图片提取 + 图片描述生成
 *
 * 支持格式：
 * - Word (.docx): 解压 word/media/ 目录
 * - PPT (.pptx): 解压 ppt/media/ 目录
 * - PDF: 用 pdf-lib 提取内嵌图片对象
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join, extname } from "path";
import type { VisionModelConfig } from "../services/doc-parser.js";

export interface ExtractedImage {
  id: string;          // 唯一标识，如 "img-0", "img-1"
  name: string;        // 原始文件名
  ext: string;         // 扩展名
  data: Buffer;        // 图片二进制数据
  page?: number;       // 所在页码（PDF 可能有）
  mimeType: string;    // image/png, image/jpeg 等
}

export interface ImageWithDescription {
  id: string;
  name: string;
  ext: string;
  page?: number;
  mimeType: string;
  description: string; // LLM 生成的图片描述
  base64: string;      // base64 编码（用于 LLM 输入和 API 输出）
}

/** 从文件扩展名推断 MIME 类型 */
function inferMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return map[ext.toLowerCase()] || "image/png";
}

/** 提取 Word (.docx) 内嵌图片 */
export async function extractDocxImages(filePath: string): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const buffer = readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const images: ExtractedImage[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (relativePath.startsWith("word/media/") && !zipEntry.dir) {
      const name = relativePath.split("/").pop() || `image-${images.length}`;
      const ext = extname(name).slice(1) || "png";
      images.push({
        id: `img-${images.length}`,
        name,
        ext,
        data: Buffer.alloc(0), // 占位，下面填充
        mimeType: inferMimeType(ext),
      });
    }
  });

  // 异步读取数据
  let idx = 0;
  await Promise.all(
    Object.entries(zip.files)
      .filter(([path]) => path.startsWith("word/media/"))
      .map(async ([path, entry]) => {
        const data = await entry.async("nodebuffer");
        const name = path.split("/").pop() || `image-${idx}`;
        const ext = extname(name).slice(1) || "png";
        images[idx] = {
          id: `img-${idx}`,
          name,
          ext,
          data,
          mimeType: inferMimeType(ext),
        };
        idx++;
      })
  );

  return images.filter((img) => img.data.length > 0);
}

/** 提取 PPT (.pptx) 内嵌图片 */
export async function extractPptxImages(filePath: string): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const buffer = readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const images: ExtractedImage[] = [];

  let idx = 0;
  await Promise.all(
    Object.entries(zip.files)
      .filter(([path]) => path.startsWith("ppt/media/"))
      .map(async ([path, entry]) => {
        const data = await entry.async("nodebuffer");
        const name = path.split("/").pop() || `image-${idx}`;
        const ext = extname(name).slice(1) || "png";
        images.push({
          id: `img-${idx}`,
          name,
          ext,
          data,
          mimeType: inferMimeType(ext),
        });
        idx++;
      })
  );

  return images.filter((img) => img.data.length > 0);
}

/** 提取 PDF 内嵌图片 */
export async function extractPdfImages(filePath: string): Promise<ExtractedImage[]> {
  const { PDFDocument } = await import("pdf-lib");
  const buffer = readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(buffer);
  const images: ExtractedImage[] = [];

  const pages = pdfDoc.getPages();
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    // @ts-ignore - pdf-lib 内部结构
    const resources = page.node.Resources?.();
    if (!resources) continue;

    // @ts-ignore
    const xObjects = resources.lookup?.("XObject") || resources.get?.("XObject");
    if (!xObjects) continue;

    // @ts-ignore
    const dict = xObjects.dict || xObjects;
    if (!dict) continue;

    const keys = Object.keys(dict);
    for (const key of keys) {
      try {
        // @ts-ignore
        const obj = dict[key];
        if (!obj) continue;
        // @ts-ignore
        const subtype = obj.get?.("Subtype")?.name || obj.lookup?.("Subtype")?.name;
        if (subtype !== "Image") continue;

        // @ts-ignore
        const width = obj.get?.("Width")?.numberValue || obj.lookup?.("Width")?.numberValue || 0;
        // @ts-ignore
        const height = obj.get?.("Height")?.numberValue || obj.lookup?.("Height")?.numberValue || 0;
        if (width < 50 || height < 50) continue; // 过滤小图标/噪点

        // @ts-ignore
        const filter = obj.get?.("Filter")?.name || obj.lookup?.("Filter")?.name || "";
        let data: Buffer;
        let ext = "png";

        // @ts-ignore
        const rawData = obj.getContents?.() || obj.get?.("Contents") || obj.contents;
        if (!rawData) continue;

        if (filter === "DCTDecode") {
          ext = "jpg";
          data = Buffer.from(rawData);
        } else if (filter === "FlateDecode") {
          // @ts-ignore
          const colorSpace = obj.get?.("ColorSpace")?.name || obj.lookup?.("ColorSpace")?.name || "DeviceRGB";
          // 尝试提取为 PNG（简化处理：用 canvas 或 Sharp 可能更好，但这里先做基础版本）
          // 对于 FlateDecode，数据需要解码后重新编码为 PNG
          // 简化：先跳过需要复杂解码的图片，或尝试用 pdf-lib 的 embed 方式
          continue; // TODO: 支持 FlateDecode 图片的 PNG 转换
        } else {
          continue;
        }

        images.push({
          id: `img-${images.length}`,
          name: `page-${pageIdx + 1}-${key}.${ext}`,
          ext,
          data,
          page: pageIdx + 1,
          mimeType: inferMimeType(ext),
        });
      } catch {
        // 跳过无法解析的图片对象
      }
    }
  }

  return images;
}

/** 统一入口：根据文件类型提取图片 */
export async function extractDocumentImages(filePath: string): Promise<ExtractedImage[]> {
  const ext = extname(filePath).toLowerCase();
  try {
    if (ext === ".docx") return await extractDocxImages(filePath);
    if (ext === ".pptx") return await extractPptxImages(filePath);
    if (ext === ".pdf") return await extractPdfImages(filePath);
    return [];
  } catch (err: any) {
    console.error(`[ImageExtractor] Failed to extract images from ${filePath}:`, err.message);
    return [];
  }
}

/** 用视觉模型生成图片描述 */
export async function generateImageDescription(
  imageBase64: string,
  mimeType: string,
  visionConfig: VisionModelConfig
): Promise<string> {
  const prompt = `请用简短的一句话描述这张图片的主要内容（30字以内）。如果是流程图/架构图/原理图，请说明图中展示的系统/流程名称。如果是操作界面截图，请说明这是什么系统的什么操作界面。如果是照片/实物图，请描述图中主体。只输出描述，不要任何解释。`;

  try {
    const response = await fetch(visionConfig.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${visionConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: visionConfig.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision API error: ${response.status}`);
    }

    const data = await response.json();
    const desc = data.choices?.[0]?.message?.content?.trim() || "";
    return desc || "文档内嵌图片";
  } catch (err: any) {
    console.error("[ImageExtractor] Failed to generate description:", err.message);
    return "文档内嵌图片";
  }
}

/** 批量生成图片描述 */
export async function describeImages(
  images: ExtractedImage[],
  visionConfig: VisionModelConfig
): Promise<ImageWithDescription[]> {
  const results: ImageWithDescription[] = [];

  for (const img of images) {
    const base64 = img.data.toString("base64");
    const description = await generateImageDescription(base64, img.mimeType, visionConfig);
    results.push({
      ...img,
      description,
      base64,
    });
  }

  return results;
}

/** 保存图片到磁盘 */
export function saveImages(
  images: ImageWithDescription[],
  outDir: string
): Array<{ id: string; path: string; description: string; page?: number }> {
  mkdirSync(outDir, { recursive: true });
  const saved: Array<{ id: string; path: string; description: string; page?: number }> = [];

  for (const img of images) {
    const fileName = `${img.id}.${img.ext}`;
    const filePath = join(outDir, fileName);
    writeFileSync(filePath, Buffer.from(img.base64, "base64"));
    saved.push({
      id: img.id,
      path: filePath,
      description: img.description,
      page: img.page,
    });
  }

  return saved;
}
