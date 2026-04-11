import { useState, useEffect } from "react";
import {
  Card,
  List,
  Tag,
  Input,
  Button,
  Flex,
  Typography,
  Space,
  Form,
  Descriptions,
  App,
  Empty,
  Collapse,
  Badge,
} from "antd";
import {
  PlayCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { api } from "@/api";
import CodeEditor from "@/components/CodeEditor";
import ShareDialog from "@/components/ShareDialog";

const { Text, Title } = Typography;

interface ParamProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

interface ParamSchema {
  type?: string;
  properties?: Record<string, ParamProperty>;
  required?: string[];
  [key: string]: unknown;
}

interface SkillInfo {
  name: string;
  description: string;
  autonomy: string;
  visible: boolean;
  dependencies: string[];
  timeout?: number;
  paramSchema?: ParamSchema | null;
  isSystem?: boolean;
  owner?: string;
}

const autonomyColors: Record<string, string> = {
  MANUAL: "green",
  AUTO_PRE: "orange",
  AUTO_POST: "purple",
  GUARDIAN: "red",
};

export default function SkillsPage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SkillInfo | null>(null);
  const [params, setParams] = useState("{}");
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<
    Array<{ name: string; data: any; success: boolean; time: string }>
  >([]);
  const [shareSkill, setShareSkill] = useState<SkillInfo | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      const data = await api.get<any>("/api/skills");
      setSkills(data);
    } catch {
      message.error(t("load_failed"));
    }
  };

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase()),
  );

  const execute = async () => {
    if (!selected) return;
    setExecuting(true);
    try {
      const p = JSON.parse(params);
      const data = await api.post<any>("/api/execute", {
        skillName: selected.name,
        params: p,
      });
      setResults((prev) => [
        {
          name: selected.name,
          data,
          success: !data.error,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
    } catch (err: any) {
      message.error(err.message);
    }
    setExecuting(false);
  };

  return (
    <Flex gap={16} style={{ height: "calc(100vh - 112px)" }}>
      {/* Left: Skill List */}
      <Card
        size="small"
        className="glass-card"
        title={
          <Flex align="center" gap={8}>
            <ThunderboltOutlined />
            <span>
              {t("skills")} ({filtered.length})
            </span>
          </Flex>
        }
        style={{ width: 320, height: "100%", display: "flex", flexDirection: "column", flexShrink: 0 }}
        styles={{ body: { padding: 0, flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" } }}
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
          dataSource={filtered}
          size="small"
          style={{ flex: 1, overflow: "auto" }}
          renderItem={(skill) => (
            <List.Item
              onClick={() => setSelected(skill)}
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
                  {skill.visible ? (
                    <EyeOutlined style={{ fontSize: 10, color: "#999" }} />
                  ) : (
                    <EyeInvisibleOutlined
                      style={{ fontSize: 10, color: "#999" }}
                    />
                  )}
                  {(!skill.isSystem || skill.owner) && (
                    <ShareAltOutlined
                      style={{ fontSize: 10, color: "#1677ff", cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setShareSkill(skill); }}
                    />
                  )}
                </Flex>
                <Flex gap={4} style={{ marginTop: 4 }}>
                  <Tag
                    color={autonomyColors[skill.autonomy] || "default"}
                    style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}
                  >
                    {skill.autonomy}
                  </Tag>
                  {skill.dependencies.length > 0 && (
                    <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                      {skill.dependencies.length} deps
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

      {/* Center: Execute & Results */}
      <Flex vertical flex={1} gap={16} style={{ overflow: "auto" }}>
        <Card size="small" className="glass-card" title={t("execute_skill")}>
          <Form layout="vertical" size="small">
            <Form.Item label={t("skill_name")}>
              <Input
                value={selected?.name || ""}
                readOnly
                placeholder={t("select_skill")}
              />
            </Form.Item>
            <Form.Item label={t("parameters")}>
              <CodeEditor value={params} onChange={setParams} />
            </Form.Item>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={executing}
              onClick={execute}
              disabled={!selected}
            >
              {t("execute")}
            </Button>
          </Form>
        </Card>

        {results.length > 0 && (
          <Card
            size="small"
            className="glass-card"
            title={t("results")}
            extra={
              <a onClick={() => setResults([])}>{t("clear")}</a>
            }
          >
            <Collapse
              size="small"
              items={results.map((r, i) => ({
                key: i,
                label: (
                  <Flex align="center" gap={8}>
                    <Badge status={r.success ? "success" : "error"} />
                    <Text strong>{r.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {r.time}
                    </Text>
                  </Flex>
                ),
                children: (
                  <pre
                    style={{
                      fontSize: 11,
                      maxHeight: 300,
                      overflow: "auto",
                      margin: 0,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {JSON.stringify(r.data, null, 2)}
                  </pre>
                ),
              }))}
              defaultActiveKey={[0]}
            />
          </Card>
        )}
      </Flex>

      {/* Share Dialog */}
      <ShareDialog
        open={!!shareSkill}
        onClose={() => setShareSkill(null)}
        resourceType="skill"
        resourceId={shareSkill?.name || ""}
        resourceName={shareSkill?.name || ""}
      />

      {/* Right: Skill Detail */}
      {selected && (
        <Card
          size="small"
          className="glass-card"
          title={t("skill_detail")}
          style={{ width: 320, height: "100%", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}
          styles={{ body: { flex: 1, overflow: "auto" } }}
        >
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t("name")}>
              {selected.name}
            </Descriptions.Item>
            <Descriptions.Item label={t("autonomy")}>
              <Tag color={autonomyColors[selected.autonomy]}>
                {selected.autonomy}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("visible")}>
              {selected.visible ? t("yes") : t("no")}
            </Descriptions.Item>
            {selected.timeout && (
              <Descriptions.Item label={t("timeout")}>
                {selected.timeout}ms
              </Descriptions.Item>
            )}
            <Descriptions.Item label={t("description")}>
              {selected.description || "-"}
            </Descriptions.Item>
            {selected.dependencies.length > 0 && (
              <Descriptions.Item label={t("dependencies")}>
                <Space wrap>
                  {selected.dependencies.map((d) => (
                    <Tag key={d}>{d}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
          {selected.paramSchema && selected.paramSchema.properties && (
            <div style={{ marginTop: 12 }}>
              <Text strong style={{ fontSize: 12 }}>
                Parameters
              </Text>
              <div style={{ marginTop: 6 }}>
                {Object.entries(selected.paramSchema.properties).map(([paramName, prop]) => (
                  <div
                    key={paramName}
                    style={{
                      padding: "4px 0",
                      borderBottom: "1px solid var(--ant-color-border-secondary)",
                    }}
                  >
                    <Flex align="center" gap={6} wrap="wrap">
                      <Text code style={{ fontSize: 11 }}>
                        {paramName}
                      </Text>
                      {prop.type && (
                        <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                          {prop.type as string}
                        </Tag>
                      )}
                      {selected.paramSchema?.required?.includes(paramName) && (
                        <Tag color="red" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
                          required
                        </Tag>
                      )}
                    </Flex>
                    {prop.description && (
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 2 }}>
                        {prop.description as string}
                      </Text>
                    )}
                    {prop.enum && (
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 2 }}>
                        enum: {(prop.enum as unknown[]).map(String).join(", ")}
                      </Text>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </Flex>
  );
}
