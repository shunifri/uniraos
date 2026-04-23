import { useState, useRef } from "react";
import { Drawer, Segmented, Flex } from "antd";
import { Attachments } from "@ant-design/x";
import type { Attachment, AttachmentsRef } from "@ant-design/x/es/attachments";
import { apiFetch } from "@/api";
import { useI18nStore } from "@/i18n";

interface AttachmentAreaProps {
  open: boolean;
  onClose: () => void;
}

export default function AttachmentArea({ open, onClose }: AttachmentAreaProps) {
  const t = useI18nStore((s) => s.t);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<AttachmentsRef>(null);
  const attachmentPaths = useRef<Map<string, string>>(new Map());
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // 清理轮询定时器
  const clearPollTimers = () => {
    pollTimers.current.forEach((t) => clearInterval(t));
    pollTimers.current.clear();
  };

  // 轮询文件解析状态
  const startPollParseStatus = (uid: string, serverPath: string) => {
    // 更新附件描述为"转换中"
    setAttachments((prev) =>
      prev.map((a) => a.uid === uid ? { ...a, description: "转换中...", status: "uploading" as const } : a)
    );

    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/upload/parse-status?path=${encodeURIComponent(serverPath)}`);
        const data = await res.json();
        if (data.status === "done") {
          clearInterval(timer);
          pollTimers.current.delete(uid);
          const tagsLabel = data.tags?.length ? ` | 标签: ${data.tags.join(", ")}` : "";
          setAttachments((prev) =>
            prev.map((a) => a.uid === uid ? { ...a, description: `已解析 (${data.format || "text"})${tagsLabel}`, status: "done" as const } : a)
          );
        } else if (data.status === "error") {
          clearInterval(timer);
          pollTimers.current.delete(uid);
          setAttachments((prev) =>
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

  const handleAttachmentChange = (info: { fileList: Attachment[] }) => {
    const list: Attachment[] = info.fileList;
    // 过滤掉被删除的附件，清理相关资源
    const removedUids = new Set(attachments.map((a) => a.uid).filter((uid) => !list.some((b) => b.uid === uid)));
    removedUids.forEach((uid) => {
      attachmentPaths.current.delete(uid);
      const timer = pollTimers.current.get(uid);
      if (timer) { clearInterval(timer); pollTimers.current.delete(uid); }
    });
    setAttachments(list);
  };

  const handleAttachmentUpload = async (options: any) => {
    const { file, onSuccess, onError } = options as { file: any; onSuccess?: any; onError?: any };
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

  return (
    <Drawer
      title="附件"
      placement="right"
      open={open}
      onClose={() => {
        onClose();
        clearPollTimers();
      }}
      width={400}
    >
      <Attachments
        ref={attachmentsRef}
        items={attachments}
        onChange={handleAttachmentChange}
        customRequest={handleAttachmentUpload}
        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.gif,.zip,.rar"
      />
    </Drawer>
  );
}
