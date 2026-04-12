import { useState } from "react";
import { Card, Input, Tag, Flex, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";

const Text = Typography.Text;
import { useI18nStore } from "@/i18n";
import { pageImageUrl } from "@/api";
import type { SearchResult } from "./types";

interface SearchSectionProps {
  searchQuery: string;
  searching: boolean;
  results: SearchResult[];
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onViewDoc: (docId: string, docName: string) => void;
}

/** 在页面图片上叠加黄色高亮矩形 */
function HighlightedPageImage({ docId, page, bboxes }: {
  docId: string;
  page: number;
  bboxes: Array<{ page: number; bbox: [number, number, number, number] }>;
}) {
  const pageBboxes = bboxes.filter((b) => b.page === page);
  return (
    <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
      <img
        src={pageImageUrl(docId, page)}
        alt={`第 ${page} 页`}
        style={{ width: "100%", height: "auto", display: "block" }}
        loading="lazy"
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

export default function SearchSection({
  searchQuery,
  searching,
  results,
  onQueryChange,
  onSearch,
  onViewDoc,
}: SearchSectionProps) {
  const t = useI18nStore((s) => s.t);

  return (
    <Card size="small" title={t("kb_search")}>
      <Input.Search
        placeholder={t("kb_search_hint")}
        enterButton={<SearchOutlined />}
        value={searchQuery}
        onChange={(e) => onQueryChange(e.target.value)}
        onSearch={onSearch}
        loading={searching}
        style={{ marginBottom: 12 }}
      />
      {results.length > 0 && (
        <div style={{ maxHeight: 500, overflow: "auto" }}>
          {results.map((r, i) => {
            const hasBbox = r.bboxes && r.bboxes.length > 0 && r.docId;
            const hasPage = r.pageNumber != null && r.docId;
            return (
              <Card key={i} size="small" style={{ marginBottom: 8 }}>
                <Flex justify="space-between" align="center">
                  <Text
                    strong
                    style={{ fontSize: 13, cursor: r.docId ? "pointer" : "default", color: r.docId ? "#1677ff" : undefined }}
                    onClick={r.docId ? () => onViewDoc(r.docId!, r.docName) : undefined}
                  >
                    {r.docName}
                  </Text>
                  <Flex gap={4}>
                    {r.pageNumber != null && <Tag>第 {r.pageNumber} 页</Tag>}
                    <Tag color="blue">{(r.score * 100).toFixed(0)}%</Tag>
                  </Flex>
                </Flex>
                {hasBbox ? (
                  <div style={{ marginTop: 8, borderRadius: 6, overflow: "hidden", border: "1px solid var(--ant-color-border)", maxHeight: 200 }}>
                    {[...new Set(r.bboxes!.map((b) => b.page))].slice(0, 1).map((page) => (
                      <HighlightedPageImage key={page} docId={r.docId!} page={page} bboxes={r.bboxes!} />
                    ))}
                  </div>
                ) : hasPage ? (
                  <div style={{ marginTop: 8, borderRadius: 6, overflow: "hidden", border: "1px solid var(--ant-color-border)", maxHeight: 200 }}>
                    <img src={pageImageUrl(r.docId ?? '', r.pageNumber!)} alt={`第 ${r.pageNumber} 页`} style={{ width: "100%", height: "auto", display: "block" }} loading="lazy" />
                  </div>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>{r.content?.slice(0, 200)}</Text>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}
