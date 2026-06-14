import { useMemo } from "react";
import { XMarkdown } from "@ant-design/x-markdown";
import { CodeHighlighter } from "@ant-design/x";

/** 简化版 DocMindLayout 类型（前端） */
interface DocMindLayout {
  uniqueId?: string;
  type: string;
  subType?: string;
  pageNum?: number | number[];
  pos?: Array<{ x: number; y: number }>;
  text?: string;
  markdownContent?: string;
  llmResult?: string;
  level?: number;
  alignment?: string;
  lineHeight?: number;
  imageUrl?: string;     // Document Mind 可能返回的图片 URL
  blocks?: Array<{
    text: string;
    pos?: any;
    styleId?: number;
    style?: {
      fontName?: string;
      charScale?: number;
      color?: string;
      underline?: boolean;
      deleteLine?: boolean;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
    };
  }>;
  cells?: Array<any>;
  index?: number;
}

interface DocMindPreviewProps {
  layouts: DocMindLayout[];
  pageImages?: number[]; // available page numbers for image overlay
  docId?: string;        // for page image URL construction
  pageFilter?: number;   // 如果只显示指定页面（1-based），传入页码
  highlightText?: string; // 要高亮显示的 chunk 文本
}

/** 从 highlightText 中提取核心匹配片段（清理空白后取前 80 字符） */
function extractMatchSnippet(text?: string): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80);
}

/** 判断 layout 是否包含 highlight snippet */
function isHighlighted(layout: DocMindLayout, snippet: string): boolean {
  if (!snippet) return false;
  const layoutText = (layout.markdownContent || layout.text || "").replace(/\s+/g, " ").trim();
  // 双向包含：snippet 包含 layoutText 或 layoutText 包含 snippet
  return layoutText.length > 0 && (snippet.includes(layoutText) || layoutText.includes(snippet));
}

const markdownComponents: Record<string, React.ComponentType<any>> = {
  code: ({ children, lang, block }: any) =>
    block ? (
      <CodeHighlighter lang={lang}>{String(children ?? "")}</CodeHighlighter>
    ) : (
      <code style={{ background: "var(--ant-color-fill-tertiary)", padding: "1px 4px", borderRadius: 3, fontSize: "0.9em" }}>{children}</code>
    ),
};

/** Get page number (0-based) from possibly-array pageNum */
function getPageNum(layout: DocMindLayout): number {
  const pn = layout.pageNum ?? 0;
  return Array.isArray(pn) ? pn[0] : pn;
}

/** Get top Y coordinate from pos for sorting */
function getTopY(layout: DocMindLayout): number {
  if (layout.pos && layout.pos.length > 0) {
    return Math.min(...layout.pos.map((p) => p.y));
  }
  return layout.index ?? 0;
}

/** Build a readable heading tag from title layout */
function TitleBlock({ layout }: { layout: DocMindLayout }) {
  const level = layout.level ?? 1;
  const text = layout.markdownContent || layout.text || "";
  const style: React.CSSProperties = {
    margin: "12px 0 8px",
    fontWeight: 700,
    lineHeight: 1.4,
    color: "#1e293b",
  };
  if (level === 1) {
    style.fontSize = 16;
    style.borderBottom = "1px solid #e2e8f0";
    style.paddingBottom = 6;
  } else if (level === 2) {
    style.fontSize = 14;
  } else if (level === 3) {
    style.fontSize = 13;
  } else {
    style.fontSize = 12;
  }

  return (
    <div style={style}>
      <XMarkdown content={text} components={markdownComponents} />
    </div>
  );
}

/** Text / paragraph block */
function TextBlock({ layout }: { layout: DocMindLayout }) {
  const text = layout.markdownContent || layout.text || "";
  if (!text.trim()) return null;

  return (
    <div
      style={{
        margin: "6px 0",
        lineHeight: layout.lineHeight ? layout.lineHeight : 1.8,
        textAlign: (layout.alignment as any) || "left",
        color: "#334155",
        fontSize: 11,
      }}
    >
      <XMarkdown content={text} components={markdownComponents} />
    </div>
  );
}

/** Table block - prefer markdownContent, fallback to cells */
function TableBlock({ layout }: { layout: DocMindLayout }) {
  const md = layout.markdownContent;
  if (md && md.trim()) {
    return (
      <div style={{ margin: "10px 0", overflowX: "auto" }}>
        <XMarkdown content={md} components={markdownComponents} />
      </div>
    );
  }

  // Fallback: try to render cells as simple HTML table
  const cells = layout.cells;
  if (cells && Array.isArray(cells) && cells.length > 0) {
    return (
      <div style={{ margin: "10px 0", overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
          <tbody>
            {cells.map((row: any[], rIdx: number) => (
              <tr key={rIdx}>
                {row.map((cell: any, cIdx: number) => (
                  <td
                    key={cIdx}
                    style={{
                      border: "1px solid #cbd5e1",
                      padding: "6px 10px",
                      textAlign: "left",
                    }}
                  >
                    {typeof cell === "string" ? cell : JSON.stringify(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ margin: "10px 0", padding: 12, background: "#f1f5f9", borderRadius: 6, color: "#64748b", fontSize: 13 }}>
      [表格] {layout.text || ""}
    </div>
  );
}

/** Formula / equation block */
function FormulaBlock({ layout }: { layout: DocMindLayout }) {
  const text = layout.markdownContent || layout.text || "";
  return (
    <div
      style={{
        margin: "10px 0",
        padding: "12px 16px",
        background: "#f8fafc",
        borderRadius: 6,
        fontFamily: "'Courier New', monospace",
        fontSize: 11,
        color: "#334155",
        overflowX: "auto",
      }}
    >
      {text.startsWith("$$") || text.includes("\\") ? (
        <XMarkdown content={text} components={markdownComponents} />
      ) : (
        text
      )}
    </div>
  );
}

/** Figure / image block */
function FigureBlock({ layout }: { layout: DocMindLayout }) {
  const text = layout.markdownContent || layout.text || "";
  const hasImage = !!layout.imageUrl;
  return (
    <div style={{ margin: "8px 0", textAlign: "center" }}>
      {hasImage && (
        <img
          src={layout.imageUrl}
          alt={text || "图片"}
          style={{ maxWidth: "100%", height: "auto", borderRadius: 4, display: "block", margin: "0 auto" }}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      {text && (
        <div
          style={{
            marginTop: hasImage ? 6 : 0,
            fontSize: 13,
            color: "#64748b",
            fontStyle: "italic",
            textAlign: "center",
          }}
        >
          <XMarkdown content={text} components={markdownComponents} />
        </div>
      )}
    </div>
  );
}

/** Generic / fallback block */
function GenericBlock({ layout }: { layout: DocMindLayout }) {
  const text = layout.markdownContent || layout.text || "";
  const hasImage = !!layout.imageUrl;
  // 有图片时即使 text 为空也渲染
  if (!text.trim() && !hasImage) return null;
  return (
    <div style={{ margin: "4px 0", fontSize: 10, color: "#475569" }}>
      {hasImage && (
        <img
          src={layout.imageUrl}
          alt={text || "图片"}
          style={{ maxWidth: "100%", height: "auto", borderRadius: 4, display: "block", margin: "0 auto 6px" }}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      {text && (
        <div>
          <span style={{ color: "#94a3b8", fontSize: 9, marginRight: 6 }}>
            [{layout.type}{layout.subType && layout.subType !== "none" ? `/${layout.subType}` : ""}]
          </span>
          <XMarkdown content={text} components={markdownComponents} />
        </div>
      )}
    </div>
  );
}

/** Single layout item renderer */
function LayoutItem({ layout, highlighted }: { layout: DocMindLayout; highlighted?: boolean }) {
  const highlightStyle: React.CSSProperties = highlighted
    ? { background: "rgba(255, 255, 0, 0.15)", borderLeft: "3px solid #facc15", paddingLeft: 8, marginLeft: -4, borderRadius: 2 }
    : {};

  const content = (() => {
    switch (layout.type) {
      case "title":
        return <TitleBlock layout={layout} />;
      case "text":
        return <TextBlock layout={layout} />;
      case "table":
        return <TableBlock layout={layout} />;
      case "formula":
        return <FormulaBlock layout={layout} />;
      case "figure_name":
        return <FigureBlock layout={layout} />;
      case "figure":
        return <FigureBlock layout={layout} />;
      case "foot_image":
      case "head_image":
        return <FigureBlock layout={layout} />;
      default:
        return <GenericBlock layout={layout} />;
    }
  })();

  if (!highlighted) return content;
  return <div style={highlightStyle}>{content}</div>;
}

/** Page container */
function PageCard({
  pageNum,
  layouts,
  highlightSnippet,
}: {
  pageNum: number;
  layouts: DocMindLayout[];
  highlightSnippet?: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      {/* Page header */}
      <div
        style={{
          background: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          padding: "8px 16px",
          fontSize: 12,
          color: "#64748b",
          fontWeight: 500,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>第 {pageNum + 1} 页</span>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>{layouts.length} 个元素</span>
      </div>

      {/* Page body */}
      <div style={{ padding: "16px 20px" }}>
        {layouts.map((layout, idx) => (
          <LayoutItem key={layout.uniqueId || idx} layout={layout} highlighted={isHighlighted(layout, highlightSnippet || "")} />
        ))}
      </div>
    </div>
  );
}

export default function DocMindPreview({ layouts, pageFilter, highlightText }: DocMindPreviewProps) {
  const highlightSnippet = useMemo(() => extractMatchSnippet(highlightText), [highlightText]);
  const pages = useMemo(() => {
    if (!layouts || layouts.length === 0) return [] as Array<{ pageNum: number; layouts: DocMindLayout[] }>;

    // Group by pageNum
    const map = new Map<number, DocMindLayout[]>();
    for (const layout of layouts) {
      const pn = getPageNum(layout);
      if (!map.has(pn)) map.set(pn, []);
      map.get(pn)!.push(layout);
    }

    // Sort pages ascending
    const sortedPages = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);

    // Within each page, sort by vertical position (top Y) then by index
    return sortedPages.map(([pageNum, pageLayouts]) => {
      pageLayouts.sort((a, b) => {
        const yDiff = getTopY(a) - getTopY(b);
        if (Math.abs(yDiff) > 1) return yDiff; // more than 1pt difference
        return (a.index ?? 0) - (b.index ?? 0);
      });
      return { pageNum, layouts: pageLayouts };
    });
  }, [layouts]);

  // pageFilter 是 1-based，转为 0-based 过滤
  const displayPages = pageFilter != null
    ? pages.filter((p) => p.pageNum + 1 === pageFilter)
    : pages;

  if (displayPages.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
        {pageFilter != null ? `暂无第 ${pageFilter} 页版面数据` : "暂无版面解析数据"}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 4px" }}>
      {displayPages.map(({ pageNum, layouts: pageLayouts }) => (
        <PageCard key={pageNum} pageNum={pageNum} layouts={pageLayouts} highlightSnippet={highlightSnippet} />
      ))}
    </div>
  );
}
