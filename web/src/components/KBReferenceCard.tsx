/**
 * KBReferenceCard - AI 回复中的知识库引用卡片
 * 显示文本内容和关联的图片/表格缩略图
 */
import { useState, useMemo } from "react";
import { Card, Typography, Space, Tag, Image, Tooltip, Divider } from "antd";
import { FileTextOutlined, FileImageOutlined, TableOutlined, EyeOutlined } from "@ant-design/icons";
import { MediaPreviewModal, type MediaItem } from "./MediaPreviewModal";

const { Text, Paragraph } = Typography;

const MAX_THUMBNAILS = 4;
const THUMBNAIL_SIZE = 80;
const CONTENT_TRUNCATE_LENGTH = 200;

export interface KBReferenceData {
  docId: string;
  docName: string;
  pageNumber?: number;
  content: string;
  score?: number;
  mediaItems: MediaItem[];
}

interface KBReferenceCardProps {
  data: KBReferenceData;
  onViewDocument?: (docId: string, page?: number) => void;
}

export function KBReferenceCard({ data, onViewDocument }: KBReferenceCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const { docId, docName, pageNumber, content, score, mediaItems } = data;

  // 预计算 ID -> 全局索引映射，避免 O(n×m) 查找
  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    mediaItems.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [mediaItems]);

  // 分类媒体项
  const imageItems = useMemo(() => mediaItems.filter(item => item.type === 'image'), [mediaItems]);
  const tableItems = useMemo(() => mediaItems.filter(item => item.type === 'table'), [mediaItems]);

  const handleOpenPreview = (index: number) => {
    setPreviewIndex(index);
    setPreviewOpen(true);
  };

  const handleViewDoc = () => {
    if (onViewDocument) {
      onViewDocument(docId, pageNumber);
    }
  };

  // 截取内容显示（防御性处理）
  const safeContent = content ?? "";
  const truncatedContent = safeContent.length > CONTENT_TRUNCATE_LENGTH
    ? safeContent.slice(0, CONTENT_TRUNCATE_LENGTH) + "..."
    : safeContent;

  return (
    <>
      <Card
        size="small"
        className="kb-reference-card"
        style={{ 
          margin: "8px 0",
          borderLeft: "3px solid #1890ff",
          background: "#fafafa",
        }}
        title={
          <Space>
            <FileTextOutlined style={{ color: "#1890ff" }} />
            <Text strong style={{ fontSize: 14 }}>{docName}</Text>
            {pageNumber != null && (
              <Tag icon={<EyeOutlined />}>
                第 {pageNumber} 页
              </Tag>
            )}
            {score !== undefined && (
              <Tag color="blue">
                相关度: {(score * 100).toFixed(1)}%
              </Tag>
            )}
          </Space>
        }
        extra={
          onViewDocument && (
            <button
              type="button"
              onClick={handleViewDoc}
              style={{ fontSize: 12, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1890ff" }}
            >
              查看文档 →
            </button>
          )
        }
      >
        {/* 文本内容 */}
        <Paragraph 
          style={{ 
            margin: 0, 
            fontSize: 13,
            color: "#333",
            lineHeight: 1.6,
          }}
        >
          {truncatedContent}
        </Paragraph>

        {/* 媒体项缩略图 */}
        {(imageItems.length > 0 || tableItems.length > 0) && (
          <>
            <Divider style={{ margin: "12px 0" }} />
            
            {/* 图片缩略图 */}
            {imageItems.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                  <FileImageOutlined /> 相关图片 ({imageItems.length})
                </Text>
                <Space wrap>
                  {imageItems.slice(0, MAX_THUMBNAILS).map((item, idx) => {
                    const globalIndex = indexMap.get(item.id) ?? 0;
                    return (
                      <Tooltip key={item.id} title={item.title || `图片 ${idx + 1}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`预览图片 ${item.title || idx + 1}`}
                          onClick={() => handleOpenPreview(globalIndex)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenPreview(globalIndex); } }}
                          className="kb-thumb"
                          style={{
                            width: THUMBNAIL_SIZE,
                            height: THUMBNAIL_SIZE,
                            borderRadius: 4,
                            overflow: "hidden",
                            cursor: "pointer",
                            border: "1px solid #d9d9d9",
                            position: "relative",
                          }}
                        >
                          <Image
                            src={item.thumbnailUrl || item.url}
                            alt={item.title || "图片"}
                            preview={false}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              transition: "transform 0.3s ease",
                            }}
                          />
                          {item.page != null && (
                            <div
                              style={{
                                position: "absolute",
                                bottom: 0,
                                right: 0,
                                background: "rgba(0,0,0,0.6)",
                                color: "#fff",
                                fontSize: 10,
                                padding: "2px 6px",
                                borderRadius: "4px 0 0 0",
                              }}
                            >
                              p{item.page}
                            </div>
                          )}
                        </div>
                      </Tooltip>
                    );
                  })}
                  {imageItems.length > MAX_THUMBNAILS && (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="查看更多图片"
                      onClick={() => handleOpenPreview(0)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleOpenPreview(0); }}
                      style={{
                        width: THUMBNAIL_SIZE,
                        height: THUMBNAIL_SIZE,
                        borderRadius: 4,
                        background: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        border: "1px solid #d9d9d9",
                      }}
                    >
                      <Text type="secondary">+{imageItems.length - MAX_THUMBNAILS}</Text>
                    </div>
                  )}
                </Space>
              </div>
            )}

            {/* 表格标签 */}
            {tableItems.length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                  <TableOutlined /> 相关表格 ({tableItems.length})
                </Text>
                <Space wrap>
                  {tableItems.map((item, idx) => {
                    const globalIndex = indexMap.get(item.id) ?? 0;
                    return (
                      <Tag
                        key={item.id}
                        icon={<TableOutlined />}
                        color="processing"
                        style={{ cursor: "pointer" }}
                        tabIndex={0}
                        role="button"
                        aria-label={`预览表格 ${item.title || idx + 1}`}
                        onClick={() => handleOpenPreview(globalIndex)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleOpenPreview(globalIndex); }}
                      >
                        {item.title || `表格 ${idx + 1}`}
                        {item.page != null && ` (p${item.page})`}
                      </Tag>
                    );
                  })}
                </Space>
              </div>
            )}
          </>
        )}
      </Card>

      {/* 预览弹窗 */}
      <MediaPreviewModal
        open={previewOpen}
        items={mediaItems}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        onChangeIndex={setPreviewIndex}
      />
    </>
  );
}

export default KBReferenceCard;
