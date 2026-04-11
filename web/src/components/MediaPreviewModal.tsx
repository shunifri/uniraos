/**
 * MediaPreviewModal - 图片/表格全屏预览弹窗
 */
import { Modal, Image, Table, Tabs, Typography, Space, Tag } from "antd";
import { FileImageOutlined, TableOutlined, InfoCircleOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

export interface MediaItem {
  type: 'image' | 'table';
  id: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  page?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  // 表格特有
  tableData?: {
    headers: string[];
    rows: string[][];
  };
  // 图片描述（如果有）
  description?: string;
}

interface MediaPreviewModalProps {
  open: boolean;
  items: MediaItem[];
  currentIndex: number;
  onClose: () => void;
  onChangeIndex?: (index: number) => void;
}

export function MediaPreviewModal({
  open,
  items,
  currentIndex,
  onClose,
  onChangeIndex,
}: MediaPreviewModalProps) {
  const currentItem = items[currentIndex];

  if (!currentItem) return null;

  const handlePrev = () => {
    if (currentIndex > 0 && onChangeIndex) {
      onChangeIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1 && onChangeIndex) {
      onChangeIndex(currentIndex + 1);
    }
  };

  // 渲染图片内容
  const renderImageContent = (item: MediaItem) => (
    <div style={{ textAlign: "center", padding: 24 }}>
      <Image
        src={item.url}
        alt={item.title || "图片"}
        style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
        preview={false}
      />
      {item.description && (
        <div style={{ marginTop: 16, padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
          <Text type="secondary">{item.description}</Text>
        </div>
      )}
    </div>
  );

  // 渲染表格内容
  const renderTableContent = (item: MediaItem) => {
    const data = item.tableData;
    if (!data) {
      return (
        <div style={{ padding: 48, textAlign: "center" }}>
          <Text type="secondary">暂无表格数据</Text>
        </div>
      );
    }

    const columns = data.headers.map((header, idx) => ({
      title: header,
      dataIndex: `col${idx}`,
      key: `col${idx}`,
    }));

    const dataSource = data.rows.map((row, rowIdx) => {
      const record: Record<string, string> = { key: String(rowIdx) };
      row.forEach((cell, colIdx) => {
        record[`col${colIdx}`] = cell;
      });
      return record;
    });

    return (
      <div style={{ padding: 24 }}>
        <Table
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          size="small"
          bordered
          scroll={{ x: "max-content" }}
        />
      </div>
    );
  };

  // 渲染信息面板
  const renderInfoPanel = (item: MediaItem) => (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <div>
          <Text type="secondary">类型:</Text>
          <Tag icon={item.type === 'image' ? <FileImageOutlined /> : <TableOutlined />} style={{ marginLeft: 8 }}>
            {item.type === 'image' ? '图片' : '表格'}
          </Tag>
        </div>
        {item.page && (
          <div>
            <Text type="secondary">页码:</Text>
            <Text style={{ marginLeft: 8 }}>第 {item.page} 页</Text>
          </div>
        )}
        {item.bbox && (
          <div>
            <Text type="secondary">位置:</Text>
            <Text style={{ marginLeft: 8 }}>
              ({Math.round(item.bbox.x)}, {Math.round(item.bbox.y)}) -
              ({Math.round(item.bbox.x + item.bbox.w)}, {Math.round(item.bbox.y + item.bbox.h)})
            </Text>
          </div>
        )}
        <div>
          <Text type="secondary">ID:</Text>
          <Text code style={{ marginLeft: 8, fontSize: 12 }}>{item.id}</Text>
        </div>
      </Space>
    </div>
  );

  const items_tabs = [
    {
      key: 'content',
      label: item.type === 'image' ? '图片' : '表格',
      children: item.type === 'image' ? renderImageContent(item) : renderTableContent(item),
    },
    {
      key: 'info',
      label: <><InfoCircleOutlined /> 信息</>,
      children: renderInfoPanel(item),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      centered
      bodyStyle={{ padding: 0 }}
      title={
        <Space>
          {currentItem.type === 'image' ? <FileImageOutlined /> : <TableOutlined />}
          <span>{currentItem.title || `${currentItem.type === 'image' ? '图片' : '表格'} ${currentIndex + 1}/${items.length}`}</span>
        </Space>
      }
    >
      <Tabs items={items_tabs} />
      
      {/* 底部导航 */}
      {items.length > 1 && (
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          padding: "12px 24px",
          borderTop: "1px solid #f0f0f0",
          background: "#fafafa",
        }}>
          <span
            onClick={handlePrev}
            style={{ 
              cursor: currentIndex > 0 ? "pointer" : "not-allowed",
              color: currentIndex > 0 ? "#1890ff" : "#ccc",
              userSelect: "none",
            }}
          >
            ← 上一个
          </span>
          <Text type="secondary">
            {currentIndex + 1} / {items.length}
          </Text>
          <span
            onClick={handleNext}
            style={{ 
              cursor: currentIndex < items.length - 1 ? "pointer" : "not-allowed",
              color: currentIndex < items.length - 1 ? "#1890ff" : "#ccc",
              userSelect: "none",
            }}
          >
            下一个 →
          </span>
        </div>
      )}
    </Modal>
  );
}

export default MediaPreviewModal;
