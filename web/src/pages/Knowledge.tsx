import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Flex, App, Select, Button, Space, Modal, Input } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { api, apiFetch } from "@/api";
import KBStats from "@/components/knowledge/KBStats";
import ImportSection from "@/components/knowledge/ImportSection";
import SearchSection from "@/components/knowledge/SearchSection";
import DocumentTable from "@/components/knowledge/DocumentTable";
import DocumentViewerDrawer from "@/components/knowledge/DocumentViewerDrawer";
import ShareDialog from "@/components/ShareDialog";
import type { KBDocument, SearchResult } from "@/components/knowledge/types";

interface KBCollection {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export default function KnowledgePage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [viewTab, setViewTab] = useState<"markdown" | "images" | "compare" | "restored">("markdown");
  const [viewPageImages, setViewPageImages] = useState<number[]>([]);
  const [viewLayouts, setViewLayouts] = useState<any[]>([]);
  const [shareDoc, setShareDoc] = useState<KBDocument | null>(null);

  // Collections state
  const [collections, setCollections] = useState<KBCollection[]>([]);
  const urlCollectionId = searchParams.get("collectionId");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(urlCollectionId || undefined);
  const [loadingCollections, setLoadingCollections] = useState(false);

  // 创建分类弹窗
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [createCollectionName, setCreateCollectionName] = useState("");

  const handleViewDoc = async (docId: string, docName: string) => {
    setViewLoading(true);
    setViewPageImages([]);
    setViewLayouts([]);
    setViewDoc({ name: docName, content: "", docId });
    try {
      const [contentRes, pagesRes, layoutsRes] = await Promise.all([
        apiFetch(`/api/knowledge/documents/${docId}/content`),
        apiFetch(`/api/knowledge/documents/${docId}/pages`),
        apiFetch(`/api/knowledge/documents/${docId}/layouts`),
      ]);
      const contentData = await contentRes.json();
      const pagesData = await pagesRes.json();
      const layoutsData = await layoutsRes.json();

      if (contentData.success) {
        setViewDoc({ name: docName, content: contentData.content || "(无解析内容)", docId });
      } else {
        setViewDoc({ name: docName, content: `加载失败: ${contentData.error}`, docId });
      }

      const hasLayouts = layoutsData.success && Array.isArray(layoutsData.layouts) && layoutsData.layouts.length > 0;
      if (hasLayouts) {
        setViewLayouts(layoutsData.layouts);
      }

      if (pagesData.success && pagesData.pages?.length > 0) {
        setViewPageImages(pagesData.pages);
        setViewTab(hasLayouts ? "restored" : "images");
      } else if (hasLayouts) {
        setViewTab("restored");
      } else {
        setViewTab("markdown");
      }
    } catch (e: any) {
      setViewDoc({ name: docName, content: `加载失败: ${e.message}`, docId });
      setViewTab("markdown");
    }
    setViewLoading(false);
  };

  const loadCollections = useCallback(async () => {
    setLoadingCollections(true);
    try {
      const data = await api.get<any>("/api/knowledge/collections");
      if (data.success) {
        setCollections(data.data?.collections || []);
      }
    } catch (err: unknown) {
      console.warn('Failed to load collections:', err);
    }
    setLoadingCollections(false);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const url = selectedCollectionId
        ? `/api/knowledge/stats?collectionId=${encodeURIComponent(selectedCollectionId)}`
        : "/api/knowledge/stats";
      const data = await api.get<any>(url);
      if (data.success) setStats(data);
    } catch (err: unknown) { 
      console.warn('Knowledge operation failed:', err);
    }
  }, [selectedCollectionId]);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const url = selectedCollectionId
        ? `/api/knowledge/documents?collectionId=${encodeURIComponent(selectedCollectionId)}`
        : "/api/knowledge/documents";
      const data = await api.get<any>(url);
      if (data.success) {
        setDocuments(data.documents || []);
      }
    } catch (err: unknown) { 
      console.warn('Knowledge operation failed:', err);
    }
    setLoadingDocs(false);
  }, [selectedCollectionId]);

  // URL 参数变化时自动选中对应集合
  useEffect(() => {
    const cid = searchParams.get("collectionId");
    if (cid && cid !== selectedCollectionId) {
      setSelectedCollectionId(cid);
    }
  }, [searchParams]);

  useEffect(() => {
    loadCollections();
    loadStats();
    loadDocuments();
  }, [loadCollections, loadStats, loadDocuments]);

  // Polling when documents are processing
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

  // SSE for realtime parsing progress
  const completedSSE = useRef<Set<string>>(new Set());
  useEffect(() => {
    const processingDocs = documents.filter(d => d.parsingStatus === 'processing');
    if (processingDocs.length === 0) return;

    const eventSources: EventSource[] = [];
    
    for (const doc of processingDocs) {
      // 跳过已经收到完成状态的文档，避免重连噪音
      if (completedSSE.current.has(doc.id)) continue;

      const es = new EventSource(`/api/knowledge/documents/${doc.id}/stream`);
      
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setDocuments(prev => prev.map(d => {
            if (d.id === doc.id) {
              return {
                ...d,
                parsingStatus: data.status,
                parsingProgress: data.progress,
              };
            }
            return d;
          }));
          
          if (data.status === 'success' || data.status === 'failed') {
            completedSSE.current.add(doc.id);
            es.close();
            loadDocuments();
            loadStats();
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };
      
      es.onerror = () => {
        // 如果已完成则忽略关闭导致的 error
        if (completedSSE.current.has(doc.id)) return;
        es.close();
        // 静默处理连接错误，改为轮询刷新状态
        loadDocuments();
      };
      
      eventSources.push(es);
    }
    
    return () => {
      for (const es of eventSources) {
        es.close();
      }
    };
  }, [documents.map(d => d.parsingStatus).join(','), loadDocuments, loadStats]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      interface SearchResponse {
        success: boolean;
        results?: Array<{ docId: string; docName: string; content: string; score: number }>;
      }
      let url = `/api/knowledge/search?q=${encodeURIComponent(searchQuery)}&limit=10`;
      if (selectedCollectionId) {
        url += `&collectionId=${encodeURIComponent(selectedCollectionId)}`;
      }
      const data = await api.get<SearchResponse>(url);
      if (data.success) {
        setSearchResults(data.results || []);
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '搜索失败');
    }
    setSearching(false);
  };

  const handleUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    setImporting(true);
    try {
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

      // 使用与文件页面一致的命名规则（stripTimestamp 后的存储名）
      const storedName = filePath.split('/').pop() || file.name;
      const kbName = storedName.replace(/_\d{10,15}(\.[^.]+)$/, "$1").replace(/_\d{10,15}$/, "");

      const data = await api.post<any>("/api/knowledge/ingest", {
        name: kbName,
        path: filePath,
        tags: importTags ? importTags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
        collectionId: selectedCollectionId,
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

  const handleChangeCollection = async (docId: string, collectionId: string | null) => {
    try {
      const data = await api.put<any>(`/api/knowledge/documents/${docId}`, { collectionId });
      if (data.success) {
        message.success("分类修改成功");
        loadDocuments();
      } else {
        message.error(data.error || "修改失败");
      }
    } catch (e: any) { message.error(e.message); }
  };

  const handleOpenShare = (doc: KBDocument) => {
    setShareDoc(doc);
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

  const handleCreateCollection = () => {
    setCreateCollectionName("");
    setCreateCollectionOpen(true);
  };

  const handleConfirmCreateCollection = async () => {
    const name = createCollectionName.trim();
    if (!name) {
      message.warning("请输入分类名称");
      return;
    }
    try {
      const data = await api.post<any>("/api/knowledge/collections", { name, description: "" });
      if (data.success) {
        message.success("分类创建成功");
        setCreateCollectionOpen(false);
        loadCollections();
      } else {
        message.error(data.error || "创建失败");
      }
    } catch (e: any) { message.error(e.message); }
  };

  const handleDeleteCollection = (collectionId: string) => {
    Modal.confirm({
      title: "删除分类",
      content: "确定删除此分类？分类内的文档将移回默认知识库。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const data = await api.del<any>(`/api/knowledge/collections/${collectionId}`);
          if (data.success) {
            message.success("分类已删除");
            if (selectedCollectionId === collectionId) {
              setSelectedCollectionId(undefined);
            }
            loadCollections();
            loadDocuments();
            loadStats();
          } else {
            message.error(data.error || "删除失败");
          }
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  return (
    <Flex vertical gap={16} style={{ maxWidth: 960, margin: "0 auto", padding: "16px 0" }}>
      {/* Collection Selector */}
      <Flex justify="space-between" align="center">
        <Space>
          <Select
            style={{ minWidth: 200 }}
            placeholder="选择知识库分类"
            loading={loadingCollections}
            value={selectedCollectionId}
            onChange={(val) => {
              setSelectedCollectionId(val);
              // 清除 URL 中的 collectionId 参数，避免手动切换后被覆盖
              if (searchParams.has("collectionId")) {
                const next = new URLSearchParams(searchParams);
                next.delete("collectionId");
                setSearchParams(next, { replace: true });
              }
            }}
            allowClear
            options={[
              { label: "全部分类", value: undefined },
              ...collections.map((c) => ({ label: c.name, value: c.id })),
            ]}
          />
          <Button icon={<PlusOutlined />} onClick={handleCreateCollection}>
            新建分类
          </Button>
        </Space>
        {selectedCollectionId && collections.find((c) => c.id === selectedCollectionId)?.name !== "默认知识库" && (
          <Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteCollection(selectedCollectionId)}>
            删除分类
          </Button>
        )}
      </Flex>

      <KBStats stats={stats} />
      <ImportSection
        importing={importing}
        importTags={importTags}
        onImportTagsChange={setImportTags}
        customRequest={handleUpload}
      />
      <SearchSection
        searchQuery={searchQuery}
        searching={searching}
        results={searchResults}
        onQueryChange={setSearchQuery}
        onSearch={handleSearch}
        onViewDoc={handleViewDoc}
      />
      <DocumentTable
        documents={documents}
        collections={collections}
        loading={loadingDocs}
        onRefresh={loadDocuments}
        onRebuild={handleRebuild}
        rebuilding={rebuilding}
        onDelete={handleDelete}
        onOpenShare={handleOpenShare}
        onViewDoc={handleViewDoc}
        onChangeCollection={handleChangeCollection}
      />
      <ShareDialog
        open={!!shareDoc}
        onClose={() => setShareDoc(null)}
        resourceType="kb_document"
        resourceId={shareDoc?.id || ""}
        resourceName={shareDoc?.name || ""}
      />
      <DocumentViewerDrawer
        open={!!viewDoc}
        doc={viewDoc}
        loading={viewLoading}
        viewTab={viewTab}
        pageImages={viewPageImages}
        layouts={viewLayouts}
        onClose={() => { setViewDoc(null); setViewPageImages([]); setViewLayouts([]); }}
        onTabChange={setViewTab}
      />
      <Modal
        title="新建知识库分类"
        open={createCollectionOpen}
        onOk={handleConfirmCreateCollection}
        onCancel={() => setCreateCollectionOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="请输入分类名称"
          value={createCollectionName}
          onChange={(e) => setCreateCollectionName(e.target.value)}
          onPressEnter={handleConfirmCreateCollection}
          autoFocus
        />
      </Modal>
    </Flex>
  );
}
