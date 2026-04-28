import { useState, useRef, useCallback, useEffect } from "react";
import { Flex, Typography, Tag, Button, List, Drawer, Badge, Collapse, Spin, message, Segmented } from "antd";
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
  FileZipOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import { useInboxStore } from "@/store/inbox-store";
import InboxPanel from "@/components/inbox/InboxPanel";
import { apiFetch, pageImageUrl, apiCreateConversation } from "@/api";
import ConfirmCard from "@/components/ConfirmCard";
import { getFileIcon, formatFileSize, HighlightedPageImage } from "@/components/chat/utils";
import type { ChatMsg, Conversation, KbReference, WebReference, FileDownloadInfo, FileDownloadData } from "@/components/chat/types";
import DocMindPreview from "@/components/knowledge/DocMindPreview";

const { Text } = Typography;

const PAGE_SIZE = 50;

/** 从消息列表中移除 typing 指示器 */
const removeTyping = (msgs: ChatMsg[]) => msgs.filter(m => !(m.role === "thinking" && m.content === "__typing__"));

// Conversation State Interface
interface ConversationState {
  messages: ChatMsg[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  oldestMessageId: number | null;
  abortController: AbortController | null;
  showThinking: boolean;
  thinkingTimer: NodeJS.Timeout | null;
  pendingKbRefs: KbReference[];
  pendingWebRefs: WebReference[];
  attachments: Attachment[];
  attachmentsSnap: Attachment[];
  attachmentPaths: Map<string, string>;
  attachmentParseContent: Map<string, string>;
  attachmentParseTags: Map<string, string[]>;
  attachmentPageCount: Map<string, number>;
  pollTimers: Map<string, ReturnType<typeof setInterval>>;
  headerOpen: boolean;
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
  img: ({ src, alt }: any) => (
    <img src={src} alt={alt || ""} style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
  ),
  video: ({ src, children }: any) => (
    <video src={src} controls preload="metadata" style={{ maxWidth: "100%", borderRadius: 8 }} onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; }}>
      {children}
    </video>
  ),
};

// ---- Preprocess [^N] → <kbref data-index="N">[N]</kbref> for XMarkdown ----
function preprocessFootnotes(md: string): string {
  return md.replace(/\[\^(\d+)\]/g, '<kbref data-index="$1">[$1]</kbref>');
}

// ---- Preprocess bare image/video URLs → renderable syntax ----
function preprocessImages(md: string): string {
  // 1. Markdown 链接 [text](url) 中的 url 是图片的情况，转换为 ![text](url)
  let result = md.replace(
    /(?<!!)\[([^\]]+)\]\((https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s)]*)?)\)/gi,
    (_match, alt, url) => `![${alt}](${url})`
  );
  // 2. 独立的图片 URL（整行或前后有空格/换行）
  result = result.replace(
    /(^|\s)(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s]*)?)(?=\s|$)/gi,
    (_match, prefix, url) => `${prefix}![图片](${url})`
  );
  return result;
}

// ---- Extract suggested questions from assistant message ----
function extractSuggestedQuestions(content: string): string[] {
  if (!content) return [];

  // Pattern 1: Header + list (bullet or numbered)
  const headerPattern = /(?:推荐问题|建议问题|您还可以问|相关问题|更多问题|类似问题|继续探索)[：:]\s*(?:\n|\r\n?)((?:[-*•]\s*.+(?:\n|\r\n?))*)/i;
  const numberedHeaderPattern = /(?:推荐问题|建议问题|您还可以问|相关问题|更多问题|类似问题|继续探索)[：:]\s*(?:\n|\r\n?)((?:\d+[.．、]\s*.+(?:\n|\r\n?))*)/i;

  for (const pattern of [headerPattern, numberedHeaderPattern]) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const questions = match[1]
        .split(/\n|\r\n?/)
        .map(line => line.replace(/^[-*•\d.．、\s]+/, '').trim())
        .filter(q => q.length > 3 && !q.startsWith('```'));
      if (questions.length >= 2) return questions;
    }
  }

  // Pattern 2: Detect question list at end of message (no header)
  const lines = content.split(/\n|\r\n?/).map(l => l.trim()).filter(Boolean);
  const lastBlock: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^[-*•]\s/.test(line) || /^\d+[.．、]\s/.test(line)) {
      lastBlock.unshift(line.replace(/^[-*•\d.．、\s]+/, '').trim());
    } else if (lastBlock.length > 0) {
      break;
    }
  }
  if (lastBlock.length >= 2) {
    return lastBlock.filter(q => q.length > 3);
  }

  return [];
}

function preprocessVideos(md: string): string {
  // 视频没有标准 Markdown 语法，用 HTML video 标签（XMarkdown 支持）
  // 1. Markdown 链接 [text](url) 中的 url 是视频的情况
  let result = md.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+\.(?:mp4|webm|mov|mkv|avi)(?:\?[^\s)]*)?)\)/gi,
    (_match, alt, url) => `<video src="${url}" controls preload="metadata" style="max-width:100%;border-radius:8px"><p>${alt}</p></video>`
  );
  // 2. 独立的视频 URL
  result = result.replace(
    /(^|\s)(https?:\/\/[^\s]+\.(?:mp4|webm|mov|mkv|avi)(?:\?[^\s]*)?)(?=\s|$)/gi,
    (_match, prefix, url) => `${prefix}<video src="${url}" controls preload="metadata" style="max-width:100%;border-radius:8px">视频</video>`
  );
  return result;
}

// ---- API helpers ----
function parseMsg(m: any): ChatMsg {
  const parsed: ChatMsg = {
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
    resultData: m.extra?.resultData ?? undefined,
  };
  // 预解析 user_confirm 数据，避免每次渲染 JSON.parse 产生新对象引用
  if (parsed.role === "user_confirm") {
    try {
      parsed.parsedData = JSON.parse(m.content);
    } catch {}
  }
  return parsed;
}

interface ChatPageProps {
  embedded?: boolean;
}

export default function ChatPage({ embedded = false }: ChatPageProps) {
  const t = useI18nStore((s) => s.t);
  const embeddedRole = useAuthStore((s) => s.embeddedRole);
  const panelOpen = useInboxStore((s) => s.panelOpen);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convStates, setConvStates] = useState<Map<string, ConversationState>>(new Map());
  const [activeConvId, _setActiveConvId] = useState<string | null>(null);
  const activeConvIdRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);

  // 全局状态（不随对话切换而清空）
  const [mdPreviews, setMdPreviews] = useState<Record<string, string>>({});
  const [confirmedCards, setConfirmedCards] = useState<Set<string>>(new Set());
  const [confirmedDataMap, setConfirmedDataMap] = useState<Record<string, any>>({});
  const [pptxThemes, setPptxThemes] = useState<Array<{ name: string; label: string; custom: boolean; sourceFile?: string; preview: { bg: string; title: string; accent: string } }>>([]);
  const pptxThemesFetched = useRef(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<{ uid: string; name: string; content: string; path: string; tags: string[]; pageCount?: number } | null>(null);
  const [viewingTab, setViewingTab] = useState<"markdown" | "images" | "compare">("markdown");
  const [viewingPageImages, setViewingPageImages] = useState<number[]>([]);
  const [viewingRefs, setViewingRefs] = useState<KbReference[] | null>(null);
  const [viewingRefIndex, setViewingRefIndex] = useState<number | null>(null);
  const [refViewMode, setRefViewMode] = useState<"auto" | "restored" | "text">("auto");
  const [refDocPages, setRefDocPages] = useState<Record<string, number[]>>({});
  const [refDocLayouts, setRefDocLayouts] = useState<any[]>([]);
  const [kbDocView, setKbDocView] = useState<{ docId: string; name: string; content: string } | null>(null);
  const [kbDocViewTab, setKbDocViewTab] = useState<"markdown" | "images" | "restored">("markdown");
  const [kbDocLayouts, setKbDocLayouts] = useState<any[]>([]);
  const [kbDocPageImages, setKbDocPageImages] = useState<number[]>([]);
  const [kbDocViewLoading, setKbDocViewLoading] = useState(false);

  // 输入框状态（全局，切换对话时保留）
  const [inputValue, setInputValue] = useState("");

  // Sender refs (全局，因为不需要随对话切换重置)
  const senderRef = useRef<any>(null);
  const attachmentsRef = useRef<AttachmentsRef>(null);

  const setActiveConvId = (id: string | null) => {
    activeConvIdRef.current = id;
    _setActiveConvId(id);
  };

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (pptxThemesFetched.current) return;
    pptxThemesFetched.current = true;
    apiFetch("/api/pptx/themes").then((r) => r.json()).then((d) => {
      if (d.success && d.themes) setPptxThemes(d.themes);
    }).catch(() => {});
  }, []);

  // 引用抽屉打开时，Document Mind 文档获取 layouts 用于还原视图
  useEffect(() => {
    if (!viewingRefs || viewingRefIndex === null) {
      setRefDocLayouts([]);
      return;
    }
    const ref = viewingRefs[viewingRefIndex];
    if (!ref || !ref.docMindTaskId || ref.pageNumber == null) {
      setRefDocLayouts([]);
      return;
    }
    apiFetch(`/api/knowledge/documents/${ref.docId}/layouts`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.layouts)) {
          setRefDocLayouts(d.layouts);
        } else {
          setRefDocLayouts([]);
        }
      })
      .catch(() => setRefDocLayouts([]));
  }, [viewingRefs, viewingRefIndex]);

  // Initialize conversation state
  const getOrCreateConvState = useCallback((convId: string): ConversationState => {
    return {
      messages: [],
      loading: false,
      hasMore: false,
      loadingMore: false,
      oldestMessageId: null,
      abortController: null,
      showThinking: false,
      thinkingTimer: null,
      pendingKbRefs: [],
      pendingWebRefs: [],
      attachments: [],
      attachmentsSnap: [],
      attachmentPaths: new Map(),
      attachmentParseContent: new Map(),
      attachmentParseTags: new Map(),
      attachmentPageCount: new Map(),
      pollTimers: new Map(),
      headerOpen: false,
    };
  }, []);

  // Update conversation state
  const updateConvState = useCallback((convId: string, updates: Partial<ConversationState>) => {
    setConvStates(prev => {
      const next = new Map(prev);
      const current = next.get(convId) || getOrCreateConvState(convId);
      next.set(convId, { ...current, ...updates });
      return next;
    });
  }, [getOrCreateConvState]);

  // Load conversations
  const loadConversations = async () => {
    try {
      const res = await apiFetch("/api/conversations");
      const data = await res.json();
      if (data.success) {
        const convs = data.conversations || [];
        setConversations(convs);

        // Initialize states for new conversations
        setConvStates(prev => {
          const next = new Map(prev);
          for (const conv of convs) {
            if (!next.has(conv.id)) {
              next.set(conv.id, getOrCreateConvState(conv.id));
            }
          }
          return next;
        });

        if (convs.length > 0 && !activeConvIdRef.current) {
          const latest = convs[0];
          setActiveConvId(latest.id);
          loadMessages(latest.id);
        }
      }
    } catch (err: unknown) {
      console.warn('Failed to load conversations:', err);
    }
  };

  // 从历史消息中推断哪些 user_confirm 卡片已经被处理过，并提取已提交的数据
  const syncConfirmedCards = (messages: ChatMsg[]) => {
    const toDisable: string[] = [];
    const newDataMap: Record<string, any> = {};
    messages.forEach((msg, i) => {
      if (msg.role === "user_confirm") {
        // 如果 user_confirm 后面有 assistant/tool/user 等实际跟进消息，说明已处理
        const hasFollowUp = messages.slice(i + 1).some(m =>
          m.role === "assistant" || m.role === "tool" || m.role === "user"
        );
        if (hasFollowUp) {
          try {
            const data = msg.parsedData || JSON.parse(msg.content);
            if (data.confirmId) {
              toDisable.push(data.confirmId);
              // 查找后续 tool 消息，优先找包含 userResponse 的（新格式），fallback 到第一个
              const toolMsgs = messages.slice(i + 1).filter(m => m.role === "tool");
              const userResponseMsg = toolMsgs.find(m => m.resultData?.userResponse !== undefined);
              const toolMsg = userResponseMsg || toolMsgs[0];
              if (toolMsg) {
                // 防御性处理：extra 可能是字符串（旧数据）或对象
                let extra = (toolMsg as any).extra;
                if (typeof extra === "string") {
                  try { extra = JSON.parse(extra); } catch { extra = undefined; }
                }
                const submitted = (toolMsg as any).resultData || extra?.resultData;
                // tool result data 包装在 { userResponse: formData } 中，需要解包
                let formData = submitted?.userResponse ?? submitted;
                // 过滤空对象/空值，避免错误恢复
                if (formData && typeof formData === "object" && !Array.isArray(formData)) {
                  if (Object.keys(formData).length > 0) {
                    newDataMap[data.confirmId] = formData;
                  }
                } else if (formData !== undefined && formData !== null) {
                  // 非对象值（如字符串、数字）也保存
                  newDataMap[data.confirmId] = formData;
                }
              }
            }
          } catch (e) {
            console.warn("[syncConfirmedCards] parse error:", e);
          }
        }
      }
    });
    if (toDisable.length > 0) {
      setConfirmedCards(prev => {
        const next = new Set(prev);
        toDisable.forEach(id => next.add(id));
        return next;
      });
    }
    if (Object.keys(newDataMap).length > 0) {
      setConfirmedDataMap(prev => ({ ...prev, ...newDataMap }));
    }
  };

  // Load messages for conversation
  const loadMessages = async (convId: string, beforeId?: number) => {
    try {
      const url = beforeId && beforeId > 0
        ? `/api/conversations/${convId}/messages?limit=${PAGE_SIZE}&before_id=${beforeId}`
        : `/api/conversations/${convId}/messages?limit=${PAGE_SIZE}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success) {
        const newMessages = (data.messages || []).map((m: any) => parseMsg(m)).filter((m: ChatMsg) => m.status !== "streaming");
        const oldestId = newMessages.length > 0 ? newMessages[0].id ?? null : null;

        setConvStates(prev => {
          const currentState = prev.get(convId) || getOrCreateConvState(convId);
          const mergedMessages = beforeId && beforeId > 0
            ? [...newMessages, ...currentState.messages]
            : newMessages;
          return new Map(prev).set(convId, {
            ...currentState,
            messages: mergedMessages,
            hasMore: !!data.hasMore,
            oldestMessageId: oldestId ?? currentState.oldestMessageId,
          });
        });

        if (!beforeId) {
          shouldScrollRef.current = true;
          syncConfirmedCards(newMessages);
          // 加载完成后滚动到底部（页面刷新/初始加载时）
          requestAnimationFrame(() => {
            setTimeout(() => {
              const container = scrollContainerRef.current;
              if (container) {
                container.scrollTop = container.scrollHeight;
              }
            }, 50);
          });
        } else {
          // prepend 后需要基于整个合并后的列表重新同步
          const currentState = convStates.get(convId);
          if (currentState) {
            syncConfirmedCards([...newMessages, ...currentState.messages]);
          }
        }
      }
    } catch (err: unknown) {
      console.warn('Failed to load messages:', err);
    }
  };

  // Load older messages for pagination
  const loadMoreMessages = async (convId: string) => {
    const state = convStates.get(convId);
    if (!state || !state.hasMore || state.loadingMore || !state.oldestMessageId) return;

    updateConvState(convId, { loadingMore: true });
    const container = scrollContainerRef.current;
    const oldScrollHeight = container?.scrollHeight || 0;
    const oldScrollTop = container?.scrollTop || 0;

    await loadMessages(convId, state.oldestMessageId);

    // Restore scroll position after prepending messages
    if (container) {
      const newScrollHeight = container.scrollHeight;
      container.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
    }

    updateConvState(convId, { loadingMore: false });
  };

  // Handle KB doc view
  const handleViewKbDoc = async (docId: string, docName: string) => {
    setKbDocViewLoading(true);
    setKbDocPageImages([]);
    setKbDocLayouts([]);
    setKbDocView({ docId, name: docName, content: "" });
    try {
      const [contentRes, pagesRes, layoutsRes] = await Promise.all([
        apiFetch(`/api/knowledge/documents/${docId}/content`),
        apiFetch(`/api/knowledge/documents/${docId}/pages`),
        apiFetch(`/api/knowledge/documents/${docId}/layouts`),
      ]);
      const contentData = await contentRes.json();
      const pagesData = await pagesRes.json();
      const layoutsData = await layoutsRes.json();

      setKbDocView((prev) => prev ? { ...prev, content: contentData.success ? (contentData.content || "(无内容)") : `加载失败: ${contentData.error}` } : null);

      const hasLayouts = layoutsData.success && Array.isArray(layoutsData.layouts) && layoutsData.layouts.length > 0;
      if (hasLayouts) {
        setKbDocLayouts(layoutsData.layouts);
      }

      if (pagesData.success && pagesData.pages?.length > 0) {
        setKbDocPageImages(pagesData.pages);
        // If layouts available, prefer restored view; otherwise images
        setKbDocViewTab(hasLayouts ? "restored" : "images");
      } else if (hasLayouts) {
        setKbDocViewTab("restored");
      } else {
        setKbDocViewTab("markdown");
      }
    } catch (e: any) {
      setKbDocView({ docId, name: docName, content: `加载失败: ${e.message}` });
      setKbDocViewTab("markdown");
    }
    setKbDocViewLoading(false);
  };

  const handleConfirmCard = (cardId: string, _confirmed: boolean) => {
    setConfirmedCards((prev) => {
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });
  };

  // Attachment handling
  const startPollParseStatus = (convId: string, uid: string, serverPath: string) => {
    const state = convStates.get(convId)!;
    // 更新附件描述为"转换中"
    const list = state.attachments.map((a) => a.uid === uid ? { ...a, description: "转换中...", status: "uploading" as const } : a);
    updateConvState(convId, {
      attachments: list,
    });

    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/upload/parse-status?path=${encodeURIComponent(serverPath)}`);
        const data = await res.json();
        if (data.status === "done") {
          clearInterval(timer);
          state.pollTimers.delete(uid);
          state.attachmentParseContent.set(uid, data.content || "");
          if (data.tags && Array.isArray(data.tags)) {
            state.attachmentParseTags.set(uid, data.tags);
          }
          if (data.pageCount) {
            state.attachmentPageCount.set(uid, data.pageCount);
          }
          const tagsLabel = data.tags?.length ? ` | 标签: ${data.tags.join(", ")}` : "";
          const updatedList = state.attachments.map((a) => a.uid === uid ? { ...a, description: `已解析 (${data.format || "text"})${tagsLabel}`, status: "done" as const } : a);
          updateConvState(convId, {
            attachments: updatedList,
          });
        } else if (data.status === "error") {
          clearInterval(timer);
          state.pollTimers.delete(uid);
          const updatedList = state.attachments.map((a) => a.uid === uid ? { ...a, description: `解析失败: ${data.error || "未知错误"}`, status: "error" as const } : a);
          updateConvState(convId, {
            attachments: updatedList,
          });
        }
      } catch {
        // 网络错误，继续重试
      }
    }, 2000);
    state.pollTimers.set(uid, timer);
  };

  const handleAttachmentChange = (convId: string, info: any) => {
    const state = convStates.get(convId)!;
    const list: Attachment[] = Array.isArray(info) ? info : info?.fileList ?? info;
    // 过滤掉被删除的附件，清理相关资源
    const removedUids = new Set(state.attachments.map((a) => a.uid).filter((uid) => !list.some((b) => b.uid === uid)));
    removedUids.forEach((uid) => {
      state.attachmentPaths.delete(uid);
      state.attachmentParseContent.delete(uid);
      state.attachmentParseTags.delete(uid);
      const timer = state.pollTimers.get(uid);
      if (timer) {
        clearInterval(timer);
        state.pollTimers.delete(uid);
      }
    });
    updateConvState(convId, {
      attachments: list,
    });
    state.attachmentsSnap = list;
    if (list.length > 0) {
      updateConvState(convId, {
        headerOpen: true,
      });
    }
  };

  const handleAttachmentUpload = async (convId: string, options: any) => {
    const { file, onSuccess, onError } = options;
    const state = convStates.get(convId)!;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        const path = data.data?.files?.map((f: any) => f?.path).filter(Boolean)[0] || "uploads/" + file.name;
        state.attachmentPaths.set(file.uid, path);
        onSuccess?.(data, file);
        // 上传成功后开始轮询解析状态
        startPollParseStatus(convId, file.uid, path);
      } else {
        onError?.(new Error(data.error || "上传失败"));
      }
    } catch (e: any) {
      onError?.(e);
    }
  };

  // Send Message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      let convId = activeConvIdRef.current;
      if (!convId) {
        convId = await apiCreateConversation("新对话");
        if (!convId) return;
        setActiveConvId(convId);
        loadConversations();
      }

      // 清空输入框
      setInputValue("");

      const state = convStates.get(convId)!;
      const currentAttachments = state.attachmentsSnap.filter((a) => a.status === "done" || a.status === "error");

      let fullText = text;
      if (currentAttachments.length > 0) {
        const attachmentSections = currentAttachments.map((a) => {
          const path = state.attachmentPaths.get(a.uid) || "";
          const parsedContent = state.attachmentParseContent.get(a.uid);
          if (parsedContent) {
            return `--- 文件: ${a.name} (路径: ${path}) ---\n${parsedContent}\n--- 文件结束 ---`;
          }
          return `[附件: ${a.name} (路径: ${path})]`;
        });
        fullText = `${attachmentSections.join("\n\n")}\n\n${text}`;
      }

      const userMsg: ChatMsg = { role: "user", content: text };
      shouldScrollRef.current = true;
      const abortController = new AbortController();

      updateConvState(convId, {
        loading: true,
        abortController: abortController,
        pendingKbRefs: [],
        pendingWebRefs: [],
        showThinking: false,
        attachments: [],
        messages: [...state.messages, userMsg, { role: "thinking", content: "__typing__" }],
      });

      try {
        const res = await apiFetch("/api/agent/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: fullText, conversationId: convId, ...(embeddedRole ? { role: embeddedRole } : {}) }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          const currentState = convStates.get(convId)!;
          updateConvState(convId, {
            loading: false,
            abortController: null,
            messages: [...currentState.messages, { role: "assistant", content: err.error || res.statusText, isError: true }],
          });
          loadConversations();
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let currentText = "";
        let needNewBubble = true;
        let hasThinking = true;

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
            // 使用状态更新函数的回调形式，确保获取最新状态
            if (eventType === "text_delta") {
              if (needNewBubble) {
                needNewBubble = false;
                hasThinking = false;
                currentText = data.text;
                setConvStates(prev => {
                  const currentState = prev.get(convId)!;
                  
                  const refs = currentState.pendingKbRefs.length > 0 ? [...currentState.pendingKbRefs] : undefined;
                  const webRefs = currentState.pendingWebRefs.length > 0 ? [...currentState.pendingWebRefs] : undefined;
                  return new Map(prev).set(convId, {
                    ...currentState,
                    messages: [...removeTyping(currentState.messages), { role: "assistant", content: data.text, kbReferences: refs, webReferences: webRefs, status: "streaming" }],
                  });
                });
              } else {
                currentText += data.text;
                setConvStates(prev => {
                  const currentState = prev.get(convId)!;
                  return new Map(prev).set(convId, {
                    ...currentState,
                    messages: currentState.messages.map(msg =>
                      msg.status === "streaming" ? { ...msg, content: currentText } : msg
                    ),
                  });
                });
              }
            } else if (eventType === "tool_call") {
              // tool_call 只表示 LLM 决定调用工具，实际展示在 tool_start 时处理
              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                
                return new Map(prev).set(convId, {
                  ...currentState,
                  messages: removeTyping(currentState.messages).map(msg =>
                    msg.status === "streaming" ? { ...msg, status: undefined } : msg
                  ),
                });
              });
              needNewBubble = true;
              currentText = "";
            } else if (eventType === "tool_start") {
              // 工具开始执行：添加一个 running 状态的工具消息
              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                
                return new Map(prev).set(convId, {
                  ...currentState,
                  messages: [
                    ...removeTyping(currentState.messages).map(msg =>
                      msg.status === "streaming" ? { ...msg, status: undefined } : msg
                    ),
                    { role: "tool", content: "", skillName: data.skillName, status: "running" },
                  ],
                });
              });
              needNewBubble = true;
              currentText = "";
            } else if (eventType === "tool_result") {
              // 工具执行完成：更新最后一个 running 状态的工具消息
              const r = data.result;
              let summary = "";
              let extra: Record<string, unknown> | undefined;
              let chartOptions: Record<string, unknown>[] | undefined;
              let fileDownload: { files: any[]; zipDownloadUrl?: string; zipName?: string } | undefined;

              if (r?.success) {
                if (r.data?.__type === "file_download" && r.data?.files) {
                  summary = `已准备 ${r.data.files.length} 个文件`;
                  fileDownload = {
                    files: r.data.files,
                    zipDownloadUrl: r.data.zipDownloadUrl,
                    zipName: r.data.zipName,
                  };
                } else if (r.data?.option && r.data?.chartType) {
                  summary = `已生成${r.data.chartType}图表`;
                  chartOptions = [r.data.option];
                } else if (r.data?.charts && Array.isArray(r.data.charts)) {
                  summary = `已生成 ${r.data.charts.length} 个图表`;
                  chartOptions = r.data.charts.map((c: any) => c.option).filter(Boolean);
                } else if (r.data?.message) {
                  summary = r.data.message;
                } else if (r.data?.results && Array.isArray(r.data.results)) {
                  summary = `获取到 ${r.data.results.length} 条结果`;
                } else if (typeof r.data === "string") {
                  summary = r.data.slice(0, 300);
                } else if (r.data && typeof r.data === "object") {
                  const dataStr = JSON.stringify(r.data);
                  summary = r.data.message || r.data.text || r.data.content ||
                    (dataStr.length <= 500 ? dataStr : dataStr.slice(0, 300) + "...");
                  extra = { resultData: r.data };
                } else {
                  summary = "完成";
                }
              } else {
                summary = r?.error?.message || r?.error || "失败";
              }

              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                const runningToolIndex = currentState.messages
                  .map((msg, idx) => ({ msg, idx }))
                  .filter(({ msg }) => msg.role === "tool" && msg.status === "running")
                  .pop()?.idx;

                const toolResultData = extra?.resultData as Record<string, unknown> | undefined;

                if (runningToolIndex !== undefined) {
                  const newMessages = [...currentState.messages];
                  newMessages[runningToolIndex] = {
                    ...newMessages[runningToolIndex],
                    content: summary,
                    status: r?.success ? "done" : "error",
                    isError: !r?.success,
                    ...(chartOptions ? { chartOptions } : {}),
                    ...(toolResultData ? { resultData: toolResultData } : {}),
                    ...(fileDownload ? { fileDownload } : {}),
                  };
                  return new Map(prev).set(convId, { ...currentState, messages: newMessages });
                }
                // 如果没有找到 running 的工具消息（比如页面刷新后），追加一条
                const newToolMsg: ChatMsg = {
                  role: "tool",
                  content: summary,
                  skillName: data.skillName,
                  status: r?.success ? "done" : "error",
                  isError: !r?.success,
                  ...(chartOptions ? { chartOptions } : {}),
                  ...(toolResultData ? { resultData: toolResultData } : {}),
                  ...(fileDownload ? { fileDownload } : {}),
                };
                return new Map(prev).set(convId, {
                  ...currentState,
                  messages: [...removeTyping(currentState.messages), newToolMsg],
                });
              });
            } else if (eventType === "kb_references") {
              // 更新 pendingKbRefs
              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                const updatedState = { ...currentState, pendingKbRefs: data.references || [] };
                // 如果已经有助手消息，直接更新其引用
                const lastMsg = updatedState.messages[updatedState.messages.length - 1];
                if (!needNewBubble && lastMsg && lastMsg.status === "streaming") {
                  updatedState.messages = updatedState.messages.slice(0, -1).concat([
                    { ...lastMsg, kbReferences: data.references }
                  ]);
                }
                return new Map(prev).set(convId, updatedState);
              });
            } else if (eventType === "web_references") {
              // 更新 pendingWebRefs
              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                const updatedState = { ...currentState, pendingWebRefs: data.references || [] };
                // 如果已经有助手消息，直接更新其引用
                const lastMsg = updatedState.messages[updatedState.messages.length - 1];
                if (!needNewBubble && lastMsg && lastMsg.status === "streaming") {
                  updatedState.messages = updatedState.messages.slice(0, -1).concat([
                    { ...lastMsg, webReferences: data.references }
                  ]);
                }
                return new Map(prev).set(convId, updatedState);
              });
            } else if (eventType === "strategy_selected") {
              const levelMap: Record<string, string> = {
                simple: "💬 直接为你解答",
                react: "🔍 正在分析，将逐步为你处理",
                team: "👥 多角度协作分析中",
              };
              const label = levelMap[data.level] || `🤖 处理中`;
              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                const hasTyping = currentState.messages.some(m => m.role === "thinking" && m.content === "__typing__");
                return new Map(prev).set(convId, {
                  ...currentState,
                  messages: hasTyping
                    ? currentState.messages.map(msg =>
                        msg.role === "thinking" && msg.content === "__typing__"
                          ? { role: "strategy", content: label }
                          : msg
                      )
                    : [...currentState.messages, { role: "strategy", content: label }],
                });
              });
              hasThinking = false;
            } else if (eventType === "user_confirm") {
              setConvStates(prev => {
                const currentState = prev.get(convId)!;
                
                return new Map(prev).set(convId, {
                  ...currentState,
                  messages: removeTyping(currentState.messages).map(msg =>
                    msg.status === "streaming" ? { ...msg, status: undefined } : msg
                  ).concat([{ role: "user_confirm", content: JSON.stringify(data), parsedData: data }]),
                });
              });
              needNewBubble = true;
              currentText = "";
            }
          }
        }

        if (abortController.signal.aborted) {
          setConvStates(prev => {
            const currentState = prev.get(convId)!;
            return new Map(prev).set(convId, {
              ...currentState,
              loading: false,
              abortController: null,
              messages: currentState.messages.filter(m => !(m.role === "thinking" && m.content === "__typing__") && m.status !== "streaming"),
            });
          });
          return;
        }

        setConvStates(prev => {
          const currentState = prev.get(convId)!;
          
          return new Map(prev).set(convId, {
            ...currentState,
            loading: false,
            abortController: null,
            pendingKbRefs: [],
            pendingWebRefs: [],
            messages: removeTyping(currentState.messages).map(msg =>
              msg.status === "streaming" ? { ...msg, status: undefined } : msg
            ),
          });
        });
        loadConversations();
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setConvStates(prev => {
            const currentState = prev.get(convId)!;
            return new Map(prev).set(convId, {
              ...currentState,
              loading: false,
              abortController: null,
              messages: [
                ...currentState.messages.filter(m => !(m.role === "thinking" && m.content === "__typing__") && m.status !== "streaming"),
                { role: "assistant", content: err.message || "网络错误", isError: true },
              ],
            });
          });
          loadConversations();
        } else {
          setConvStates(prev => {
            const currentState = prev.get(convId)!;
            return new Map(prev).set(convId, { ...currentState, loading: false, abortController: null });
          });
        }
      }
    },
    [convStates, updateConvState]
  );

  // Stop Chat
  const stopChat = (convId: string) => {
    const state = convStates.get(convId);
    if (!state || !state.abortController) return;

    state.abortController.abort();
    if (state.thinkingTimer) {
      clearTimeout(state.thinkingTimer);
    }
    updateConvState(convId, {
      loading: false,
      abortController: null,
      showThinking: false,
      messages: state.messages.filter(m => !(m.role === "thinking" && m.content === "__typing__") && m.status !== "streaming"),
    });
  };

  // New Chat
  const newChat = async () => {
    const id = await apiCreateConversation("新对话");
    if (id) {
      setActiveConvId(id);
      updateConvState(id, getOrCreateConvState(id));
      loadConversations();
    }
  };

  // Switch Conversation
  const switchConversation = (convId: string) => {
    const currentId = activeConvIdRef.current;
    if (convId === currentId) return;
    setActiveConvId(convId);
    const targetState = convStates.get(convId);
    if (!targetState || targetState.messages.length === 0) {
      loadMessages(convId);
    }
    // 滚动到最新消息
    setTimeout(() => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  };

  // Delete Conversation
  const deleteConversation = async (convId: string) => {
    try {
      const state = convStates.get(convId);
      if (state?.abortController) {
        state.abortController.abort();
        if (state.thinkingTimer) {
          clearTimeout(state.thinkingTimer);
        }
      }
      await apiFetch(`/api/conversations/${convId}`, { method: "DELETE" });
      if (convId === activeConvIdRef.current) {
        setActiveConvId(null);
      }
      setConvStates(prev => {
        const next = new Map(prev);
        next.delete(convId);
        return next;
      });
      loadConversations();
    } catch (err: unknown) {
      console.warn('Failed to delete conversation:', err);
    }
  };

  // Render
  const activeState = activeConvId ? (convStates.get(activeConvId) || getOrCreateConvState("default")) : getOrCreateConvState("default");

  // Auto-scroll to bottom when messages change and shouldScrollRef is true
  useEffect(() => {
    if (shouldScrollRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [activeState.messages, activeState.loading]);

  // 是否有附件正在解析中
  const hasParsingAttachments = activeState.attachments.some((a) => a.status === "uploading");

  return (
    <Flex style={{ height: embedded ? "100vh" : "calc(100vh - 64px - 48px)", width: "100%" }}>
      {/* Mobile sidebar overlay */}
      {!embedded && (
        <div
          className={`mobile-sidebar-overlay ${mobileSidebarOpen ? "visible" : ""}`}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      {!embedded && (
        <div className={`glass-card chat-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`} style={{ width: 240, borderRight: "1px solid var(--ant-color-border)", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden", borderRadius: 0 }}>
          <div style={{ padding: "12px 12px 8px" }}>
            <Button type="primary" icon={<PlusOutlined />} block onClick={() => { newChat(); setMobileSidebarOpen(false); }}>{t("create")}</Button>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 4px" }}>
            <List
              dataSource={conversations}
              split={false}
              renderItem={(conv) => {
                const convState = convStates.get(conv.id);
                const isLoading = convState?.loading;
                return (
                  <List.Item
                    className={conv.id === activeConvId ? "conv-active" : ""}
                    style={{ padding: "8px 12px", cursor: "pointer", borderRadius: 6, marginBottom: 2 }}
                    onClick={() => { switchConversation(conv.id); setMobileSidebarOpen(false); }}
                  >
                    <Flex align="center" gap={8} style={{ width: "100%", minWidth: 0 }}>
                      {isLoading ? (
                        <span style={{ flexShrink: 0, width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(102, 126, 234, 0.2)", borderTopColor: "#667eea", animation: "pulse-border 0.8s linear infinite" }} />
                      ) : (
                        <MessageOutlined style={{ flexShrink: 0, opacity: 0.5, fontSize: 14 }} />
                      )}
                      <Text ellipsis style={{ flex: 1, fontSize: 13 }} title={conv.title}>{conv.title || "新对话"}</Text>
                      <DeleteOutlined style={{ flexShrink: 0, opacity: 0.3, fontSize: 12 }} onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }} />
                    </Flex>
                  </List.Item>
                );
              }}
            />
          </div>
        </div>
      )}

      {/* Main chat */}
      <Flex vertical className="chat-main" style={{ flex: 1, maxWidth: 900, margin: "0 auto", width: "100%", minWidth: 0, overflow: "hidden" }}>
        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={() => {
            const container = scrollContainerRef.current;
            if (!container) return;
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
            shouldScrollRef.current = isNearBottom;
            if (container.scrollTop < 30 && activeState.hasMore && !activeState.loadingMore && activeConvId) {
              loadMoreMessages(activeConvId);
            }
          }}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}
        >
          {/* Mobile sidebar toggle */}
          {!embedded && (
            <Button
              className="mobile-menu-btn"
              type="text"
              icon={<MenuOutlined />}
              aria-label="打开侧边栏"
              onClick={() => setMobileSidebarOpen(true)}
              style={{ alignSelf: "flex-start", marginBottom: -8 }}
            />
          )}
          {/* 加载更多指示器 */}
          {activeState.hasMore && (
            <Flex justify="center" style={{ padding: "8px 0" }}>
              {activeState.loadingMore ? <Spin size="small" /> : (
                <Button type="link" size="small" onClick={() => activeConvId && loadMoreMessages(activeConvId)}>加载更早消息</Button>
              )}
            </Flex>
          )}

          {activeState.messages.length === 0 && !activeState.hasMore && (
            <div className="chat-empty" style={{ textAlign: "center", margin: "auto" }}>
              <img src="/ai-avatar.png" alt="AI" style={{ width: 72, height: 72, borderRadius: 20, margin: "0 auto 20px", display: "block", boxShadow: "0 8px 32px rgba(139, 92, 246, 0.25)" }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                <span className="text-gradient">RAOS 智能助手</span>
              </div>
              <div style={{ color: "#94A3B8", fontSize: 14 }}>有什么我可以帮你的？</div>
            </div>
          )}

          {activeState.messages.map((msg, i) => {
            // 渲染用户确认卡片
            if (msg.role === "user_confirm") {
              const data = msg.parsedData || {};
              const isDisabled = confirmedCards.has(data.confirmId as string);
              return (
                <div key={msg.id ?? `m${i}`} style={{ marginLeft: 46 }}>
                  <ConfirmCard
                    confirmId={data.confirmId as string}
                    type={data.type as any}
                    title={data.title as string}
                    description={data.description as string}
                    options={data.options as any}
                    multiSelect={data.multiSelect as boolean}
                    fields={data.fields as any}
                    schema={data.schema as any}
                    confirmText={(data.confirmText as string) ?? "确定"}
                    cancelText={(data.cancelText as string) ?? "取消"}
                    disabled={isDisabled}
                    submittedData={confirmedDataMap[data.confirmId as string]}
                    onConfirm={async (confirmId, response) => {
                      try {
                        await apiFetch("/api/agent/chat/confirm", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ confirmId, response }),
                        });
                        handleConfirmCard(confirmId, true);
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
                        handleConfirmCard(confirmId, false);
                      } catch (err) {
                        console.error("Cancel failed:", err);
                      }
                    }}
                  />
                </div>
              );
            }

            // 渲染用户消息
            if (msg.role === "user") {
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

            // 渲染思考指示器
            if (msg.role === "thinking") {
              if (msg.content === "__typing__") {
                return (
                  <div key={msg.id ?? `m${i}`} style={{ display: "flex", gap: 12, alignItems: "center", marginLeft: 4, animation: "fade-in-up 0.3s ease-out" }}>
                    <img src="/ai-avatar.png" alt="AI" style={{ width: 32, height: 32, borderRadius: 10 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div style={{ display: "flex", gap: 4, padding: "10px 16px", borderRadius: 16, background: "rgba(139, 92, 246, 0.06)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B5CF6", opacity: 0.6, animation: "pulse-border 1.2s infinite" }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#A78BFA", opacity: 0.6, animation: "pulse-border 1.2s infinite 0.2s" }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C4B5FD", opacity: 0.6, animation: "pulse-border 1.2s infinite 0.4s" }} />
                    </div>
                  </div>
                );
              }
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

            // 渲染策略提示
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

            // 渲染工具调用
            if (msg.role === "tool") {
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
                </div>
              );
            }

            // 渲染助手消息
            const isStreaming = activeState.loading && i === activeState.messages.length - 1;
            const bubbleContent = msg.content || (isStreaming ? "..." : "");
            const refs = msg.kbReferences;
            return (
              <div key={msg.id ?? `m${i}`}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', animation: 'fade-in-up 0.3s ease-out' }}>
                  <img src="/ai-avatar.png" alt="AI" style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isStreaming && !msg.content ? (
                      <Spin size="small" />
                    ) : (
                      <XMarkdown
                        content={preprocessVideos(preprocessImages(preprocessFootnotes(bubbleContent)))}
                        streaming={{ hasNextChunk: isStreaming }}
                        components={{
                          ...markdownComponents,
                          kbref: ({ children, ...props }: any) => {
                            const idx = parseInt(props["data-index"] || "0", 10);
                            return (
                              <sup
                                style={{ color: "#1677ff", cursor: refs?.length ? "pointer" : "default", fontWeight: 600, fontSize: "0.75em", padding: "0 1px" }}
                                onClick={refs?.length ? (e: React.MouseEvent) => { e.stopPropagation(); setViewingRefs(refs); setViewingRefIndex(idx - 1); } : undefined}
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
                {refs && refs.length > 0 && !activeState.loading && (() => {
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
                    "pdf": { label: "PDF", color: "#ff4d4f", bg: "rgba(255, 241, 240, 0.8)" },
                    "doc": { label: "Word", color: "#1677ff", bg: "rgba(230, 244, 255, 0.8)" },
                    "docx": { label: "Word", color: "#1677ff", bg: "rgba(230, 244, 255, 0.8)" },
                    "xls": { label: "Excel", color: "#52c41a", bg: "rgba(246, 255, 237, 0.8)" },
                    "xlsx": { label: "Excel", color: "#52c41a", bg: "rgba(246, 255, 237, 0.8)" },
                    "ppt": { label: "PPT", color: "#fa8c16", bg: "rgba(255, 247, 230, 0.8)" },
                    "pptx": { label: "PPT", color: "#fa8c16", bg: "rgba(255, 247, 230, 0.8)" },
                    "md": { label: "MD", color: "#722ed1", bg: "rgba(249, 240, 255, 0.8)" },
                    "txt": { label: "Text", color: "#8c8c8c", bg: "rgba(250, 250, 250, 0.8)" },
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
                          const meta = extLabelMap[ext] || { label: ext.toUpperCase() || "FILE", color: "#8c8c8c", bg: "rgba(250, 250, 250, 0.8)" };
                          return (
                            <div
                              key={docId}
                              onClick={() => handleViewKbDoc(docId, docName)}
                              className="glass-card"
                              style={{
                                cursor: "pointer",
                                flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
                                padding: "10px 14px", borderRadius: 14,
                                maxWidth: 300, minWidth: 200,
                              }}
                            >
                              <div style={{
                                width: 32, height: 32, borderRadius: 10,
                                background: meta.bg,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontWeight: 700, fontSize: 10, color: meta.color,
                                flexShrink: 0,
                                backdropFilter: "blur(4px)",
                              }}>
                                {meta.label}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#334155" }}>
                                  {docName}
                                </div>
                                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                                  引用 [{indices.join(", ")}]
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Web References */}
                {msg.webReferences && msg.webReferences.length > 0 && !activeState.loading && (
                  <div style={{ padding: "8px 0 0 48px", overflow: "hidden" }}>
                    <div style={{
                      display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
                      scrollbarWidth: "thin",
                      WebkitOverflowScrolling: "touch",
                    }}>
                      {msg.webReferences.map((webRef) => (
                        <a
                          key={webRef.index}
                          href={webRef.url}
                          target="_blank"
                          rel="noreferrer"
                          className="glass-card"
                          style={{
                            cursor: "pointer",
                            flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 14px", borderRadius: 14,
                            maxWidth: 300, minWidth: 200,
                            textDecoration: "none",
                          }}
                        >
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(230, 244, 255, 0.8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 10, color: "#1677ff", flexShrink: 0, backdropFilter: "blur(4px)" }}>
                            <GlobalOutlined style={{ fontSize: 14 }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#334155" }}>
                              {webRef.title}
                            </div>
                            {webRef.snippet && (
                              <div style={{ fontSize: 11, color: "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                                {webRef.snippet}
                              </div>
                            )}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* File Download */}
                {msg.fileDownload && msg.fileDownload.files.length > 0 && !activeState.loading && (
                  <div style={{ padding: "8px 0 0 48px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {msg.fileDownload.files.map((file) => (
                        <a
                          key={file.path}
                          href={file.downloadUrl}
                          download={file.name}
                          className="glass-card"
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 14px", borderRadius: 14,
                            textDecoration: "none",
                          }}
                        >
                          {getFileIcon(`.${file.ext}`, 22)}
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{file.name}</div>
                            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{formatFileSize(file.size)}</div>
                          </div>
                          <DownloadOutlined style={{ color: "#52c41a", fontSize: 16, marginLeft: 4 }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Questions */}
                {(() => {
                  const questions = extractSuggestedQuestions(msg.content);
                  if (questions.length === 0 || activeState.loading) return null;
                  return (
                    <div style={{ padding: "8px 0 0 48px", overflow: "hidden" }}>
                      <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                        <BulbOutlined />
                        推荐问题
                      </div>
                      <div style={{
                        display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
                        scrollbarWidth: "thin",
                        WebkitOverflowScrolling: "touch",
                      }}>
                        {questions.map((q, qi) => (
                          <div
                            key={qi}
                            onClick={() => sendMessage(q)}
                            className="glass-card"
                            style={{
                              cursor: "pointer",
                              flexShrink: 0,
                              padding: "10px 16px",
                              borderRadius: 14,
                              fontSize: 13,
                              color: "#475569",
                              border: "1px solid rgba(139, 92, 246, 0.15)",
                              background: "rgba(139, 92, 246, 0.04)",
                              transition: "all 0.2s",
                              whiteSpace: "nowrap",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(139, 92, 246, 0.1)";
                              e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.3)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "rgba(139, 92, 246, 0.04)";
                              e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.15)";
                            }}
                          >
                            {q}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Sender with Attachments Header */}
        {activeConvId && (
          <div className="chat-sender-area">
            <Sender
              ref={senderRef}
              placeholder={hasParsingAttachments ? "文档解析中，请稍候..." : t("chat_placeholder")}
              loading={activeState.loading}
              disabled={hasParsingAttachments}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={sendMessage}
              onCancel={() => stopChat(activeConvId)}
              header={
                <Sender.Header
                  title={hasParsingAttachments ? `附件 (${activeState.attachments.length}) — 转换中...` : `附件 (${activeState.attachments.length})`}
                  open={activeState.headerOpen}
                  onOpenChange={(open) => updateConvState(activeConvId!, { headerOpen: open })}
                  closable
                  styles={{ content: { padding: 12 } }}
                >
                  <Attachments
                    ref={attachmentsRef}
                    accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.txt,.md,.csv,.tsv,.json,.log,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                    multiple
                    customRequest={(opts) => handleAttachmentUpload(activeConvId!, opts)}
                    items={activeState.attachments}
                    onChange={(info) => handleAttachmentChange(activeConvId!, info)}
                    disabled={activeState.loading}
                    placeholder={{
                      icon: <LinkOutlined style={{ fontSize: 20 }} />,
                      title: "拖拽文件到此处或点击上传",
                      description: "支持 PDF、Word、Excel、PPT、CSV、图片、文本等格式",
                    }}
                    getDropContainer={() => senderRef.current?.nativeElement}
                    onPreview={(file: any) => {
                      const uid = file.uid;
                      const state = convStates.get(activeConvId!)!;
                      if (state.attachmentParseContent.has(uid)) {
                        setViewingAttachment({
                          uid,
                          name: file.name || "未知文件",
                          content: state.attachmentParseContent.get(uid) || "",
                          path: state.attachmentPaths.get(uid) || "",
                          tags: state.attachmentParseTags.get(uid) || [],
                          pageCount: state.attachmentPageCount.get(uid),
                        });
                      }
                    }}
                  />
                </Sender.Header>
              }
              prefix={
                <Badge count={activeState.attachments.length} size="small">
                  <Button
                    type="text"
                    icon={<LinkOutlined />}
                    disabled={activeState.loading}
                    onClick={() => updateConvState(activeConvId!, { headerOpen: !activeState.headerOpen })}
                  />
                </Badge>
              }
            />
          </div>
        )}
      </Flex>

      {/* Inbox Panel — 右侧待处理事项面板 */}
      {panelOpen && <InboxPanel />}

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
        width={viewingTab === "compare" ? 640 : 420}
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
              onClick={() => {
                if (viewingAttachment?.path) {
                  apiFetch(`/api/download/uploaded?path=${encodeURIComponent(viewingAttachment.path)}`).then(async (res) => {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = viewingAttachment.name || "download";
                    a.click();
                    URL.revokeObjectURL(url);
                  }).catch(() => message.error("下载失败"));
                }
              }}
            >
              下载文件
            </Button>
          </Flex>
        }
      >
        {viewingTab === "markdown" && (
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <XMarkdown components={markdownComponents}>{viewingAttachment?.content}</XMarkdown>
          </div>
        )}
        {viewingTab === "images" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {viewingPageImages.map((page, i) => (
              <div key={i} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--ant-color-border)" }}>
                <img
                  src={`/api/upload/parse-image?path=${encodeURIComponent(viewingAttachment?.path || "")}&page=${page}`}
                  alt={`第 ${page} 页`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}
        {viewingTab === "compare" && (
          <Flex gap={16} style={{ height: "100%", minHeight: 500 }}>
            <div style={{ flex: 1, overflow: "auto", paddingRight: 8, fontSize: 11, lineHeight: 1.7 }}>
              <XMarkdown components={markdownComponents}>{viewingAttachment?.content}</XMarkdown>
            </div>
            <div style={{ flex: 1, overflow: "auto", paddingLeft: 8, borderLeft: "1px solid var(--ant-color-border)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {viewingPageImages.map((page, i) => (
                  <div key={i} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--ant-color-border)" }}>
                    <img
                      src={`/api/upload/parse-image?path=${encodeURIComponent(viewingAttachment?.path || "")}&page=${page}`}
                      alt={`第 ${page} 页`}
                      style={{ width: "100%", height: "auto", display: "block" }}
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          </Flex>
        )}
      </Drawer>

      {/* KB 引用文档查看抽屉 */}
      <Drawer
        title={viewingRefs ? `相关文档 (${viewingRefIndex !== null ? viewingRefIndex + 1 : ""}/${viewingRefs?.length})` : ""}
        open={viewingRefs !== null}
        onClose={() => { setViewingRefs(null); setViewingRefIndex(null); setRefDocLayouts([]); }}
        width={420}
        extra={
          <Segmented
            options={[
              ...(viewingRefs && viewingRefIndex !== null && viewingRefs[viewingRefIndex]?.docMindTaskId && refDocLayouts.length > 0
                ? [{ label: "还原", value: "restored" }]
                : []),
              { label: "自动", value: "auto" },
              { label: "纯文本", value: "text" },
            ]}
            value={refViewMode}
            onChange={(v) => setRefViewMode(v as "auto" | "restored" | "text")}
          />
        }
      >
        {viewingRefs && viewingRefIndex !== null && viewingRefs[viewingRefIndex] && (
          <div>
            <Flex align="center" justify="space-between" style={{ marginBottom: 12 }}>
              <Tag color="blue" style={{ fontSize: 11 }}>相似度: {((viewingRefs[viewingRefIndex].score ?? 0) * 100).toFixed(0)}%</Tag>
              <Text type="secondary" style={{ fontSize: 10 }}>
                文档: {viewingRefs[viewingRefIndex].docName} · Chunk #{viewingRefs[viewingRefIndex].chunkIndex}
              </Text>
            </Flex>
            {refViewMode === "restored" && viewingRefs[viewingRefIndex].docMindTaskId && refDocLayouts.length > 0 ? (
              <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ background: "#f8fafc", padding: "4px 12px", fontSize: 12, color: "#64748b" }}>
                  第 {viewingRefs[viewingRefIndex].pageNumber} 页（版面还原）
                </div>
                <DocMindPreview layouts={refDocLayouts} pageFilter={viewingRefs[viewingRefIndex].pageNumber ?? undefined} highlightText={viewingRefs[viewingRefIndex].content} />
              </div>
            ) : refViewMode === "auto" && viewingRefs[viewingRefIndex].pageNumber != null ? (
              <div>
                {/* Document Mind 文档：自动模式下也显示版面还原 */}
                {viewingRefs[viewingRefIndex].docMindTaskId && refDocLayouts.length > 0 ? (
                  <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ background: "#f8fafc", padding: "4px 12px", fontSize: 12, color: "#64748b" }}>
                      第 {viewingRefs[viewingRefIndex].pageNumber} 页（版面还原）
                    </div>
                    <DocMindPreview layouts={refDocLayouts} pageFilter={viewingRefs[viewingRefIndex].pageNumber ?? undefined} highlightText={viewingRefs[viewingRefIndex].content} />
                  </div>
                ) : (
                  /* 本地解析文档：显示页面截图 */
                  <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ background: "#f8fafc", padding: "4px 12px", fontSize: 12, color: "#64748b" }}>
                      第 {viewingRefs[viewingRefIndex].pageNumber} 页
                    </div>
                    <HighlightedPageImage
                      docId={viewingRefs[viewingRefIndex].docId}
                      page={viewingRefs[viewingRefIndex].pageNumber}
                      bboxes={viewingRefs[viewingRefIndex].bboxes ?? []}
                    />
                  </div>
                )}
                <div style={{ marginBottom: 12, padding: 10, background: "#f5f5f5", borderRadius: 8, fontSize: 11, lineHeight: 1.7 }}>
                  <XMarkdown content={viewingRefs[viewingRefIndex].content} />
                </div>
              </div>
            ) : (
              <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 8, fontSize: 11, lineHeight: 1.7 }}>
                <XMarkdown content={viewingRefs[viewingRefIndex].content} />
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* KB 文档完整查看抽屉 */}
      <Drawer
        title={kbDocView?.name}
        open={kbDocView !== null}
        onClose={() => setKbDocView(null)}
        width={520}
        extra={
          <Segmented
            options={[
              { label: "还原", value: "restored" },
              { label: "文本", value: "markdown" },
              { label: "图片", value: "images" },
            ]}
            value={kbDocViewTab}
            onChange={(v) => setKbDocViewTab(v as "markdown" | "images" | "restored")}
          />
        }
      >
        {kbDocViewLoading ? (
          <Flex justify="center" align="center" style={{ padding: 40 }}>
            <Spin />
          </Flex>
        ) : kbDocViewTab === "markdown" ? (
          <div style={{ lineHeight: 1.7, fontSize: 11 }}>
            <XMarkdown content={kbDocView?.content || "无内容"} />
          </div>
        ) : kbDocViewTab === "images" ? (
          <List
            dataSource={kbDocPageImages}
            renderItem={(page) => (
              <List.Item style={{ padding: "8px 0" }}>
                <img
                  src={pageImageUrl(kbDocView!.docId, page)}
                  alt={`第 ${page} 页`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                  loading="lazy"
                />
              </List.Item>
            )}
          />
        ) : (
          <DocMindPreview layouts={kbDocLayouts} />
        )}
      </Drawer>
    </Flex>
  );
}
