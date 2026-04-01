import { useState } from "react";
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
    label: "Federation Overview",
    icon: <GlobalOutlined />,
    component: FederationOverview,
  },
  {
    key: "peers",
    label: "Peer Instances",
    icon: <DesktopOutlined />,
    component: PeersView,
  },
  {
    key: "metrics",
    label: "Metrics Comparison",
    icon: <BarChartOutlined />,
    component: MetricsComparison,
  },
  {
    key: "recommendations",
    label: "Recommendations",
    icon: <BulbOutlined />,
    component: RecommendationsPanel,
  },
  {
    key: "migration",
    label: "Migration History",
    icon: <SwapRightOutlined />,
    component: MigrationHistory,
  },
  {
    key: "config",
    label: "Configuration",
    icon: <SettingOutlined />,
    component: ConfigurationPanel,
  },
];

export default function FederationPage() {
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
            <span>Federation</span>
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
              title={panel.label}
            >
              <Text ellipsis style={{ fontSize: 12 }}>
                {panel.label}
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
