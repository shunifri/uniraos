import { useState, useEffect, useCallback } from "react";
import { Flex, App } from "antd";
import { useI18nStore } from "@/i18n";
import { api, apiFetch } from "@/api";
import KBStats from "@/components/knowledge/KBStats";
import ImportSection from "@/components/knowledge/ImportSection";
import SearchSection from "@/components/knowledge/SearchSection";
import DocumentTable from "@/components/knowledge/DocumentTable";
import DocumentViewerDrawer from "@/components/knowledge/DocumentViewerDrawer";
import type { KBDocument, SearchResult } from "@/components/knowledge/types";

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
        setViewTab("images");
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
    } catch (err: unknown) { 
      console.warn('Knowledge operation failed:', err);
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const data = await api.get<any>("/api/knowledge/documents");
      if (data.success) {
        setDocuments(data.documents || []);
      }
    } catch (err: unknown) { 
      console.warn('Knowledge operation failed:', err);
    }
    setLoadingDocs(false);
  }, []);

  useEffect(() => {
    loadStats();
    loadDocuments();
  }, [loadStats, loadDocuments]);

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
  useEffect(() => {
    const processingDocs = documents.filter(d => d.parsingStatus === 'processing');
    if (processingDocs.length === 0) return;

    const eventSources: EventSource[] = [];
    
    for (const doc of processingDocs) {
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
            loadDocuments();
            loadStats();
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };
      
      es.onerror = () => {
        console.error(`SSE error for doc ${doc.id}`);
        es.close();
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
      const data = await api.get<SearchResponse>(`/api/knowledge/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      if (data.success) {
        setSearchResults(data.results || []);
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '搜索失败');
    }
    setSearching(false);
  };

  const handleUpload = async (options: { file: File; onSuccess?: () => void; onError?: (error: Error) => void }) => {
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
      loadDocuments();
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

  return (
    <Flex vertical gap={16} style={{ maxWidth: 960, margin: "0 auto", padding: "16px 0" }}>
      <KBStats stats={stats} />
      <ImportSection
        importing={importing}
        importTags={importTags}
        onImportTagsChange={setImportTags}
        beforeUpload={handleUpload}
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
        loading={loadingDocs}
        onRefresh={loadDocuments}
        onRebuild={handleRebuild}
        rebuilding={rebuilding}
        onDelete={handleDelete}
        onShare={handleShare}
        onViewDoc={handleViewDoc}
      />
      <DocumentViewerDrawer
        open={!!viewDoc}
        doc={viewDoc}
        loading={viewLoading}
        viewTab={viewTab}
        pageImages={viewPageImages}
        onClose={() => { setViewDoc(null); setViewPageImages([]); }}
        onTabChange={setViewTab}
      />
    </Flex>
  );
}
