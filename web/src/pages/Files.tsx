import { useState, useEffect, useCallback, useRef } from "react";
import {
  Flex,
  Card,
  Tree,
  Table,
  Button,
  Space,
  Tag,
  App,
  Typography,
  Upload,
  Input,
  Modal,
  Drawer,
  Empty,
  Spin,
  Tooltip,
  Popconfirm,
  Segmented,
} from "antd";
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  FileWordOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FileZipOutlined,
  FileMarkdownOutlined,
  DeleteOutlined,
  DownloadOutlined,
  UploadOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  DatabaseOutlined,
  HomeOutlined,
  RightOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import ShareDialog from "@/components/ShareDialog";
import { XMarkdown } from "@ant-design/x-markdown";
import { useI18nStore } from "@/i18n";
import { api, apiFetch, pageImageUrl } from "@/api";

const { Text } = Typography;

interface TreeNode {
  key: string;
  title: string;
  isLeaf: boolean;
  children?: TreeNode[];
  size?: number;
  modifiedAt?: number;
  ext?: string;
  isShared?: boolean;
  owner?: string;
}

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
  ext: string;
}

interface SharedFileItem {
  id: string;
  name: string;
  path: string;
  size: number;
  owner: string;
  ownerName?: string;
  sharedAt: number;
  permission: string;
}

interface KbDocInfo {
  docId: string;
  vectorized: number;
  vectorTotal: number;
  chunkCount: number;
  status: string; // "parsing" | "vectorizing" | "done"
}

function getFileIcon(ext: string, size = 16) {
  const style = { fontSize: size };
  const map: Record<string, React.ReactNode> = {
    ".pdf": <FilePdfOutlined style={{ ...style, color: "#ff4d4f" }} />,
    ".xlsx": <FileExcelOutlined style={{ ...style, color: "#52c41a" }} />,
    ".xls": <FileExcelOutlined style={{ ...style, color: "#52c41a" }} />,
    ".csv": <FileExcelOutlined style={{ ...style, color: "#52c41a" }} />,
    ".docx": <FileWordOutlined style={{ ...style, color: "#1677ff" }} />,
    ".doc": <FileWordOutlined style={{ ...style, color: "#1677ff" }} />,
    ".pptx": <FilePptOutlined style={{ ...style, color: "#fa8c16" }} />,
    ".ppt": <FilePptOutlined style={{ ...style, color: "#fa8c16" }} />,
    ".txt": <FileTextOutlined style={{ ...style, color: "#8c8c8c" }} />,
    ".log": <FileTextOutlined style={{ ...style, color: "#8c8c8c" }} />,
    ".md": <FileMarkdownOutlined style={{ ...style, color: "#722ed1" }} />,
    ".png": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".jpg": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".jpeg": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".gif": <FileImageOutlined style={{ ...style, color: "#13c2c2" }} />,
    ".zip": <FileZipOutlined style={{ ...style, color: "#faad14" }} />,
    ".rar": <FileZipOutlined style={{ ...style, color: "#faad14" }} />,
  };
  return map[ext] || <FileOutlined style={{ ...style, color: "#8c8c8c" }} />;
}

function formatSize(bytes: number): string {
  if (!bytes) return "--";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(ts: number): string {
  if (!ts) return "--";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 从带时间戳的文件名还原原始名 */
function stripTimestamp(name: string): string {
  return name.replace(/_\d{10,15}(\.[^.]+)$/, "$1");
}

/** KB 向量化状态标签 */
function KbStatusTag({ info }: { info: KbDocInfo | undefined }) {
  if (!info) return null;
  if (info.status === "parsing") {
    return (
      <Tag icon={<ClockCircleOutlined spin />} color="processing" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
        解析中
      </Tag>
    );
  }
  if (info.status === "vectorizing") {
    const pct = info.vectorTotal ? Math.round((info.vectorized / info.vectorTotal) * 100) : 0;
    return (
      <Tooltip title={`${info.vectorized} / ${info.vectorTotal} chunks`}>
        <Tag icon={<SyncOutlined spin />} color="processing" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
          向量化 {pct}%
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={`${info.vectorized} chunks 已向量化`}>
      <Tag icon={<CheckCircleOutlined />} color="success" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
        已向量化
      </Tag>
    </Tooltip>
  );
}

export default function FilesPage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [sharedFiles, setSharedFiles] = useState<SharedFileItem[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingShared, setLoadingShared] = useState(false);
  const [kbDocs, setKbDocs] = useState<Record<string, KbDocInfo>>({});
  const [organizing, setOrganizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 共享文件相关
  const [isSharedFolder, setIsSharedFolder] = useState(false);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);

  // 文档查看器
  const [viewDoc, setViewDoc] = useState<{ name: string; docId: string; content: string } | null>(null);
  const [viewPageImages, setViewPageImages] = useState<number[]>([]);
  const [viewTab, setViewTab] = useState<"markdown" | "images" | "compare">("markdown");
  const [viewLoading, setViewLoading] = useState(false);

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    try {
      const data = await api.get<any>("/api/files/tree");
      if (data.success) setTree(data.tree || []);
    } catch {}
    setLoadingTree(false);
  }, []);

  const loadFiles = useCallback(async (path: string) => {
    setLoadingFiles(true);
    try {
      const data = await api.get<any>(`/api/files/list?path=${encodeURIComponent(path)}`);
      if (data.success) setFiles(data.files || []);
    } catch {}
    setLoadingFiles(false);
  }, []);

  const loadKbStatus = useCallback(async () => {
    try {
      const data = await api.get<any>("/api/files/kb-status");
      if (data.success && data.kbDocs) setKbDocs(data.kbDocs);
    } catch {}
  }, []);

  const loadSharedFiles = useCallback(async () => {
    setLoadingShared(true);
    try {
      const data = await api.get<any>("/api/files/shared");
      if (data.success) {
        setSharedFiles(data.files || []);
      }
    } catch {}
    setLoadingShared(false);
  }, []);

  const refreshAll = useCallback(() => {
    loadTree();
    loadFiles(currentPath);
    loadKbStatus();
    loadSharedFiles();
  }, [loadTree, loadFiles, loadKbStatus, loadSharedFiles, currentPath]);

  useEffect(() => {
    loadTree();
    loadFiles("");
    loadKbStatus();
    loadSharedFiles();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadTree, loadFiles, loadKbStatus, loadSharedFiles]);

  // 有解析/向量化进行中时轮询
  useEffect(() => {
    const hasPending = Object.values(kbDocs).some((d) => d.status === "parsing" || d.status === "vectorizing");
    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(() => { loadKbStatus(); loadFiles(currentPath); }, 4000);
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [kbDocs, loadKbStatus, loadFiles, currentPath]);

  const navigateTo = (path: string) => {
    setIsSharedFolder(false);
    setCurrentPath(path);
    setSelectedFolder(path);
    loadFiles(path);
    if (path) {
      const parts = path.split("/");
      const keys: string[] = [];
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        keys.push(acc);
      }
      setExpandedKeys((prev) => [...new Set([...prev, ...keys])]);
    }
  };

  const navigateToShared = () => {
    setIsSharedFolder(true);
    setCurrentPath("__SHARED__");
    setSelectedFolder("__SHARED__");
    loadSharedFiles();
  };

  const handleTreeSelect = (keys: any) => {
    if (keys.length === 0) return;
    const key = keys[0] as string;
    
    // 处理共享文件夹
    if (key === "__SHARED__") {
      navigateToShared();
      return;
    }
    
    const node = findNode(tree, key);
    if (node && !node.isLeaf) {
      navigateTo(key);
    } else if (node && node.isLeaf) {
      const parentPath = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      navigateTo(parentPath);
    }
  };

  const findNode = (nodes: TreeNode[], key: string): TreeNode | null => {
    for (const n of nodes) {
      if (n.key === key) return n;
      if (n.children) {
        const found = findNode(n.children, key);
        if (found) return found;
      }
    }
    return null;
  };

  /** 获取文件的 KB 匹配信息（通过原始文件名匹配） */
  const getKbInfo = (fileName: string): KbDocInfo | undefined => {
    // 直接匹配
    if (kbDocs[fileName]) return kbDocs[fileName];
    // 去掉时间戳后匹配
    const original = stripTimestamp(fileName);
    if (kbDocs[original]) return kbDocs[original];
    return undefined;
  };

  const handleDelete = async (path: string) => {
    try {
      const data = await api.del<any>(`/api/files?path=${encodeURIComponent(path)}`);
      if (data.success) {
        message.success(t("deleted"));
        refreshAll();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDownload = async (file: FileItem) => {
    try {
      const res = await apiFetch(`/api/download?path=${encodeURIComponent(file.path)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = stripTimestamp(file.name);
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error(t("failed"));
    }
  };

  const doUpload = async (file: File, mode: string = "auto"): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);
    const params = new URLSearchParams({ mode });
    if (currentPath) params.set("folder", currentPath);
    const res = await apiFetch(`/api/upload?${params.toString()}`, { method: "POST", body: formData });
    const data = await res.json();
    if (!data.success) { message.error(data.error || "上传失败"); return; }

    const fileInfo = data.data?.files?.[0];
    if (!fileInfo) { message.success(`"${file.name}" 上传成功`); refreshAll(); return; }

    if (fileInfo.duplicate === "same_content") {
      message.info(`"${file.name}" 内容已存在，无需重复上传`);
      return;
    }

    if (fileInfo.duplicate === "name_conflict") {
      // 同名不同内容 → 弹窗让用户选择
      Modal.confirm({
        title: "文件名冲突",
        content: `"${file.name}" 已存在但内容不同，如何处理？`,
        okText: "覆盖旧版",
        cancelText: "保留两者",
        onOk: async () => { await doUpload(file, "overwrite"); refreshAll(); },
        onCancel: async () => { await doUpload(file, "new_version"); refreshAll(); },
      });
      return;
    }

    message.success(`"${file.name}" 上传成功`);
    setTimeout(refreshAll, 500);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await doUpload(file);
    } catch (e: any) {
      message.error(e.message || "上传失败");
    }
    setUploading(false);
    return false;
  };

  const handleOrganize = async () => {
    setOrganizing(true);
    try {
      const data = await api.post<any>("/api/files/organize", {});
      if (data.success) {
        const moved = data.moves?.filter((m: any) => m.success).length ?? 0;
        message.success(`${t("files_organized")}${moved > 0 ? ` (${moved} 个文件)` : ""}`);
        refreshAll();
      } else {
        message.error(data.error);
      }
    } catch (e: any) {
      message.error(e.message);
    }
    setOrganizing(false);
  };

  const handleNewFolder = async () => {
    if (!newFolderName.trim()) return;
    const folderPath = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
    try {
      const data = await api.post<any>("/api/files/mkdir", { path: folderPath });
      if (data.success) {
        message.success(t("success"));
        setNewFolderOpen(false);
        setNewFolderName("");
        refreshAll();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleAddToKb = async (file: FileItem) => {
    const originalName = stripTimestamp(file.name);
    try {
      const res = await apiFetch("/api/knowledge/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: originalName, path: file.path, tags: [] }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(`"${originalName}" 已加入知识库`);
        setTimeout(loadKbStatus, 1000);
      } else {
        message.error(data.error || t("failed"));
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleViewDoc = async (kbInfo: KbDocInfo, fileName: string) => {
    setViewLoading(true);
    setViewTab("markdown");
    setViewPageImages([]);
    setViewDoc({ name: fileName, docId: kbInfo.docId, content: "" });
    try {
      // 获取文档解析内容
      const data = await api.get<any>(`/api/knowledge/documents/${kbInfo.docId}/content`);
      if (data.success) {
        setViewDoc({ name: fileName, docId: kbInfo.docId, content: data.content || "" });
      }
      // 获取页面图片列表
      try {
        const imgRes = await apiFetch(`/api/knowledge/documents/${kbInfo.docId}/pages`);
        const imgData = await imgRes.json();
        if (imgData.pages) setViewPageImages(imgData.pages);
      } catch { /* no images */ }
    } catch (e: any) {
      message.error(e.message);
    }
    setViewLoading(false);
  };

  const breadcrumbParts = currentPath ? currentPath.split("/") : [];

  const renderTreeIcon = (props: any) => {
    if (!props.isLeaf) {
      return props.expanded ? <FolderOpenOutlined style={{ color: "#faad14" }} /> : <FolderOutlined style={{ color: "#faad14" }} />;
    }
    return getFileIcon(props.data?.ext || "", 14);
  };

  const columns = [
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, record: FileItem) => {
        const displayName = record.isDir ? name : stripTimestamp(name);
        const kbInfo = record.isDir ? undefined : getKbInfo(name);
        return (
          <Flex align="center" gap={8}>
            {record.isDir ? <FolderOutlined style={{ color: "#faad14", fontSize: 18 }} /> : getFileIcon(record.ext, 18)}
            <Text
              strong={record.isDir}
              style={{ cursor: record.isDir ? "pointer" : "default", color: record.isDir ? "#1677ff" : undefined }}
              onClick={() => record.isDir && navigateTo(record.path)}
            >
              {displayName}
            </Text>
            {kbInfo && <KbStatusTag info={kbInfo} />}
          </Flex>
        );
      },
    },
    {
      title: t("files_size"),
      dataIndex: "size",
      key: "size",
      width: 90,
      render: (size: number, record: FileItem) => record.isDir ? "--" : <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(size)}</Text>,
    },
    {
      title: t("files_modified"),
      dataIndex: "modifiedAt",
      key: "modifiedAt",
      width: 120,
      render: (ts: number) => <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(ts)}</Text>,
    },
    {
      title: t("actions"),
      key: "actions",
      width: 130,
      render: (_: any, record: FileItem) => {
        const kbInfo = record.isDir ? undefined : getKbInfo(record.name);
        return (
          <Space size={0}>
            {!record.isDir && kbInfo && kbInfo.status === "done" && (
              <Tooltip title="查看文档">
                <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => handleViewDoc(kbInfo, stripTimestamp(record.name))} />
              </Tooltip>
            )}
            {!record.isDir && !kbInfo && (
              <Tooltip title={t("files_add_to_kb")}>
                <Button type="text" size="small" icon={<DatabaseOutlined />} onClick={() => handleAddToKb(record)} />
              </Tooltip>
            )}
            {!record.isDir && (
              <Tooltip title="下载">
                <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(record)} />
              </Tooltip>
            )}
            <Popconfirm title={t("confirm")} onConfirm={() => handleDelete(record.path)}>
              <Button type="text" danger size="small" icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  // 统计
  const kbTotal = Object.keys(kbDocs).length;
  const kbVectorized = Object.values(kbDocs).filter((d) => d.status === "done").length;

  // 准备树数据（添加共享文件夹）
  const treeDataWithShared = sharedFiles.length > 0 ? [
    {
      key: "__SHARED__",
      title: "📁 共享文件",
      isLeaf: false,
      children: sharedFiles.map((f) => ({
        key: `shared://${f.id}`,
        title: f.name,
        isLeaf: true,
        size: f.size,
        modifiedAt: f.sharedAt,
        ext: f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".")).toLowerCase() : "",
        isShared: true,
        owner: f.owner,
      })),
    },
    ...tree,
  ] : tree;

  // 共享文件表格列
  const sharedColumns = [
    {
      title: "文件名",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, record: SharedFileItem) => (
        <Flex align="center" gap={8}>
          {getFileIcon(name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "", 18)}
          <Text>{name}</Text>
          <Tag color="blue">共享</Tag>
        </Flex>
      ),
    },
    {
      title: "分享者",
      dataIndex: "owner",
      key: "owner",
      width: 120,
      render: (owner: string) => <Text type="secondary" style={{ fontSize: 12 }}>{owner}</Text>,
    },
    {
      title: "大小",
      dataIndex: "size",
      key: "size",
      width: 90,
      render: (size: number) => <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(size)}</Text>,
    },
    {
      title: "分享时间",
      dataIndex: "sharedAt",
      key: "sharedAt",
      width: 120,
      render: (ts: number) => <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(ts)}</Text>,
    },
    {
      title: "权限",
      dataIndex: "permission",
      key: "permission",
      width: 80,
      render: (perm: string) => <Tag>{perm === "write" ? "可编辑" : "只读"}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: any, record: SharedFileItem) => (
        <Space size={0}>
          <Tooltip title="下载">
            <Button 
              type="text" 
              size="small" 
              icon={<DownloadOutlined />} 
              onClick={() => window.open(`/api/download?path=${encodeURIComponent(record.path)}&token=${localStorage.getItem("token") || ""}`, "_blank")}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Flex gap={16} style={{ height: "calc(100vh - 64px - 48px)" }}>
      {/* Left: Folder Tree */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={6}>
            <FolderOutlined />
            <span>{t("files_workspace")}</span>
          </Flex>
        }
        style={{ width: 260, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto", padding: "8px 4px" } }}
      >
        {loadingTree ? (
          <Flex justify="center" style={{ padding: 24 }}><Spin size="small" /></Flex>
        ) : treeDataWithShared.length === 0 ? (
          <Empty description={t("no_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Tree
            treeData={treeDataWithShared}
            showIcon
            icon={renderTreeIcon}
            selectedKeys={selectedFolder ? [selectedFolder] : []}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            onSelect={handleTreeSelect}
            style={{ fontSize: 13 }}
          />
        )}
      </Card>

      {/* Right: File List */}
      <Card
        size="small"
        style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto", padding: 0 } }}
        title={
          isSharedFolder ? (
            <Flex align="center" gap={8} style={{ fontSize: 13 }}>
              <ShareAltOutlined style={{ color: "#1677ff" }} />
              <Text strong>共享文件</Text>
              <Tag>{sharedFiles.length} 个文件</Tag>
            </Flex>
          ) : (
            <Flex align="center" gap={4} style={{ fontSize: 13 }}>
              <HomeOutlined
                style={{ cursor: "pointer", color: "#1677ff" }}
                onClick={() => navigateTo("")}
              />
              {breadcrumbParts.map((part, i) => (
                <Flex key={i} align="center" gap={4}>
                  <RightOutlined style={{ fontSize: 10, color: "#999" }} />
                  <Text
                    style={{ cursor: "pointer", color: i === breadcrumbParts.length - 1 ? undefined : "#1677ff" }}
                    onClick={() => navigateTo(breadcrumbParts.slice(0, i + 1).join("/"))}
                  >
                    {part}
                  </Text>
                </Flex>
              ))}
              {breadcrumbParts.length === 0 && (
                <Text type="secondary">
                  {t("files_root")} · {kbTotal} 个入库 · {kbVectorized} 个已向量化
                </Text>
              )}
            </Flex>
          )
        }
        extra={
          isSharedFolder ? (
            <Button size="small" icon={<ReloadOutlined />} onClick={loadSharedFiles} loading={loadingShared}>
              刷新
            </Button>
          ) : (
            <Space>
              <Upload
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.zip"
                showUploadList={false}
                multiple
                beforeUpload={(file) => { handleUpload(file); return false; }}
              >
                <Button type="primary" size="small" icon={<UploadOutlined />} loading={uploading}>
                  上传文件
                </Button>
              </Upload>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setNewFolderOpen(true)}>
                {t("files_new_folder")}
              </Button>
              <Button
                size="small"
                icon={<RobotOutlined />}
                loading={organizing}
                onClick={handleOrganize}
                type="primary"
                ghost
              >
                {organizing ? t("files_organizing") : t("files_organize")}
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={refreshAll} />
          </Space>
          )
        }
      >
        <Table
          columns={isSharedFolder ? (sharedColumns as any) : columns}
          dataSource={isSharedFolder ? (sharedFiles as any[]) : files}
          rowKey={isSharedFolder ? "id" : "path"}
          size="small"
          loading={isSharedFolder ? loadingShared : loadingFiles}
          pagination={false}
          scroll={{ y: "calc(100vh - 200px)" }}
          locale={{ emptyText: <Empty description={isSharedFolder ? "暂无共享文件" : t("files_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>

      {/* New Folder Modal */}
      <Modal
        title={t("files_new_folder")}
        open={newFolderOpen}
        onOk={handleNewFolder}
        onCancel={() => { setNewFolderOpen(false); setNewFolderName(""); }}
        okText={t("ok")}
        cancelText={t("cancel")}
      >
        <Input
          placeholder={t("files_folder_name")}
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onPressEnter={handleNewFolder}
          autoFocus
        />
      </Modal>

      {/* 文档查看 Drawer */}
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
                  src={pageImageUrl(viewDoc?.docId ?? "", page)}
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
                        src={pageImageUrl(viewDoc?.docId ?? "", viewPageImages[idx])}
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
