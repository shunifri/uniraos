import { useState, useRef, useEffect } from "react";
import { Flex, Typography, Tag, Button, List, Spin, Badge, Segmented, message } from "antd";
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
  DownloadOutlined,
} from "@ant-design/icons";
import { apiFetch } from "@/api";
import { useI18nStore } from "@/i18n";
import { getFileIcon, formatFileSize } from "./utils";

const { Text } = Typography;

interface PptxTheme {
  name: string;
  label: string;
  custom: boolean;
  sourceFile?: string;
  preview: { bg: string; title: string; accent: string };
}

interface UserFilesProps {
  fileDownload: {
    files: Array<{
      name: string;
      path: string;
      size: number;
      ext: string;
      downloadUrl: string;
      contentUrl?: string;
    }>;
    zipDownloadUrl?: string;
    zipName?: string;
    zipPaths?: string[];
  };
  mdPreviews: Record<string, string>;
  onRefreshPptxThemes: () => void;
  pptxThemes: PptxTheme[];
}

export default function UserFiles({
  fileDownload,
  mdPreviews,
  onRefreshPptxThemes,
  pptxThemes,
}: UserFilesProps) {
  const t = useI18nStore((s) => s.t);

  const downloadFn = (url: string, name: string) => {
    apiFetch(url).then(async (res) => {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name;
      a.click();
      URL.revokeObjectURL(blobUrl);
    }).catch(() => message.error("下载失败"));
  };

  // 解析幻灯片内容用于卡片预览
  const parseSlides = (raw: string) => {
    const stripped = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
    return stripped.split(/\n---\n/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const lines = s.split("\n");
      let title = "";
      const bullets: string[] = [];
      for (const l of lines) {
        const t = l.trim();
        if (!title && /^#{1,3}\s+/.test(t)) title = t.replace(/^#{1,3}\s+/, "");
        else if (/^>\s+/.test(t) && !title) title = t.replace(/^>\s+/, "");
        else if (/^[-*+]\s+/.test(t)) bullets.push(t.replace(/^[-*+]\s+/, ""));
        else if (t && !title) title = t;
        else if (t) bullets.push(t);
      }
      return { title, bullets };
    });
  };

  // 主题预览色（静态 fallback + 动态）
  const fallbackThemeColors: Record<string, { bg: string; title: string; accent: string; body: string }> = {
    "business-blue": { bg: "#FFFFFF", title: "#1B3A5C", accent: "#2B7AE0", body: "#444" },
    "tech-dark": { bg: "#1A1A2E", title: "#E0E0FF", accent: "#00D4FF", body: "#B0B0CC" },
    "minimal-white": { bg: "#FAFAFA", title: "#222", accent: "#888", body: "#555" },
    "vibrant-orange": { bg: "#FFFAF5", title: "#D4520A", accent: "#FF6B2B", body: "#4A4A4A" },
    "academic-green": { bg: "#F5FAF5", title: "#1B5E20", accent: "#43A047", body: "#3E3E3E" },
  };

  const detectTheme = (raw: string) => {
    const m = raw.match(/^---\s*\n[\s\S]*?theme:\s*(\S+)[\s\S]*?\n---/);
    return m ? m[1] : "business-blue";
  };

  return (
    <div style={{ padding: "8px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {fileDownload.files.map((f, fi) => {
          const isMd = f.ext === ".md";
          const mdContent = mdPreviews[f.contentUrl || ""];
          const isPpt = isMd && mdContent && mdContent.includes("\n---\n");

          // 合并动态主题
          const themeColors: Record<string, { bg: string; title: string; accent: string; body: string }> = { ...fallbackThemeColors };
          for (const t of pptxThemes) {
            if (!themeColors[t.name] && t.preview) {
              themeColors[t.name] = { bg: `#${t.preview.bg}`, title: `#${t.preview.title}`, accent: `#${t.preview.accent}`, body: "#444" };
            }
          }

          const currentTheme = mdContent ? detectTheme(mdContent) : "business-blue";
          const colors = themeColors[currentTheme] || themeColors["business-blue"];

          return (
            <div
              key={fi}
              style={{ minWidth: 240, maxWidth: isMd ? "100%" : 300, flex: isMd ? "1 1 100%" : undefined }}
            >
              {/* 文件信息栏 + 下载按钮 */}
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 8,
                  border: "1px solid var(--ant-color-border)",
                  background: "var(--ant-color-bg-container)",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
              >
                <div style={{ fontSize: 28, lineHeight: 1 }}>{getFileIcon(f.ext)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ant-color-text-secondary)" }}>{formatFileSize(f.size)}</div>
                </div>
                {isMd ? (
                  <Flex gap={4} align="center">
                    {(["MD", "PDF", "DOCX", "PPTX"] as const).map((fmt) => {
                      const themeParam = fmt === "PPTX" && mdContent ? `&theme=${currentTheme}` : "";
                      return (
                        <Button
                          key={fmt}
                          size="small"
                          type={fmt === "MD" ? "primary" : "default"}
                          style={{ fontSize: 11, padding: "0 8px", height: 24 }}
                          onClick={() => {
                            if (fmt === "MD") {
                              downloadFn(f.downloadUrl, f.name);
                            } else {
                              downloadFn(
                                `/api/download/convert?path=${encodeURIComponent(f.path)}&format=${fmt.toLowerCase()}${themeParam}`,
                                f.name.replace(/\.md$/i, `.${fmt.toLowerCase()}`),
                              );
                            }
                          }}
                        >
                          {fmt}
                        </Button>
                      );
                    })}
                  </Flex>
                ) : (
                  <DownloadOutlined
                    style={{ fontSize: 16, color: "#1677ff", flexShrink: 0, cursor: "pointer" }}
                    onClick={() => downloadFn(f.downloadUrl, f.name)}
                  />
                )}
              </div>

              {/* PPT 幻灯片卡片预览 */}
              {isPpt && mdContent && (() => {
                const slides = parseSlides(mdContent);
                return (
                  <div style={{ marginTop: 8 }}>
                    {/* 主题选择器 */}
                    <Flex gap={6} style={{ marginBottom: 8 }} align="center" wrap="wrap">
                      <Text style={{ fontSize: 11, color: "var(--ant-color-text-secondary)" }}>主题:</Text>
                      {Object.entries(themeColors).map(([name, c]) => {
                        const themeInfo = pptxThemes.find((t) => t.name === name);
                        const label = themeInfo?.label || ({
                          "business-blue": "商务蓝",
                          "tech-dark": "科技深色",
                          "minimal-white": "简约白",
                          "vibrant-orange": "活力橙",
                          "academic-green": "学术绿",
                        } as Record<string, string>)[name] || name;
                        const isCustom = themeInfo?.custom;
                        return (
                          <div
                            key={name}
                            title={`${label}${isCustom ? ` (来源: ${themeInfo?.sourceFile || "自定义"})` : ""}`}
                            onClick={() => {
                              if (!mdContent) return;
                              // Theme selection handled in parent
                            }}
                            style={{
                              width: 20, height: 20, borderRadius: 4, cursor: "pointer",
                              background: c.bg, border: name === currentTheme ? `2px solid ${c.accent}` : `1px solid ${isCustom ? c.accent + "88" : "#ddd"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              boxShadow: name === currentTheme ? `0 0 0 2px ${c.accent}33` : "none",
                            }}
                          >
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: c.accent }} />
                          </div>
                        );
                      })}
                    </Flex>
                    {/* 幻灯片卡片列表 */}
                    <div style={{
                      display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8,
                      scrollbarWidth: "thin",
                    }}>
                      {slides.map((slide, si) => {
                        const isCover = si === 0 && slide.bullets.length === 0;
                        return (
                          <div key={si} style={{
                            flex: "0 0 240px", height: 135, borderRadius: 6,
                            background: colors.bg, border: "1px solid var(--ant-color-border)",
                            padding: 0, overflow: "hidden", position: "relative",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                          }}>
                            {/* 顶部装饰线 */}
                            <div style={{ height: 3, background: colors.accent }} />
                            <div style={{ padding: "8px 12px" }}>
                              {isCover ? (
                                <div style={{ textAlign: "center", paddingTop: 20 }}>
                                  <div style={{
                                    fontSize: 13, fontWeight: 700, color: colors.title,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  }}>{slide.title}</div>
                                  <div style={{ width: 40, height: 2, background: colors.accent, margin: "6px auto" }} />
                                </div>
                              ) : (
                                <>
                                  <div style={{
                                    fontSize: 11, fontWeight: 600, color: colors.title,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    marginBottom: 2,
                                  }}>{slide.title}</div>
                                  <div style={{ width: 20, height: 2, background: colors.accent, marginBottom: 6 }} />
                                  <div style={{ fontSize: 9, color: colors.body, lineHeight: 1.6 }}>
                                    {slide.bullets.slice(0, 4).map((b, bi) => (
                                      <div key={bi} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        <span style={{ color: colors.accent, marginRight: 4 }}>•</span>{b}
                                      </div>
                                    ))}
                                    {slide.bullets.length > 4 && (
                                      <div style={{ color: colors.accent, fontSize: 8 }}>+{slide.bullets.length - 4} more</div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                            {/* 页码 */}
                            <div style={{
                              position: "absolute", bottom: 4, right: 8,
                              fontSize: 8, color: colors.body, opacity: 0.6,
                            }}>{si + 1}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 非 PPT 的普通 MD 预览 */}
              {isMd && mdContent && !isPpt && (
                <div style={{
                  marginTop: 6, padding: "12px 16px", borderRadius: 8,
                  border: "1px solid var(--ant-color-border)",
                  background: "var(--ant-color-bg-container)",
                  maxHeight: 300, overflowY: "auto",
                  fontSize: 13, lineHeight: 1.7,
                }}>
                  {/* XMarkdown rendered in parent */}
                  <div dangerouslySetInnerHTML={{ __html: mdContent }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {fileDownload.zipDownloadUrl && fileDownload.files.length > 1 && (
        <Button
          type="dashed"
          icon={<FileZipOutlined />}
          onClick={() => {
            const fd = fileDownload;
            apiFetch(fd.zipDownloadUrl!, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: fd.zipPaths, zipName: fd.zipName }),
            }).then(async (res) => {
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = fd.zipName || "files.zip"; a.click();
              URL.revokeObjectURL(url);
            }).catch(() => message.error("打包下载失败"));
          }}
          style={{ height: "auto", padding: "10px 16px", borderRadius: 8, alignSelf: "flex-start" }}
        >
          打包下载 ({fileDownload.files.length} 个文件)
        </Button>
      )}
    </div>
  );
}
