import {
  FilePdfOutlined,
  FileExcelOutlined,
  FileWordOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FileZipOutlined,
  FileMarkdownOutlined,
  FileOutlined,
} from "@ant-design/icons";
import type React from "react";
import { useState } from "react";
import { pageImageUrl } from "@/api";

export function getFileIcon(ext: string, size: number | string = 16): React.ReactNode {
  const style = { fontSize: typeof size === 'number' ? `${size}px` : size };
  const iconMap: Record<string, React.ReactNode> = {
    ".pdf": <FilePdfOutlined style={{ ...style, color: "#ff4d4f" }} />,
    ".xlsx": <FileExcelOutlined style={{ ...style, color: "#52c41a" }} />,
    ".xls": <FileExcelOutlined style={{ ...style, color: "#52c41a" }} />,
    ".csv": <FileExcelOutlined style={{ ...style, color: "#52c41a" }} />,
    ".docx": <FileWordOutlined style={{ ...style, color: "#1677ff" }} />,
    ".doc": <FileWordOutlined style={{ ...style, color: "#1677ff" }} />,
    ".pptx": <FilePptOutlined style={{ ...style, color: "#fa8c16" }} />,
    ".ppt": <FilePptOutlined style={{ ...style, color: "#fa8c16" }} />,
    ".txt": <FileTextOutlined style={{ ...style, color: "#8c8c8c" }} />,
    ".log": <FileTextOutlined style={{ ...style, color: "#8c8c8c" }} />,
    ".md": <FileMarkdownOutlined style={{ ...style, color: "#722ed1" }} />,
    ".png": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".jpg": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".jpeg": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".gif": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".zip": <FileZipOutlined style={{ ...style, color: "#faad14" }} />,
    ".rar": <FileZipOutlined style={{ ...style, color: "#faad14" }} />,
  };
  return iconMap[ext] || <FileOutlined style={{ ...style, color: "#8c8c8c" }} />;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** 在页面图片上叠加黄色高亮矩形 */
export function HighlightedPageImage({ docId, page, bboxes }: {
  docId: string;
  page: number;
  bboxes: Array<{ page: number; bbox: [number, number, number, number] }>;
}) {
  const [imgError, setImgError] = useState(false);
  const pageBboxes = bboxes.filter((b) => b.page === page);

  if (imgError) {
    return (
      <div
        style={{
          width: "100%",
          padding: "40px 20px",
          textAlign: "center",
          background: "#f8fafc",
          borderRadius: 6,
          color: "#94a3b8",
          fontSize: 13,
        }}
      >
        <FileTextOutlined style={{ fontSize: 32, marginBottom: 8, display: "block" }} />
        暂无第 {page} 页截图
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
      <img
        src={pageImageUrl(docId, page)}
        alt={`第 ${page} 页`}
        style={{ width: "100%", height: "auto", display: "block" }}
        loading="lazy"
        onError={() => setImgError(true)}
      />
      {pageBboxes.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${b.bbox[0]}%`,
            top: `${b.bbox[1]}%`,
            width: `${b.bbox[2]}%`,
            height: `${b.bbox[3]}%`,
            background: "rgba(255, 255, 0, 0.3)",
            border: "2px solid rgba(255, 200, 0, 0.6)",
            borderRadius: 2,
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
}

// ---- Highlight keywords in React (not HTML injection, avoids DOMPurify stripping) ----
export function highlightText(text: string, keywords: string[]): React.ReactNode[] {
  if (!keywords.length) return [text];
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) => {
    // Use a fresh regex each time (no lastIndex issue)
    const isMatch = new RegExp(`^(?:${escaped.join("|")})$`, "i").test(part);
    return isMatch ? (
      <mark key={i} style={{ background: "#fff1b8", padding: "0 1px", borderRadius: 2 }}>{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

export function extractKeywords(text: string): string[] {
  // 中文停用词，用于切分
  const zhStops = "的了是在有和我你他她它们这那就都也不吗呢吧啊哪什么怎么为什么可以能会要请帮给把让到从对用说看想做去来很最一个一些所有关于哪些怎样如何";
  const stopChars = new Set(zhStops.split(""));
  // 1. 去标点符号，按停用字切分中文为短语
  const cleaned = text.replace(/[^\u4e00-\u9fffa-zA-Z0-9]/g, " ");
  const phrases: string[] = [];
  let cur = "";
  for (const ch of cleaned) {
    if (stopChars.has(ch) || ch === " ") {
      if (cur.length >= 2) phrases.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length >= 2) phrases.push(cur);
  // 2. 长短语拆成 2-4 字 n-gram
  const result: string[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    // 保留完整短语
    if (phrase.length >= 2 && phrase.length <= 6 && !seen.has(phrase)) {
      result.push(phrase);
      seen.add(phrase);
    }
    // 拆 2-gram
    if (phrase.length > 2) {
      for (let i = 0; i <= phrase.length - 2; i++) {
        const ng = phrase.slice(i, i + 2);
        if (!seen.has(ng)) { result.push(ng); seen.add(ng); }
      }
    }
  }
  // 优先长词，最多 12 个
  return result.sort((a, b) => b.length - a.length).slice(0, 12);
}
