import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Statistic,
  Tag,
  Button,
  Space,
  Empty,
  App,
  Badge,
  Typography,
} from "antd";
import {
  ReloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from "@ant-design/icons";
import { api } from "@/api";

const { Text } = Typography;

interface EvolutionStatus {
  running: boolean;
  evolutionCycles: number;
  lastRunTime?: string;
  totalSuggestions: number;
  approvedSkills: number;
  pendingSkills: number;
  emergenceDetected: number;
  redlineViolations: number;
}

export default function EvolutionOverview() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<EvolutionStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await api.get<EvolutionStatus>("/api/evolution/status");
      setStatus(data);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleEngine = async () => {
    try {
      if (status?.running) {
        await api.post("/api/evolution/stop");
        setStatus((s) => s ? { ...s, running: false } : null);
        message.success("Evolution engine stopped");
      } else {
        await api.post("/api/evolution/start");
        setStatus((s) => s ? { ...s, running: true } : null);
        message.success("Evolution engine started");
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  if (!status) {
    return <Empty description="Loading..." />;
  }

  return (
    <Flex vertical gap={16}>
      {/* Engine Status */}
      <Card size="small" title="Evolution Engine">
        <Flex vertical gap={12}>
          <Flex align="center" gap={12}>
            <Badge
              status={status.running ? "success" : "default"}
              text={status.running ? "Running" : "Stopped"}
            />
            <Button
              size="small"
              icon={status.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={toggleEngine}
              loading={loading}
              type={status.running ? "default" : "primary"}
            >
              {status.running ? "Stop" : "Start"}
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

          <Flex gap={24} wrap>
            <Statistic
              title="Evolution Cycles"
              value={status.evolutionCycles}
              valueStyle={{ fontSize: 20 }}
            />
            {status.lastRunTime && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Last Run
                </Text>
                <br />
                <Text>{new Date(status.lastRunTime).toLocaleString()}</Text>
              </div>
            )}
            <Statistic
              title="Total Suggestions"
              value={status.totalSuggestions}
              valueStyle={{ fontSize: 20 }}
            />
          </Flex>
        </Flex>
      </Card>

      {/* Quick Stats */}
      <Card size="small" title="Statistics">
        <Flex gap={16} wrap>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Approved Skills"
              value={status.approvedSkills}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Pending Skills"
              value={status.pendingSkills}
              valueStyle={{ color: "#faad14" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Emergence Detected"
              value={status.emergenceDetected}
              valueStyle={{ color: "#1677ff" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title="Redline Violations"
              value={status.redlineViolations}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Flex>
      </Card>
    </Flex>
  );
}
