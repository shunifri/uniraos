import { useState } from "react";
import {
  Card,
  List,
  Input,
  Flex,
  Typography,
  Button,
  Empty,
  Tag,
} from "antd";
import {
  SearchOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

export interface SkillListItem {
  name: string;
  description: string;
  autonomy: string;
  visible: boolean;
  dependencies: string[];
  timeout?: number;
  isSystem?: boolean;
  owner?: string;
  source?: "own" | "shared" | "role" | "system";
}

interface Props {
  skills: SkillListItem[];
  selected: SkillListItem | null;
  onSelect: (skill: SkillListItem) => void;
  onNew: () => void;
  loading?: boolean;
}

export default function SkillEditorSidebar({
  skills,
  selected,
  onSelect,
  onNew,
  loading,
}: Props) {
  const t = useI18nStore((s) => s.t);
  const [search, setSearch] = useState("");

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card
      size="small"
      className="glass-card"
      style={{
        width: 280,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
      styles={{
        body: {
          padding: 0,
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
      title={
        <Flex align="center" justify="space-between">
          <Flex align="center" gap={8}>
            <ThunderboltOutlined />
            <span>{t("skill_list")}</span>
          </Flex>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={onNew}
          >
            {t("new_skill")}
          </Button>
        </Flex>
      }
    >
      <div style={{ padding: "8px 12px", flexShrink: 0 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t("search")}
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>
      <List
        loading={loading}
        dataSource={filtered}
        size="small"
        style={{ flex: 1, overflow: "auto" }}
        locale={{
          emptyText: <Empty description={t("no_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        }}
        renderItem={(skill) => (
          <List.Item
            onClick={() => onSelect(skill)}
            style={{
              cursor: "pointer",
              padding: "8px 12px",
              background:
                selected?.name === skill.name
                  ? "var(--ant-color-primary-bg)"
                  : undefined,
              borderLeft:
                selected?.name === skill.name
                  ? "3px solid var(--ant-color-primary)"
                  : "3px solid transparent",
            }}
          >
            <Flex vertical style={{ width: "100%" }}>
              <Flex align="center" gap={6}>
                <Text strong style={{ fontSize: 13 }}>
                  {skill.name}
                </Text>
                {skill.isSystem && (
                  <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                    {t("system")}
                  </Tag>
                )}
              </Flex>
              {skill.description && (
                <Text
                  type="secondary"
                  style={{ fontSize: 11, marginTop: 2 }}
                  ellipsis
                >
                  {skill.description}
                </Text>
              )}
            </Flex>
          </List.Item>
        )}
      />
    </Card>
  );
}
