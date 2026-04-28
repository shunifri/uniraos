/**
 * Inbox Badge — 顶部导航栏的未读消息提示
 *
 * 显示未读数，点击展开下拉快捷列表或切换 Inbox 面板
 */

import { Badge, Dropdown, List, Button, Empty, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useNavigate, useLocation } from "react-router-dom";
import { useInboxStore } from "../../store/inbox-store";
import { useState } from "react";

const { Text } = Typography;

export default function InboxBadge() {
  const { stats, items, fetchItems, setPanelOpen } = useInboxStore();
  const navigate = useNavigate();
  const location = useLocation();
  const isChatPage = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const [open, setOpen] = useState(false);

  const unreadItems = items.filter((item) => item.status === "unread").slice(0, 5);

  const dropdownContent = (
    <div style={{
      width: 320,
      maxHeight: 400,
      overflowY: "auto",
      overflowX: "hidden",
      position: "relative",
      background: "rgba(255, 255, 255, 0.72)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      border: "1px solid rgba(255, 255, 255, 0.5)",
      borderRadius: 16,
      boxShadow: "0 4px 24px rgba(139, 92, 246, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)",
    }}>
      {/* 装饰圆 — glass-card 风格 */}
      <div style={{
        position: "absolute",
        top: -20,
        right: -20,
        width: 70,
        height: 70,
        borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(236, 72, 153, 0.06))",
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(139, 92, 246, 0.08)" }}>
          <Text strong>通知 ({stats.unreadCount})</Text>
        </div>
        {unreadItems.length === 0 ? (
          <Empty description="暂无新通知" style={{ margin: "20px 0" }} />
        ) : (
          <List
            dataSource={unreadItems}
            renderItem={(item) => (
              <List.Item
                style={{
                  padding: "8px 16px",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(139, 92, 246, 0.04)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div>
                  <Text strong style={{ fontSize: 13 }}>{item.title}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.description?.slice(0, 40) || ""}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        )}
        <div style={{ padding: "8px 16px", borderTop: "1px solid rgba(139, 92, 246, 0.08)", textAlign: "center" }}>
          <Button type="link" size="small" onClick={() => {
            setOpen(false);
            if (!isChatPage) {
              navigate("/chat");
            }
            setPanelOpen(true);
          }}>
            查看全部
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Dropdown
      popupRender={() => dropdownContent}
      trigger={["click"]}
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Badge count={stats.unreadCount} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          onClick={() => {
            fetchItems({ status: "unread", pageSize: 5 });
          }}
        />
      </Badge>
    </Dropdown>
  );
}
