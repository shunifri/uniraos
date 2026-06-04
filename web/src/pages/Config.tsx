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
  Menu,
  Alert,
  Tooltip,
  Table,
  Modal,
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
  CloudServerOutlined,
  RocketOutlined,
  DeleteOutlined,
  PlusOutlined,
  FileTextOutlined,
  AliyunOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
  RollbackOutlined,
  StopOutlined,
  DeleteOutlined as DeleteIcon,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import { api, runCalibration, getCalibrationStatus, getCalibrationHistory, getCandidates, promoteCandidate, rejectCandidate, deleteCandidate, revertActiveCandidate, getCandidateSettings, updateCandidateSettings, type CalibrationRun, type ScoreCandidate, type CandidateStatus } from "@/api";

const { Text, Title } = Typography;

const presets: Record<string, any> = {
  openai: { type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  claude: { type: "claude", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  deepseek: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  ollama: { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3" },
};

type ModelCardType = "llm" | "vision" | "imageGen" | "tts" | "stt" | "embedding";
type MenuKey = "models" | "agent" | "docmind" | "federation" | "evolution" | "calibration";

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

// =============================================================================
// 4 个 useForm 子组件 (useForm() 在子组件里调用, 仅当 panel active 时才创建 form 实例)
// 避免 antd 警告 "Instance created by useForm is not connected to any Form element"
// =============================================================================

function AgentPanel({ t, onSave, initialValues }: { t: any; onSave: (v: any) => Promise<void>; initialValues?: any }) {
  const [form] = Form.useForm();
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

function DocMindPanel({
  t,
  config,
  testLoading,
  onSave,
  onTest,
}: {
  t: any;
  config: any;
  testLoading: boolean;
  onSave: (v: any) => Promise<void>;
  onTest: () => void;
}) {
  const [form] = Form.useForm();
  return (
    <Flex vertical gap={16}>
      <Title level={4} style={{ margin: 0 }}>
        <AliyunOutlined style={{ marginRight: 8 }} />
        Document Mind
      </Title>
      <Alert
        type="info"
        showIcon
        message={t("docmind_title")}
        description={t("docmind_desc")}
        style={{ marginBottom: 8 }}
      />
      <Card
        size="small"
        className="glass-card"
        title={
          <Flex align="center" gap={8}>
            <FileTextOutlined />
            <span>{t("api_config")}</span>
            <Tag color={config?.enabled ? "success" : "default"} style={{ fontSize: 11 }}>
              {config?.enabled ? t("enabled") : t("disabled")}
            </Tag>
          </Flex>
        }
      >
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 7 }}
          onFinish={onSave}
          size="small"
          initialValues={config || {}}
        >
          <Form.Item name="enabled" label={t("enable")} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="accessKeyId" label="AccessKey ID" rules={[{ required: true }]}>
            <Input placeholder="LTAI..." />
          </Form.Item>
          <Form.Item name="accessKeySecret" label="AccessKey Secret" rules={[{ required: true }]}>
            <Input.Password placeholder="your-secret-key" />
          </Form.Item>
          <Form.Item name="endpoint" label="Endpoint">
            <Input placeholder="docmind-api.cn-hangzhou.aliyuncs.com" />
          </Form.Item>
          <Form.Item name="regionId" label="Region">
            <Input placeholder="cn-hangzhou" />
          </Form.Item>
          <Divider orientation="left" style={{ fontSize: 13 }}>{t("advanced_options")}</Divider>
          <Form.Item name="multimediaMode" label={t("multimedia_mode")}>
            <Select
              options={[
                { label: t("base_recognition"), value: "base" },
                { label: t("advance_parsing"), value: "advance" },
              ]}
            />
          </Form.Item>
          <Form.Item name="maxPollingMinutes" label={t("max_polling_time")}>
            <InputNumber min={5} max={120} addonAfter={t("minutes")} style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="pollingIntervalSeconds" label={t("polling_interval")}>
            <InputNumber min={1} max={30} addonAfter={t("seconds")} style={{ width: 150 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                {t("save")}
              </Button>
              <Button onClick={onTest} loading={testLoading} icon={<ApiOutlined />}>
                {t("test_connection")}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </Flex>
  );
}

function FederationPanel({
  t,
  config,
  peers,
  newPeer,
  setNewPeer,
  addPeer,
  removePeer,
  onSave,
}: {
  t: any;
  config: any;
  peers: Array<{ endpoint: string; name?: string }>;
  newPeer: { endpoint: string; name: string };
  setNewPeer: any;
  addPeer: () => void;
  removePeer: (endpoint: string) => void;
  onSave: (v: any) => Promise<void>;
}) {
  const [form] = Form.useForm();
  return (
    <Flex vertical gap={16}>
      <Title level={4} style={{ margin: 0 }}>
        <CloudServerOutlined style={{ marginRight: 8 }} />
        {t("federation")}
      </Title>
      <Card size="small" className="glass-card">
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 7 }}
          onFinish={onSave}
          size="small"
          initialValues={config || {}}
        >
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
                  key="del"
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
            onChange={(e) => setNewPeer((p: any) => ({ ...p, endpoint: e.target.value }))}
            style={{ flex: 1 }}
          />
          <Input
            size="small"
            placeholder={t("name")}
            value={newPeer.name}
            onChange={(e) => setNewPeer((p: any) => ({ ...p, name: e.target.value }))}
            style={{ width: 150 }}
          />
          <Button size="small" icon={<PlusOutlined />} onClick={addPeer}>
            {t("add")}
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}

function EvolutionPanel({
  t,
  config,
  onSave,
}: {
  t: any;
  config: any;
  onSave: (v: any) => Promise<void>;
}) {
  const [form] = Form.useForm();
  return (
    <Flex vertical gap={16}>
      <Title level={4} style={{ margin: 0 }}>
        <RocketOutlined style={{ marginRight: 8 }} />
        {t("evolution_engine")}
      </Title>
      <Card size="small" className="glass-card">
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 8 }}
          onFinish={onSave}
          size="small"
          initialValues={config || {}}
        >
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
    </Flex>
  );
}

// =============================================================================
// Calibration 面板 (admin only)
// 手动触发 FTS score 标定 + 看历史 runs
// =============================================================================

function CalibrationPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [currentRun, setCurrentRun] = useState<CalibrationRun | null>(null);
  const [history, setHistory] = useState<CalibrationRun[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);

  // 初始 + 轮询：run 在跑时 1s 拉一次 status
  const refresh = useCallback(async () => {
    try {
      const status = await getCalibrationStatus();
      setCurrentRun(status.currentRun);
      const hist = await getCalibrationHistory(10);
      setHistory(hist.runs);
    } catch (err: any) {
      console.warn("[calibration-panel] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [polling, refresh]);

  // 当 run 状态从 running 变 success/failed → 停轮询
  useEffect(() => {
    if (currentRun && currentRun.status !== "running" && polling) {
      setPolling(false);
    }
  }, [currentRun, polling]);

  const handleRun = async () => {
    setSubmitting(true);
    try {
      const r = await runCalibration();
      message.success("标定已启动: " + r.run.runId);
      setPolling(true);
      await refresh();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error?.includes("already running")) {
        message.warning("已有标定在跑中,稍候...");
        setPolling(true);
      } else {
        message.error("启动失败: " + (err?.message || "未知错误"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isRunning = currentRun?.status === "running";

  return (
    <Flex vertical gap={16}>
      <Title level={4} style={{ margin: 0 }}>
        <ExperimentOutlined style={{ marginRight: 8 }} />
        标定管理
      </Title>

      <Alert
        message="手动触发 FTS 评分标定"
        description={
          <>
            标定会用最近 1000 条真实反馈 + synthetic 补充数据,跑出最优的 <code>FTS_SCORE_K</code>。
            生产建议: acceptance rate 跌到 50% 以下 / LLM 升级后 / 索引重建后 → 跑一次。
            结果写到 <code>.raos/calibration/{`{runId}`}.json</code>。
          </>
        }
        type="info"
        showIcon
      />

      <Card size="small" className="glass-card" title="当前状态">
        <Flex align="center" gap={16} wrap="wrap">
          <Button
            type="primary"
            icon={isRunning ? <LoadingOutlined /> : <ExperimentOutlined />}
            loading={submitting || isRunning}
            onClick={handleRun}
            disabled={isRunning}
          >
            {isRunning ? "标定中..." : "开始标定"}
          </Button>
          {/* 操作说明: 解释按钮的目的 — 让 ops 一眼知道什么场景下要按 */}
          <Text type="secondary" style={{ fontSize: 12 }}>
            <QuestionCircleOutlined style={{ marginRight: 4 }} />
            <strong>何时按:</strong>
            ① acceptance rate 跌到 50% 以下 ② LLM/embedding 升级 ③ 索引重建后 ④ 接入新数据源
            <Tooltip
              title={
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <div><strong>目的:</strong> 用真实 (query, node, relevance) 三元组拟合最佳的 FTS_SCORE_K,</div>
                  <div style={{ marginTop: 4 }}>让 recall top-K 排序更准 (而不是固定 k=2 的魔法值)。</div>
                  <div style={{ marginTop: 4 }}><strong>耗时:</strong> 30 秒-2 分钟 (取决于数据量), 期间不影响线上检索。</div>
                  <div style={{ marginTop: 4 }}><strong>输出:</strong> bestK / RMSE 写到 .raos/calibration/, 不直接改线上 k。</div>
                  <div style={{ marginTop: 4 }}><strong>采纳:</strong> 看 success run 的 bestK, ops 决定是否更新 FTS_SCORE_K env。</div>
                </div>
              }
            >
              <InfoCircleOutlined style={{ marginLeft: 6, color: "#1677ff", cursor: "help" }} />
            </Tooltip>
          </Text>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          {currentRun && (
            <Space>
              <Text type="secondary">Run ID:</Text>
              <Tag>{currentRun.runId}</Tag>
              {currentRun.status === "running" && (
                <Tag color="processing" icon={<LoadingOutlined />}>
                  running
                </Tag>
              )}
              {currentRun.status === "success" && (
                <Tag color="success" icon={<CheckCircleOutlined />}>
                  success
                </Tag>
              )}
              {currentRun.status === "failed" && (
                <Tag color="error" icon={<CloseCircleOutlined />}>
                  failed
                </Tag>
              )}
              {currentRun.bestK !== undefined && (
                <Tag color="cyan">best k = {currentRun.bestK.toFixed(2)}</Tag>
              )}
              {currentRun.productionRmse !== undefined && (
                <Tag color="geekblue">RMSE = {currentRun.productionRmse.toFixed(3)}</Tag>
              )}
            </Space>
          )}
        </Flex>
        {currentRun?.error && (
          <Alert type="error" message={currentRun.error} style={{ marginTop: 12 }} />
        )}
        {currentRun?.stderrTail && currentRun.status === "failed" && (
          <pre
            style={{
              marginTop: 12,
              padding: 8,
              background: "#f5f5f5",
              fontSize: 12,
              maxHeight: 160,
              overflow: "auto",
              borderRadius: 4,
            }}
          >
            {currentRun.stderrTail}
          </pre>
        )}
      </Card>

      <Card size="small" className="glass-card" title={`历史 (${history.length})`}>
        {history.length === 0 ? (
          <Text type="secondary">暂无历史</Text>
        ) : (
          <List
            size="small"
            dataSource={history}
            renderItem={(run) => (
              <List.Item>
                <Flex justify="space-between" style={{ width: "100%" }} wrap="wrap" gap={8}>
                  <Space>
                    {run.status === "running" && (
                      <Tag color="processing" icon={<LoadingOutlined />}>
                        running
                      </Tag>
                    )}
                    {run.status === "success" && (
                      <Tag color="success" icon={<CheckCircleOutlined />}>
                        success
                      </Tag>
                    )}
                    {run.status === "failed" && (
                      <Tag color="error" icon={<CloseCircleOutlined />}>
                        failed
                      </Tag>
                    )}
                    <Text code style={{ fontSize: 12 }}>
                      {run.runId}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(run.startedAt).toLocaleString()}
                    </Text>
                  </Space>
                  <Space>
                    {run.bestK !== undefined && (
                      <Tag color="cyan">k = {run.bestK.toFixed(2)}</Tag>
                    )}
                    {run.productionRmse !== undefined && (
                      <Tag color="geekblue">RMSE = {run.productionRmse.toFixed(3)}</Tag>
                    )}
                    {run.finishedAt && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s
                      </Text>
                    )}
                  </Space>
                </Flex>
              </List.Item>
            )}
          />
        )}
      </Card>

      <CandidatesTable />
    </Flex>
  );
}

// =============================================================================
// Candidates 候选池 + auto-promote 控制面板
// =============================================================================

function CandidatesTable() {
  const { message, modal } = App.useApp();
  const [candidates, setCandidates] = useState<ScoreCandidate[]>([]);
  const [active, setActive] = useState<ScoreCandidate | null>(null);
  const [currentK, setCurrentK] = useState<{ k: number; source: "env" | "candidate"; setAt: number }>({ k: 0, source: "env", setAt: 0 });
  const [autoPromote, setAutoPromote] = useState(true);
  const [threshold, setThreshold] = useState(5);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getCandidates();
      setCandidates(data.candidates);
      setActive(data.active);
      setCurrentK(data.currentK);
      const settings = await getCandidateSettings();
      setAutoPromote(settings.autoPromote);
      setThreshold(settings.improvementThresholdPct);
    } catch (err: any) {
      console.warn("[candidates] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePromote = async (id: string, k: number) => {
    setLoading(true);
    try {
      const r = await promoteCandidate(id);
      if (r.ok) {
        message.success("已采纳 k=" + k.toFixed(2));
        await refresh();
      } else {
        message.error(r.reason);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = (id: string, k: number) => {
    modal.confirm({
      title: "确认 reject?",
      content: `k=${k.toFixed(2)} 这个候选将被标记为 rejected (保留在池里但不会被 auto-promote)`,
      okText: "reject",
      onOk: async () => {
        const r = await rejectCandidate(id);
        if (r.ok) {
          message.success("已 reject");
          await refresh();
        } else {
          message.error(r.reason);
        }
      },
    });
  };

  const handleDelete = (id: string, k: number) => {
    modal.confirm({
      title: "确认 delete?",
      content: `k=${k.toFixed(2)} 这个候选将从池里移除 (软删, 审计保留)`,
      okText: "delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        const r = await deleteCandidate(id);
        if (r.ok) {
          message.success("已 delete");
          await refresh();
        } else {
          message.error(r.reason);
        }
      },
    });
  };

  const handleRevert = () => {
    modal.confirm({
      title: "确认 revert?",
      content: "回滚当前 active 到上一版 (如果没有上一版 → 回到 env 默认值)",
      okText: "revert",
      okButtonProps: { danger: true },
      onOk: async () => {
        const r = await revertActiveCandidate();
        if (r.ok) {
          message.success(r.reason);
          await refresh();
        } else {
          message.error(r.reason);
        }
      },
    });
  };

  const handleToggleAuto = async (val: boolean) => {
    const r = await updateCandidateSettings({ autoPromote: val });
    if (r.ok) {
      setAutoPromote(r.autoPromote);
      message.success("auto-promote " + (val ? "已开启" : "已关闭"));
    }
  };

  const handleThresholdChange = async (val: number) => {
    const r = await updateCandidateSettings({ improvementThresholdPct: val });
    if (r.ok) {
      setThreshold(r.improvementThresholdPct);
    }
  };

  // 过滤掉 deleted 让表格更干净
  const visibleCandidates = candidates.filter((c) => c.status !== "deleted");

  const columns = [
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (s: CandidateStatus) => {
        if (s === "active") return <Tag color="success" icon={<CheckCircleOutlined />}>active</Tag>;
        if (s === "candidate") return <Tag color="processing">candidate</Tag>;
        if (s === "rejected") return <Tag color="default">rejected</Tag>;
        return <Tag>{s}</Tag>;
      },
    },
    {
      title: "k",
      dataIndex: "k",
      key: "k",
      width: 70,
      render: (k: number) => <Text code>{k.toFixed(2)}</Text>,
    },
    {
      title: "RMSE",
      dataIndex: "rmse",
      key: "rmse",
      width: 80,
      render: (r: number) => r.toFixed(4),
    },
    {
      title: "样本",
      dataIndex: "sampleSize",
      key: "sampleSize",
      width: 60,
    },
    {
      title: "改善",
      dataIndex: "improvementVsPrevious",
      key: "improvementVsPrevious",
      width: 80,
      render: (v?: number) => {
        if (v === undefined) return <Text type="secondary">-</Text>;
        const color = v >= 0 ? "green" : "red";
        return <Tag color={color}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</Tag>;
      },
    },
    {
      title: "Run ID",
      dataIndex: "runId",
      key: "runId",
      width: 80,
      render: (id: string) => <Text code style={{ fontSize: 11 }}>{id.slice(0, 12)}</Text>,
    },
    {
      title: "时间",
      key: "time",
      render: (r: ScoreCandidate) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {new Date(r.createdAt).toLocaleString()}
        </Text>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (r: ScoreCandidate) => {
        if (r.status === "active") {
          return (
            <Button size="small" icon={<RollbackOutlined />} onClick={handleRevert}>
              revert
            </Button>
          );
        }
        if (r.status === "deleted") {
          return <Text type="secondary">已删</Text>;
        }
        return (
          <Space size={4}>
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={loading}
              onClick={() => handlePromote(r.id, r.k)}
            >
              采纳
            </Button>
            <Button
              size="small"
              icon={<StopOutlined />}
              onClick={() => handleReject(r.id, r.k)}
            >
              reject
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteIcon />}
              onClick={() => handleDelete(r.id, r.k)}
            >
              删
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      size="small"
      className="glass-card"
      title={
        <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
          <span>
            <ExperimentOutlined style={{ marginRight: 8 }} />
            候选池 ({visibleCandidates.length})
            {currentK.k > 0 && (
              <Tag color="cyan" style={{ marginLeft: 12 }}>
                当前 k = {currentK.k.toFixed(2)} ({currentK.source})
              </Tag>
            )}
          </span>
          <Space>
            <Tooltip title="新 candidate RMSE 必须比 active 低至少这个百分比, 才会被自动采纳">
              <span>阈值 {threshold}%</span>
            </Tooltip>
            <InputNumber
              size="small"
              min={0}
              max={50}
              value={threshold}
              onChange={(v) => v !== null && handleThresholdChange(v)}
              style={{ width: 60 }}
            />
            <Tooltip title="开启后, 新 candidate 满足阈值就自动改 active">
              <Switch
                size="small"
                checked={autoPromote}
                onChange={handleToggleAuto}
                checkedChildren="auto"
                unCheckedChildren="manual"
              />
            </Tooltip>
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
          </Space>
        </Flex>
      }
    >
      {visibleCandidates.length === 0 ? (
        <Text type="secondary">
          池里还没有候选。点上面"开始标定"按钮跑一次, 跑完会自动加进来。
        </Text>
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={visibleCandidates}
          columns={columns}
          pagination={false}
          rowClassName={(r) => (r.status === "active" ? "ant-table-row-selected" : "")}
        />
      )}
    </Card>
  );
}

export default function ConfigPage() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [activeKey, setActiveKey] = useState<MenuKey>("models");
  // 注: agentForm / fedForm / evoForm / docMindForm 已下沉到各自子组件 (AgentPanel /
  // FederationPanel / EvolutionPanel / DocMindPanel) — 这样 useForm() 只在对应 panel
  // active 时才调用，不会触发 antd "Instance created by useForm is not connected" 警告

  const [cardConfigs, setCardConfigs] = useState<Record<string, any>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [peers, setPeers] = useState<Array<{ endpoint: string; name?: string }>>([]);
  const [newPeer, setNewPeer] = useState({ endpoint: "", name: "" });
  const [docMindConfig, setDocMindConfig] = useState<any>({});
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [fedConfig, setFedConfig] = useState<any>(null);
  const [evoConfig, setEvoConfig] = useState<any>(null);

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
        maxIterations: cfg.agent.maxIterations,
        systemPrompt: cfg.agent.systemPrompt,
      });

      // 加载 Document Mind 配置
      const docMindDefaults = {
        enabled: false,
        accessKeyId: "",
        accessKeySecret: "",
        endpoint: "docmind-api.cn-hangzhou.aliyuncs.com",
        regionId: "cn-hangzhou",
        multimediaMode: "advance",
        maxPollingMinutes: 30,
        pollingIntervalSeconds: 3,
      };
      const docMindCfg = cfg.docMind || docMindDefaults;
      setDocMindConfig(docMindCfg);
    } catch (err: unknown) {
      console.warn('Failed to load docMind config:', err);
    }

    if (isAdmin) {
      try {
        const fedCfg = await api.get<any>("/api/config/federation");
        if (fedCfg.success) {
          setFedConfig(fedCfg.config);
          setPeers(fedCfg.config.peers || []);
        }
      } catch (err: unknown) {
        console.warn('Failed to load federation config:', err);
      }
      try {
        const evoCfg = await api.get<any>("/api/config/evolution-engine");
        if (evoCfg.success) setEvoConfig(evoCfg.config);
      } catch (err: unknown) {
        console.warn('Failed to load evolution config:', err);
      }
    }
  }, [isAdmin]);

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

  const testDocMind = async () => {
    setTestLoading((prev) => ({ ...prev, docmind: true }));
    try {
      const data = await api.post<any>("/api/config/docmind/test", {});
      if (data.success) {
        message.success(`Document Mind connected! Endpoint: ${data.endpoint}`);
      } else {
        message.error(data.error);
      }
    } catch (e: any) { message.error(e.message); }
    setTestLoading((prev) => ({ ...prev, docmind: false }));
  };

  const saveAgent = async (values: any) => {
    try {
      await api.post<any>("/api/config/agent", values);
      message.success(t("saved"));
    } catch (e: any) { message.error(e.message); }
  };

  const saveDocMind = async (values: any) => {
    try {
      const data = await api.post<any>("/api/config/docmind", values);
      if (data.success) {
        message.success(t("saved"));
        setDocMindConfig(values);
      } else {
        message.error(data.error);
      }
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
    {
      key: "docmind",
      icon: <AliyunOutlined />,
      label: "Document Mind",
    },
    ...(isAdmin ? [
      {
        key: "federation",
        icon: <CloudServerOutlined />,
        label: t("federation") || "联邦",
      },
      {
        key: "evolution",
        icon: <RocketOutlined />,
        label: t("evolution_engine") || "进化引擎",
      },
      {
        key: "calibration",
        icon: <ExperimentOutlined />,
        label: "标定管理",
      },
    ] : []),
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
        return <AgentPanel t={t} onSave={saveAgent} initialValues={cardConfigs.agent} />;

      case "docmind":
        return (
          <DocMindPanel
            t={t}
            config={docMindConfig}
            testLoading={!!testLoading["docmind"]}
            onSave={saveDocMind}
            onTest={testDocMind}
          />
        );

      case "federation":
        return (
          <FederationPanel
            t={t}
            config={fedConfig}
            peers={peers}
            newPeer={newPeer}
            setNewPeer={setNewPeer}
            addPeer={addPeer}
            removePeer={removePeer}
            onSave={saveFed}
          />
        );

      case "evolution":
        return <EvolutionPanel t={t} config={evoConfig} onSave={saveEvo} />;

      case "calibration":
        return <CalibrationPanel />;

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
