/**
 * DocumentPreviewDrawer - 文档预览抽屉
 * 左侧树形结构 + 右侧内容区域
 */
import { useState, useEffect, useCallback } from "react";
import { Drawer, Tabs, Typography, Spin, Empty, Segmented, Alert } from "antd";
import { FileTextOutlined, PictureOutlined, LayoutOutlined } from "@ant-design/icons";
import { DocumentStructureTree, type LayoutNode } from "./DocumentStructureTree";
import { MediaGallery } from "./MediaGallery";
import { api } from "@/api";

const { Title, Text } = Typography;
const { TabPane } = Tabs;

interface DocumentPreviewDrawerProps {
  open: boolean;
  docId: string;
  docName: string;
  onClose: () => void;
}

interface LayoutData {
  id: string;
  type: string;
  subType?: string;
  page: number;
  text: string;
  level: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

interface MediaItem {
  id: string;
  page: number;
  url: string;
  type: 'image' | 'table';
  title?: string;
}

export function DocumentPreviewDrawer({
  open,
  docId,
  docName,
  onClose,
}: DocumentPreviewDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layouts, setLayouts] = useState<LayoutData[]>([]);
  const [images, setImages] = useState<MediaItem[]>([]);
  const [tables, setTables] = useState<MediaItem[]>([]);
  const [mediaType, setMediaType] = useState<'document' | 'video' | 'audio'>('document');
  const [pageCount, setPageCount] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'layout' | 'markdown' | 'media'>('layout');
  const [parsedContent, setParsedContent] = useState<string>("");

  // 加载文档数据
  useEffect(() => {
    if (!open || !docId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        // 并行加载版面数据和内容
        const [layoutsRes, contentRes] = await Promise.all([
          api.get<any>(`/api/knowledge/documents/${docId}/layouts`),
          api.get<any>(`/api/knowledge/documents/${docId}/content`),
        ]);

        if (layoutsRes.success) {
          setLayouts(layoutsRes.layouts || []);
          setImages((layoutsRes.mediaItems?.images || []).map((img: any) => ({
            ...img,
            type: 'image' as const,
            title: `图片`,
          })));
          setTables((layoutsRes.mediaItems?.tables || []).map((table: any) => ({
            ...table,
            type: 'table' as const,
            title: `表格`,
          })));
          setMediaType(layoutsRes.mediaType || 'document');
          setPageCount(layoutsRes.pageCount || 0);
        }

        if (contentRes.success) {
          setParsedContent(contentRes.content || "");
        }
      } catch (e: any) {
        setError(e.message || "加载失败");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [open, docId]);

  // 处理树节点选择
  const handleTreeSelect = useCallback((key: string, node: LayoutNode | null, type: 'layout' | 'image' | 'table' | 'media') => {
    setSelectedKey(key);
    
    if (type === 'layout' && node) {
      setCurrentPage(node.page);
    } else if (type === 'image' || type === 'table') {
      // 切换到媒体视图
      // 这里可以添加更多逻辑
    }
  }, []);

  // 渲染原始版面视图
  const renderLayoutView = () => {
    if (loading) {
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin size="large" />
        </div>
      );
    }

    if (error) {
      return (
        <Alert
          type="error"
          message="加载失败"
          description={error}
          style={{ margin: 24 }}
        />
      );
    }

    // 如果没有版面数据，提示使用 Markdown 视图
    if (layouts.length === 0 && !loading) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无版面数据，请切换到 Markdown 视图"
          style={{ marginTop: 48 }}
        />
      );
    }

    return (
      <div style={{ padding: 24 }}>
        <Title level={5} style={{ marginBottom: 16 }}>
          📄 第 {currentPage} 页 / 共 {pageCount} 页
        </Title>
        
        {/* 这里将来可以添加页面图片和 bbox 高亮 */}
        <Alert
          type="info"
          message="版面视图"
          description="显示文档原始版面结构（开发中）"
          showIcon
        />
        
        <div style={{ marginTop: 16 }}>
          <Text type="secondary">该文档包含：</Text>
          <ul style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>{layouts.length} 个版面元素</li>
            <li>{images.length} 张图片</li>
            <li>{tables.length} 个表格</li>
          </ul>
        </div>
      </div>
    );
  };

  // 渲染 Markdown 视图
  const renderMarkdownView = () => {
    if (loading) {
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin size="large" />
        </div>
      );
    }

    return (
      <div style={{ padding: 24 }}>
        <div 
          className="markdown-body"
          style={{ 
            background: "#fff",
            padding: 24,
            borderRadius: 8,
            minHeight: 400,
          }}
        >
          {parsedContent ? (
            <pre style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
              {parsedContent}
            </pre>
          ) : (
            <Empty description="暂无解析内容" />
          )}
        </div>
      </div>
    );
  };

  // 渲染媒体画廊视图
  const renderMediaView = () => {
    return (
      <MediaGallery
        images={images}
        tables={tables}
        title="媒体列表"
      />
    );
  };

  return (
    <Drawer
      title={
        <Title level={4} style={{ margin: 0 }}>
          <FileTextOutlined style={{ marginRight: 8 }} />
          {docName}
        </Title>
      }
      open={open}
      onClose={onClose}
      width={900}
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ display: "flex", height: "100%" }}>
        {/* 左侧树形结构 */}
        <div
          style={{
            width: 260,
            borderRight: "1px solid #f0f0f0",
            overflow: "auto",
            background: "#fafafa",
          }}
        >
          {loading ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <Spin />
            </div>
          ) : (
            <DocumentStructureTree
              layouts={layouts}
              images={images}
              tables={tables}
              mediaType={mediaType}
              selectedKey={selectedKey}
              onSelect={handleTreeSelect}
            />
          )}
        </div>

        {/* 右侧内容区域 */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {/* 视图切换 */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0" }}>
            <Segmented
              value={viewMode}
              onChange={(v) => setViewMode(v as 'layout' | 'markdown' | 'media')}
              options={[
                { 
                  label: <><LayoutOutlined /> 版面视图</>, 
                  value: 'layout',
                  disabled: layouts.length === 0,
                },
                { 
                  label: <><FileTextOutlined /> Markdown</>, 
                  value: 'markdown',
                },
                ...(images.length > 0 || tables.length > 0 ? [{
                  label: <><PictureOutlined /> 媒体 ({images.length + tables.length})</>,
                  value: 'media' as const,
                }] : []),
              ]}
            />
          </div>

          {/* 内容区域 */}
          <div>
            {viewMode === 'layout' && renderLayoutView()}
            {viewMode === 'markdown' && renderMarkdownView()}
            {(images.length > 0 || tables.length > 0) && viewMode === 'media' && renderMediaView()}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

export default DocumentPreviewDrawer;
