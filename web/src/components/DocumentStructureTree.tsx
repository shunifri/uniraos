/**
 * DocumentStructureTree - 文档结构树组件
 * 显示文档的层级结构（标题、章节）
 */
import { useState, useMemo } from "react";
import { Tree, Tag, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  FileTextOutlined,
  PictureOutlined,
  TableOutlined,
  VideoCameraOutlined,
  AudioOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

export interface LayoutNode {
  id: string;
  type: string;
  subType?: string;
  page: number;
  text: string;
  level: number;
}

export interface MediaItem {
  id: string;
  page: number;
  url?: string;
  type: 'image' | 'table';
}

interface DocumentStructureTreeProps {
  layouts: LayoutNode[];
  images: MediaItem[];
  tables: MediaItem[];
  mediaType?: 'document' | 'video' | 'audio';
  selectedKey?: string;
  onSelect?: (key: string, node: LayoutNode | null, type: 'layout' | 'image' | 'table' | 'media') => void;
}

export function DocumentStructureTree({
  layouts,
  images,
  tables,
  mediaType = 'document',
  selectedKey,
  onSelect,
}: DocumentStructureTreeProps) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>(['root', 'images', 'tables']);

  // 构建树形数据
  const treeData = useMemo((): DataNode[] => {
    const nodes: DataNode[] = [];

    // 根节点：文档结构
    const layoutNodes: DataNode[] = [];
    let currentParent: DataNode | null = null;
    const parentStack: DataNode[] = [];

    for (const layout of layouts) {
      const node: DataNode = {
        key: `layout-${layout.id}`,
        title: (
          <span>
            <Text ellipsis style={{ maxWidth: 180 }}>{layout.text.slice(0, 50)}</Text>
            <Tag size="small" style={{ marginLeft: 4, fontSize: 10 }}>p{layout.page}</Tag>
          </span>
        ),
        icon: <FileTextOutlined />,
        isLeaf: true,
      };

      // 根据 level 确定层级关系
      if (layout.level === 0 || layout.type === 'title') {
        // 顶级节点
        layoutNodes.push(node);
        currentParent = node;
        parentStack.length = 0;
        parentStack.push(node);
      } else {
        // 找到合适的父节点
        while (parentStack.length > 0) {
          const lastParent = parentStack[parentStack.length - 1];
          // 这里简化处理，实际应该比较 level
          if (!lastParent.children) {
            lastParent.children = [];
          }
          lastParent.children.push(node);
          break;
        }
      }
    }

    nodes.push({
      key: 'root',
      title: <Text strong>📑 文档结构</Text>,
      children: layoutNodes.length > 0 ? layoutNodes : undefined,
      selectable: false,
    });

    // 图片列表节点
    if (images.length > 0) {
      nodes.push({
        key: 'images',
        title: (
          <span>
            <PictureOutlined style={{ marginRight: 4 }} />
            <Text strong>图片列表</Text>
            <Tag size="small" style={{ marginLeft: 4 }}>{images.length}</Tag>
          </span>
        ),
        children: images.map((img, idx) => ({
          key: `image-${img.id}`,
          title: (
            <span>
              <Text ellipsis style={{ maxWidth: 140 }}>图片 {idx + 1}</Text>
              <Tag size="small" style={{ marginLeft: 4, fontSize: 10 }}>p{img.page}</Tag>
            </span>
          ),
          icon: <PictureOutlined />,
          isLeaf: true,
        })),
        selectable: false,
      });
    }

    // 表格列表节点
    if (tables.length > 0) {
      nodes.push({
        key: 'tables',
        title: (
          <span>
            <TableOutlined style={{ marginRight: 4 }} />
            <Text strong>表格列表</Text>
            <Tag size="small" style={{ marginLeft: 4 }}>{tables.length}</Tag>
          </span>
        ),
        children: tables.map((table, idx) => ({
          key: `table-${table.id}`,
          title: (
            <span>
              <Text ellipsis style={{ maxWidth: 140 }}>表格 {idx + 1}</Text>
              <Tag size="small" style={{ marginLeft: 4, fontSize: 10 }}>p{table.page}</Tag>
            </span>
          ),
          icon: <TableOutlined />,
          isLeaf: true,
        })),
        selectable: false,
      });
    }

    // 音视频片段节点
    if (mediaType === 'video' || mediaType === 'audio') {
      nodes.push({
        key: 'media',
        title: (
          <span>
            {mediaType === 'video' ? <VideoCameraOutlined /> : <AudioOutlined />}
            <Text strong style={{ marginLeft: 4 }}>媒体片段</Text>
          </span>
        ),
        selectable: false,
      });
    }

    return nodes;
  }, [layouts, images, tables, mediaType]);

  const handleSelect = (selectedKeys: React.Key[], info: any) => {
    if (selectedKeys.length > 0 && onSelect) {
      const key = String(selectedKeys[0]);
      
      if (key.startsWith('layout-')) {
        const layoutId = key.replace('layout-', '');
        const layout = layouts.find(l => l.id === layoutId) || null;
        onSelect(key, layout, 'layout');
      } else if (key.startsWith('image-')) {
        onSelect(key, null, 'image');
      } else if (key.startsWith('table-')) {
        onSelect(key, null, 'table');
      } else if (key === 'media') {
        onSelect(key, null, 'media');
      }
    }
  };

  return (
    <Tree
      showIcon
      defaultExpandAll
      expandedKeys={expandedKeys}
      onExpand={setExpandedKeys}
      selectedKeys={selectedKey ? [selectedKey] : []}
      onSelect={handleSelect}
      treeData={treeData}
      style={{ 
        background: "transparent",
        padding: "8px 0",
      }}
      blockNode
    />
  );
}

export default DocumentStructureTree;
