import { useState, useEffect } from "react";
import {
  Card,
  List,
  Button,
  Space,
  Empty,
  App,
  Badge,
  Tag,
  Flex,
  Modal,
  Typography,
} from "antd";
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text, Paragraph } = Typography;

interface Recommendation {
  id: string;
  type: "adopt" | "upgrade" | "optimize";
  skillName: string;
  sourceInstance: string;
  confidence: number;
  description: string;
  details?: string;
}

export default function RecommendationsPanel() {
  const { message, modal } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      const data = await api.get<{ success: boolean; recommendations: Recommendation[] }>(
        "/api/federation/recommendations"
      );
      setRecommendations(data.recommendations || []);
    } catch (e: any) {
      message.error(e.message || "Failed to load recommendations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
    const interval = setInterval(loadRecommendations, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAccept = (id: string, skillName: string) => {
    modal.confirm({
      title: t("accept"),
      content: `${t("accept_recommendation_confirm")} "${skillName}"?`,
      okText: t("accept"),
      cancelText: t("cancel"),
      onOk: async () => {
        try {
          await api.post(`/api/federation/accept-recommendation/${id}`);
          message.success(t("recommendation_accepted"));
          await loadRecommendations();
        } catch (e: any) {
          message.error(e.message || t("failed_to_accept_recommendation"));
        }
      },
    });
  };

  const handleIgnore = (id: string, skillName: string) => {
    modal.confirm({
      title: t("ignore"),
      content: `${t("ignore_recommendation_confirm")} "${skillName}"?`,
      okText: t("ignore"),
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await api.post(`/api/federation/ignore-recommendation/${id}`);
          message.success(t("recommendation_ignored"));
          await loadRecommendations();
        } catch (e: any) {
          message.error(e.message || t("failed_to_ignore_recommendation"));
        }
      },
    });
  };

  const handleViewDetails = (rec: Recommendation) => {
    modal.info({
      title: `Recommendation: ${rec.skillName}`,
      width: 600,
      content: (
        <Flex vertical gap={16}>
          <div>
            <Text strong>Type: </Text>
            <Tag color={getTypeColor(rec.type)}>{rec.type}</Tag>
          </div>
          <div>
            <Text strong>Source Instance: </Text>
            <Text>{rec.sourceInstance}</Text>
          </div>
          <div>
            <Text strong>Confidence: </Text>
            <Badge
              count={`${(rec.confidence * 100).toFixed(2)}%`}
              style={{
                backgroundColor:
                  rec.confidence > 0.9
                    ? "#52c41a"
                    : rec.confidence > 0.7
                      ? "#faad14"
                      : "#f5222d",
              }}
            />
          </div>
          <div>
            <Text strong>Description:</Text>
            <Paragraph>{rec.description}</Paragraph>
          </div>
          {rec.details && (
            <div>
              <Text strong>Details:</Text>
              <Paragraph>{rec.details}</Paragraph>
            </div>
          )}
        </Flex>
      ),
    });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "adopt":
        return "success";
      case "upgrade":
        return "processing";
      case "optimize":
        return "warning";
      default:
        return "default";
    }
  };

  if (recommendations.length === 0) {
    return (
      <Flex vertical gap={16}>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadRecommendations}
          loading={loading}
        >
          {t("refresh")}
        </Button>
        <Empty description={t("no_recommendations")} />
      </Flex>
    );
  }

  return (
    <Flex vertical gap={16}>
      <Button
        icon={<ReloadOutlined />}
        onClick={loadRecommendations}
        loading={loading}
      >
        Refresh
      </Button>

      <List
        itemLayout="vertical"
        size="large"
        dataSource={recommendations}
        loading={loading}
        renderItem={(rec) => (
          <List.Item
            key={rec.id}
            extra={
              <Space size="small">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handleViewDetails(rec)}
                >
                  {t("details")}
                </Button>
                <Button
                  type="text"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  style={{ color: "#52c41a" }}
                  onClick={() => handleAccept(rec.id, rec.skillName)}
                >
                  {t("accept")}
                </Button>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleIgnore(rec.id, rec.skillName)}
                >
                  {t("ignore")}
                </Button>
              </Space>
            }
          >
            <List.Item.Meta
              title={
                <Flex gap={8} align="center">
                  <span>{rec.skillName}</span>
                  <Tag color={getTypeColor(rec.type)}>{rec.type}</Tag>
                  <Badge
                    count={`${(rec.confidence * 100).toFixed(1)}%`}
                    style={{
                      backgroundColor:
                        rec.confidence > 0.9
                          ? "#52c41a"
                          : rec.confidence > 0.7
                            ? "#faad14"
                            : "#f5222d",
                    }}
                  />
                </Flex>
              }
              description={
                <Flex vertical gap={4}>
                  <Text type="secondary">
                    Source: <strong>{rec.sourceInstance}</strong>
                  </Text>
                  <Text>{rec.description}</Text>
                </Flex>
              }
            />
          </List.Item>
        )}
      />
    </Flex>
  );
}
