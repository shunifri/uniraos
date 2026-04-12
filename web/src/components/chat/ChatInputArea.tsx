import { useState, useRef, useCallback } from "react";
import { Button } from "antd";
import { Sender, Attachments } from "@ant-design/x";
import type { Attachment, AttachmentsRef } from "@ant-design/x/es/attachments";
import { StopOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { apiFetch } from "@/api";

interface ChatInputAreaProps {
  loading: boolean;
  onSendMessage: (text: string) => void;
  onStopChat: () => void;
}

export default function ChatInputArea({ loading, onSendMessage, onStopChat }: ChatInputAreaProps) {
  const t = useI18nStore((s) => s.t);
  const [inputValue, setInputValue] = useState("");

  const handleSend = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue("");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--ant-color-border)" }}>
        <Button type="primary" danger icon={<StopOutlined />} block onClick={onStopChat}>
          {t("stop")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 12px", borderTop: "1px solid var(--ant-color-border)" }}>
      <Sender
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSend}
        placeholder={t("input_placeholder")}
        disabled={loading}
      />
    </div>
  );
}
