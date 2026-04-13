import { useState, useRef, useCallback, useEffect } from "react";
import { Flex, Typography, Tag, Button, List, Spin, Badge, Drawer, Input, message, Segmented, Collapse } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { Bubble, Sender, Think, CodeHighlighter, Attachments } from "@ant-design/x";
import type { Attachment } from "@ant-design/x/es/attachments";
import type { AttachmentsRef } from "@ant-design/x/es/attachments";
import { XMarkdown } from "@ant-design/x-markdown";
import ReactECharts from "echarts-for-react";
import {
  UserOutlined,
  RobotOutlined,
  LinkOutlined,
  CloudUploadOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  BulbOutlined,
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  DownloadOutlined,
  BookOutlined,
  ReadOutlined,
  ToolOutlined,
  RightOutlined,
  SearchOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  FileTextOutlined,
  FileOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { apiFetch, pageImageUrl } from "@/api";
import ConfirmCard from "@/components/ConfirmCard";
import { getFileIcon, formatFileSize } from "@/components/chat/utils";

const { Text } = Typography;

const PAGE_SIZE = 50;

// ---- File download types ----
interface FileDownloadInfo {
  name: string;
  path: string;
  size: number;
  ext: string;
  downloadUrl: string;
  contentUrl?: string;
}

interface FileDownloadData {
  files: FileDownloadInfo[];
  zipDownloadUrl?: string;
  zipName?: string;
  zipPaths?: string[];
}



// ---- KB Reference types ----
interface KbReference {
  index: number;
  docId: string;
  docName: string;
  chunkIndex: number;
  content: string;
  score: number;
  pageNumber: number | null;
  bboxes: Array<{ page: number; bbox: [number, number, number, number] }> | null;
}

interface WebReference {
  index: number;
  title: string;
  url: string;
  snippet?: string;
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

// ---- Types ----
interface ChatMsg {
  id?: number; // DB id，用于分页
  role: "user" | "assistant" | "tool" | "system" | "thinking" | "strategy" | "user_confirm";
  content: string;
  skillName?: string;
  isError?: boolean;
  status?: "running" | "done" | "error";
  chartOptions?: Record<string, unknown>[];
  fileDownload?: FileDownloadData;
  kbReferences?: KbReference[];
  webReferences?: WebReference[];
  resultData?: Record<string, unknown>;
}

interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

// ---- API helpers ----
async function apiCreateConversation(title: string): Promise<string | null> {
  try {
    const res = await apiFetch("/api/conversations", { method: "POST", body: JSON.stringify({ title }) });
    const data = await res.json();
    return data.success ? data.id : null;
  } catch { return null; }
}

function parseMsg(m: any): ChatMsg {
  if (m.role === "assistant" && m.extra) {
    console.log("[parseMsg] assistant extra:", JSON.stringify(m.extra).slice(0, 200));
  }
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    skillName: m.skill_name || undefined,
    status: m.status || undefined,
    isError: !!m.is_error,
    chartOptions: m.extra?.chartOptions || undefined,
    fileDownload: m.extra?.fileDownload || undefined,
    kbReferences: m.extra?.kbReferences || undefined,
    webReferences: m.extra?.webReferences || undefined,
    resultData: m.extra?.resultData || undefined,
  };
}

// ---- XMarkdown custom components (plugins) ----
const markdownComponents: Record<string, React.ComponentType<any>> = {
  code: ({ children, lang, block }: any) =>
    block ? (
      <CodeHighlighter lang={lang}>{String(children ?? "")}</CodeHighlighter>
    ) : (
      <code style={{ background: "var(--ant-color-fill-tertiary)", padding: "1px 4px", borderRadius: 3, fontSize: "0.9em" }}>{children}</code>
    ),
  think: ({ children, streamStatus }: any) => (
    <Think title="Thinking..." loading={streamStatus === "loading"}>{children}</Think>
  ),
};

// ---- Highlight keywords in React (not HTML injection, avoids DOMPurify stripping) ----
function highlightText(text: string, keywords: string[]): React.ReactNode[] {
  if (!keywords.length) return [text];
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) => {
    // Use a fresh regex each time (no lastIndex issue)
    const isMatch = new RegExp(`^(?:${escaped.join("|")})$`, "i").test(part);
    return isMatch ? (
      <mark key={i} style={{ background: "#fff1b8", padding: "0 1px", borderRadius: 2 }}>{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

function extractKeywords(text: string): string[] {
  // 中文停用词，用于切分
  const zhStops = "的了是在有和我你他她它们这那就都也不吗呢吧啊哪什么怎么为什么可以能会要请帮给把让到从对用说看想做去来很最一个一些所有关于哪些怎样如何";
  const stopChars = new Set(zhStops.split(""));
  // 1. 去标点符号，按停用字切分中文为短语
  const cleaned = text.replace(/[^\u4e00-\u9fffa-zA-Z0-9]/g, " ");
  const phrases: string[] = [];
  let cur = "";
  for (const ch of cleaned) {
    if (stopChars.has(ch) || ch === " ") {
      if (cur.length >= 2) phrases.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length >= 2) phrases.push(cur);
  // 2. 长短语拆成 2-4 字 n-gram
  const result: string[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    // 保留完整短语
    if (phrase.length >= 2 && phrase.length <= 6 && !seen.has(phrase)) {
      result.push(phrase);
      seen.add(phrase);
    }
    // 拆 2-gram
    if (phrase.length > 2) {
      for (let i = 0; i <= phrase.length - 2; i++) {
        const ng = phrase.slice(i, i + 2);
        if (!seen.has(ng)) { result.push(ng); seen.add(ng); }
      }
    }
  }
  // 优先长词，最多 12 个
  return result.sort((a, b) => b.length - a.length).slice(0, 12);
}

// ---- Preprocess [^N] → <kbref data-index="N">[N]</kbref> for XMarkdown ----
function preprocessFootnotes(md: string): string {
  return md.replace(/\[\^(\d+)\]/g, '<kbref data-index="$1">[$1]</kbref>');
}

export default function ChatPage() {
  const t = useI18nStore((s) => s.t);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const [activeConvId, _setActiveConvId] = useState<string | null>(null);
  // 控制是否自动滚动到底部（加载更多时不滚动）
  const shouldScrollRef = useRef(true);
  // md 文件预览内容缓存
  const [mdPreviews, setMdPreviews] = useState<Record<string, string>>({});
  // 已确认的 user_confirm 卡片 ID 集合
  const [confirmedCards, setConfirmedCards] = useState<Set<string>>(new Set());
  // 动态 PPTX 主题列表（内置 + 自定义）
  const [pptxThemes, setPptxThemes] = useState<Array<{ name: string; label: string; custom: boolean; sourceFile?: string; preview: { bg: string; title: string; accent: string } }>>([]);
  const pptxThemesFetched = useRef(false);
  // 移动端侧边栏开关
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const setActiveConvId = (id: string | null) => {
    activeConvIdRef.current = id;
    _setActiveConvId(id);
  };

  useEffect(() => { loadConversations(); }, []);

  // 获取 PPTX 主题列表
  useEffect(() => {
    if (pptxThemesFetched.current) return;
    pptxThemesFetched.current = true;
    apiFetch("/api/pptx/themes").then((r) => r.json()).then((d) => {
      if (d.success && d.themes) setPptxThemes(d.themes);
    }).catch(() => {});
  }, []);

  const refreshPptxThemes = useCallback(() => {
    apiFetch("/api/pptx/themes").then((r) => r.json()).then((d) => {
      if (d.success && d.themes) setPptxThemes(d.themes);
    }).catch(() => {});
  }, []);

  // 自动滚动到底部 — 流式时直接跳底（无动画），避免频繁触发 smooth 导致跳动
  useEffect(() => {
    if (shouldScrollRef.current) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages]);

  // 自动加载 md 文件预览内容
  useEffect(() => {
    for (const msg of messages) {
      if (!msg.fileDownload?.files) continue;
      for (const f of msg.fileDownload.files) {
        if (f.ext === ".md" && f.contentUrl && !mdPreviews[f.path]) {
          apiFetch(f.contentUrl).then(async (res) => {
            const text = await res.text();
            setMdPreviews((prev) => prev[f.path] ? prev : { ...prev, [f.path]: text });
          }).catch(() => {});
        }
      }
    }
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  };

  const loadConversations = async () => {
    try {
      const res = await apiFetch("/api/conversations");
      const data = await res.json();
      if (data.success) {
        setConversations(data.conversations || []);
        if (data.conversations?.length > 0 && !activeConvIdRef.current) {
          const latest = data.conversations[0];
          setActiveConvId(latest.id);
          loadMessages(latest.id);
        }
      }
    } catch (err: unknown) { 
      console.warn('Failed to load conversations:', err);
    }
  };

  /** 加载最新一页消息 */
  const loadMessages = async (convId: string) => {
    try {
      const res = await apiFetch(`/api/conversations/${convId}/messages?limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (data.success) {
        shouldScrollRef.current = true;
        setMessages((data.messages || []).map(parseMsg));
        setHasMore(!!data.hasMore);
        // 加载完成后滚动到底部
        setTimeout(scrollToBottom, 50);
      }
    } catch (err: unknown) { 
      console.warn('Failed to load messages:', err);
    }
  };

  /** 向上加载更早消息 */
  const loadOlderMessages = async () => {
    if (loadingMore || !hasMore || !activeConvIdRef.current) return;
    const firstMsgId = messages[0]?.id;
    if (!firstMsgId) return;

    setLoadingMore(true);
    shouldScrollRef.current = false;

    try {
      const res = await apiFetch(`/api/conversations/${activeConvIdRef.current}/messages?limit=${PAGE_SIZE}&before_id=${firstMsgId}`);
      const data = await res.json();
      if (data.success) {
        const older = (data.messages || []).map(parseMsg);
        if (older.length > 0) {
          // 记录当前滚动位置
          const container = scrollContainerRef.current;
          const prevScrollHeight = container?.scrollHeight ?? 0;

          setMessages((prev) => [...older, ...prev]);
          setHasMore(!!data.hasMore);

          // 保持滚动位置（prepend 后 scrollHeight 变大）
          requestAnimationFrame(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - prevScrollHeight;
            }
            shouldScrollRef.current = true;
          });
        } else {
          setHasMore(false);
        }
      }
    } catch (err: unknown) { 
      console.warn('Failed to load older messages:', err);
    }
    setLoadingMore(false);
  };

  /** 滚动到顶部时加载更多 */
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // 加载更早消息
    if (container.scrollTop < 50 && hasMore && !loadingMore) {
      loadOlderMessages();
    }
    // 检测用户是否在底部附近（50px 阈值）
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    shouldScrollRef.current = isAtBottom;
  };

  const switchConversation = (convId: string) => {
    if (convId === activeConvIdRef.current) return;
    setActiveConvId(convId);
    setMessages([]);
    setHasMore(false);
    loadMessages(convId);
    apiFetch("/api/agent/clear", { method: "POST" }).catch(() => {});
  };

  const deleteConversation = async (convId: string) => {
    try {
      await apiFetch(`/api/conversations/${convId}`, { method: "DELETE" });
      if (convId === activeConvIdRef.current) { setActiveConvId(null); setMessages([]); }
      loadConversations();
    } catch (err: unknown) { 
      console.warn('Failed to delete conversation:', err);
    }
  };

  // 附件状态：文件上传后暂存，等用户发送消息时一起提交
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsSnap = useRef<Attachment[]>([]); // ref 镜像，解决 useCallback stale closure
  // 封装 setAttachments 自动同步 ref
  const updateAttachments: typeof setAttachments = (val) => {
    setAttachments((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      attachmentsSnap.current = next;
      return next;
    });
  };
  const [headerOpen, setHeaderOpen] = useState(false);
  const attachmentPaths = useRef<Map<string, string>>(new Map()); // uid → 服务器路径
  const attachmentParseContent = useRef<Map<string, string>>(new Map()); // uid → 解析后的内容
  const attachmentParseTags = useRef<Map<string, string[]>>(new Map()); // uid → 自动提取的标签
  const attachmentPageCount = useRef<Map<string, number>>(new Map()); // uid → 页面图片数量
  const senderRef = useRef<any>(null);
  const attachmentsRef = useRef<AttachmentsRef>(null);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // 查看附件解析内容
  const [viewingAttachment, setViewingAttachment] = useState<{ uid: string; name: string; content: string; path: string; tags: string[]; pageCount?: number } | null>(null);
  const [viewingTab, setViewingTab] = useState<"markdown" | "images" | "compare">("markdown");
  const [viewingPageImages, setViewingPageImages] = useState<number[]>([]);
  // KB 引用
  const pendingKbRefs = useRef<KbReference[]>([]);
  const pendingWebRefs = useRef<WebReference[]>([]);
  const [viewingRefs, setViewingRefs] = useState<KbReference[] | null>(null);
  const [viewingRefIndex, setViewingRefIndex] = useState<number | null>(null);
  const [refViewMode, setRefViewMode] = useState<"auto" | "text">("auto"); // auto = 显示页面图片（有 bbox 则高亮），text = 纯文本
  // 引用文档的页面图片列表缓存：docId → pages[]
  const [refDocPages, setRefDocPages] = useState<Record<string, number[]>>({});
  // KB 文档完整查看
  const [kbDocView, setKbDocView] = useState<{ docId: string; name: string; content: string } | null>(null);
  const [kbDocViewTab, setKbDocViewTab] = useState<"markdown" | "images" | "compare">("markdown");
  const [kbDocPageImages, setKbDocPageImages] = useState<number[]>([]);
  const [kbDocViewLoading, setKbDocViewLoading] = useState(false);

  const handleViewKbDoc = async (docId: string, docName: string) => {
    setKbDocViewLoading(true);
    setKbDocPageImages([]);
    setKbDocView({ docId, name: docName, content: "" });
    try {
      const [contentRes, pagesRes] = await Promise.all([
        apiFetch(`/api/knowledge/documents/${docId}/content`),
        apiFetch(`/api/knowledge/documents/${docId}/pages`),
      ]);
      const contentData = await contentRes.json();
      const pagesData = await pagesRes.json();
      setKbDocView({ docId, name: docName, content: contentData.success ? (contentData.content || "(无内容)") : `加载失败: ${contentData.error}` });
      if (pagesData.success && pagesData.pages?.length > 0) {
        setKbDocPageImages(pagesData.pages);
        setKbDocViewTab("images"); // 有页面图片时默认显示图片
      } else {
        setKbDocViewTab("markdown");
      }
    } catch (e: any) {
      setKbDocView({ docId, name: docName, content: `加载失败: ${e.message}` });
      setKbDocViewTab("markdown");
    }
    setKbDocViewLoading(false);
  };

  // 清理轮询定时器
  useEffect(() => {
    return () => { pollTimers.current.forEach((t) => clearInterval(t)); };
  }, []);

  // 轮询文件解析状态
  const startPollParseStatus = (uid: string, serverPath: string) => {
    // 更新附件描述为"转换中"
    updateAttachments((prev) =>
      prev.map((a) => a.uid === uid ? { ...a, description: "转换中...", status: "uploading" as const } : a)
    );

    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/upload/parse-status?path=${encodeURIComponent(serverPath)}`);
        const data = await res.json();
        if (data.status === "done") {
          clearInterval(timer);
          pollTimers.current.delete(uid);
          attachmentParseContent.current.set(uid, data.content || "");
          if (data.tags && Array.isArray(data.tags)) {
            attachmentParseTags.current.set(uid, data.tags);
          }
          if (data.pageCount) {
            attachmentPageCount.current.set(uid, data.pageCount);
          }
          const tagsLabel = data.tags?.length ? ` | 标签: ${data.tags.join(", ")}` : "";
          updateAttachments((prev) =>
            prev.map((a) => a.uid === uid ? { ...a, description: `已解析 (${data.format || "text"})${tagsLabel}`, status: "done" as const } : a)
          );
        } else if (data.status === "error") {
          clearInterval(timer);
          pollTimers.current.delete(uid);
          updateAttachments((prev) =>
            prev.map((a) => a.uid === uid ? { ...a, description: `解析失败: ${data.error || "未知错误"}`, status: "error" as const } : a)
          );
        }
        // status === "parsing" → 继续轮询
      } catch {
        // 网络错误，继续重试
      }
    }, 2000);
    pollTimers.current.set(uid, timer);
  };

  const handleAttachmentChange = (info: any) => {
    const list: Attachment[] = Array.isArray(info) ? info : info?.fileList ?? info;
    // 过滤掉被删除的附件，清理相关资源
    const removedUids = new Set(attachments.map((a) => a.uid).filter((uid) => !list.some((b) => b.uid === uid)));
    removedUids.forEach((uid) => {
      attachmentPaths.current.delete(uid);
      attachmentParseContent.current.delete(uid);
      attachmentParseTags.current.delete(uid);
      const timer = pollTimers.current.get(uid);
      if (timer) { clearInterval(timer); pollTimers.current.delete(uid); }
    });
    updateAttachments(list);
    attachmentsSnap.current = list;
    if (list.length > 0) setHeaderOpen(true);
  };

  const handleAttachmentUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        const path = data.data?.files?.map((f: any) => f?.path).filter(Boolean)[0] || "uploads/" + file.name;
        attachmentPaths.current.set(file.uid, path);
        onSuccess?.(data, file);
        // 上传成功后开始轮询解析状态
        startPollParseStatus(file.uid, path);
      } else {
        onError?.(new Error(data.error || "上传失败"));
      }
    } catch (e: any) {
      onError?.(e);
    }
  };

  // 是否有附件正在解析中
  const hasParsingAttachments = attachments.some((a) => a.status === "uploading");

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      let convId = activeConvIdRef.current;
      if (!convId) {
        convId = await apiCreateConversation("新对话");
        if (!convId) return;
        setActiveConvId(convId);
        loadConversations();
      }

      // 合并附件信息到消息（附件保留不清除，每次对话都带上）
      let fullText = text;
      const currentAttachments = attachmentsSnap.current.filter((a) => a.status === "done" || a.status === "error");
      if (currentAttachments.length > 0) {
        const attachmentSections = currentAttachments.map((a) => {
          const path = attachmentPaths.current.get(a.uid) || "";
          const parsedContent = attachmentParseContent.current.get(a.uid);
          if (parsedContent) {
            return `--- 文件: ${a.name} (路径: ${path}) ---\n${parsedContent}\n--- 文件结束 ---`;
          }
          return `[附件: ${a.name} (路径: ${path})]`;
        });
        fullText = `${attachmentSections.join("\n\n")}\n\n${text}`;
        // 附件保留在对话框中，用户手动删除才移除
      }

      const userMsg: ChatMsg = { role: "user", content: text };
      shouldScrollRef.current = true;
      // 添加用户消息 + typing 指示器
      setMessages((prev) => [...prev, userMsg, { role: "thinking" as any, content: "__typing__" }]);
      setInputValue("");
      setLoading(true);

      const abortController = new AbortController();
      abortRef.current = abortController;
      let currentText = "";
      let needNewBubble = true;

      try {
        const res = await apiFetch("/api/agent/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: fullText, conversationId: convId }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          setMessages((prev) => [...prev, { role: "assistant", content: err.error || res.statusText, isError: true }]);
          setLoading(false);
          loadConversations();
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const parts = sseBuffer.split("\n\n");
          sseBuffer = parts.pop()!;

          for (const part of parts) {
            let eventType = "";
            let eventData = "";
            for (const line of part.split("\n")) {
              if (line.startsWith("event: ")) eventType = line.slice(7);
              else if (line.startsWith("data: ")) eventData = line.slice(6);
            }
            if (!eventType || !eventData) continue;
            let data: any;
            try { data = JSON.parse(eventData); } catch { continue; }

            // 移除 typing 指示器的辅助函数
            const removeTyping = (msgs: ChatMsg[]) => msgs.filter(m => !(m.role === "thinking" && m.content === "__typing__"));

            if (eventType === "text_delta") {
              if (needNewBubble) {
                needNewBubble = false;
                currentText = data.text;
                const snapshot = currentText;
                const refs = pendingKbRefs.current.length > 0 ? [...pendingKbRefs.current] : undefined;
                const webRefs = pendingWebRefs.current.length > 0 ? [...pendingWebRefs.current] : undefined;
                setMessages((prev) => [...removeTyping(prev), { role: "assistant", content: snapshot, kbReferences: refs, webReferences: webRefs }]);
              } else {
                currentText += data.text;
                const snapshot = currentText;
                setMessages((prev) => {
                  const next = [...prev];
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === "assistant") {
                      next[i] = { ...next[i], content: snapshot };
                      break;
                    }
                  }
                  return next;
                });
              }
            } else if (eventType === "kb_references") {
              pendingKbRefs.current = data.references || [];
              console.log("[KB-DEBUG] received kb_references, count=", pendingKbRefs.current.length, "needNewBubble=", needNewBubble);
              // 如果 assistant bubble 已经创建，回写引用到最后一条 assistant 消息
              if (!needNewBubble) {
                const refsSnapshot = [...pendingKbRefs.current];
                setMessages((prev) => {
                  const next = [...prev];
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === "assistant") {
                      next[i] = { ...next[i], kbReferences: refsSnapshot };
                      break;
                    }
                  }
                  return next;
                });
              }
            } else if (eventType === "web_references") {
              pendingWebRefs.current = data.references || [];
              // 回写到最后一条 assistant 消息
              if (!needNewBubble) {
                const webRefsSnapshot = [...pendingWebRefs.current];
                setMessages((prev) => {
                  const next = [...prev];
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === "assistant") {
                      next[i] = { ...next[i], webReferences: webRefsSnapshot };
                      break;
                    }
                  }
                  return next;
                });
              }
            } else if (eventType === "strategy_selected") {
              const levelMap: Record<string, string> = {
                simple: "💬 直接为你解答",
                react: "🔍 正在分析，将逐步为你处理",
                team: "👥 多角度协作分析中",
              };
              const label = levelMap[data.level] || `🤖 处理中`;
              setMessages((prev) => [...removeTyping(prev), { role: "strategy", content: label }]);
            } else if (eventType === "thinking") {
              // 显示思考内容（如果有 content 字段则显示思考过程）
              const thinkContent = data.content || `正在思考 (第 ${data.iteration ?? ""} 轮)...`;
              setMessages((prev) => {
                const cleaned = removeTyping(prev);
                // 合并连续思考消息
                const lastIdx = cleaned.length - 1;
                if (lastIdx >= 0 && cleaned[lastIdx].role === "thinking" && cleaned[lastIdx].content !== "__typing__") {
                  const next = [...cleaned];
                  next[lastIdx] = { ...next[lastIdx], content: next[lastIdx].content + "\n" + thinkContent };
                  return next;
                }
                return [...cleaned, { role: "thinking", content: thinkContent }];
              });
            } else if (eventType === "tool_start") {
              setMessages((prev) => [...removeTyping(prev), { role: "tool", content: `正在使用 ${data.skillName}...`, skillName: data.skillName, status: "running" }]);
            } else if (eventType === "tool_result") {
              const r = data.result;
              console.log("[CHART-DEBUG] tool_result:", data.skillName, "hasOption:", !!r?.data?.option, "hasChartType:", !!r?.data?.chartType, "hasCharts:", !!r?.data?.charts);
              let summary = "";
              let chartOptions: Record<string, unknown>[] | undefined;

              let fileDownload: FileDownloadData | undefined;
              if (r.success) {
                if (r.data?.__type === "file_download" && r.data?.files) {
                  fileDownload = r.data as FileDownloadData;
                  summary = `已准备 ${fileDownload.files.length} 个文件`;
                } else if (r.data?.option && r.data?.chartType) {
                  summary = `已生成${r.data.chartType}图表`;
                  chartOptions = [r.data.option];
                } else if (r.data?.charts && Array.isArray(r.data.charts)) {
                  summary = `已生成 ${r.data.charts.length} 个图表`;
                  chartOptions = r.data.charts.map((c: any) => c.option).filter(Boolean);
                } else if (r.data?.message) summary = r.data.message;
                else if (r.data?.results && Array.isArray(r.data.results)) summary = `获取到 ${r.data.results.length} 条结果`;
                else if (r.data?.text) summary = r.data.text.slice(0, 200) + (r.data.text.length > 200 ? "..." : "");
                else if (r.data?.content) { const c = typeof r.data.content === "string" ? r.data.content : JSON.stringify(r.data.content); summary = c.slice(0, 200) + (c.length > 200 ? "..." : ""); }
                else if (r.data?.svg || r.data?.html) summary = "已生成图表";
                else if (typeof r.data === "string") summary = r.data.slice(0, 200);
                else summary = t("done");
              } else { summary = r.error?.message || r.error || t("failed"); }

              const toolMsg: ChatMsg = { role: "tool", content: summary, skillName: data.skillName, isError: !r.success, status: r.success ? "done" : "error", chartOptions, fileDownload, resultData: (r.data && typeof r.data === 'object' && !chartOptions && !fileDownload) ? r.data as Record<string, unknown> : undefined };
              setMessages((prev) => {
                const next = [...prev];
                const idx = next.findLastIndex((m) => m.role === "tool" && m.skillName === data.skillName && m.status === "running");
                if (idx >= 0) next[idx] = toolMsg;
                return next;
              });
            } else if (eventType === "tool_call") {
              if (currentText) currentText = "";
              needNewBubble = true;
            } else if (eventType === "done" || eventType === "agent_done") {
              if (data.hitMax) {
                setMessages((prev) => [...prev, { role: "system", content: t("hit_max_iterations") }]);
              }
            } else if (eventType === "user_confirm") {
              const confirmData = data;
              setMessages(prev => {
                const next = [...prev];
                // Update the preceding tool_start (running) message to "done" so loading stops
                const toolIdx = next.findLastIndex((m) => m.role === "tool" && m.status === "running");
                if (toolIdx >= 0) {
                  next[toolIdx] = { ...next[toolIdx], content: "等待用户确认...", status: "done" };
                }
                next.push({ role: "user_confirm" as any, content: JSON.stringify(confirmData) });
                return next;
              });
            } else if (eventType === "error") {
              setMessages((prev) => [...prev, { role: "assistant", content: data.error, isError: true }]);
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setMessages((prev) => [...prev, { role: "assistant", content: err.message || t("network_error"), isError: true }]);
        }
      }

      setLoading(false);
      abortRef.current = null;
      // 后端已保存消息，只需刷新会话列表（更新标题/时间）
      loadConversations();
    },
    [loading, t],
  );

  const stopChat = () => { abortRef.current?.abort(); setLoading(false); };

  const newChat = async () => {
    const id = await apiCreateConversation("新对话");
    if (id) { setActiveConvId(id); setMessages([]); setHasMore(false); loadConversations(); }
    apiFetch("/api/agent/clear", { method: "POST" }).catch(() => {});
  };

  return (
    <Flex style={{ height: "calc(100vh - 64px - 48px)", width: "100%" }}>
      {/* Mobile sidebar overlay */}
      <div
        className={`mobile-sidebar-overlay ${mobileSidebarOpen ? "visible" : ""}`}
        onClick={() => setMobileSidebarOpen(false)}
      />
      {/* Sidebar */}
      <div className={`glass-card chat-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`} style={{ width: 240, borderRight: "1px solid var(--ant-color-border)", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden", borderRadius: 0 }}>
        <div style={{ padding: "12px 12px 8px" }}>
          <Button type="primary" icon={<PlusOutlined />} block onClick={() => { newChat(); setMobileSidebarOpen(false); }}>{t("create")}</Button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 4px" }}>
          <List
            dataSource={conversations}
            split={false}
            renderItem={(conv) => (
              <List.Item
                className={conv.id === activeConvId ? "conv-active" : ""}
                style={{ padding: "8px 12px", cursor: "pointer", borderRadius: 6, marginBottom: 2 }}
                onClick={() => { switchConversation(conv.id); setMobileSidebarOpen(false); }}
              >
                <Flex align="center" gap={8} style={{ width: "100%", minWidth: 0 }}>
                  <MessageOutlined style={{ flexShrink: 0, opacity: 0.5 }} />
                  <Text ellipsis style={{ flex: 1, fontSize: 13 }} title={conv.title}>{conv.title || "新对话"}</Text>
                  <DeleteOutlined style={{ flexShrink: 0, opacity: 0.3, fontSize: 12 }} onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }} />
                </Flex>
              </List.Item>
            )}
          />
        </div>
      </div>

      {/* Main chat */}
      <Flex vertical className="chat-main" style={{ flex: 1, maxWidth: 900, margin: "0 auto", width: "100%", minWidth: 0, overflow: "hidden" }}>
        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}
        >
          {/* Mobile sidebar toggle */}
          <Button
            className="mobile-menu-btn"
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileSidebarOpen(true)}
            style={{ alignSelf: "flex-start", marginBottom: -8 }}
          />
          {/* 加载更多指示器 */}
          {hasMore && (
            <Flex justify="center" style={{ padding: "8px 0" }}>
              {loadingMore ? <Spin size="small" /> : (
                <Button type="link" size="small" onClick={loadOlderMessages}>加载更早消息</Button>
              )}
            </Flex>
          )}

          {messages.length === 0 && !hasMore && (
            <div className="chat-empty" style={{ textAlign: "center", margin: "auto" }}>
              <img src="/ai-avatar.png" alt="AI" style={{ width: 72, height: 72, borderRadius: 20, margin: "0 auto 20px", display: "block", boxShadow: "0 8px 32px rgba(139, 92, 246, 0.25)" }} />
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                <span className="text-gradient">RAOS 智能助手</span>
              </div>
              <div style={{ color: "#94A3B8", fontSize: 14 }}>有什么我可以帮你的？</div>
            </div>
          )}
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              // 解析消息中的文件附件引用，渲染为文件卡片
              const fileBlockRegex = /--- 文件: (.+?) \(路径: (.+?)\) ---\n([\s\S]*?)--- 文件结束 ---/g;
              const attachRefRegex = /\[附件: (.+?) \(路径: (.+?)\)\]/g;
              const hasFileBlocks = fileBlockRegex.test(msg.content) || attachRefRegex.test(msg.content);

              if (hasFileBlocks) {
                // 提取文件引用和纯文本
                const files: Array<{ name: string; path: string; content: string }> = [];
                let textOnly = msg.content;

                // 提取完整文件块（含解析内容）
                textOnly = textOnly.replace(/--- 文件: (.+?) \(路径: (.+?)\) ---\n([\s\S]*?)--- 文件结束 ---/g, (_m, name, path, content) => {
                  files.push({ name, path, content: content.trim() });
                  return "";
                });
                // 提取简短附件引用（无解析内容）
                textOnly = textOnly.replace(/\[附件: (.+?) \(路径: (.+?)\)\]/g, (_m, name, path) => {
                  if (!files.some((f) => f.path === path)) files.push({ name, path, content: "" });
                  return "";
                });
                textOnly = textOnly.trim();

                return (
                  <Bubble
                    key={msg.id ?? `m${i}`}
                    placement="end"
                    className="user-bubble"
                    content={textOnly || " "}
                    contentRender={(content) => {
                      const getExt = (name: string) => {
                        const dot = name.lastIndexOf(".");
                        return dot >= 0 ? name.slice(dot).toLowerCase() : "";
                      };
                      const extLabelMap: Record<string, { label: string; color: string; bg: string }> = {
                        ".pptx": { label: "PPT", color: "#fa8c16", bg: "#fff7e6" },
                        ".ppt": { label: "PPT", color: "#fa8c16", bg: "#fff7e6" },
                        ".pdf": { label: "PDF", color: "#ff4d4f", bg: "#fff1f0" },
                        ".docx": { label: "Word", color: "#1677ff", bg: "#e6f4ff" },
                        ".doc": { label: "Word", color: "#1677ff", bg: "#e6f4ff" },
                        ".xlsx": { label: "Excel", color: "#52c41a", bg: "#f6ffed" },
                        ".xls": { label: "Excel", color: "#52c41a", bg: "#f6ffed" },
                        ".csv": { label: "CSV", color: "#52c41a", bg: "#f6ffed" },
                        ".png": { label: "Image", color: "#13c2c2", bg: "#e6fffb" },
                        ".jpg": { label: "Image", color: "#13c2c2", bg: "#e6fffb" },
                        ".jpeg": { label: "Image", color: "#13c2c2", bg: "#e6fffb" },
                        ".md": { label: "MD", color: "#722ed1", bg: "#f9f0ff" },
                        ".txt": { label: "Text", color: "#8c8c8c", bg: "#fafafa" },
                      };
                      return (
                      <div>
                        {files.length > 0 && (
                          <Flex gap={8} wrap="wrap" style={{ marginBottom: textOnly ? 10 : 0 }}>
                            {files.map((f, fi) => {
                              const ext = getExt(f.name);
                              const meta = extLabelMap[ext] || { label: ext.replace(".", "").toUpperCase() || "FILE", color: "#8c8c8c", bg: "#fafafa" };
                              return (
                              <div
                                key={fi}
                                onClick={() => {
                                  if (f.content) {
                                    setViewingAttachment({ uid: `hist-${fi}`, name: f.name, content: f.content, path: f.path, tags: [] });
                                  }
                                }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 10,
                                  padding: "10px 14px", borderRadius: 10,
                                  background: "rgba(255,255,255,0.95)",
                                  border: "1px solid rgba(0,0,0,0.06)",
                                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                                  cursor: f.content ? "pointer" : "default",
                                  maxWidth: 300, minWidth: 200,
                                  transition: "box-shadow 0.2s, border-color 0.2s",
                                }}
                                onMouseEnter={(e) => { if (f.content) { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; e.currentTarget.style.borderColor = meta.color; } }}
                                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)"; }}
                              >
                                {/* 文件类型图标 */}
                                <div style={{
                                  width: 40, height: 40, borderRadius: 8,
                                  background: meta.bg,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 20, flexShrink: 0,
                                }}>
                                  {getFileIcon(ext)}
                                </div>
                                {/* 文件信息 */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: 13, fontWeight: 500, color: "#333",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    lineHeight: 1.3,
                                  }}>{f.name}</div>
                                  <Flex align="center" gap={6} style={{ marginTop: 3 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, color: meta.color,
                                      background: meta.bg, padding: "1px 6px", borderRadius: 4,
                                    }}>{meta.label}</span>
                                    {f.content && <span style={{ fontSize: 10, color: "#999" }}>可预览</span>}
                                  </Flex>
                                </div>
                              </div>
                              );
                            })}
                          </Flex>
                        )}
                        {textOnly && <span>{typeof content === "string" ? content : ""}</span>}
                      </div>
                      );
                    }}
                    avatar={<div style={{ width: 34, height: 34, borderRadius: 12, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)' }}><UserOutlined /></div>}
                  />
                );
              }

              return (
                <Bubble
                  key={msg.id ?? `m${i}`}
                  placement="end"
                  className="user-bubble"
                  content={msg.content}
                  avatar={<div style={{ width: 34, height: 34, borderRadius: 12, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)' }}><UserOutlined /></div>}
                />
              );
            }
            if (msg.role === "thinking") {
              // Typing 指示器
              if (msg.content === "__typing__") {
                return (
                  <div key={msg.id ?? `m${i}`} style={{ display: "flex", gap: 12, alignItems: "center", marginLeft: 4, animation: "fade-in-up 0.3s ease-out" }}>
                    <img src="/ai-avatar.png" alt="AI" style={{ width: 32, height: 32, borderRadius: 10 }} />
                    <div style={{ display: "flex", gap: 4, padding: "10px 16px", borderRadius: 16, background: "rgba(139, 92, 246, 0.06)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B5CF6", opacity: 0.6, animation: "pulse-border 1.2s infinite" }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#A78BFA", opacity: 0.6, animation: "pulse-border 1.2s infinite 0.2s" }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C4B5FD", opacity: 0.6, animation: "pulse-border 1.2s infinite 0.4s" }} />
                    </div>
                  </div>
                );
              }
              // 思考内容 — 内联小标签，点击可展开
              return (
                <div key={msg.id ?? `m${i}`} style={{ marginLeft: 46, padding: "2px 0" }}>
                  <Collapse ghost size="small" defaultActiveKey={[]} style={{ width: "fit-content" }} items={[{
                    key: "think",
                    label: (
                      <span className="strategy-badge" style={{ background: "linear-gradient(135deg, rgba(139, 92, 246, 0.06), rgba(236, 72, 153, 0.04))" }}>
                        <BulbOutlined style={{ fontSize: 11 }} />
                        深度思考
                      </span>
                    ),
                    children: (
                      <Text style={{ fontSize: 12, color: "#64748B", whiteSpace: "pre-wrap", lineHeight: 1.6, display: "block", maxHeight: 200, overflow: "auto", padding: "8px 12px", background: "rgba(139,92,246,0.03)", borderRadius: 10 }}>{msg.content}</Text>
                    ),
                  }]} />
                </div>
              );
            }
            if (msg.role === "strategy") {
              return (
                <Flex key={msg.id ?? `m${i}`} justify="center" style={{ padding: "4px 0" }}>
                  <span className="strategy-badge">
                    <BulbOutlined style={{ fontSize: 12 }} />
                    {msg.content}
                  </span>
                </Flex>
              );
            }
            if (msg.role === "tool") {
              // 工具调用：嵌入式可折叠行（参考 ChatGPT/Kimi 风格）
              const toolIcon = msg.skillName?.includes("search") ? <SearchOutlined />
                : msg.skillName?.includes("kb_") ? <FileTextOutlined />
                : msg.skillName?.includes("web_") ? <GlobalOutlined />
                : msg.skillName?.includes("chart") ? <BarChartOutlined />
                : msg.skillName?.includes("file") ? <FileOutlined />
                : msg.skillName?.includes("db_") || msg.skillName?.includes("mysql") ? <DatabaseOutlined />
                : <ToolOutlined />;
              const isRunning = msg.status === "running";
              const toolLabel = msg.skillName?.replace(/_/g, " ") ?? "tool";
              const summary = msg.content && msg.content !== "完成" && msg.content !== "失败" ? msg.content : "";

              return (
                <div key={msg.id ?? `m${i}`} style={{ marginLeft: 46, animation: 'fade-in-up 0.3s ease-out' }}>
                  <Collapse
                    ghost
                    size="small"
                    expandIcon={({ isActive }) => (
                      <span style={{ transition: 'transform 0.3s', display: 'inline-block', transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                        <RightOutlined style={{ fontSize: 10, color: '#94A3B8' }} />
                      </span>
                    )}
                    items={[{
                      key: "tool",
                      label: (
                        <Flex align="center" gap={10} style={{ padding: '2px 0', overflow: 'hidden', minWidth: 0 }}>
                          <span style={{ color: isRunning ? '#667eea' : msg.isError ? '#EF4444' : '#64748B', fontSize: 15, flexShrink: 0 }}>
                            {isRunning ? <LoadingOutlined spin /> : toolIcon}
                          </span>
                          <Text style={{ fontSize: 14, color: '#334155', fontWeight: 500, flexShrink: 0 }}>{toolLabel}</Text>
                          {summary && (
                            <Text style={{ fontSize: 13, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                              {summary.length > 60 ? summary.slice(0, 60) + "..." : summary}
                            </Text>
                          )}
                        </Flex>
                      ),
                      children: msg.resultData ? (
                        <pre style={{ fontSize: 12, maxHeight: 240, overflow: 'auto', background: '#F8FAFC', padding: 12, borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#475569', border: '1px solid #E2E8F0', margin: '4px 0' }}>
                          {JSON.stringify(msg.resultData, null, 2)}
                        </pre>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>{msg.content || "无详情"}</Text>
                      ),
                    }]}
                    style={{
                      background: isRunning ? 'rgba(102, 126, 234, 0.04)' : msg.isError ? 'rgba(239, 68, 68, 0.04)' : '#F8FAFC',
                      borderRadius: 12,
                      border: `1px solid ${isRunning ? 'rgba(102, 126, 234, 0.12)' : msg.isError ? 'rgba(239, 68, 68, 0.12)' : '#E2E8F0'}`,
                    }}
                  />
                  {msg.chartOptions && msg.chartOptions.length > 0 && (
                    <div style={{ padding: "8px 16px" }}>
                      {msg.chartOptions.map((opt, ci) => (
                        <div key={ci} style={{ background: "var(--ant-color-bg-container)", borderRadius: 8, padding: 12, marginBottom: 8, border: "1px solid var(--ant-color-border)" }}>
                          <ReactECharts option={opt} style={{ height: 350 }} notMerge lazyUpdate />
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.fileDownload && msg.fileDownload.files.length > 0 && (
                    <div style={{ padding: "8px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {msg.fileDownload.files.map((f, fi) => {
                          const isMd = f.ext === ".md";
                          const mdContent = mdPreviews[f.path];
                          const isPpt = isMd && mdContent && mdContent.includes("\n---\n");
                          const downloadFn = (url: string, name: string) => {
                            apiFetch(url).then(async (res) => {
                              const blob = await res.blob();
                              const blobUrl = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = blobUrl; a.download = name; a.click();
                              URL.revokeObjectURL(blobUrl);
                            }).catch(() => message.error("下载失败"));
                          };
                          // 解析幻灯片内容用于卡片预览
                          const parseSlides = (raw: string) => {
                            const stripped = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
                            return stripped.split(/\n---\n/).map((s) => s.trim()).filter(Boolean).map((s) => {
                              const lines = s.split("\n");
                              let title = "";
                              const bullets: string[] = [];
                              for (const l of lines) {
                                const t = l.trim();
                                if (!title && /^#{1,3}\s+/.test(t)) title = t.replace(/^#{1,3}\s+/, "");
                                else if (/^>\s+/.test(t) && !title) title = t.replace(/^>\s+/, "");
                                else if (/^[-*+]\s+/.test(t)) bullets.push(t.replace(/^[-*+]\s+/, ""));
                                else if (t && !title) title = t;
                                else if (t) bullets.push(t);
                              }
                              return { title, bullets };
                            });
                          };
                          // 主题预览色（静态 fallback + 动态）
                          const fallbackThemeColors: Record<string, { bg: string; title: string; accent: string; body: string }> = {
                            "business-blue": { bg: "#FFFFFF", title: "#1B3A5C", accent: "#2B7AE0", body: "#444" },
                            "tech-dark": { bg: "#1A1A2E", title: "#E0E0FF", accent: "#00D4FF", body: "#B0B0CC" },
                            "minimal-white": { bg: "#FAFAFA", title: "#222", accent: "#888", body: "#555" },
                            "vibrant-orange": { bg: "#FFFAF5", title: "#D4520A", accent: "#FF6B2B", body: "#4A4A4A" },
                            "academic-green": { bg: "#F5FAF5", title: "#1B5E20", accent: "#43A047", body: "#3E3E3E" },
                          };
                          // 合并动态主题
                          const themeColors: Record<string, { bg: string; title: string; accent: string; body: string }> = { ...fallbackThemeColors };
                          for (const t of pptxThemes) {
                            if (!themeColors[t.name] && t.preview) {
                              themeColors[t.name] = { bg: `#${t.preview.bg}`, title: `#${t.preview.title}`, accent: `#${t.preview.accent}`, body: "#444" };
                            }
                          }
                          const detectTheme = (raw: string) => {
                            const m = raw.match(/^---\s*\n[\s\S]*?theme:\s*(\S+)[\s\S]*?\n---/);
                            return m ? m[1] : "business-blue";
                          };
                          const currentTheme = mdContent ? detectTheme(mdContent) : "business-blue";
                          const colors = themeColors[currentTheme] || themeColors["business-blue"];

                          return (
                            <div key={fi} style={{ minWidth: 240, maxWidth: isMd ? "100%" : 300, flex: isMd ? "1 1 100%" : undefined }}>
                              {/* 文件信息栏 + 下载按钮 */}
                              <div
                                style={{
                                  display: "flex", alignItems: "center", gap: 10,
                                  padding: "10px 14px", borderRadius: 8,
                                  border: "1px solid var(--ant-color-border)",
                                  background: "var(--ant-color-bg-container)",
                                  transition: "border-color 0.2s, box-shadow 0.2s",
                                }}
                              >
                                <div style={{ fontSize: 28, lineHeight: 1 }}>{getFileIcon(f.ext)}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                                  <div style={{ fontSize: 11, color: "var(--ant-color-text-secondary)" }}>{formatFileSize(f.size)}</div>
                                </div>
                                {isMd ? (
                                  <Flex gap={4} align="center">
                                    {(["MD", "PDF", "DOCX", "PPTX"] as const).map((fmt) => (
                                      <Button
                                        key={fmt}
                                        size="small"
                                        type={fmt === "MD" ? "primary" : "default"}
                                        style={{ fontSize: 11, padding: "0 8px", height: 24 }}
                                        onClick={() => {
                                          if (fmt === "MD") {
                                            downloadFn(f.downloadUrl, f.name);
                                          } else {
                                            const themeParam = fmt === "PPTX" ? `&theme=${currentTheme}` : "";
                                            downloadFn(
                                              `/api/download/convert?path=${encodeURIComponent(f.path)}&format=${fmt.toLowerCase()}${themeParam}`,
                                              f.name.replace(/\.md$/i, `.${fmt.toLowerCase()}`),
                                            );
                                          }
                                        }}
                                      >
                                        {fmt}
                                      </Button>
                                    ))}
                                  </Flex>
                                ) : (
                                  <DownloadOutlined
                                    style={{ fontSize: 16, color: "#1677ff", flexShrink: 0, cursor: "pointer" }}
                                    onClick={() => downloadFn(f.downloadUrl, f.name)}
                                  />
                                )}
                              </div>

                              {/* PPT 幻灯片卡片预览 */}
                              {isPpt && mdContent && (() => {
                                const slides = parseSlides(mdContent);
                                return (
                                  <div style={{ marginTop: 8 }}>
                                    {/* 主题选择器 */}
                                    <Flex gap={6} style={{ marginBottom: 8 }} align="center" wrap="wrap">
                                      <Text style={{ fontSize: 11, color: "var(--ant-color-text-secondary)" }}>主题:</Text>
                                      {Object.entries(themeColors).map(([name, c]) => {
                                        const themeInfo = pptxThemes.find((t) => t.name === name);
                                        const label = themeInfo?.label || ({ "business-blue": "商务蓝", "tech-dark": "科技深色", "minimal-white": "简约白", "vibrant-orange": "活力橙", "academic-green": "学术绿" } as Record<string, string>)[name] || name;
                                        const isCustom = themeInfo?.custom;
                                        return (
                                        <div
                                          key={name}
                                          title={`${label}${isCustom ? ` (来源: ${themeInfo?.sourceFile || "自定义"})` : ""}`}
                                          onClick={() => {
                                            if (!mdContent) return;
                                            const updated = mdContent.replace(/^(---\s*\n[\s\S]*?theme:\s*)\S+([\s\S]*?\n---)/, `$1${name}$2`);
                                            if (updated !== mdContent) {
                                              setMdPreviews((prev) => ({ ...prev, [f.path]: updated }));
                                            }
                                          }}
                                          style={{
                                            width: 20, height: 20, borderRadius: 4, cursor: "pointer",
                                            background: c.bg, border: name === currentTheme ? `2px solid ${c.accent}` : `1px solid ${isCustom ? c.accent + "88" : "#ddd"}`,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            boxShadow: name === currentTheme ? `0 0 0 2px ${c.accent}33` : "none",
                                          }}
                                        >
                                          <div style={{ width: 8, height: 8, borderRadius: 2, background: c.accent }} />
                                        </div>
                                        );
                                      })}
                                      {/* 上传学习按钮 */}
                                      <div
                                        title="上传 PPTX 学习风格"
                                        onClick={() => {
                                          const input = document.createElement("input");
                                          input.type = "file";
                                          input.accept = ".pptx";
                                          input.onchange = async () => {
                                            const file = input.files?.[0];
                                            if (!file) return;
                                            const formData = new FormData();
                                            formData.append("file", file);
                                            try {
                                              const res = await apiFetch(`/api/pptx/themes/learn?name=${encodeURIComponent(file.name.replace(/\.pptx$/i, ""))}`, { method: "POST", body: formData, rawBody: true } as any);
                                              const data = await res.json();
                                              if (data.success) {
                                                message.success(`已学习风格: ${data.theme.name}`);
                                                refreshPptxThemes();
                                              } else {
                                                message.error(data.error || "风格学习失败");
                                              }
                                            } catch { message.error("上传失败"); }
                                          };
                                          input.click();
                                        }}
                                        style={{
                                          width: 20, height: 20, borderRadius: 4, cursor: "pointer",
                                          border: "1px dashed #aaa", display: "flex", alignItems: "center", justifyContent: "center",
                                          fontSize: 12, color: "#aaa",
                                        }}
                                      >+</div>
                                    </Flex>
                                    {/* 幻灯片卡片列表 */}
                                    <div style={{
                                      display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8,
                                      scrollbarWidth: "thin",
                                    }}>
                                      {slides.map((slide, si) => {
                                        const isCover = si === 0 && slide.bullets.length === 0;
                                        return (
                                          <div key={si} style={{
                                            flex: "0 0 240px", height: 135, borderRadius: 6,
                                            background: colors.bg, border: "1px solid var(--ant-color-border)",
                                            padding: 0, overflow: "hidden", position: "relative",
                                            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                                          }}>
                                            {/* 顶部装饰线 */}
                                            <div style={{ height: 3, background: colors.accent }} />
                                            <div style={{ padding: "8px 12px" }}>
                                              {isCover ? (
                                                <div style={{ textAlign: "center", paddingTop: 20 }}>
                                                  <div style={{
                                                    fontSize: 13, fontWeight: 700, color: colors.title,
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                  }}>{slide.title}</div>
                                                  <div style={{ width: 40, height: 2, background: colors.accent, margin: "6px auto" }} />
                                                </div>
                                              ) : (
                                                <>
                                                  <div style={{
                                                    fontSize: 11, fontWeight: 600, color: colors.title,
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                    marginBottom: 2,
                                                  }}>{slide.title}</div>
                                                  <div style={{ width: 20, height: 2, background: colors.accent, marginBottom: 6 }} />
                                                  <div style={{ fontSize: 9, color: colors.body, lineHeight: 1.6 }}>
                                                    {slide.bullets.slice(0, 4).map((b, bi) => (
                                                      <div key={bi} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        <span style={{ color: colors.accent, marginRight: 4 }}>•</span>{b}
                                                      </div>
                                                    ))}
                                                    {slide.bullets.length > 4 && (
                                                      <div style={{ color: colors.accent, fontSize: 8 }}>+{slide.bullets.length - 4} more</div>
                                                    )}
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                            {/* 页码 */}
                                            <div style={{
                                              position: "absolute", bottom: 4, right: 8,
                                              fontSize: 8, color: colors.body, opacity: 0.6,
                                            }}>{si + 1}</div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* 非 PPT 的普通 MD 预览 */}
                              {isMd && mdContent && !isPpt && (
                                <div style={{
                                  marginTop: 6, padding: "12px 16px", borderRadius: 8,
                                  border: "1px solid var(--ant-color-border)",
                                  background: "var(--ant-color-bg-container)",
                                  maxHeight: 300, overflowY: "auto",
                                  fontSize: 13, lineHeight: 1.7,
                                }}>
                                  <XMarkdown components={markdownComponents}>{mdContent}</XMarkdown>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {msg.fileDownload.zipDownloadUrl && msg.fileDownload.files.length > 1 && (
                        <Button
                          type="dashed"
                          icon={<FileZipOutlined />}
                          onClick={() => {
                            const fd = msg.fileDownload!;
                            apiFetch(fd.zipDownloadUrl!, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ paths: fd.zipPaths, zipName: fd.zipName }),
                            }).then(async (res) => {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url; a.download = fd.zipName || "files.zip"; a.click();
                              URL.revokeObjectURL(url);
                            }).catch(() => message.error("打包下载失败"));
                          }}
                          style={{ height: "auto", padding: "10px 16px", borderRadius: 8, alignSelf: "flex-start" }}
                        >
                          打包下载 ({msg.fileDownload.files.length} 个文件)
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            if (msg.role === "user_confirm") {
              const data = JSON.parse(msg.content);
              const isDisabled = confirmedCards.has(data.confirmId);
              return (
                <div key={msg.id ?? `m${i}`} style={{ marginLeft: 46 }}>
                <ConfirmCard
                  confirmId={data.confirmId}
                  type={data.type}
                  title={data.title}
                  description={data.description}
                  options={data.options}
                  multiSelect={data.multiSelect}
                  fields={data.fields}
                  confirmText={data.confirmText}
                  cancelText={data.cancelText}
                  disabled={isDisabled}
                  onConfirm={async (confirmId, response) => {
                    try {
                      await apiFetch("/api/agent/chat/confirm", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ confirmId, response }),
                      });
                      setConfirmedCards(prev => new Set(prev).add(confirmId));
                      // 更新前面 tool 消息的文字为用户选择内容
                      const label = (response as any)?.selectedLabel || (response as any)?.selected?.map((s: any) => s.label).join(", ") || "已确认";
                      setMessages(prev => {
                        const next = [...prev];
                        // 从当前 confirm 消息往前找最近的 user_confirm tool
                        for (let j = next.length - 1; j >= 0; j--) {
                          if (next[j].role === "tool" && next[j].skillName === "user_confirm" && next[j].content === "等待用户确认...") {
                            next[j] = { ...next[j], content: `已选择: ${label}` };
                            break;
                          }
                        }
                        return next;
                      });
                    } catch (err) {
                      console.error("Confirm failed:", err);
                    }
                  }}
                  onCancel={async (confirmId) => {
                    try {
                      await apiFetch("/api/agent/chat/confirm", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ confirmId, cancelled: true }),
                      });
                      setConfirmedCards(prev => new Set(prev).add(confirmId));
                      // 更新 tool 消息为已取消
                      setMessages(prev => {
                        const next = [...prev];
                        for (let j = next.length - 1; j >= 0; j--) {
                          if (next[j].role === "tool" && next[j].skillName === "user_confirm" && next[j].content === "等待用户确认...") {
                            next[j] = { ...next[j], content: "已取消" };
                            break;
                          }
                        }
                        return next;
                      });
                    } catch (err) {
                      console.error("Cancel failed:", err);
                    }
                  }}
                />
                </div>
              );
            }
            if (msg.role === "system") {
              return <Flex key={msg.id ?? `m${i}`} justify="center"><Tag color="warning">{msg.content}</Tag></Flex>;
            }
            // assistant
            const isStreaming = loading && i === messages.length - 1;
            const bubbleContent = msg.content || (isStreaming ? "..." : "");
            const refs = msg.kbReferences;
            return (
              <div key={msg.id ?? `m${i}`}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', animation: 'fade-in-up 0.3s ease-out' }}>
                  <img src="/ai-avatar.png" alt="AI" style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isStreaming && !msg.content ? (
                      <Spin size="small" />
                    ) : (
                      <XMarkdown
                        content={preprocessFootnotes(bubbleContent)}
                        streaming={{ hasNextChunk: isStreaming }}
                        components={{
                          ...markdownComponents,
                          kbref: ({ children, ...props }: any) => {
                            const idx = parseInt(props["data-index"] || "0", 10);
                            return (
                              <sup
                                style={{ color: "#1677ff", cursor: refs?.length ? "pointer" : "default", fontWeight: 600, fontSize: "0.75em", padding: "0 1px" }}
                                onClick={refs?.length ? (e: React.MouseEvent) => { e.stopPropagation(); setViewingRefs(refs); setViewingRefIndex(idx); } : undefined}
                              >
                                {children}
                              </sup>
                            );
                          },
                        }}
                        openLinksInNewTab
                      />
                    )}
                  </div>
                </div>
                {refs && refs.length > 0 && !loading && (() => {
                  // 按文档去重，合并引用编号
                  const docMap = new Map<string, { docName: string; indices: number[]; ref: KbReference }>();
                  for (const ref of refs) {
                    const existing = docMap.get(ref.docId);
                    if (existing) {
                      existing.indices.push(ref.index);
                    } else {
                      docMap.set(ref.docId, { docName: ref.docName, indices: [ref.index], ref });
                    }
                  }
                  const extLabelMap: Record<string, { label: string; color: string; bg: string }> = {
                    "pdf": { label: "PDF", color: "#ff4d4f", bg: "#fff1f0" },
                    "doc": { label: "Word", color: "#1677ff", bg: "#e6f4ff" },
                    "docx": { label: "Word", color: "#1677ff", bg: "#e6f4ff" },
                    "xls": { label: "Excel", color: "#52c41a", bg: "#f6ffed" },
                    "xlsx": { label: "Excel", color: "#52c41a", bg: "#f6ffed" },
                    "ppt": { label: "PPT", color: "#fa8c16", bg: "#fff7e6" },
                    "pptx": { label: "PPT", color: "#fa8c16", bg: "#fff7e6" },
                    "md": { label: "MD", color: "#722ed1", bg: "#f9f0ff" },
                    "txt": { label: "Text", color: "#8c8c8c", bg: "#fafafa" },
                  };
                  return (
                    <div style={{ padding: "8px 0 0 48px", overflow: "hidden" }}>
                      <div style={{
                        display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
                        scrollbarWidth: "thin",
                        WebkitOverflowScrolling: "touch",
                      }}>
                        {[...docMap.entries()].map(([docId, { docName, indices }]) => {
                          const ext = docName.split(".").pop()?.toLowerCase() || "";
                          const meta = extLabelMap[ext] || { label: ext.toUpperCase() || "FILE", color: "#8c8c8c", bg: "#fafafa" };
                          return (
                            <div
                              key={docId}
                              className="kb-ref-card"
                              onClick={() => { setViewingRefs(refs); setViewingRefIndex(indices[0]); }}
                            >
                              <div className="decor-circle" style={{ background: meta.color }} />
                              <Flex align="center" gap={10}>
                                <div style={{
                                  width: 36, height: 36, borderRadius: 8,
                                  background: meta.bg,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 18, flexShrink: 0,
                                }}>
                                  {getFileIcon("." + ext)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: 12, fontWeight: 500, color: "#333",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    lineHeight: 1.3,
                                  }}>{docName}</div>
                                  <Flex align="center" gap={6} style={{ marginTop: 2 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, color: meta.color,
                                      background: meta.bg, padding: "1px 6px", borderRadius: 4,
                                    }}>{meta.label}</span>
                                    {indices.length > 1 && (
                                      <span style={{ fontSize: 10, color: "#999" }}>{indices.length} 处引用</span>
                                    )}
                                  </Flex>
                                </div>
                              </Flex>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {msg.webReferences && msg.webReferences.length > 0 && !loading && (
                  <div style={{ padding: "6px 0 0 48px", overflow: "hidden" }}>
                    <div style={{
                      display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
                      scrollbarWidth: "thin",
                      WebkitOverflowScrolling: "touch",
                    }}>
                      {msg.webReferences.map((wr) => (
                        <div
                          key={wr.index}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 14px", borderRadius: 10,
                            background: "rgba(255,255,255,0.95)",
                            border: "1px solid rgba(0,0,0,0.06)",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                            cursor: "pointer", minWidth: 180, maxWidth: 280, flexShrink: 0,
                            transition: "box-shadow 0.2s, border-color 0.2s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; e.currentTarget.style.borderColor = "#13c2c2"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)"; }}
                          onClick={() => window.open(wr.url, "_blank")}
                        >
                          <div style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: "#e6fffb",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 18, flexShrink: 0,
                          }}>
                            <LinkOutlined style={{ color: "#13c2c2" }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 500, color: "#333",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              lineHeight: 1.3,
                            }}>{wr.title}</div>
                            <div style={{
                              fontSize: 10, color: "#999", marginTop: 2,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{wr.url.replace(/^https?:\/\//, "").split("/")[0]}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Sender with Attachments Header */}
        <div className="chat-sender-area">
          <Sender
            ref={senderRef}
            placeholder={hasParsingAttachments ? "文档解析中，请稍候..." : t("chat_placeholder")}
            loading={loading}
            disabled={hasParsingAttachments}
            value={inputValue}
            onChange={setInputValue}
            onSubmit={sendMessage}
            onCancel={stopChat}
            header={
              <Sender.Header
                title={hasParsingAttachments ? `附件 (${attachments.length}) — 转换中...` : `附件 (${attachments.length})`}
                open={headerOpen}
                onOpenChange={setHeaderOpen}
                closable
                styles={{ content: { padding: 12 } }}
              >
                <Attachments
                  ref={attachmentsRef}
                  accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.txt,.md,.csv,.tsv,.json,.log,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                  multiple
                  customRequest={handleAttachmentUpload}
                  items={attachments}
                  onChange={handleAttachmentChange}
                  disabled={loading}
                  placeholder={{
                    icon: <LinkOutlined style={{ fontSize: 20 }} />,
                    title: "拖拽文件到此处或点击上传",
                    description: "支持 PDF、Word、Excel、PPT、CSV、图片、文本等格式",
                  }}
                  getDropContainer={() => senderRef.current?.nativeElement}
                  onPreview={(file: any) => {
                    const uid = file.uid;
                    if (attachmentParseContent.current.has(uid)) {
                      setViewingAttachment({
                        uid,
                        name: file.name || "未知文件",
                        content: attachmentParseContent.current.get(uid) || "",
                        path: attachmentPaths.current.get(uid) || "",
                        tags: attachmentParseTags.current.get(uid) || [],
                        pageCount: attachmentPageCount.current.get(uid),
                      });
                    }
                  }}
                />
              </Sender.Header>
            }
            prefix={
              <Badge count={attachments.length} size="small">
                <Button
                  type="text"
                  icon={<LinkOutlined />}
                  disabled={loading}
                  onClick={() => setHeaderOpen(!headerOpen)}
                />
              </Badge>
            }
          />
        </div>
      </Flex>

      {/* 附件解析内容查看 Drawer */}
      <Drawer
        title={viewingAttachment?.name || "文件内容"}
        open={!!viewingAttachment}
        onClose={() => { setViewingAttachment(null); setViewingPageImages([]); setViewingTab("markdown"); }}
        afterOpenChange={(open) => {
          if (open && viewingAttachment?.path) {
            // 从磁盘获取页面图片列表（永久存储）
            apiFetch(`/api/upload/parse-images?path=${encodeURIComponent(viewingAttachment.path)}`)
              .then((r) => r.json())
              .then((d) => { if (d.success && d.pages?.length) setViewingPageImages(d.pages); })
              .catch(() => {});
          }
        }}
        placement="right"
        width={viewingTab === "compare" ? 960 : 600}
        extra={
          <Flex gap={8} align="center">
            {viewingPageImages.length > 0 && (
              <Segmented
                size="small"
                value={viewingTab}
                onChange={(v) => setViewingTab(v as any)}
                options={[
                  { label: "解析内容", value: "markdown" },
                  { label: "原始页面", value: "images" },
                  { label: "对照视图", value: "compare" },
                ]}
              />
            )}
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={async () => {
                if (!viewingAttachment) return;
                try {
                  const res = await apiFetch("/api/knowledge/ingest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: viewingAttachment.name,
                      content: viewingAttachment.content,
                      tags: viewingAttachment.tags || [],
                    }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    message.success("已加入知识库");
                  } else {
                    message.error(data.error || "加入知识库失败");
                  }
                } catch {
                  message.error("加入知识库失败");
                }
              }}
            >
              加入知识库
            </Button>
          </Flex>
        }
      >
        {viewingAttachment?.tags && viewingAttachment.tags.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>自动标签：</Text>
            {viewingAttachment.tags.map((tag) => <Tag key={tag} color="blue" style={{ fontSize: 12 }}>{tag}</Tag>)}
          </div>
        )}
        {viewingTab === "markdown" && (
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            <XMarkdown>{viewingAttachment?.content || "(无内容)"}</XMarkdown>
          </div>
        )}
        {viewingTab === "images" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {viewingPageImages.length > 0 ? viewingPageImages.map((page) => (
              <div key={page} style={{ border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "4px 12px", background: "var(--ant-color-bg-layout)", fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                  第 {page} 页
                </div>
                <img
                  src={`/api/upload/parse-images?path=${encodeURIComponent(viewingAttachment?.path || "")}&page=${page}`}
                  alt={`第 ${page} 页`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                  loading="lazy"
                />
              </div>
            )) : <Text type="secondary">暂无页面图片</Text>}
          </div>
        )}
        {viewingTab === "compare" && (() => {
          // 按 --- 分割解析内容，与页面图片一一对应
          const mdPages = (viewingAttachment?.content || "").split(/\n\n---\n\n/).filter(Boolean);
          const maxPages = Math.max(mdPages.length, viewingPageImages.length);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {Array.from({ length: maxPages }, (_, idx) => (
                <div key={idx} style={{ display: "flex", gap: 16, border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                  {/* 左：原始图片 */}
                  <div style={{ flex: 1, minWidth: 0, background: "#f5f5f5" }}>
                    <div style={{ padding: "4px 10px", fontSize: 11, color: "#999", borderBottom: "1px solid #eee" }}>原始 · 第 {idx + 1} 页</div>
                    {viewingPageImages[idx] ? (
                      <img
                        src={`/api/upload/parse-images?path=${encodeURIComponent(viewingAttachment?.path || "")}&page=${viewingPageImages[idx]}`}
                        alt={`第 ${idx + 1} 页`}
                        style={{ width: "100%", height: "auto", display: "block" }}
                        loading="lazy"
                      />
                    ) : <div style={{ padding: 16, color: "#ccc", textAlign: "center" }}>无图片</div>}
                  </div>
                  {/* 右：解析内容 */}
                  <div style={{ flex: 1, minWidth: 0, padding: 12, fontSize: 13, lineHeight: 1.7, overflow: "auto", maxHeight: 500 }}>
                    <div style={{ padding: "4px 0", fontSize: 11, color: "#999", borderBottom: "1px solid #eee", marginBottom: 8 }}>解析 · 第 {idx + 1} 页</div>
                    {mdPages[idx] ? <XMarkdown>{mdPages[idx]}</XMarkdown> : <Text type="secondary">无内容</Text>}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Drawer>

      {/* KB 引用详情 Drawer */}
      <Drawer
        title={
          <Flex align="center" gap={8}>
            <BookOutlined style={{ color: "#1677ff" }} />
            <span>知识库引用 ({viewingRefs?.length ?? 0})</span>
          </Flex>
        }
        open={!!viewingRefs}
        onClose={() => { setViewingRefs(null); setViewingRefIndex(null); setRefViewMode("auto"); setRefDocPages({}); }}
        placement="right"
        width={560}
        extra={
          <Segmented
            size="small"
            value={refViewMode}
            onChange={(v) => setRefViewMode(v as any)}
            options={[
              { label: "原图视图", value: "auto" },
              { label: "文本内容", value: "text" },
            ]}
          />
        }
        afterOpenChange={(open) => {
          if (open && viewingRefs) {
            // 异步获取每个引用文档的页面图片列表
            const docIds = [...new Set(viewingRefs.map((r) => r.docId))];
            for (const docId of docIds) {
              apiFetch(`/api/knowledge/documents/${docId}/pages`)
                .then((res) => res.json())
                .then((data) => {
                  if (data.success && data.pages?.length > 0) {
                    setRefDocPages((prev) => ({ ...prev, [docId]: data.pages }));
                  }
                })
                .catch(() => {});
            }
            // 滚动到目标引用
            if (viewingRefIndex != null) {
              setTimeout(() => {
                const el = document.getElementById(`kb-ref-${viewingRefIndex}`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 100);
            }
          }
        }}
      >
        {(() => {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
          const keywords = lastUserMsg ? extractKeywords(lastUserMsg.content) : [];
          return viewingRefs?.map((ref) => {
            const hasBbox = ref.bboxes && ref.bboxes.length > 0;
            const docPages = refDocPages[ref.docId] || [];
            const hasDocImages = docPages.length > 0;

            // 决定是否显示图片
            const wantImage = refViewMode === "auto";
            // 确定要展示的页码
            let showPages: number[] = [];
            if (wantImage) {
              if (hasBbox) {
                // 有 bbox：精确显示涉及的页码
                showPages = [...new Set(ref.bboxes!.map((b) => b.page))];
              } else if (ref.pageNumber != null && hasDocImages && docPages.includes(ref.pageNumber)) {
                // 有 pageNumber 但无 bbox：显示该页（无高亮）
                showPages = [ref.pageNumber];
              } else if (hasDocImages) {
                // 无 pageNumber 但文档有图片：根据 chunkIndex 估算页码
                const estimatedPage = Math.min(ref.chunkIndex + 1, docPages.length);
                showPages = [docPages[estimatedPage - 1] || docPages[0]];
              }
            }

            return (
              <div
                key={ref.index}
                id={`kb-ref-${ref.index}`}
                style={{
                  marginBottom: 16,
                  padding: 16,
                  borderRadius: 8,
                  border: viewingRefIndex === ref.index ? "2px solid #1677ff" : "1px solid var(--ant-color-border)",
                  background: viewingRefIndex === ref.index ? "#e6f4ff" : "var(--ant-color-bg-layout)",
                  transition: "all 0.3s",
                }}
              >
                <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                  <Flex align="center" gap={8}>
                    <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>[^{ref.index}]</Tag>
                    <Text strong style={{ fontSize: 14 }}>{ref.docName}</Text>
                  </Flex>
                  <Tag color={ref.score >= 0.7 ? "green" : ref.score >= 0.4 ? "orange" : "default"}>
                    相关度 {(ref.score * 100).toFixed(0)}%
                  </Tag>
                </Flex>
                <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    第 {ref.chunkIndex + 1} 段{ref.pageNumber != null ? ` · 第 ${ref.pageNumber} 页` : ""}
                  </Text>
                  <Button type="link" size="small" style={{ fontSize: 11, padding: 0 }} onClick={() => handleViewKbDoc(ref.docId, ref.docName)}>
                    查看完整文档
                  </Button>
                </Flex>
                {wantImage && showPages.length > 0 ? (
                  <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid var(--ant-color-border)" }}>
                    {showPages.map((page) => (
                      hasBbox
                        ? <HighlightedPageImage key={page} docId={ref.docId} page={page} bboxes={ref.bboxes!} />
                        : <img key={page} src={pageImageUrl(ref.docId, page)} alt={`第 ${page} 页`} style={{ width: "100%", height: "auto", display: "block" }} loading="lazy" />
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.7,
                      padding: 12,
                      borderRadius: 6,
                      background: "var(--ant-color-bg-container)",
                      borderLeft: "3px solid #1677ff",
                      maxHeight: 300,
                      overflow: "auto",
                    }}
                  >
                    <XMarkdown>{ref.content}</XMarkdown>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </Drawer>

      {/* KB 文档完整查看 Drawer */}
      <Drawer
        title={kbDocView?.name || "文档内容"}
        open={!!kbDocView}
        onClose={() => { setKbDocView(null); setKbDocPageImages([]); }}
        placement="right"
        width={kbDocViewTab === "compare" ? 960 : 600}
        loading={kbDocViewLoading}
        extra={
          kbDocPageImages.length > 0 ? (
            <Segmented
              size="small"
              value={kbDocViewTab}
              onChange={(v) => setKbDocViewTab(v as any)}
              options={[
                { label: "解析内容", value: "markdown" },
                { label: "原始页面", value: "images" },
                { label: "对照视图", value: "compare" },
              ]}
            />
          ) : null
        }
      >
        {kbDocViewTab === "markdown" && (
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            <XMarkdown>{kbDocView?.content || "(无内容)"}</XMarkdown>
          </div>
        )}
        {kbDocViewTab === "images" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {kbDocPageImages.length > 0 ? kbDocPageImages.map((page) => (
              <div key={page} style={{ border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ background: "var(--ant-color-bg-layout)", padding: "4px 12px", fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                  第 {page} 页
                </div>
                <img
                  src={pageImageUrl(kbDocView?.docId ?? '', page)}
                  alt={`第 ${page} 页`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                  loading="lazy"
                />
              </div>
            )) : <Text type="secondary">暂无页面图片</Text>}
          </div>
        )}
        {kbDocViewTab === "compare" && (() => {
          const mdPages = (kbDocView?.content || "").split(/\n\n---\n\n/).filter(Boolean);
          const maxPages = Math.max(mdPages.length, kbDocPageImages.length);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {Array.from({ length: maxPages }, (_, idx) => (
                <div key={idx} style={{ display: "flex", gap: 16, border: "1px solid var(--ant-color-border)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ flex: 1, borderRight: "1px solid var(--ant-color-border)" }}>
                    {idx < kbDocPageImages.length ? (
                      <img
                        src={pageImageUrl(kbDocView?.docId ?? '', kbDocPageImages[idx])}
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
