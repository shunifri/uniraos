import { join } from "path";
import { parseDocument, type VisionModelConfig } from "../services/doc-parser.js";
import { savePageImages } from "./page-image-store.js";

export interface ParseStatus {
  status: "parsing" | "done" | "error";
  content?: string;
  error?: string;
  format?: string;
  tags?: string[];
  pageCount?: number;
}

const fileParseCache = new Map<string, ParseStatus>();

export function getParseStatus(relativePath: string): ParseStatus | undefined {
  return fileParseCache.get(relativePath);
}

export function setParseStatus(relativePath: string, status: ParseStatus): void {
  fileParseCache.set(relativePath, status);
}

export function deleteParseStatus(relativePath: string): void {
  fileParseCache.delete(relativePath);
}

/**
 * Fire-and-forget async file parsing.
 */
export function asyncParseFile(filePath: string, relativePath: string, getVisionConfig: () => VisionModelConfig | null): void {
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
  }).catch((err) => {
    fileParseCache.set(relativePath, { status: "error", error: err.message });
  });
}
