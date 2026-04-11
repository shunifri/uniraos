/**
 * MediaGallery - 媒体画廊组件
 * 网格展示文档中的图片和表格
 */
import { useState } from "react";
import { Card, Image, Typography, Space, Tag, Empty, Tabs } from "antd";
import { PictureOutlined, TableOutlined } from "@ant-design/icons";
import { MediaPreviewModal, type MediaItem } from "./MediaPreviewModal";

const { Text } = Typography;
const { TabPane } = Tabs;

interface MediaGalleryProps {
  images: MediaItem[];
  tables: MediaItem[];
  title?: string;
}

export function MediaGallery({ images, tables, title = "媒体列表" }: MediaGalleryProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'images' | 'tables'>('images');

  const allItems = [...images, ...tables];

  const handleOpenPreview = (index: number, type: 'images' | 'tables') => {
    setActiveTab(type);
    // 计算全局索引
    let globalIndex = index;
    if (type === 'tables') {
      globalIndex = images.length + index;
    }
    setPreviewIndex(globalIndex);
    setPreviewOpen(true);
  };

  // 渲染图片画廊
  const renderImageGallery = () => {
    if (images.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无图片"
        />
      );
    }

    return (
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 16,
        padding: 16,
      }}>
        {images.map((img, idx) => (
          <Card
            key={img.id}
            size="small"
            hoverable
            onClick={() => handleOpenPreview(idx, 'images')}
            cover={
              <div style={{ 
                height: 120, 
                overflow: "hidden",
                background: "#f5f5f5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Image
                  src={img.thumbnailUrl || img.url}
                  alt={img.title || `图片 ${idx + 1}`}
                  preview={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                />
              </div>
            }
          >
            <Card.Meta
              title={
                <Text ellipsis style={{ fontSize: 12 }}>
                  {img.title || `图片 ${idx + 1}`}
                </Text>
              }
              description={
                <Tag size="small" style={{ fontSize: 10 }}>
                  第 {img.page} 页
                </Tag>
              }
            />
          </Card>
        ))}
      </div>
    );
  };

  // 渲染表格列表
  const renderTableList = () => {
    if (tables.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无表格"
        />
      );
    }

    return (
      <Space direction="vertical" style={{ width: "100%", padding: 16 }}>
        {tables.map((table, idx) => (
          <Card
            key={table.id}
            size="small"
            hoverable
            onClick={() => handleOpenPreview(idx, 'tables')}
          >
            <Space>
              <TableOutlined style={{ fontSize: 24, color: "#1890ff" }} />
              <div>
                <Text strong>{table.title || `表格 ${idx + 1}`}</Text>
                <div>
                  <Tag size="small" style={{ fontSize: 10 }}>
                    第 {table.page} 页
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    点击查看详情
                  </Text>
                </div>
              </div>
            </Space>
          </Card>
        ))}
      </Space>
    );
  };

  // 如果没有内容，显示空状态
  if (images.length === 0 && tables.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无媒体内容"
      />
    );
  }

  return (
    <>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'images' | 'tables')}
        style={{ padding: "0 16px" }}
      >
        {images.length > 0 && (
          <TabPane
            tab={
              <span>
                <PictureOutlined />
                图片 ({images.length})
              </span>
            }
            key="images"
          >
            {renderImageGallery()}
          </TabPane>
        )}
        {tables.length > 0 && (
          <TabPane
            tab={
              <span>
                <TableOutlined />
                表格 ({tables.length})
              </span>
            }
            key="tables"
          >
            {renderTableList()}
          </TabPane>
        )}
      </Tabs>

      {/* 预览弹窗 */}
      <MediaPreviewModal
        open={previewOpen}
        items={allItems}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        onChangeIndex={setPreviewIndex}
      />
    </>
  );
}

export default MediaGallery;
