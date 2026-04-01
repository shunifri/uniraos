import { useState } from "react";
import { Card, Flex, Button, Typography } from "antd";
import {
  ReconciliationOutlined,
  BranchesOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  SliderOutlined,
  RedEnvelopeOutlined,
} from "@ant-design/icons";
import EvolutionOverview from "@/components/evolution/EvolutionOverview";
import SkillGenealogy from "@/components/evolution/SkillGenealogy";
import EmergenceMonitor from "@/components/evolution/EmergenceMonitor";
import PendingActions from "@/components/evolution/PendingActions";
import LifecycleView from "@/components/evolution/LifecycleView";
import RedlinesView from "@/components/evolution/RedlinesView";

const { Text } = Typography;

type PanelKey = "overview" | "genealogy" | "emergence" | "pending" | "lifecycle" | "redlines";

const panels: Array<{
  key: PanelKey;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType;
}> = [
  {
    key: "overview",
    label: "Evolution Overview",
    icon: <ReconciliationOutlined />,
    component: EvolutionOverview,
  },
  {
    key: "genealogy",
    label: "Skill Genealogy",
    icon: <BranchesOutlined />,
    component: SkillGenealogy,
  },
  {
    key: "emergence",
    label: "Emergence Monitor",
    icon: <WarningOutlined />,
    component: EmergenceMonitor,
  },
  {
    key: "pending",
    label: "Pending Actions",
    icon: <CheckCircleOutlined />,
    component: PendingActions,
  },
  {
    key: "lifecycle",
    label: "Lifecycle",
    icon: <SliderOutlined />,
    component: LifecycleView,
  },
  {
    key: "redlines",
    label: "Redlines",
    icon: <RedEnvelopeOutlined />,
    component: RedlinesView,
  },
];

export default function EvolutionPage() {
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
            <ReconciliationOutlined />
            <span>Evolution</span>
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
