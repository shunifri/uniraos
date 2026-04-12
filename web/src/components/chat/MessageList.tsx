import { useState, useEffect } from "react";
import { Flex, Typography, Button, Spin, Drawer, Segmented } from "antd";
import { Bubble } from "@ant-design/x";
import { XMarkdown } from "@ant-design/x-markdown";
import ReactECharts from "echarts-for-react";
import { UserOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { apiFetch } from "@/api";
import { HighlightedPageImage } from "./utils";
import MessageBubble from "./MessageBubble";
import { markdownComponents } from "./MarkdownConfig";
import type { ChatMsg, KbReference } from "./types";

const { Text } = Typography;

interface MessageListProps {
  messages: ChatMsg[];
  hasMore: boolean;
  loadingMore: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  confirmedCards: Set<string>;
  mdPreviews: Record<string, string>;
  onScroll: () => void;
  onLoadOlderMessages: () => void;
  onConfirmCard: (cardId: string, confirmed: boolean) => void;
  onViewKbDoc: (docId: string, docName: string) => void;
}

export default function MessageList({
  messages,
  hasMore,
  loadingMore,
  scrollContainerRef,
  messagesEndRef,
  confirmedCards,
  mdPreviews,
  onScroll,
  onLoadOlderMessages,
  onConfirmCard,
  onViewKbDoc,
}: MessageListProps) {
  const t = useI18nStore((s) => s.t);

  const [viewingRefs, setViewingRefs] = useState<KbReference[] | null>(null);
  const [viewingRefIndex, setViewingRefIndex] = useState<number | null>(null);
  const [refViewMode, setRefViewMode] = useState<"auto" | "text">("auto");
  const [refDocPages, setRefDocPages] = useState<Record<string, number[]>>({});
  const [kbDocView, setKbDocView] = useState<{ docId: string; name: string; content: string } | null>(null);
  const [kbDocViewTab, setKbDocViewTab] = useState<"markdown" | "images">("markdown");
  const [kbDocPageImages, setKbDocPageImages] = useState<number[]>([]);
  const [kbDocViewLoading, setKbDocViewLoading] = useState(false);

  const handleInternalViewKbDoc = async (docId: string, docName: string) => {
    setKbDocViewLoading(true);
    setKbDocPageImages([]);
    setKbDocView({ docId, name: docName, content: "" });
    try {
      const [contentRes, pagesRes] = await Promise.all([
        apiFetch(`/api/knowledge/documents/${docId}/content`),
        apiFetch(`/api/knowledge/documents/${docId}/pages`),
      ]);
      const contentData = await contentRes.json();
      const pagesData = await pagesRes.json();
      setKbDocView({ docId, name: docName, content: contentData.success ? (contentData.content || "(无内容)") : `加载失败: ${contentData.error}` });
      if (pagesData.success && pagesData.pages?.length > 0) {
        setKbDocPageImages(pagesData.pages);
        setKbDocViewTab("images");
      } else {
        setKbDocViewTab("markdown");
      }
    } catch (e: any) {
      setKbDocView({ docId, name: docName, content: `加载失败: ${e.message}` });
      setKbDocViewTab("markdown");
    }
    setKbDocViewLoading(false);
  };

  return (
    <>
      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        {/* 加载更多指示器 */}
        {hasMore && (
          <Flex justify="center" style={{ padding: "8px 0" }}>
            {loadingMore ? <Spin size="small" /> : (
              <Button type="link" size="small" onClick={onLoadOlderMessages}>加载更早消息</Button>
            )}
          </Flex>
        )}

        {messages.length === 0 && !hasMore && (
          <div className="chat-empty" style={{ textAlign: "center", margin: "auto" }}>
            <img src="/ai-avatar.png" alt="AI" style={{ width: 72, height: 72, borderRadius: 20, margin: "0 auto 20px", display: "block", boxShadow: "0 8px 32px rgba(139, 92, 246, 0.25)" }} />
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              <span className="text-gradient">RAOS 智能助手</span>
            </div>
            <div style={{ color: "#94A3B8", fontSize: 14 }}>有什么我可以帮你的？</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id ?? `m${i}`}
            msg={msg}
            confirmedCards={confirmedCards}
            mdPreviews={mdPreviews}
            onViewKbDoc={onViewKbDoc ?? handleInternalViewKbDoc}
            onConfirmCard={onConfirmCard}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* KB Document Drawer */}
      <Drawer
        title={kbDocView?.name}
        open={!!kbDocView}
        onClose={() => setKbDocView(null)}
        width="80%"
        extra={
          kbDocPageImages.length > 0 ? (
            <Segmented
              value={kbDocViewTab}
              onChange={(v) => setKbDocViewTab(v as any)}
              options={[
                { label: "图片", value: "images" },
                { label: "文本", value: "markdown" },
              ]}
            />
          ) : undefined
        }
      >
        {kbDocViewLoading && <Spin spinning />}
        {!kbDocViewLoading && kbDocView && (
          <>
            {kbDocViewTab === "images" && kbDocPageImages.length > 0 && (
              <Flex vertical gap={16}>
                {kbDocPageImages.map((page) => (
                  <div key={page} style={{ maxWidth: 800, margin: "0 auto" }}>
                    <HighlightedPageImage docId={kbDocView.docId} page={page} bboxes={[]} />
                  </div>
                ))}
              </Flex>
            )}
            {kbDocViewTab === "markdown" && (
              <XMarkdown content={kbDocView.content} components={markdownComponents} />
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
