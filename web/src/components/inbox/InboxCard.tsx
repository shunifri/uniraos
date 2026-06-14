/**
 * Inbox Card — 单个 InboxItem 的展示卡片
 *
 * 支持：审批、通知、任务、告警 四种类型
 */

import { Card, Tag, Typography, Flex, Button, Space, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  AlertOutlined,
  BellOutlined,
  FileTextOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useInboxStore } from "../../store/inbox-store";
import type { InboxItem } from "../../store/inbox-store";

const { Text, Paragraph } = Typography;

interface InboxCardProps {
  item: InboxItem;
}

const priorityColors: Record<string, string> = {
  low: "default",
  normal: "blue",
  high: "orange",
  urgent: "red",
};

const typeIcons: Record<string, React.ReactNode> = {
  approval: <FileTextOutlined />,
  notification: <BellOutlined />,
  task: <ClockCircleOutlined />,
  alert: <AlertOutlined />,
};

export function InboxCard({ item }: InboxCardProps) {
  const { markAsRead, completeItem, dismissItem } = useInboxStore();

  const isUnread = item.status === "unread";
  const isPending = item.status === "pending";
  const isCompleted = item.status === "completed";

  const actions = item.payload?.actions || [];

  return (
    <Card
      size="small"
      style={{
        width: "100%",
        background: isUnread ? "rgba(22, 119, 255, 0.04)" : undefined,
        borderLeft: isUnread ? "3px solid #1677ff" : "3px solid transparent",
        borderRadius: 8,
      }}
      styles={{ body: { padding: "12px 16px" } }}
    >
      {/* 头部 */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Flex align="center" gap={8}>
          <Text type="secondary" style={{ fontSize: 14 }}>
            {typeIcons[item.type] || <BellOutlined />}
          </Text>
          <Text strong style={{ fontSize: 14 }}>
            {item.title}
          </Text>
          {item.aggregateCount && item.aggregateCount > 1 && (
            <Tag color="purple">{item.aggregateCount} 条</Tag>
          )}
        </Flex>
        <Tag color={priorityColors[item.priority] || "default"} style={{ fontSize: 11, padding: "0 4px", lineHeight: "16px" }}>
          {item.priority}
        </Tag>
      </Flex>

      {/* 描述 */}
      {item.description && (
        <Paragraph
          type="secondary"
          style={{ fontSize: 13, marginBottom: 8 }}
          ellipsis={{ rows: 2 }}
        >
          {item.description}
        </Paragraph>
      )}

      {/* AI 建议 */}
      {item.aiSuggestion && (
        <div
          style={{
            background: "rgba(139, 92, 246, 0.06)",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 8,
            border: "1px solid rgba(139, 92, 246, 0.15)",
          }}
        >
          <Flex align="center" gap={4} style={{ marginBottom: 4 }}>
            <RobotOutlined style={{ color: "#8B5CF6", fontSize: 12 }} />
            <Text style={{ fontSize: 12, color: "#8B5CF6", fontWeight: 500 }}>
              AI 建议: {item.aiSuggestion.recommendation === "approve" ? "通过" : item.aiSuggestion.recommendation === "reject" ? "驳回" : "需审查"}
              {item.aiSuggestion.confidence ? ` (${Math.round(item.aiSuggestion.confidence * 100)}%)` : ""}
            </Text>
          </Flex>
          {item.aiSuggestion.reasoning && (
            <Text style={{ fontSize: 12, color: "#64748B" }}>
              {item.aiSuggestion.reasoning}
            </Text>
          )}
        </div>
      )}

      {/* 截止时间 */}
      {item.dueAt && (
        <Flex align="center" gap={4} style={{ marginBottom: 8 }}>
          <ClockCircleOutlined style={{ fontSize: 12, color: "#f5222d" }} />
          <Text style={{ fontSize: 12, color: "#f5222d" }}>
            截止: {new Date(item.dueAt).toLocaleString()}
          </Text>
        </Flex>
      )}

      {/* 操作按钮 */}
      {(isUnread || isPending) && actions.length > 0 && (
        <Space style={{ marginTop: 8 }}>
          {actions.map((action: any) => (
            <Button
              key={action.action}
              type={action.primary ? "primary" : "default"}
              danger={action.danger}
              size="small"
              onClick={() => completeItem(item.id, action.action)}
            >
              {action.label}
            </Button>
          ))}
          <Button size="small" onClick={() => dismissItem(item.id)}>
            忽略
          </Button>
        </Space>
      )}

      {isCompleted && (
        <Flex align="center" gap={4} style={{ marginTop: 8 }}>
          <CheckCircleOutlined style={{ color: "#52c41a" }} />
          <Text style={{ color: "#52c41a", fontSize: 12 }}>已完成</Text>
        </Flex>
      )}

      {/* 时间 */}
      <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 8 }}>
        {new Date(item.createdAt).toLocaleString()}
      </Text>
    </Card>
  );
}
