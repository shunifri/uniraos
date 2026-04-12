import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Statistic,
  Badge,
  Button,
  Space,
  Empty,
  App,
  Tag,
  Typography,
} from "antd";
import {
  ReloadOutlined,
  LoginOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

interface FederationStatus {
  instanceId: string;
  evolution: {
    running: boolean;
    cycleCount: number;
    lastCycleAt: number;
    pendingActions: number;
    executedActions: number;
    strategies: string[];
    executors: string[];
    config: {
      cycleIntervalMs: number;
      maxActionsPerCycle: number;
      autoExecute: boolean;
      skipApprovalRequired: boolean;
    };
  };
  federation: {
    peers: number;
    recommendations: number;
  };
  migration: {
    historyCount: number;
  };
}

export default function FederationOverview() {
  const { message } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await api.get<FederationStatus>("/api/federation/status");
      setStatus(data);
    } catch (e: any) {
      message.error(e.message || t("error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleFederation = async () => {
    try {
      if (status?.evolution?.running) {
        await api.post("/api/federation/leave");
        message.success(t("left_federation"));
      } else {
        await api.post("/api/federation/join");
        message.success(t("joined_federation"));
      }
      loadStatus();
    } catch (e: any) {
      message.error(e.message || t("error"));
    }
  };

  if (!status?.instanceId) {
    return <Empty description={t("loading")} />;
  }

  const isJoined = status.evolution?.running || false;

  return (
    <Flex vertical gap={16}>
      {/* Instance Profile */}
      <Card size="small" title={t("instance_profile")}>
        <Flex vertical gap={12}>
          <Flex gap={12}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("instance_id")}
              </Text>
              <br />
              <Text strong>{status.instanceId}</Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("version")}
              </Text>
              <br />
              <Text>1.0.0</Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Skills
              </Text>
              <br />
              <Text>0</Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Status
              </Text>
              <br />
              <Badge
                status={isJoined ? "success" : "default"}
                text={isJoined ? t("joined") : t("idle")}
              />
            </div>
          </Flex>
        </Flex>
      </Card>

      {/* Federation Status */}
      <Card size="small" title={t("federation_status")}>
        <Flex vertical gap={12}>
          <Flex gap={16} wrap>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Running
              </Text>
              <br />
              <Badge
                status={status.evolution?.running ? "success" : "default"}
                text={status.evolution?.running ? t("yes") : t("no")}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Heartbeat Interval
              </Text>
              <br />
              <Text>60s</Text>
            </div>
          </Flex>

          <Flex gap={8}>
            <Button
              size="small"
              icon={isJoined ? <LogoutOutlined /> : <LoginOutlined />}
              onClick={toggleFederation}
              loading={loading}
              type={isJoined ? "default" : "primary"}
            >
              {isJoined ? t("leave_federation") : t("join_federation")}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadStatus}
              loading={loading}
            >
              {t("refresh")}
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* Quick Stats */}
      <Card size="small" title={t("quick_statistics")}>
        <Flex gap={16} wrap>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("peer_instances")}
              value={status.federation?.peers || 0}
              valueStyle={{ color: "#1677ff" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("recommendations")}
              value={status.federation?.recommendations || 0}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("migrated_skills")}
              value={status.migration?.historyCount || 0}
              valueStyle={{ color: "#faad14" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("federated_networks")}
              value={0}
              valueStyle={{ color: "#f5222d" }}
            />
          </Card>
        </Flex>
      </Card>
    </Flex>
  );
}
