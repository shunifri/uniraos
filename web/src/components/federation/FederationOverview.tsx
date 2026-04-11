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

const { Text } = Typography;

interface InstanceProfile {
  instanceId: string;
  version: string;
  skillCount: number;
  status: "joined" | "idle";
}

interface FederationStatus {
  instanceProfile: InstanceProfile;
  federationCount: number;
  running: boolean;
  heartbeatInterval: number;
  peerCount: number;
  recommendationCount: number;
  migratedSkillCount: number;
}

export default function FederationOverview() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await api.get<FederationStatus>("/api/federation/status");
      setStatus(data);
    } catch (e: any) {
      message.error(e.message || "Failed to load federation status");
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
      if (status?.instanceProfile.status === "joined") {
        await api.post("/api/federation/leave");
        setStatus((s) =>
          s
            ? {
                ...s,
                instanceProfile: { ...s.instanceProfile, status: "idle" },
              }
            : null
        );
        message.success("Left federation");
      } else {
        await api.post("/api/federation/join");
        setStatus((s) =>
          s
            ? {
                ...s,
                instanceProfile: { ...s.instanceProfile, status: "joined" },
              }
            : null
        );
        message.success("Joined federation");
      }
    } catch (e: any) {
      message.error(e.message || "Failed to toggle federation");
    }
  };

  if (!status) {
    return <Empty description="Loading..." />;
  }

  const isJoined = status.instanceProfile.status === "joined";

  return (
    <Flex vertical gap={16}>
      {/* Instance Profile */}
      <Card size="small" title="Instance Profile">
        <Flex vertical gap={12}>
          <Flex gap={12}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Instance ID
              </Text>
              <br />
              <Text strong>{status.instanceProfile.instanceId}</Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Version
              </Text>
              <br />
              <Text>{status.instanceProfile.version}</Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Skills
              </Text>
              <br />
              <Text>{status.instanceProfile.skillCount}</Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Status
              </Text>
              <br />
              <Badge
                status={isJoined ? "success" : "default"}
                text={isJoined ? "Joined" : "Idle"}
              />
            </div>
          </Flex>
        </Flex>
      </Card>

      {/* Federation Status */}
      <Card size="small" title="Federation Status">
        <Flex vertical gap={12}>
          <Flex gap={16} wrap>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Running
              </Text>
              <br />
              <Badge
                status={status.running ? "success" : "default"}
                text={status.running ? "Yes" : "No"}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Heartbeat Interval
              </Text>
              <br />
              <Text>{status.heartbeatInterval}s</Text>
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
              {isJoined ? "Leave Federation" : "Join Federation"}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadStatus}
              loading={loading}
            >
              Refresh
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* Quick Stats */}
      <Card size="small" title="Quick Statistics">
        <Flex gap={16} wrap>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Peer Instances"
              value={status.peerCount}
              valueStyle={{ color: "#1677ff" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Recommendations"
              value={status.recommendationCount}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Migrated Skills"
              value={status.migratedSkillCount}
              valueStyle={{ color: "#faad14" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Federated Networks"
              value={status.federationCount}
              valueStyle={{ color: "#f5222d" }}
            />
          </Card>
        </Flex>
      </Card>
    </Flex>
  );
}
