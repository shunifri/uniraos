import { Drawer, Segmented, Typography } from "antd";
import SafeXMarkdown from "@/components/SafeXMarkdown";

const Text = Typography.Text;
import { pageImageUrl } from "@/api";

interface DocumentViewerDrawerProps {
  open: boolean;
  doc: { name: string; content: string; docId: string } | null;
  loading: boolean;
  viewTab: "markdown" | "images" | "compare";
  pageImages: number[];
  onClose: () => void;
  onTabChange: (tab: "markdown" | "images" | "compare") => void;
}

export default function DocumentViewerDrawer({
  open,
  doc,
  loading,
  viewTab,
  pageImages,
  onClose,
  onTabChange,
}: DocumentViewerDrawerProps) {
  return (
    <Drawer
      title={doc?.name || "文档内容"}
      open={open}
      onClose={onClose}
      placement="right"
      width={viewTab === "compare" ? 960 : 600}
      loading={loading}
      extra={
        pageImages.length > 0 ? (
          <Segmented
            size="small"
            value={viewTab}
            onChange={(v) => onTabChange(v as any)}
            options={[
              { label: "解析内容", value: "markdown" },
              { label: "原始页面", value: "images" },
              { label: "对照视图", value: "compare" },
            ]}
          />
        ) : null
      }
    >
      {viewTab === "markdown" && (
         <div style={{ fontSize: 14, lineHeight: 1.8 }}>
           <SafeXMarkdown content={doc?.content || "(无内容)"} />
         </div>
      )}
      {viewTab === "images" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {pageImages.length > 0 ? pageImages.map((page) => (
            <div key={page} style={{ border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "var(--ant-color-bg-layout)", padding: "4px 12px", fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                第 {page} 页
              </div>
              <img
                src={pageImageUrl(doc?.docId ?? '', page)}
                alt={`第 ${page} 页`}
                style={{ width: "100%", height: "auto", display: "block" }}
                loading="lazy"
              />
            </div>
          )) : <Text type="secondary">暂无页面图片</Text>}
        </div>
      )}
      {viewTab === "compare" && (() => {
        const mdPages = (doc?.content || "").split(/\n\n---\n\n/).filter(Boolean);
        const maxPages = Math.max(mdPages.length, pageImages.length);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {Array.from({ length: maxPages }, (_, idx) => (
              <div key={idx} style={{ display: "flex", gap: 16, border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ flex: 1, borderRight: "1px solid var(--ant-color-border)" }}>
                  {idx < pageImages.length ? (
                    <img
                      src={pageImageUrl(doc?.docId ?? '', pageImages[idx])}
                      alt={`第 ${idx + 1} 页`}
                      style={{ width: "100%", height: "auto", display: "block" }}
                      loading="lazy"
                    />
                  ) : <div style={{ padding: 16, color: "var(--ant-color-text-secondary)" }}>无图片</div>}
                </div>
                 <div style={{ flex: 1, padding: 16, fontSize: 13, lineHeight: 1.8 }}>
                   {idx < mdPages.length ? <SafeXMarkdown content={mdPages[idx]} /> : <Text type="secondary">无解析内容</Text>}
                 </div>
              </div>
            ))}
          </div>
        );
      })()}
    </Drawer>
  );
}
