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
  Divider,
  List,
  App,
  Slider,
  Row,
  Col,
} from "antd";
import {
  SaveOutlined,
  ApiOutlined,
  EyeOutlined,
  PictureOutlined,
  SoundOutlined,
  AudioOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  CloudServerOutlined,
  RocketOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import { api } from "@/api";

const { Text } = Typography;

const presets: Record<string, any> = {
  openai: { type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  claude: { type: "claude", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  deepseek: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  ollama: { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3" },
};

type ModelCardType = "llm" | "vision" | "imageGen" | "tts" | "stt" | "embedding";

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
  testLLM,
  testLoading,
}: {
  def: CardDef;
  initialValues?: any;
  onSave: (type: ModelCardType, values: any) => Promise<void>;
  isLLM: boolean;
  testLLM?: () => void;
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
    await onSave(def.key, values);
  };

  return (
    <Card
      size="small"
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
            {isLLM && testLLM && (
              <Button onClick={testLLM} loading={testLoading}>
                {t("test_connection")}
              </Button>
            )}
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}

export default function ConfigPage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [agentForm] = Form.useForm();
  const [fedForm] = Form.useForm();
  const [evoForm] = Form.useForm();

  const [cardConfigs, setCardConfigs] = useState<Record<string, any>>({});
  const [testLoading, setTestLoading] = useState(false);
  const [peers, setPeers] = useState<Array<{ endpoint: string; name?: string }>>([]);
  const [newPeer, setNewPeer] = useState({ endpoint: "", name: "" });

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

      agentForm.setFieldsValue({
        maxIterations: cfg.agent.maxIterations,
        systemPrompt: cfg.agent.systemPrompt,
      });
    } catch { /* ignore */ }

    if (isAdmin) {
      try {
        const fedCfg = await api.get<any>("/api/config/federation");
        if (fedCfg.success) {
          fedForm.setFieldsValue(fedCfg.config);
          setPeers(fedCfg.config.peers || []);
        }
      } catch { /* ignore */ }
      try {
        const evoCfg = await api.get<any>("/api/config/evolution-engine");
        if (evoCfg.success) evoForm.setFieldsValue(evoCfg.config);
      } catch { /* ignore */ }
    }
  }, [isAdmin, agentForm, fedForm, evoForm]);

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

  const testLLM = async () => {
    setTestLoading(true);
    try {
      const data = await api.post<any>("/api/llm/test", {});
      if (data.success) {
        message.success(`Connected! Model: ${data.model}`);
      } else {
        message.error(data.error);
      }
    } catch (e: any) { message.error(e.message); }
    setTestLoading(false);
  };

  const saveAgent = async (values: any) => {
    try {
      await api.post<any>("/api/config/agent", values);
      message.success(t("saved"));
    } catch (e: any) { message.error(e.message); }
  };

  const saveFed = async (values: any) => {
    try {
      await api.post<any>("/api/config/federation", values);
      message.success(t("saved"));
    } catch (e: any) { message.error(e.message); }
  };

  const addPeer = async () => {
    if (!newPeer.endpoint) return;
    try {
      await api.post<any>("/api/config/federation/peers", {
        endpoint: newPeer.endpoint,
        name: newPeer.name || undefined,
      });
      setNewPeer({ endpoint: "", name: "" });
      const fedCfg = await api.get<any>("/api/config/federation");
      if (fedCfg.success) setPeers(fedCfg.config.peers || []);
      message.success(t("added"));
    } catch (e: any) { message.error(e.message); }
  };

  const removePeer = async (endpoint: string) => {
    try {
      await api.del<any>("/api/config/federation/peers", { endpoint });
      setPeers((prev) => prev.filter((p) => p.endpoint !== endpoint));
      message.success(t("deleted"));
    } catch (e: any) { message.error(e.message); }
  };

  const saveEvo = async (values: any) => {
    try {
      await api.post<any>("/api/config/evolution-engine", values);
      message.success(t("saved"));
    } catch (e: any) { message.error(e.message); }
  };

  return (
    <Flex vertical gap={16} style={{ maxWidth: 960, margin: "0 auto", padding: "16px 0" }}>
      {/* Model Cards Grid */}
      <Divider orientation="left" style={{ fontSize: 14 }}>{t("mc_title")}</Divider>
      <Row gutter={[16, 16]}>
        {MODEL_CARDS.map((def) => (
          <Col key={def.key} xs={24} md={12}>
            <ModelCardForm
              def={def}
              initialValues={cardConfigs[def.key]}
              onSave={saveModelCard}
              isLLM={def.key === "llm"}
              testLLM={def.key === "llm" ? testLLM : undefined}
              testLoading={testLoading}
            />
          </Col>
        ))}
      </Row>

      {/* Agent Settings */}
      <Card size="small" title={<><SettingOutlined /> {t("agent_settings")}</>}>
        <Form form={agentForm} layout="horizontal" labelCol={{ span: 6 }} onFinish={saveAgent} size="small">
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

      {/* Federation (Admin only) */}
      {isAdmin && (
        <Card size="small" title={<><CloudServerOutlined /> {t("federation")}</>}>
          <Form form={fedForm} layout="horizontal" labelCol={{ span: 7 }} onFinish={saveFed} size="small">
            <Form.Item name="instanceId" label={t("instance_id")}>
              <Input placeholder="raos_main" />
            </Form.Item>
            <Form.Item name="federationKey" label={t("federation_key")}>
              <Input.Password placeholder={t("federation_key_hint")} />
            </Form.Item>
            <Form.Item name="heartbeatIntervalMs" label={t("heartbeat")}>
              <InputNumber min={5000} style={{ width: 160 }} addonAfter="ms" />
            </Form.Item>
            <Form.Item name="syncIntervalMs" label={t("sync_interval")}>
              <InputNumber min={10000} style={{ width: 160 }} addonAfter="ms" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                {t("save")}
              </Button>
            </Form.Item>
          </Form>

          <Divider orientation="left" style={{ fontSize: 13 }}>{t("peers")}</Divider>
          <List
            size="small"
            dataSource={peers}
            locale={{ emptyText: t("no_peers") }}
            renderItem={(p) => (
              <List.Item
                actions={[
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removePeer(p.endpoint)}
                  />,
                ]}
              >
                <List.Item.Meta
                  title={<Text code style={{ fontSize: 12 }}>{p.endpoint}</Text>}
                  description={p.name || undefined}
                />
              </List.Item>
            )}
          />
          <Flex gap={8} style={{ marginTop: 8 }}>
            <Input
              size="small"
              placeholder="http://remote:3000"
              value={newPeer.endpoint}
              onChange={(e) => setNewPeer((p) => ({ ...p, endpoint: e.target.value }))}
              style={{ flex: 1 }}
            />
            <Input
              size="small"
              placeholder={t("name")}
              value={newPeer.name}
              onChange={(e) => setNewPeer((p) => ({ ...p, name: e.target.value }))}
              style={{ width: 150 }}
            />
            <Button size="small" icon={<PlusOutlined />} onClick={addPeer}>
              {t("add")}
            </Button>
          </Flex>
        </Card>
      )}

      {/* Evolution Engine (Admin only) */}
      {isAdmin && (
        <Card size="small" title={<><RocketOutlined /> {t("evolution_engine")}</>}>
          <Form form={evoForm} layout="horizontal" labelCol={{ span: 8 }} onFinish={saveEvo} size="small">
            <Form.Item name="autoExecute" label={t("auto_execute")} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="cycleIntervalMs" label={t("cycle_interval")}>
              <InputNumber min={60000} style={{ width: 160 }} addonAfter="ms" />
            </Form.Item>
            <Form.Item name="maxActionsPerCycle" label={t("max_actions")}>
              <InputNumber min={1} max={50} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="successRateThreshold" label={t("success_threshold")}>
              <Slider min={0} max={1} step={0.05} />
            </Form.Item>
            <Form.Item name="latencyThresholdMs" label={t("latency_threshold")}>
              <InputNumber min={100} style={{ width: 160 }} addonAfter="ms" />
            </Form.Item>
            <Form.Item name="inactiveDays" label={t("inactive_days")}>
              <InputNumber min={1} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                {t("save")}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}
    </Flex>
  );
}
