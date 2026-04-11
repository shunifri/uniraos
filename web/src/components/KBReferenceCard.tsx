/**
 * KBReferenceCard - AI 回复中的知识库引用卡片
 * 显示文本内容和关联的图片/表格缩略图
 */
import { useState } from "react";
import { Card, Typography, Space, Tag, Image, Tooltip, Divider } from "antd";
import { FileTextOutlined, FileImageOutlined, TableOutlined, EyeOutlined } from "@ant-design/icons";
import { MediaPreviewModal, type MediaItem } from "./MediaPreviewModal";

const { Text, Paragraph } = Typography;

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

  // 分类媒体项
  const imageItems = mediaItems.filter(item => item.type === 'image');
  const tableItems = mediaItems.filter(item => item.type === 'table');

  const handleOpenPreview = (index: number) => {
    setPreviewIndex(index);
    setPreviewOpen(true);
  };

  const handleViewDoc = () => {
    if (onViewDocument) {
      onViewDocument(docId, pageNumber);
    }
  };

  // 截取内容显示
  const truncatedContent = content.length > 200 
    ? content.slice(0, 200) + "..." 
    : content;

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
            {pageNumber && (
              <Tag size="small" icon={<EyeOutlined />}>
                第 {pageNumber} 页
              </Tag>
            )}
            {score !== undefined && (
              <Tag size="small" color="blue">
                相关度: {(score * 100).toFixed(1)}%
              </Tag>
            )}
          </Space>
        }
        extra={
          onViewDocument && (
            <a onClick={handleViewDoc} style={{ fontSize: 12 }}>
              查看文档 →
            </a>
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
                  {imageItems.slice(0, 4).map((item, idx) => {
                    const globalIndex = mediaItems.findIndex(m => m.id === item.id);
                    return (
                      <Tooltip key={item.id} title={item.title || `图片 ${idx + 1}`}>
                        <div
                          onClick={() => handleOpenPreview(globalIndex)}
                          style={{
                            width: 80,
                            height: 80,
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
                            }}
                          />
                          {item.page && (
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
                  {imageItems.length > 4 && (
                    <div
                      onClick={() => handleOpenPreview(0)}
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 4,
                        background: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        border: "1px solid #d9d9d9",
                      }}
                    >
                      <Text type="secondary">+{imageItems.length - 4}</Text>
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
                    const globalIndex = mediaItems.findIndex(m => m.id === item.id);
                    return (
                      <Tag
                        key={item.id}
                        icon={<TableOutlined />}
                        color="processing"
                        style={{ cursor: "pointer" }}
                        onClick={() => handleOpenPreview(globalIndex)}
                      >
                        {item.title || `表格 ${idx + 1}`}
                        {item.page && ` (p${item.page})`}
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
