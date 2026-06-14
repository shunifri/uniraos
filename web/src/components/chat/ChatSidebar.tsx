import { Flex, Typography, List, Button } from "antd";
import { PlusOutlined, DeleteOutlined, MessageOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import type { Conversation } from "./types";

const { Text } = Typography;

interface ChatSidebarProps {
  conversations: Conversation[];
  activeConvId: string | null;
  mobileSidebarOpen: boolean;
  onNewChat: () => void;
  onSwitchConversation: (convId: string) => void;
  onDeleteConversation: (convId: string) => void;
  onCloseMobileSidebar: () => void;
}

export default function ChatSidebar({
  conversations,
  activeConvId,
  mobileSidebarOpen,
  onNewChat,
  onSwitchConversation,
  onDeleteConversation,
  onCloseMobileSidebar,
}: ChatSidebarProps) {
  const t = useI18nStore((s) => s.t);

  return (
    <>
      {/* Mobile sidebar overlay */}
      <div
        className={`mobile-sidebar-overlay ${mobileSidebarOpen ? "visible" : ""}`}
        onClick={onCloseMobileSidebar}
      />
      {/* Sidebar */}
      <div className={`glass-card chat-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`}
        style={{ width: 240, borderRight: "1px solid var(--ant-color-border)", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden", borderRadius: 0 }}>
        <div style={{ padding: "12px 12px 8px" }}>
          <Button type="primary" icon={<PlusOutlined />} block onClick={() => { onNewChat(); onCloseMobileSidebar(); }}>{t("create")}</Button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 4px" }}>
          <List
            dataSource={conversations}
            split={false}
            renderItem={(conv) => (
              <List.Item
                className={conv.id === activeConvId ? "conv-active" : ""}
                style={{ padding: "8px 12px", cursor: "pointer", borderRadius: 6, marginBottom: 2 }}
                onClick={() => { onSwitchConversation(conv.id); onCloseMobileSidebar(); }}
              >
                <Flex align="center" gap={8} style={{ width: "100%", minWidth: 0 }}>
                  <MessageOutlined style={{ flexShrink: 0, opacity: 0.5 }} />
                  <Text ellipsis style={{ flex: 1, fontSize: 13 }} title={conv.title}>{conv.title || "新对话"}</Text>
                  <DeleteOutlined style={{ flexShrink: 0, opacity: 0.3, fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }} />
                </Flex>
              </List.Item>
            )}
          />
        </div>
      </div>
    </>
  );
}
