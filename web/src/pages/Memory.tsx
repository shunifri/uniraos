import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Typography,
  Tag,
  Button,
  Space,
  InputNumber,
  Select,
  Badge,
  Collapse,
  Empty,
  App,
  Statistic,
  Input,
  Table,
  Timeline,
  List,
  DatePicker,
  Tabs,
} from "antd";
import {
  ReloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  HistoryOutlined,
  DatabaseOutlined,
  CloudDownloadOutlined,
  LinkOutlined,
  WarningOutlined,
  UserOutlined,
  DeleteOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { api } from "@/api";
import CodeEditor from "@/components/CodeEditor";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

type TabKey = "overview" | "version" | "conflicts" | "profile" | "forgotten" | "extract";

export default function MemoryPage() {
  const t = useI18nStore((s) => s.t);
  const { message, modal } = App.useApp();

  // 基本数据
  const [stm, setStm] = useState<any>({ entries: [], size: 0 });
  const [ltm, setLtm] = useState<any>({ entries: [], total: 0 });
  const [archives, setArchives] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any>({});
  const [stats, setStats] = useState<any>({});

  // UI 状态
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [interval, setInterval] = useState(60);
  const [unit, setUnit] = useState("minutes");
  const [loading, setLoading] = useState(false);

  // Version 面板状态
  const [versionKey, setVersionKey] = useState("");
  const [versionHistory, setVersionHistory] = useState<any[]>([]);

  // Conflicts 面板状态
  const [conflictKey, setConflictKey] = useState("");
  const [conflictValue, setConflictValue] = useState("{}");
  const [conflicts, setConflicts] = useState<any[]>([]);

  // Profile 面板状态
  const [profile, setProfile] = useState<any>(null);

  // Forgotten 面板状态
  const [forgottenLog, setForgottenLog] = useState<any[]>([]);

  // Extract 面板状态
  const [extractText, setExtractText] = useState("");
  const [extractedFacts, setExtractedFacts] = useState<any[]>([]);

  // 加载基础数据
  const load = async () => {
    try {
      setLoading(true);
      const [stmR, ltmR, archR, schR, statsR] = await Promise.all([
        api.get<any>("/api/memory/stm"),
        api.get<any>("/api/memory/ltm"),
        api.get<any>("/api/memory/archives"),
        api.get<any>("/api/memory/schedule"),
        api.get<any>("/api/memory/stats"),
      ]);
      setStm(stmR);
      setLtm(ltmR);
      setArchives(archR.archives || []);
      setSchedule(schR);
      setStats(statsR);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // === Overview 操作 ===

  const startSchedule = async () => {
    let mins = interval;
    if (unit === "hours") mins *= 60;
    try {
      await api.post<any>("/api/memory/schedule", { action: "start", intervalMinutes: mins });
      setSchedule((s: any) => ({ ...s, running: true }));
      message.success(t("started"));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const stopSchedule = async () => {
    try {
      await api.post<any>("/api/memory/schedule", { action: "stop" });
      setSchedule((s: any) => ({ ...s, running: false }));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const archiveNow = async () => {
    try {
      const data = await api.post<any>("/api/memory/archive", { reason: "manual_ui" });
      message.info(`${t("archived")}: ${data.archived} entries`);
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const restore = (archiveId: string) => {
    modal.confirm({
      title: t("restore_confirm"),
      onOk: async () => {
        const data = await api.post<any>("/api/memory/restore", { archiveId });
        message.success(`${t("restored")}: ${data.restored} entries`);
        load();
      },
    });
  };

  // === Version 操作 ===

  const loadVersionHistory = async () => {
    if (!versionKey) {
      message.warning("请输入 key");
      return;
    }
    try {
      const data = await api.get<any>(`/api/memory/versions/${versionKey}`);
      setVersionHistory(data.versions || []);
      message.success(`加载 ${data.count} 个版本`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // === Conflicts 操作 ===

  const checkConflicts = async () => {
    if (!conflictKey) {
      message.warning("请输入 key");
      return;
    }
    try {
      const value = JSON.parse(conflictValue);
      const data = await api.post<any>("/api/memory/check-conflicts", {
        key: conflictKey,
        value,
      });
      setConflicts(data.conflicts || []);
      message.success(data.hasConflicts ? `发现 ${data.count} 个矛盾` : "没有矛盾");
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // === Profile 操作 ===

  const loadProfile = async () => {
    try {
      const data = await api.get<any>("/api/memory/profile");
      setProfile(data);
      message.success("已加载用户画像");
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // === Forgotten 操作 ===

  const loadForgottenLog = async () => {
    try {
      const data = await api.get<any>("/api/memory/forgotten?limit=50");
      setForgottenLog(data.entries || []);
      message.success(`加载 ${data.total} 条遗忘记录`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // === Extract 操作 ===

  const extractFacts = async () => {
    if (!extractText) {
      message.warning("请输入文本");
      return;
    }
    try {
      const data = await api.post<any>("/api/memory/extract-facts", {
        text: extractText,
      });
      setExtractedFacts(data.facts || []);
      message.success(`提取 ${data.extracted} 个事实，其中 ${data.stored} 个已保存`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // === 渲染面板 ===

  const renderOverview = () => (
    <Flex vertical gap={16}>
      {/* 统计信息 */}
      <Flex gap={16} wrap>
        <Statistic title="STM 大小" value={stats.stm?.size || 0} />
        <Statistic title="LTM 总数" value={stats.ltm?.total || 0} />
        <Statistic title="版本链" value={stats.ltm?.version_chains || 0} />
        <Statistic title="遗忘数" value={stats.ltm?.forgotten_count || 0} />
        <Statistic title="待过期" value={stats.ltm?.expired_pending || 0} />
      </Flex>

      {/* 归档调度 */}
      <Card size="small" title={<><HistoryOutlined /> 归档调度</>}>
        <Flex align="center" gap={12} wrap>
          <Tag color={schedule.running ? "success" : "default"}>
            {schedule.running ? "运行中" : "已停止"}
          </Tag>
          <InputNumber
            size="small"
            min={1}
            max={1440}
            value={interval}
            onChange={(v) => setInterval(v || 60)}
            style={{ width: 80 }}
          />
          <Select
            size="small"
            value={unit}
            onChange={setUnit}
            options={[
              { label: "分钟", value: "minutes" },
              { label: "小时", value: "hours" },
            ]}
            style={{ width: 100 }}
          />
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={startSchedule}
            disabled={schedule.running}
          >
            开始
          </Button>
          <Button
            size="small"
            icon={<PauseCircleOutlined />}
            onClick={stopSchedule}
            disabled={!schedule.running}
          >
            停止
          </Button>
          <Button size="small" onClick={archiveNow}>
            立即归档
          </Button>
        </Flex>
      </Card>

      {/* STM & LTM 预览 */}
      <Flex gap={16}>
        <Card
          size="small"
          title={`STM (${stm.size})`}
          style={{ flex: 1 }}
          styles={{ body: { maxHeight: 300, overflow: "auto" } }}
        >
          {stm.entries.length === 0 ? (
            <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            stm.entries.slice(0, 10).map((e: any, i: number) => (
              <Card key={i} size="small" style={{ marginBottom: 8 }}>
                <Text strong>{e.key}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                  {JSON.stringify(e.value).slice(0, 80)}
                </Text>
              </Card>
            ))
          )}
        </Card>

        <Card
          size="small"
          title={`LTM (${ltm.total})`}
          style={{ flex: 1 }}
          styles={{ body: { maxHeight: 300, overflow: "auto" } }}
        >
          {ltm.entries.length === 0 ? (
            <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            ltm.entries.slice(0, 10).map((e: any, i: number) => (
              <Card key={i} size="small" style={{ marginBottom: 8 }}>
                <Text strong>{e.key}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                  {e.summary || JSON.stringify(e.value).slice(0, 80)}
                </Text>
              </Card>
            ))
          )}
        </Card>
      </Flex>

      {/* 归档列表 */}
      <Card size="small" title={`归档 (${archives.length})`}>
        {archives.length === 0 ? (
          <Empty description="无数据" />
        ) : (
          <Collapse
            size="small"
            items={archives.map((a) => ({
              key: a.id,
              label: (
                <Flex align="center" gap={8}>
                  <Text strong>{a.id}</Text>
                  <Tag>{a.reason}</Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {a.entryCount} 条 | {new Date(a.createdAt).toLocaleString()}
                  </Text>
                </Flex>
              ),
              extra: (
                <Button
                  size="small"
                  icon={<CloudDownloadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    restore(a.id);
                  }}
                >
                  恢复
                </Button>
              ),
              children: (
                <Space wrap>
                  {(a.keySummary || []).map((k: string) => (
                    <Tag key={k}>{k}</Tag>
                  ))}
                </Space>
              ),
            }))}
          />
        )}
      </Card>
    </Flex>
  );

  const renderVersion = () => (
    <Flex vertical gap={16}>
      <Flex gap={8}>
        <Input
          placeholder="输入 key..."
          value={versionKey}
          onChange={(e) => setVersionKey(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button type="primary" onClick={loadVersionHistory} loading={loading}>
          查询
        </Button>
      </Flex>

      {versionHistory.length > 0 && (
        <Timeline
          items={versionHistory.map((v) => ({
            dot: <LinkOutlined />,
            children: (
              <div>
                <Text strong>v{v.version}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {v.relation} | {new Date(v.updatedAt).toLocaleString()}
                </Text>
                {v.forgotten && <Tag color="red" style={{ marginLeft: 8 }}>已遗忘</Tag>}
                <pre style={{ marginTop: 8, fontSize: 11, maxHeight: 150, overflow: "auto", backgroundColor: "#f5f5f5", padding: 8 }}>
                  {JSON.stringify(v.value, null, 2).slice(0, 200)}
                </pre>
              </div>
            ),
          }))}
        />
      )}
    </Flex>
  );

  const renderConflicts = () => (
    <Flex vertical gap={16}>
      <Flex gap={8}>
        <Input
          placeholder="Key..."
          value={conflictKey}
          onChange={(e) => setConflictKey(e.target.value)}
          style={{ flex: 1 }}
        />
      </Flex>

      <Text>新值 (JSON):</Text>
      <CodeEditor value={conflictValue} onChange={setConflictValue} height={200} />

      <Button type="primary" onClick={checkConflicts} loading={loading}>
        检测矛盾
      </Button>

      {conflicts.length > 0 && (
        <Table
          dataSource={conflicts}
          columns={[
            { title: "现有 Key", dataIndex: "existingKey", key: "existingKey" },
            { title: "描述", dataIndex: "description", key: "description", ellipsis: true },
            {
              title: "严重程度",
              dataIndex: "severity",
              key: "severity",
              render: (s) => <Tag color={s === "high" ? "red" : s === "medium" ? "orange" : "blue"}>{s}</Tag>,
            },
          ]}
          pagination={false}
          size="small"
        />
      )}
    </Flex>
  );

  const renderProfile = () => (
    <Flex vertical gap={16}>
      <Button type="primary" onClick={loadProfile} loading={loading}>
        刷新画像
      </Button>

      {profile && (
        <>
          <Card size="small" title="基本信息">
            <Flex vertical gap={8}>
              <div><Text>生成时间: {new Date(profile.generatedAt).toLocaleString()}</Text></div>
              <div><Text>记忆数: {profile.memoryCount}</Text></div>
            </Flex>
          </Card>

          <Tabs
            items={[
              {
                key: "static",
                label: "稳定事实",
                children: (
                  <List
                    dataSource={profile.static || []}
                    renderItem={(fact: string) => <List.Item>{fact}</List.Item>}
                  />
                ),
              },
              {
                key: "dynamic",
                label: "动态上下文",
                children: (
                  <List
                    dataSource={profile.dynamic || []}
                    renderItem={(fact: string) => <List.Item>{fact}</List.Item>}
                  />
                ),
              },
            ]}
          />
        </>
      )}
    </Flex>
  );

  const renderForgotten = () => (
    <Flex vertical gap={16}>
      <Button type="primary" onClick={loadForgottenLog} loading={loading}>
        加载日志
      </Button>

      {forgottenLog.length > 0 && (
        <Table
          dataSource={forgottenLog}
          columns={[
            { title: "Key", dataIndex: "key", key: "key" },
            {
              title: "遗忘时间",
              dataIndex: "forgottenAt",
              key: "forgottenAt",
              render: (t) => new Date(t).toLocaleString(),
            },
            { title: "原因", dataIndex: "forgottenReason", key: "forgottenReason" },
          ]}
          pagination={{ pageSize: 20 }}
          size="small"
        />
      )}
    </Flex>
  );

  const renderExtract = () => (
    <Flex vertical gap={16}>
      <Text>输入文本:</Text>
      <Input.TextArea
        placeholder="粘贴或输入文本..."
        value={extractText}
        onChange={(e) => setExtractText(e.target.value)}
        rows={6}
      />

      <Button type="primary" onClick={extractFacts} loading={loading}>
        提取事实
      </Button>

      {extractedFacts.length > 0 && (
        <Table
          dataSource={extractedFacts}
          columns={[
            { title: "Key", dataIndex: "key", key: "key" },
            { title: "事实", dataIndex: "fact", key: "fact", ellipsis: true },
            { title: "置信度", dataIndex: "confidence", key: "confidence", render: (c) => `${(c * 100).toFixed(0)}%` },
          ]}
          pagination={false}
          size="small"
        />
      )}
    </Flex>
  );

  const tabContent: Record<TabKey, () => React.ReactNode> = {
    overview: renderOverview,
    version: renderVersion,
    conflicts: renderConflicts,
    profile: renderProfile,
    forgotten: renderForgotten,
    extract: renderExtract,
  };

  return (
    <Flex gap={16} style={{ height: "100%", padding: "16px" }}>
      {/* 左侧导航 */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <DatabaseOutlined />
            <span>记忆系统</span>
          </Flex>
        }
        style={{ width: 200, height: "100%", flexShrink: 0, display: "flex", flexDirection: "column" }}
        styles={{ body: { padding: 0, flex: 1, overflow: "auto", display: "flex", flexDirection: "column" } }}
      >
        <div style={{ padding: "8px 12px", flexShrink: 0 }}>
          <Button
            onClick={load}
            icon={<ReloadOutlined />}
            block
            size="small"
            loading={loading}
          >
            刷新
          </Button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {[
            { key: "overview" as const, label: "概览", icon: <DatabaseOutlined /> },
            { key: "version" as const, label: "版本历史", icon: <HistoryOutlined /> },
            { key: "conflicts" as const, label: "矛盾检测", icon: <WarningOutlined /> },
            { key: "profile" as const, label: "用户画像", icon: <UserOutlined /> },
            { key: "forgotten" as const, label: "遗忘日志", icon: <DeleteOutlined /> },
            { key: "extract" as const, label: "事实提取", icon: <FileTextOutlined /> },
          ].map((tab) => (
            <Button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              type={activeTab === tab.key ? "primary" : "text"}
              block
              icon={tab.icon}
              style={{ justifyContent: "flex-start" }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* 右侧内容 */}
      <Card
        size="small"
        style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
        styles={{ body: { flex: 1, overflow: "auto" } }}
      >
        {tabContent[activeTab]?.()}
      </Card>
    </Flex>
  );
}
