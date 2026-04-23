import { useState } from "react";
import { Table, Tag, Space, Button, Popconfirm, Card, Switch, Typography } from "antd";
import { EyeOutlined, DeleteOutlined, LoadingOutlined, ReloadOutlined, ShareAltOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import type { ColumnsType } from "antd/es/table";
import type { KBDocument } from "./types";

const Text = Typography.Text;

interface DocumentTableProps {
  documents: KBDocument[];
  loading: boolean;
  onRefresh: () => void;
  onRebuild: () => void;
  rebuilding: boolean;
  onDelete: (docId: string) => void;
  onOpenShare: (doc: KBDocument) => void;
  onViewDoc: (docId: string, docName: string) => void;
}

export default function DocumentTable({
  documents,
  loading,
  onRefresh,
  onRebuild,
  rebuilding,
  onDelete,
  onOpenShare,
  onViewDoc,
}: DocumentTableProps) {
  const t = useI18nStore((s) => s.t);

  const columns: ColumnsType<KBDocument> = [
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, record: KBDocument) => (
        <Text
          strong
          style={{ fontSize: 13, cursor: "pointer", color: "#1677ff" }}
          onClick={() => onViewDoc(record.id, name)}
        >
          {name}
        </Text>
      ),
    },
    {
      title: t("kb_tags"),
      dataIndex: "tags",
      key: "tags",
      render: (tags: string[]) => (
        <Space size={2} wrap>
          {(tags || []).map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>)}
        </Space>
      ),
    },
    {
      title: t("kb_chunks"),
      dataIndex: "chunkCount",
      key: "chunkCount",
      width: 120,
      align: "center",
      render: (count: number, record: KBDocument) => {
        if (record.parsingStatus === 'processing' || (count === 0 && record.parsingStatus !== 'failed')) {
          const progress = record.parsingProgress ?? 0;
          return (
            <div style={{ minWidth: 80 }}>
              <Tag icon={<LoadingOutlined />} color="processing">
                {progress > 0 ? `${Math.round(progress)}%` : '解析中'}
              </Tag>
              {progress > 0 && (
                <div style={{ marginTop: 4, height: 3, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: '#1890ff', transition: 'width 0.3s' }} />
                </div>
              )}
            </div>
          );
        }
        if (record.parsingStatus === 'failed') {
          return <Tag color="error">解析失败</Tag>;
        }
        if (record.parsingStatus === 'pending') {
          return <Tag icon={<LoadingOutlined />} color="default">等待中</Tag>;
        }
        return count;
      },
    },
    {
      title: t("kb_vector_status"),
      key: "vectorStatus",
      width: 120,
      render: (_: any, record: KBDocument) => {
        const total = record.vectorTotal ?? 0;
        const done = record.vectorized ?? 0;
        if (total === 0) return <Tag>{t("kb_vector_none")}</Tag>;
        if (done >= total) return <Tag color="success">{t("kb_vector_ready")}</Tag>;
        return <Tag icon={<LoadingOutlined />} color="processing">{done}/{total}</Tag>;
      },
    },
    {
      title: t("kb_shared"),
      key: "shared",
      width: 80,
      render: (_: any, record: KBDocument) => (
        <div onClick={e => e.stopPropagation()}>
          <Button
            type="text"
            size="small"
            icon={<ShareAltOutlined />}
            onClick={() => onOpenShare(record)}
          />
        </div>
      ),
    },
    {
      title: t("actions"),
      key: "actions",
      width: 110,
      render: (_: any, record: KBDocument) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => onViewDoc(record.id, record.name)} />
          <Popconfirm title={t("confirm")} onConfirm={() => onDelete(record.id)}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      className="glass-card"
      title={t("kb_documents")}
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>{t("refresh")}</Button>
          <Button size="small" icon={<ReloadOutlined />} loading={rebuilding} onClick={onRebuild}>{t("kb_rebuild")}</Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={documents}
        rowKey="id"
        size="small"
        loading={loading}
        pagination={{ pageSize: 20 }}
      />
    </Card>
  );
}
