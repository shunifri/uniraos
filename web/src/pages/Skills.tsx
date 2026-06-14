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
  Radio,
  Modal,
  Popconfirm,
  Tabs,
  Select,
} from "antd";
import {
  PlayCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ShareAltOutlined,
  UserOutlined,
  CodeOutlined,
  TeamOutlined,
  AppstoreOutlined,
  BulbOutlined,
  DeleteOutlined,
  LinkOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { useAuthStore } from "@/store/auth";
import { useI18nStore } from "@/i18n";
import { api, deleteSkill } from "@/api";
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
  source?: "own" | "shared" | "role" | "system";
}

type SkillFilter = "all" | "own" | "system" | "shared";

const autonomyColors: Record<string, string> = {
  MANUAL: "green",
  AUTO_PRE: "orange",
  AUTO_POST: "purple",
  GUARDIAN: "red",
};

const sourceColors: Record<string, string> = {
  system: "default",
  own: "blue",
  shared: "purple",
  role: "cyan",
};

const sourceLabels: Record<string, string> = {
  system: "系统",
  own: "我的",
  shared: "共享",
  role: "角色",
};

export default function SkillsPage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [selected, setSelected] = useState<SkillInfo | null>(null);
  const [params, setParams] = useState("{}");
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<
    Array<{ name: string; data: any; success: boolean; time: string }>
  >([]);
  const [shareSkill, setShareSkill] = useState<SkillInfo | null>(null);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedSkill, setEmbedSkill] = useState<SkillInfo | null>(null);
  const [embedConfig, setEmbedConfig] = useState({
    title: "",
    icon: "",
    position: "bottom-right",
    width: "420",
    height: "640",
    bottom: "20",
    right: "20",
    left: "20",
    top: "20",
  });
  const [activeEmbedTab, setActiveEmbedTab] = useState("script");

  // Skill 自动生成状态
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateName, setGenerateName] = useState("");
  const [generateDescription, setGenerateDescription] = useState("");
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState<any | null>(null);

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

  const filtered = skills.filter((s) => {
    // 搜索过滤
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    // 类型过滤
    switch (filter) {
      case "own":
        return s.owner === user?.id;
      case "system":
        return s.isSystem || !s.owner;
      case "shared":
        return s.source === "shared";
      default:
        return true;
    }
  });

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

  const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const openEmbed = (skill: SkillInfo) => {
    setEmbedSkill(skill);
    setEmbedConfig({
      title: skill.name,
      icon: "",
      position: "bottom-right",
      width: "420",
      height: "640",
      bottom: "20",
      right: "20",
      left: "20",
      top: "20",
    });
    setActiveEmbedTab("script");
    setEmbedOpen(true);
  };

  const generateScriptCode = () => {
    if (!embedSkill) return "";
    const baseUrl = window.location.origin;
    const attrs: string[] = [
      `  data-skill="${escapeHtml(embedSkill.name)}"`,
      `  data-title="${escapeHtml(embedConfig.title)}"`,
    ];
    if (embedConfig.icon) attrs.push(`  data-icon="${escapeHtml(embedConfig.icon)}"`);
    attrs.push(`  data-position="${escapeHtml(embedConfig.position)}"`);
    if (embedConfig.position.includes("bottom") && embedConfig.bottom !== "20") attrs.push(`  data-bottom="${escapeHtml(embedConfig.bottom)}"`);
    if (embedConfig.position.includes("top") && embedConfig.top !== "20") attrs.push(`  data-top="${escapeHtml(embedConfig.top)}"`);
    if (embedConfig.position.includes("right") && embedConfig.right !== "20") attrs.push(`  data-right="${escapeHtml(embedConfig.right)}"`);
    if (embedConfig.position.includes("left") && embedConfig.left !== "20") attrs.push(`  data-left="${escapeHtml(embedConfig.left)}"`);
    if (embedConfig.width !== "420") attrs.push(`  data-width="${escapeHtml(embedConfig.width)}"`);
    if (embedConfig.height !== "640") attrs.push(`  data-height="${escapeHtml(embedConfig.height)}"`);
    return `<script src="${escapeHtml(baseUrl)}/widget.js"\n${attrs.join("\n")}\n></script>`;
  };

  const generateIframeCode = () => {
    if (!embedSkill) return "";
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    params.set("skill", embedSkill.name);
    params.set("title", embedConfig.title);
    if (embedConfig.icon) params.set("icon", embedConfig.icon);
    const qs = params.toString();
    return `<iframe\n  src="${escapeHtml(baseUrl)}/embed?${escapeHtml(qs)}"\n  width="${escapeHtml(embedConfig.width)}"\n  height="${escapeHtml(embedConfig.height)}"\n  frameborder="0"\n  allow="clipboard-write; fullscreen"\n  style="border: 1px solid rgba(0,0,0,0.06); border-radius: 16px;"\n></iframe>`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await deleteSkill(selected.name);
      message.success(`Skill "${selected.name}" 已删除`);
      setSkills((prev) => prev.filter((s) => s.name !== selected.name));
      setSelected(null);
    } catch (err: any) {
      message.error(err.message || "删除失败");
    }
  };

  const canDelete = selected && !selected.isSystem && (selected.source === "own" || selected.owner === user?.id);

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
        extra={
          <Button
            size="small"
            icon={<BulbOutlined />}
            onClick={() => {
              setGenerateOpen(true);
              setGenerateResult(null);
              setGenerateName("");
              setGenerateDescription("");
            }}
          >
            从描述生成
          </Button>
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
          <Radio.Group
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            size="small"
            style={{ marginTop: 8 }}
            block
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: "all", label: <><AppstoreOutlined /> {t("all")}</> },
              { value: "own", label: <><UserOutlined /> {t("my_skills")}</> },
              { value: "system", label: <><CodeOutlined /> {t("system")}</> },
              { value: "shared", label: <><TeamOutlined /> {t("shared")}</> },
            ]}
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
                  <LinkOutlined
                    style={{ fontSize: 10, color: "#52c41a", cursor: "pointer" }}
                    title="生成嵌入代码"
                    onClick={(e) => { e.stopPropagation(); openEmbed(skill); }}
                  />
                </Flex>
                <Flex gap={4} style={{ marginTop: 4 }}>
                  <Tag
                    color={autonomyColors[skill.autonomy] || "default"}
                    style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}
                  >
                    {skill.autonomy}
                  </Tag>
                  {skill.source && (
                    <Tag
                      color={sourceColors[skill.source] || "default"}
                      style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}
                    >
                      {sourceLabels[skill.source] || skill.source}
                    </Tag>
                  )}
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

      {/* Generate Skill from Description Modal */}
      <Modal
        title="从描述生成 Skill"
        open={generateOpen}
        onCancel={() => setGenerateOpen(false)}
        width={640}
        footer={null}
      >
        <Flex vertical gap={12}>
          <Form layout="vertical">
            <Form.Item label="Skill 名称" required>
              <Input
                placeholder="如: admission_consultant"
                value={generateName}
                onChange={(e) => setGenerateName(e.target.value)}
              />
            </Form.Item>
            <Form.Item label="功能描述" required>
              <Input.TextArea
                rows={4}
                placeholder="描述这个 Skill 的功能，如：根据考生的分数和省份推荐合适的大学专业..."
                value={generateDescription}
                onChange={(e) => setGenerateDescription(e.target.value)}
              />
            </Form.Item>
          </Form>
          <Button
            type="primary"
            icon={<BulbOutlined />}
            loading={generateLoading}
            disabled={!generateName.trim() || !generateDescription.trim()}
            onClick={async () => {
              setGenerateLoading(true);
              try {
                const data = await api.post<any>("/api/execute", {
                  skillName: "skill_from_description",
                  params: {
                    name: generateName.trim(),
                    description: generateDescription.trim(),
                  },
                });
                setGenerateResult(data);
                if (data.success) {
                  message.success("Skill 生成成功，已提交审批");
                } else {
                  message.error(data.error || "生成失败");
                }
              } catch (err: any) {
                message.error(err.message || "请求失败");
              }
              setGenerateLoading(false);
            }}
          >
            生成 Skill
          </Button>
          {generateResult && (
            <Collapse
              size="small"
              items={[
                {
                  key: "result",
                  label: generateResult.success ? "生成结果" : "错误信息",
                  children: (
                    <pre style={{ fontSize: 12, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(generateResult, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          )}
        </Flex>
      </Modal>

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
            {selected.source && (
              <Descriptions.Item label="来源">
                <Tag color={sourceColors[selected.source] || "default"}>
                  {sourceLabels[selected.source] || selected.source}
                </Tag>
              </Descriptions.Item>
            )}
            {selected.owner && (
              <Descriptions.Item label="所有者">
                {selected.owner}
              </Descriptions.Item>
            )}
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
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <Button size="small" icon={<LinkOutlined />} block onClick={() => openEmbed(selected)}>
              嵌入
            </Button>
          </div>
          {canDelete && (
            <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--ant-color-border-secondary)" }}>
              <Popconfirm
                title="确认删除"
                description={`确定要删除 Skill "${selected.name}" 吗？此操作不可撤销。`}
                onConfirm={handleDelete}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<DeleteOutlined />} block>
                  删除 Skill
                </Button>
              </Popconfirm>
            </div>
          )}
        </Card>
      )}
      <Modal
        title="嵌入代码"
        open={embedOpen}
        onCancel={() => setEmbedOpen(false)}
        footer={null}
        width={640}
      >
        <Form layout="vertical" style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="窗口标题" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.title}
                onChange={(e) => setEmbedConfig({ ...embedConfig, title: e.target.value })}
                placeholder="RAOS 智能助手"
              />
            </Form.Item>
            <Form.Item label="图标地址" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.icon}
                onChange={(e) => setEmbedConfig({ ...embedConfig, icon: e.target.value })}
                placeholder="https://example.com/icon.png"
              />
            </Form.Item>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Form.Item label="位置" style={{ marginBottom: 8 }}>
              <Select
                value={embedConfig.position}
                onChange={(v) => setEmbedConfig({ ...embedConfig, position: v })}
                options={[
                  { label: "右下角", value: "bottom-right" },
                  { label: "左下角", value: "bottom-left" },
                  { label: "右上角", value: "top-right" },
                  { label: "左上角", value: "top-left" },
                ]}
              />
            </Form.Item>
            {embedConfig.position.includes("bottom") && (
              <Form.Item label="距离底部(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.bottom}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, bottom: e.target.value })}
                />
              </Form.Item>
            )}
            {embedConfig.position.includes("top") && (
              <Form.Item label="距离顶部(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.top}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, top: e.target.value })}
                />
              </Form.Item>
            )}
            {embedConfig.position.includes("right") && (
              <Form.Item label="距离右侧(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.right}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, right: e.target.value })}
                />
              </Form.Item>
            )}
            {embedConfig.position.includes("left") && (
              <Form.Item label="距离左侧(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.left}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, left: e.target.value })}
                />
              </Form.Item>
            )}
            <Form.Item label="宽度(px)" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.width}
                onChange={(e) => setEmbedConfig({ ...embedConfig, width: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="高度(px)" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.height}
                onChange={(e) => setEmbedConfig({ ...embedConfig, height: e.target.value })}
              />
            </Form.Item>
          </div>
        </Form>

        <Tabs activeKey={activeEmbedTab} onChange={setActiveEmbedTab} items={[
          {
            key: "script",
            label: "Script 嵌入（浮动按钮）",
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
                  在第三方网站 HTML 底部插入此代码，页面右下角会出现浮动对话图标。
                </Typography.Paragraph>
                <pre
                  style={{
                    background: "#f6f8fa",
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    border: "1px solid #e8e8e8",
                  }}
                >
                  {generateScriptCode()}
                </pre>
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(generateScriptCode())}>
                    复制
                  </Button>
                </div>
              </>
            ),
          },
          {
            key: "iframe",
            label: "Iframe 嵌入（直接嵌入页面）",
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
                  在第三方网站需要显示对话的位置插入此 iframe 代码。
                </Typography.Paragraph>
                <pre
                  style={{
                    background: "#f6f8fa",
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    border: "1px solid #e8e8e8",
                  }}
                >
                  {generateIframeCode()}
                </pre>
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(generateIframeCode())}>
                    复制
                  </Button>
                </div>
              </>
            ),
          },
        ]} />
      </Modal>
    </Flex>
  );
}
