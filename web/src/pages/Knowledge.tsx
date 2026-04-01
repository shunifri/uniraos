import { useState, useEffect, useCallback } from "react";
import {
  Flex,
  Card,
  Statistic,
  Row,
  Col,
  Upload,
  Input,
  Button,
  Table,
  Tag,
  Space,
  App,
  Typography,
  Switch,
  Popconfirm,
  Drawer,
  Segmented,
} from "antd";
import {
  UploadOutlined,
  SearchOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  CloudOutlined,
  NumberOutlined,
  LoadingOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { XMarkdown } from "@ant-design/x-markdown";
import { useI18nStore } from "@/i18n";
import { api, apiFetch, pageImageUrl } from "@/api";

const { Text } = Typography;
const { Dragger } = Upload;

interface KBDocument {
  id: string;
  name: string;
  tags: string[];
  chunkCount: number;
  tokenCount?: number;
  createdAt: string;
  version?: number;
  shared?: boolean;
  vectorized?: number;
  vectorTotal?: number;
}

interface SearchResult {
  docName: string;
  docId?: string;
  content: string;
  score: number;
  tags?: string[];
  chunkIndex?: number;
  pageNumber?: number | null;
  bboxes?: Array<{ page: number; bbox: [number, number, number, number] }> | null;
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

export default function KnowledgePage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();

  const [stats, setStats] = useState<any>({});
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importTags, setImportTags] = useState("");
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [viewDoc, setViewDoc] = useState<{ name: string; content: string; docId: string } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewTab, setViewTab] = useState<"markdown" | "images" | "compare">("markdown");
  const [viewPageImages, setViewPageImages] = useState<number[]>([]);

  const handleViewDoc = async (docId: string, docName: string) => {
    setViewLoading(true);
    setViewPageImages([]);
    setViewDoc({ name: docName, content: "", docId });
    try {
      // 并行获取内容和页面图片列表
      const [contentRes, pagesRes] = await Promise.all([
        apiFetch(`/api/knowledge/documents/${docId}/content`),
        apiFetch(`/api/knowledge/documents/${docId}/pages`),
      ]);
      const contentData = await contentRes.json();
      const pagesData = await pagesRes.json();
      if (contentData.success) {
        setViewDoc({ name: docName, content: contentData.content || "(无解析内容)", docId });
      } else {
        setViewDoc({ name: docName, content: `加载失败: ${contentData.error}`, docId });
      }
      if (pagesData.success && pagesData.pages?.length > 0) {
        setViewPageImages(pagesData.pages);
        setViewTab("images"); // 有页面图片时默认显示图片视图
      } else {
        setViewTab("markdown");
      }
    } catch (e: any) {
      setViewDoc({ name: docName, content: `加载失败: ${e.message}`, docId });
    }
    setViewLoading(false);
  };

  const loadStats = useCallback(async () => {
    try {
      const data = await api.get<any>("/api/knowledge/stats");
      if (data.success) setStats(data);
    } catch { /* ignore */ }
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const data = await api.get<any>("/api/knowledge/documents");
      if (data.success) {
        setDocuments(data.documents || []);
      }
    } catch { /* ignore */ }
    setLoadingDocs(false);
  }, []);

  useEffect(() => {
    loadStats();
    loadDocuments();
  }, [loadStats, loadDocuments]);

  // 轮询：有文档正在解析或向量化时每 3 秒刷新
  useEffect(() => {
    const hasParsing = documents.some((d) => d.chunkCount === 0);
    const hasVectorizing = documents.some(
      (d) => d.vectorTotal != null && d.vectorized != null && d.vectorized < d.vectorTotal
    );
    if (!hasParsing && !hasVectorizing) return;
    const timer = setInterval(() => {
      loadDocuments();
      loadStats();
    }, 3000);
    return () => clearInterval(timer);
  }, [documents, loadDocuments, loadStats]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await api.get<any>(`/api/knowledge/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      if (data.success) {
        setSearchResults(data.results || []);
      }
    } catch (e: any) {
      message.error(e.message);
    }
    setSearching(false);
  };

  const handleUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    setImporting(true);
    try {
      // 1. 先上传文件到 workspace（自动去重：内容相同则跳过，同名冲突则覆盖）
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await apiFetch("/api/upload?mode=overwrite", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) {
        throw new Error(uploadData.error || "Upload failed");
      }
      const fileInfo = uploadData.data?.files?.[0];
      if (!fileInfo?.path) throw new Error("No file path returned");
      const filePath = fileInfo.path;
      // 内容完全相同的文件，跳过提示但仍然尝试 ingest（可能之前没入库）
      if (fileInfo.duplicate === "same_content") {
        // 文件层面已去重，继续尝试 KB 入库（如果已入库则 KB 自身会去重）
      }

      // 2. 用文件路径调用知识库导入（后端从 workspace 读取并解析）
      const data = await api.post<any>("/api/knowledge/ingest", {
        name: file.name,
        path: filePath,
        tags: importTags ? importTags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
      });
      if (data.success) {
        if (data.chunkCount === 0 && !data.updated && !data.parsing) {
          message.warning(`"${file.name}" 已存在且内容未变化。如需重新解析，请先删除旧文档再上传。`);
        } else {
          message.success(data.message || `${t("kb_imported")}: ${file.name}`);
        }
        onSuccess?.(data, file);
        loadDocuments();
        loadStats();
      } else {
        message.error(data.error || t("failed"));
        onError?.(new Error(data.error));
      }
    } catch (e: any) {
      message.error(e.message);
      onError?.(e);
    }
    setImporting(false);
  };

  const handleDelete = async (docId: string) => {
    try {
      const data = await api.del<any>(`/api/knowledge/documents/${docId}`);
      if (data.success) {
        message.success(t("deleted"));
        loadDocuments();
        loadStats();
      }
    } catch (e: any) { message.error(e.message); }
  };

  const handleShare = async (docId: string, shared: boolean) => {
    try {
      await api.post<any>("/api/knowledge/share", { docId, shared });
    } catch (e: any) { message.error(e.message); }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const data = await api.post<any>("/api/knowledge/rebuild", {});
      if (data.success) message.success(t("kb_rebuilt"));
      else message.error(data.error);
    } catch (e: any) { message.error(e.message); }
    setRebuilding(false);
  };

  const columns = [
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, record: KBDocument) => (
        <Text
          strong
          style={{ fontSize: 13, cursor: "pointer", color: "#1677ff" }}
          onClick={() => handleViewDoc(record.id, name)}
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
      width: 100,
      align: "center" as const,
      render: (count: number) => count === 0 ? <Tag icon={<LoadingOutlined />} color="processing">解析中</Tag> : count,
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
      dataIndex: "shared",
      key: "shared",
      width: 80,
      render: (shared: boolean, record: KBDocument) => (
        <Switch size="small" checked={shared} onChange={(v) => handleShare(record.id, v)} />
      ),
    },
    {
      title: t("actions"),
      key: "actions",
      width: 110,
      render: (_: any, record: KBDocument) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => handleViewDoc(record.id, record.name)} />
          <Popconfirm title={t("confirm")} onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Flex vertical gap={16} style={{ maxWidth: 960, margin: "0 auto", padding: "16px 0" }}>
      {/* Stats */}
      <Row gutter={16}>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t("kb_doc_count")} value={stats.documentCount ?? 0} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t("kb_chunk_count")} value={stats.chunkCount ?? 0} prefix={<NumberOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Tokens" value={stats.totalTokens ?? 0} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t("kb_vector_status")} value={stats.embeddingProvider && stats.embeddingProvider !== "local" ? stats.embeddingProvider : t("kb_vector_none")} prefix={<CloudOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* Import */}
      <Card size="small" title={t("kb_import")}>
        <Flex gap={12} align="start">
          <div style={{ flex: 1 }}>
            <Dragger
              accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.txt,.md,.csv,.tsv,.json,.png,.jpg,.jpeg"
              multiple
              customRequest={handleUpload}
              showUploadList={false}
              disabled={importing}
              style={{ padding: "16px 0" }}
            >
              <p><UploadOutlined style={{ fontSize: 28, color: "#1677ff" }} /></p>
              <p style={{ fontSize: 13 }}>{t("kb_upload_hint")}</p>
            </Dragger>
          </div>
          <div style={{ width: 200 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t("kb_tags")}</Text>
            <Input
              size="small"
              placeholder={t("kb_tags_hint")}
              value={importTags}
              onChange={(e) => setImportTags(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>
        </Flex>
      </Card>

      {/* Search */}
      <Card size="small" title={t("kb_search")}>
        <Input.Search
          placeholder={t("kb_search_hint")}
          enterButton={<SearchOutlined />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onSearch={handleSearch}
          loading={searching}
          style={{ marginBottom: 12 }}
        />
        {searchResults.length > 0 && (
          <div style={{ maxHeight: 500, overflow: "auto" }}>
            {searchResults.map((r, i) => {
              const hasBbox = r.bboxes && r.bboxes.length > 0 && r.docId;
              const hasPage = r.pageNumber != null && r.docId;
              return (
                <Card key={i} size="small" style={{ marginBottom: 8 }}>
                  <Flex justify="space-between" align="center">
                    <Text
                      strong
                      style={{ fontSize: 13, cursor: r.docId ? "pointer" : "default", color: r.docId ? "#1677ff" : undefined }}
                      onClick={r.docId ? () => handleViewDoc(r.docId!, r.docName) : undefined}
                    >
                      {r.docName}
                    </Text>
                    <Space size={4}>
                      {r.pageNumber != null && <Tag>第 {r.pageNumber} 页</Tag>}
                      <Tag color="blue">{(r.score * 100).toFixed(0)}%</Tag>
                    </Space>
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

      {/* Document List */}
      <Card
        size="small"
        title={t("kb_documents")}
        extra={
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadDocuments}>{t("refresh")}</Button>
            <Button size="small" icon={<ReloadOutlined />} loading={rebuilding} onClick={handleRebuild}>{t("kb_rebuild")}</Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={documents}
          rowKey="id"
          size="small"
          loading={loadingDocs}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      {/* 文档解析内容查看 Drawer */}
      <Drawer
        title={viewDoc?.name || "文档内容"}
        open={!!viewDoc}
        onClose={() => { setViewDoc(null); setViewPageImages([]); }}
        placement="right"
        width={viewTab === "compare" ? 960 : 600}
        loading={viewLoading}
        extra={
          viewPageImages.length > 0 ? (
            <Segmented
              size="small"
              value={viewTab}
              onChange={(v) => setViewTab(v as any)}
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
            <XMarkdown>{viewDoc?.content || "(无内容)"}</XMarkdown>
          </div>
        )}
        {viewTab === "images" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {viewPageImages.length > 0 ? viewPageImages.map((page) => (
              <div key={page} style={{ border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ background: "var(--ant-color-bg-layout)", padding: "4px 12px", fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                  第 {page} 页
                </div>
                <img
                  src={pageImageUrl(viewDoc?.docId ?? '', page)}
                  alt={`第 ${page} 页`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                  loading="lazy"
                />
              </div>
            )) : <Text type="secondary">暂无页面图片</Text>}
          </div>
        )}
        {viewTab === "compare" && (() => {
          const mdPages = (viewDoc?.content || "").split(/\n\n---\n\n/).filter(Boolean);
          const maxPages = Math.max(mdPages.length, viewPageImages.length);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {Array.from({ length: maxPages }, (_, idx) => (
                <div key={idx} style={{ display: "flex", gap: 16, border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ flex: 1, borderRight: "1px solid var(--ant-color-border)" }}>
                    {idx < viewPageImages.length ? (
                      <img
                        src={pageImageUrl(viewDoc?.docId ?? '', viewPageImages[idx])}
                        alt={`第 ${idx + 1} 页`}
                        style={{ width: "100%", height: "auto", display: "block" }}
                        loading="lazy"
                      />
                    ) : <div style={{ padding: 16, color: "var(--ant-color-text-secondary)" }}>无图片</div>}
                  </div>
                  <div style={{ flex: 1, padding: 16, fontSize: 13, lineHeight: 1.8 }}>
                    {idx < mdPages.length ? <XMarkdown>{mdPages[idx]}</XMarkdown> : <Text type="secondary">无解析内容</Text>}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Drawer>
    </Flex>
  );
}
