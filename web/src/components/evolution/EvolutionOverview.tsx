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
import { useI18nStore } from "@/i18n";

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
  const t = useI18nStore((s) => s.t);
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
        message.success(t("evolution_engine_stopped"));
      } else {
        await api.post("/api/evolution/start");
        setStatus((s) => s ? { ...s, running: true } : null);
        message.success(t("evolution_engine_started"));
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
      <Card size="small" title={t("evolution_engine")}>
        <Flex vertical gap={12}>
          <Flex align="center" gap={12}>
            <Badge
              status={status.running ? "success" : "default"}
              text={status.running ? t("running") : t("stopped")}
            />
            <Button
              size="small"
              icon={status.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={toggleEngine}
              loading={loading}
              type={status.running ? "default" : "primary"}
            >
              {status.running ? t("stop") : t("start")}
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

          <Flex gap={24} wrap>
            <Statistic
              title={t("evolution_cycles")}
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
              title={t("total_suggestions")}
              value={status.totalSuggestions}
              valueStyle={{ fontSize: 20 }}
            />
          </Flex>
        </Flex>
      </Card>

      {/* Quick Stats */}
      <Card size="small" title={t("statistics")}>
        <Flex gap={16} wrap>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("approved_skills")}
              value={status.approvedSkills}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("pending_skills")}
              value={status.pendingSkills}
              valueStyle={{ color: "#faad14" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("emergence_detected")}
              value={status.emergenceDetected}
              valueStyle={{ color: "#1677ff" }}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t("redline_violations")}
              value={status.redlineViolations}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Flex>
      </Card>
    </Flex>
  );
}
