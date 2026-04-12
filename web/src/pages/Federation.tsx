import { useState } from "react";
import { useI18nStore } from "@/i18n";
import { Card, Flex, Button, Typography } from "antd";
import {
  GlobalOutlined,
  DesktopOutlined,
  BarChartOutlined,
  BulbOutlined,
  SwapRightOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import FederationOverview from "@/components/federation/FederationOverview";
import PeersView from "@/components/federation/PeersView";
import MetricsComparison from "@/components/federation/MetricsComparison";
import RecommendationsPanel from "@/components/federation/RecommendationsPanel";
import MigrationHistory from "@/components/federation/MigrationHistory";
import ConfigurationPanel from "@/components/federation/ConfigurationPanel";

const { Text } = Typography;

type PanelKey =
  | "overview"
  | "peers"
  | "metrics"
  | "recommendations"
  | "migration"
  | "config";

const panels: Array<{
  key: PanelKey;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
}> = [
  {
    key: "overview",
    label: "federation_overview",
    icon: <GlobalOutlined />,
    component: FederationOverview,
  },
  {
    key: "peers",
    label: "peer_instances",
    icon: <DesktopOutlined />,
    component: PeersView,
  },
  {
    key: "metrics",
    label: "metrics_comparison",
    icon: <BarChartOutlined />,
    component: MetricsComparison,
  },
  {
    key: "recommendations",
    label: "recommendations",
    icon: <BulbOutlined />,
    component: RecommendationsPanel,
  },
  {
    key: "migration",
    label: "migration_history",
    icon: <SwapRightOutlined />,
    component: MigrationHistory,
  },
  {
    key: "config",
    label: "configuration",
    icon: <SettingOutlined />,
    component: ConfigurationPanel,
  },
];

export default function FederationPage() {
  const t = useI18nStore((s) => s.t);
  const [activePanel, setActivePanel] = useState<PanelKey>("overview");

  const activeComponent = panels.find((p) => p.key === activePanel)?.component;
  const ActiveComponent = activeComponent;

  return (
    <Flex gap={16} style={{ height: "100%" }}>
      {/* Left Sidebar Navigation */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <GlobalOutlined />
            <span>{t("federation")}</span>
          </Flex>
        }
        style={{
          width: 200,
          height: "100%",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
        styles={{
          body: {
            padding: 0,
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <div style={{ flex: 1, overflow: "auto" }}>
          {panels.map((panel) => (
            <Button
              key={panel.key}
              onClick={() => setActivePanel(panel.key)}
              type={activePanel === panel.key ? "primary" : "text"}
              block
              icon={panel.icon}
              style={{
                justifyContent: "flex-start",
                height: 40,
                borderRadius: 0,
              }}
              title={t(panel.label)}
            >
              <Text ellipsis style={{ fontSize: 12 }}>
                {t(panel.label)}
              </Text>
            </Button>
          ))}
        </div>
      </Card>

      {/* Right Content Panel */}
      <Card
        size="small"
        style={{
          flex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        styles={{
          body: {
            flex: 1,
            overflow: "auto",
            padding: "12px",
          },
        }}
      >
        {ActiveComponent ? <ActiveComponent /> : null}
      </Card>
    </Flex>
  );
}
