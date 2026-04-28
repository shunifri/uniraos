/**
 * Page image persistence for parsed documents.
 * Stores extracted page images alongside the source file in workspace.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

export interface PageImage {
  page: number;
  imageBase64: string;
}

/** Derive image storage directory from uploaded file path */
export function getImageDir(relativePath: string): string {
  const wsBase = join(process.cwd(), ".raos", "workspace");
  const parentDir = dirname(join(wsBase, relativePath));
  const baseName = relativePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "file";
  const safe = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, "_");
  return join(parentDir, ".parse-images", safe);
}

/** Persist page images to disk */
export function savePageImages(relativePath: string, pages: PageImage[]): void {
  if (pages.length === 0) return;
  const dir = getImageDir(relativePath);
  mkdirSync(dir, { recursive: true });
  for (const p of pages) {
    const buf = Buffer.from(p.imageBase64, "base64");
    writeFileSync(join(dir, `page-${p.page}.png`), buf);
  }
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages.map((p) => p.page)));
}

/** Read persisted page image list */
export function getPageImageList(relativePath: string): number[] {
  const indexFile = join(getImageDir(relativePath), "pages.json");
  if (!existsSync(indexFile)) return [];
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8"));
  } catch { return []; }
}
