/**
 * Inbox Panel — Chat 页面右侧可折叠面板
 *
 * 展示所有待处理/已处理的 InboxItem
 */

import { useEffect } from "react";
import { Card, Tabs, Badge, Empty, Spin, List, Typography, Tag, Flex, Button } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  BellOutlined,
  AlertOutlined,
  InboxOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { useInboxStore } from "../../store/inbox-store";
import { InboxCard } from "./InboxCard";

const { Text } = Typography;

const tabItems = [
  { key: "pending", label: "待处理", icon: <ClockCircleOutlined /> },
  { key: "completed", label: "已处理", icon: <CheckCircleOutlined /> },
  { key: "notifications", label: "通知", icon: <BellOutlined /> },
  { key: "reminders", label: "提醒", icon: <AlertOutlined /> },
];

export default function InboxPanel() {
  const {
    items,
    stats,
    loading,
    activeTab,
    setActiveTab,
    setPanelOpen,
  } = useInboxStore();

  useEffect(() => {
    useInboxStore.getState().fetchStats();
  }, []);

  const getTabBadge = (key: string) => {
    switch (key) {
      case "pending":
        return stats.pendingApprovals + stats.pendingTasks || undefined;
      case "notifications":
        return stats.unreadNotifications || undefined;
      case "reminders":
        return stats.upcomingReminders || undefined;
      default:
        return undefined;
    }
  };

  return (
    <Card
      title={
        <Flex align="center" justify="space-between">
          <Flex align="center" gap={8}>
            <InboxOutlined />
            <span>收件箱</span>
            {stats.unreadCount > 0 && (
              <Badge count={stats.unreadCount} style={{ backgroundColor: "#f5222d" }} />
            )}
          </Flex>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => setPanelOpen(false)}
          />
        </Flex>
      }
      style={{
        width: 360,
        flexShrink: 0,
        borderLeft: "1px solid var(--ant-color-border)",
        borderRadius: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
      styles={{ body: { padding: 0, flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as any)}
        items={tabItems.map((tab) => ({
          key: tab.key,
          label: (
            <span style={{ fontSize: 12 }}>
              {tab.icon}
              <span style={{ marginLeft: 2 }}>{tab.label}</span>
              {getTabBadge(tab.key) ? (
                <Badge count={getTabBadge(tab.key)} style={{ marginLeft: 2, backgroundColor: "#1677ff" }} size="small" />
              ) : null}
            </span>
          ),
        }))}
        style={{ marginBottom: 0 }}
        tabBarStyle={{ padding: "0 4px", marginBottom: 0 }}
        size="small"
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        <Spin spinning={loading}>
          {items.length === 0 ? (
            <Empty description="暂无事项" style={{ marginTop: 40 }} />
          ) : (
            <List
              dataSource={items}
              renderItem={(item) => (
                <List.Item style={{ padding: "8px 0", borderBottom: "1px solid var(--ant-color-border)" }}>
                  <InboxCard item={item} />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </div>
    </Card>
  );
}
