import { useState } from "react";
import { useI18nStore, type TranslationKey } from "@/i18n";
import { Card, Flex, Button, Typography } from "antd";
import {
  ReconciliationOutlined,
  BranchesOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  SettingOutlined,
  RedEnvelopeOutlined,
} from "@ant-design/icons";
import EvolutionOverview from "@/components/evolution/EvolutionOverview";
import SkillGenealogy from "@/components/evolution/SkillGenealogy";
import EmergenceMonitor from "@/components/evolution/EmergenceMonitor";
import LifecycleView from "@/components/evolution/LifecycleView";
import RedlinesView from "@/components/evolution/RedlinesView";

const { Text } = Typography;

type PanelKey = "overview" | "genealogy" | "emergence" | "pending" | "lifecycle" | "redlines";

const panels: Array<{
  key: PanelKey;
  label: TranslationKey;
  icon: React.ReactNode;
  component: React.ComponentType;
}> = [
  {
    key: "overview",
    label: "evolution_overview",
    icon: <ReconciliationOutlined />,
    component: EvolutionOverview,
  },
  {
    key: "genealogy",
    label: "skill_genealogy",
    icon: <BranchesOutlined />,
    component: SkillGenealogy,
  },
  {
    key: "emergence",
    label: "emergence_monitor",
    icon: <WarningOutlined />,
    component: EmergenceMonitor,
  },

  {
    key: "lifecycle",
    label: "lifecycle",
    icon: <SettingOutlined />,
    component: LifecycleView,
  },
  {
    key: "redlines",
    label: "redlines",
    icon: <RedEnvelopeOutlined />,
    component: RedlinesView,
  },
];

export default function EvolutionPage() {
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
            <ReconciliationOutlined />
            <span>{t("evolution")}</span>
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
