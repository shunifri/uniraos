import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  InputNumber,
  Switch,
  Space,
  Flex,
  Tag,
  Typography,
  Menu,
  Row,
  Col,
  App,
} from "antd";
import type { MenuProps } from "antd";
import {
  SaveOutlined,
  ApiOutlined,
  EyeOutlined,
  PictureOutlined,
  SoundOutlined,
  AudioOutlined,
  NodeIndexOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { api } from "@/api";

const { Text, Title } = Typography;

const presets: Record<string, any> = {
  openai: { type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  claude: { type: "claude", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  deepseek: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  ollama: { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3" },
};

type ModelCardType = "llm" | "vision" | "imageGen" | "tts" | "stt" | "embedding";
type MenuKey = "models" | "agent";

interface CardDef {
  key: ModelCardType;
  icon: React.ReactNode;
  label: string;
  labelEn: string;
  modelPlaceholder: string;
}

const MODEL_CARDS: CardDef[] = [
  { key: "llm", icon: <ApiOutlined />, label: "mc_llm", labelEn: "LLM", modelPlaceholder: "gpt-4o" },
  { key: "vision", icon: <EyeOutlined />, label: "mc_vision", labelEn: "Vision", modelPlaceholder: "gpt-4o" },
  { key: "imageGen", icon: <PictureOutlined />, label: "mc_image_gen", labelEn: "Image Gen", modelPlaceholder: "dall-e-3" },
  { key: "tts", icon: <SoundOutlined />, label: "mc_tts", labelEn: "TTS", modelPlaceholder: "tts-1" },
  { key: "stt", icon: <AudioOutlined />, label: "mc_stt", labelEn: "STT", modelPlaceholder: "whisper-1" },
  { key: "embedding", icon: <NodeIndexOutlined />, label: "mc_embedding", labelEn: "Embedding", modelPlaceholder: "text-embedding-3-small" },
] as const;

function ModelCardForm({
  def,
  initialValues,
  onSave,
  isLLM,
  testModel,
  testLoading,
}: {
  def: CardDef;
  initialValues?: any;
  onSave: (type: ModelCardType, values: any) => Promise<void>;
  isLLM: boolean;
  testModel?: () => void;
  testLoading?: boolean;
}) {
  const t = useI18nStore((s) => s.t);
  const [form] = Form.useForm();
  const [inheritLLM, setInheritLLM] = useState(true);
  const configured = !!initialValues?.model;

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues);
      if (!isLLM) {
        setInheritLLM(!initialValues.hasApiKey);
      }
    }
  }, [initialValues, form, isLLM]);

  const handleFinish = async (values: any) => {
    if (!isLLM && inheritLLM) {
      values.apiKey = undefined;
      values.baseUrl = undefined;
    }
    // 显式把 inherit 状态传给后端, 让它能区分"用户没改 apiKey 字段"vs"用户要清空回退到 LLM"
    values.inheritFromLLM = !isLLM && inheritLLM;
    await onSave(def.key, values);
  };

  return (
    <Card
      size="small"
      className="glass-card"
      style={{ height: "100%" }}
      title={
        <Flex align="center" gap={8}>
          {def.icon}
          <span>{t(def.label as any)}</span>
          <Tag color={configured ? "success" : "default"} style={{ fontSize: 11 }}>
            {configured ? t("mc_configured") : t("mc_not_configured")}
          </Tag>
        </Flex>
      }
    >
      {isLLM && (
        <Space style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Presets:</Text>
          {Object.keys(presets).map((k) => (
            <Button key={k} size="small" onClick={() => form.setFieldsValue(presets[k])}>
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </Button>
          ))}
        </Space>
      )}
      {!isLLM && (
        <Form.Item label={t("mc_inherit_llm")} style={{ marginBottom: 8 }}>
          <Switch checked={inheritLLM} onChange={setInheritLLM} size="small" />
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
            {t("mc_inherit_hint")}
          </Text>
        </Form.Item>
      )}
      <Form form={form} layout="horizontal" labelCol={{ span: 7 }} onFinish={handleFinish} size="small">
        <Form.Item name="type" label="Type">
          <Select
            allowClear
            options={[
              { label: "OpenAI", value: "openai" },
              { label: "OpenAI Compatible", value: "openai-compatible" },
              { label: "Claude (Anthropic)", value: "claude" },
            ]}
          />
        </Form.Item>
        {(isLLM || !inheritLLM) && (
          <>
            <Form.Item name="apiKey" label="API Key" rules={isLLM ? [{ required: true }] : undefined}>
              <Input.Password placeholder="sk-..." />
            </Form.Item>
            <Form.Item name="baseUrl" label="Base URL">
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
          </>
        )}
        <Form.Item name="model" label="Model" rules={isLLM ? [{ required: true }] : undefined}>
          <Input placeholder={def.modelPlaceholder} />
        </Form.Item>
        {def.key === "embedding" && (
          <Form.Item name="embeddingMode" label={t("mc_emb_mode")} initialValue="openai">
            <Select options={[
              { label: "OpenAI Standard", value: "openai" },
              { label: "Volcengine Multimodal", value: "volcengine-multimodal" },
            ]} />
          </Form.Item>
        )}
        {isLLM && (
          <>
            <Form.Item name="maxTokens" label="Max Tokens">
              <InputNumber min={256} max={128000} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="temperature" label="Temperature">
              <InputNumber min={0} max={2} step={0.1} style={{ width: 140 }} />
            </Form.Item>
          </>
        )}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
              {t("save")}
            </Button>
            {testModel && (
              <Button onClick={testModel} loading={testLoading}>
                {t("test_connection")}
              </Button>
            )}
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}

function AgentPanel({ t, onSave, initialValues }: { t: any; onSave: (v: any) => Promise<void>; initialValues?: any }) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues);
    }
  }, [initialValues, form]);
  return (
    <Flex vertical gap={16}>
      <Title level={4} style={{ margin: 0 }}>
        <SettingOutlined style={{ marginRight: 8 }} />
        {t("agent_settings")}
      </Title>
      <Card size="small" className="glass-card">
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 6 }}
          onFinish={onSave}
          size="small"
          initialValues={initialValues}
        >
          <Form.Item name="maxIterations" label={t("max_iterations")}>
            <InputNumber min={1} max={50} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="systemPrompt" label={t("system_prompt")}>
            <Input.TextArea rows={3} placeholder={t("system_prompt_hint")} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
              {t("save")}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Flex>
  );
}

export default function ConfigPage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();

  const [activeKey, setActiveKey] = useState<MenuKey>("models");
  const [cardConfigs, setCardConfigs] = useState<Record<string, any>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [agentConfig, setAgentConfig] = useState<any>(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.get<any>("/api/config");
      // 加载模型卡片
      const cardsRes = await api.get<any>("/api/config/model-cards");
      const cards = cardsRes.cards || {};
      // 将 LLM 主配置合并到 llm 卡片
      if (cfg.llm) {
        cards.llm = { ...cards.llm, ...cfg.llm };
      }
      setCardConfigs(cards);

      setAgentConfig({
        maxIterations: cfg.agent?.maxIterations,
        systemPrompt: cfg.agent?.systemPrompt,
      });
    } catch (err: unknown) {
      console.warn('Failed to load config:', err);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveModelCard = async (type: ModelCardType, values: any) => {
    try {
      const data = await api.post<any>(`/api/config/model-cards/${type}`, values);
      if (data.success) {
        message.success(data.message);
        setCardConfigs((prev) => ({ ...prev, [type]: { ...prev[type], ...values } }));
      } else {
        message.error(data.error);
      }
    } catch (e: any) { message.error(e.message); }
  };

  const testModelCard = async (type: ModelCardType) => {
    setTestLoading((prev) => ({ ...prev, [type]: true }));
    try {
      if (type === "llm") {
        const data = await api.post<any>("/api/llm/test", {});
        if (data.success) {
          message.success(`LLM Connected! Model: ${data.model}`);
        } else {
          message.error(data.error);
        }
      } else {
        const data = await api.post<any>(`/api/config/model-cards/${type}/test`, {});
        if (data.success) {
          message.success(`${type} test passed: ${data.message || "Connected"}`);
        } else {
          message.error(data.error);
        }
      }
    } catch (e: any) { message.error(e.message); }
    setTestLoading((prev) => ({ ...prev, [type]: false }));
  };

  const saveAgent = async (values: any) => {
    try {
      await api.post<any>("/api/config/agent", values);
      setAgentConfig(values);
      message.success(t("saved"));
    } catch (e: any) { message.error(e.message); }
  };

  const menuItems: MenuProps["items"] = [
    {
      key: "models",
      icon: <ApiOutlined />,
      label: t("mc_title") || "模型配置",
    },
    {
      key: "agent",
      icon: <SettingOutlined />,
      label: t("agent_settings") || "Agent 设置",
    },
  ];

  const renderContent = () => {
    switch (activeKey) {
      case "models":
        return (
          <Flex vertical gap={16}>
            <Title level={4} style={{ margin: 0 }}>
              <ApiOutlined style={{ marginRight: 8 }} />
              {t("mc_title")}
            </Title>
            <Row gutter={[16, 16]}>
              {MODEL_CARDS.map((def) => (
                <Col key={def.key} xs={24} md={12}>
                  <ModelCardForm
                    def={def}
                    initialValues={cardConfigs[def.key]}
                    onSave={saveModelCard}
                    isLLM={def.key === "llm"}
                    testModel={() => testModelCard(def.key)}
                    testLoading={testLoading[def.key]}
                  />
                </Col>
              ))}
            </Row>
          </Flex>
        );

      case "agent":
        return <AgentPanel t={t} onSave={saveAgent} initialValues={agentConfig} />;

      default:
        return null;
    }
  };

  return (
    <Flex style={{ height: "calc(100vh - 64px)", overflow: "hidden" }}>
      {/* 左侧菜单 */}
      <div style={{ width: 220, borderRight: "1px solid #f0f0f0", background: "#fff", padding: "16px 0" }}>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          onClick={({ key }) => setActiveKey(key as MenuKey)}
          style={{ borderRight: 0 }}
        />
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {renderContent()}
        </div>
      </div>
    </Flex>
  );
}
