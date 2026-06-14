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
import ReactECharts from "echarts-for-react";
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
  const [ltmPageSize, setLtmPageSize] = useState(10);
  const [profileQuery, setProfileQuery] = useState("");
  const [profileQueryResult, setProfileQueryResult] = useState<any>(null);
  const [profileQuerying, setProfileQuerying] = useState(false);

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
      const versions = data.versions || data.history || [];
      setVersionHistory(versions);
      message.success(`加载 ${versions.length} 个版本`);
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
      const conflicts = data.conflicts || [];
      setConflicts(conflicts);
      message.success(conflicts.length > 0 ? `发现 ${conflicts.length} 个矛盾` : "没有矛盾");
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
      const entries = data.entries || data.forgotten || [];
      setForgottenLog(entries);
      message.success(`加载 ${entries.length} 条遗忘记录`);
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
    setLoading(true);
    try {
      const data = await api.post<any>("/api/memory/extract-facts", {
        text: extractText,
      });
      setExtractedFacts(data.facts || []);
      message.success(`提取 ${data.extracted ?? 0} 个事实，其中 ${data.stored ?? 0} 个已保存`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  // === 渲染面板 ===

  const renderOverview = () => (
    <Flex vertical gap={16}>
      {/* 统计信息 — 卡片化 */}
      <Flex gap={12} wrap="wrap">
        {[
          { title: "STM 大小", value: stats.stm?.size || 0, color: "#667eea" },
          { title: "LTM 总数", value: stats.ltm?.total || 0, color: "#8B5CF6" },
          { title: "版本链", value: stats.ltm?.version_chains || 0, color: "#10B981" },
          { title: "遗忘数", value: stats.ltm?.forgotten_count || 0, color: "#F59E0B" },
          { title: "待过期", value: stats.ltm?.expired_pending || 0, color: "#EF4444" },
        ].map((s) => (
          <Card key={s.title} size="small" className="glass-card" style={{ flex: "1 1 140px", minWidth: 140 }}>
            <Statistic title={<span style={{ fontSize: 12, color: "#64748B" }}>{s.title}</span>} value={s.value} valueStyle={{ fontSize: 28, fontWeight: 700, color: s.color }} />
          </Card>
        ))}
      </Flex>

      {/* 归档调度 */}
      <Card size="small" className="glass-card" title={<><HistoryOutlined /> 归档调度</>}>
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
            {t("start")}
          </Button>
          <Button
            size="small"
            icon={<PauseCircleOutlined />}
            onClick={stopSchedule}
            disabled={!schedule.running}
          >
            {t("stop")}
          </Button>
          <Button size="small" onClick={archiveNow}>
            {t("archive_now")}
          </Button>
        </Flex>
      </Card>

      {/* STM & LTM 预览 */}
      <Flex gap={16} style={{ overflow: "hidden", width: "100%" }}>
        <Card
          size="small"
          className="glass-card"
          title={`STM (${stm.size})`}
          style={{ flex: 1, minWidth: 0 }}
          styles={{ body: { maxHeight: 300, overflowY: "auto", overflowX: "hidden" } }}
        >
          {stm.entries.length === 0 ? (
            <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            stm.entries.slice(0, 10).map((e: any, i: number) => (
              <Card key={i} size="small" className="glass-card" style={{ marginBottom: 8 }}>
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
          className="glass-card"
          title={`LTM (${ltm.total})`}
          style={{ flex: 1, minWidth: 0 }}
          styles={{ body: { maxHeight: 300, overflowY: "auto", overflowX: "hidden" } }}
        >
          {ltm.entries.length === 0 ? (
            <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              size="small"
              dataSource={ltm.entries}
              pagination={ltm.entries.length > 10 ? {
                pageSize: ltmPageSize,
                size: "small",
                showSizeChanger: true,
                pageSizeOptions: ["10", "20", "50"],
                onShowSizeChange: (_current: number, size: number) => setLtmPageSize(size),
              } : false}
              renderItem={(e: any, i: number) => (
                <List.Item key={i} style={{ padding: "4px 0" }}>
                  <div style={{ width: "100%", overflow: "hidden" }}>
                    <Text strong style={{ display: "block" }}>{e.key}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                      {e.summary || JSON.stringify(e.value).slice(0, 80)}
                    </Text>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Flex>

      {/* 归档列表 */}
      <Card size="small" className="glass-card" title={`归档 (${archives.length})`}>
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
                  {t("restore")}
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
          placeholder={t("enter_key")}
          value={versionKey}
          onChange={(e) => setVersionKey(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button type="primary" onClick={loadVersionHistory} loading={loading}>
          {t("query")}
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
                <pre style={{ marginTop: 8, fontSize: 11, maxHeight: 150, overflowX: "auto", overflowY: "auto", backgroundColor: "#f5f5f5", padding: 8, wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
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
          placeholder={t("enter_key")}
          value={conflictKey}
          onChange={(e) => setConflictKey(e.target.value)}
          style={{ flex: 1 }}
        />
      </Flex>

      <Text>新值 (JSON):</Text>
      <CodeEditor value={conflictValue} onChange={setConflictValue} />

      <Button type="primary" onClick={checkConflicts} loading={loading}>
        {t("detect_conflicts")}
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

  const handleProfileQuery = async () => {
    if (!profileQuery.trim()) return;
    setProfileQuerying(true);
    try {
      const res = await api.post<any>("/api/graph/query", { query: profileQuery, maxDepth: 3, maxNodes: 30 });
      setProfileQueryResult(res);
    } catch { setProfileQueryResult(null); }
    setProfileQuerying(false);
  };

  const renderProfile = () => {
    // 从 LTM 数据构建用户画像图谱
    const buildProfileGraph = () => {
      if (!ltm.entries || ltm.entries.length === 0) return null;

      const categoryColors: Record<string, string> = {
        // 个人信息
        personal: "#8B5CF6", identity: "#8B5CF6", personal_info: "#8B5CF6", demographics: "#8B5CF6",
        // 家庭
        family: "#EC4899", parenting: "#EC4899", son: "#EC4899", children: "#EC4899",
        // 偏好兴趣
        preference: "#F59E0B", interest: "#F59E0B", hotel: "#F59E0B", hobby: "#F59E0B",
        // 健康
        health: "#10B981", fitness: "#10B981", medical: "#10B981",
        // 技术/工作
        technical: "#667eea", skill: "#667eea", programming: "#667eea", technology: "#667eea",
        project: "#3B82F6", work: "#3B82F6", career: "#3B82F6",
        // 学习
        learning: "#8B5CF6", education: "#8B5CF6",
        // 事实
        fact: "#94A3B8", extracted: "#94A3B8",
        // 默认
        default: "#CBD5E1",
      };

      const categoryLabels: Record<string, string> = {
        personal: "个人信息", identity: "个人信息", personal_info: "个人信息", demographics: "个人信息",
        family: "家庭", parenting: "家庭", son: "家庭", children: "家庭",
        preference: "偏好", interest: "兴趣", hotel: "偏好", hobby: "兴趣",
        health: "健康", fitness: "健康", medical: "健康",
        technical: "技术栈", skill: "技能", programming: "技术", technology: "技术",
        project: "项目", work: "工作", career: "职业",
        learning: "学习", education: "教育",
        fact: "事实", extracted: "提取",
        default: "其他",
      };

      const getCategory = (tags: string[]) => {
        for (const t of tags) {
          if (categoryColors[t]) return t;
        }
        return "default";
      };

      // 中心节点：用户
      const nodes: any[] = [{
        id: "user_center",
        name: "用户",
        symbolSize: 50,
        itemStyle: { color: "#8B5CF6" },
        label: { show: true, fontSize: 14, fontWeight: "bold", color: "#fff" },
        tooltip: { formatter: `<b>用户画像中心</b><br/>记忆总数: ${ltm.entries.length}` },
      }];
      const edges: any[] = [];

      // 按显示标签分组（而非按原始 tag），合并同类别的不同 tag
      const tagGroups = new Map<string, any[]>();
      for (const entry of ltm.entries) {
        const cat = getCategory(entry.tags || []);
        const groupLabel = categoryLabels[cat] || cat;
        if (!tagGroups.has(groupLabel)) tagGroups.set(groupLabel, []);
        tagGroups.get(groupLabel)!.push({ ...entry, _cat: cat });
      }

      // 为每个分组创建一个中间节点
      for (const [groupLabel, entries] of tagGroups) {
        const firstCat = entries[0]?._cat || "default";
        const catId = `cat_${groupLabel}`;
        const color = categoryColors[firstCat] || categoryColors.default;
        nodes.push({
          id: catId,
          name: groupLabel,
          symbolSize: 30,
          itemStyle: { color },
          label: { show: true, fontSize: 12, fontWeight: "bold", color: "#fff" },
          tooltip: { formatter: `<b>${groupLabel}</b><br/>包含 ${entries.length} 条记忆` },
        });
        edges.push({ source: "user_center", target: catId });

        // 每个记忆条目（显示全部，不限制数量）
        for (const entry of entries) {
          const key = entry.key?.replace(/^(fact:|recall:)/, "").replace(/_/g, " ") || "unknown";
          const val = entry.summary || (typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value));
          const valPreview = String(val).slice(0, 80);
          nodes.push({
            id: entry.id || `entry_${key}`,
            name: key.length > 12 ? key.slice(0, 10) + "..." : key,
            symbolSize: 16,
            itemStyle: { color, opacity: 0.8 },
            label: { show: true, fontSize: 9, color: "#64748B" },
            tooltip: { formatter: `<b>${key}</b><br/><span style="color:#475569">${valPreview}</span><br/><span style="color:#94A3B8;font-size:11px">标签: ${(entry.tags || []).join(", ")}</span>` },
          });
          edges.push({ source: catId, target: entry.id || `entry_${key}` });
        }
      }

      return {
        tooltip: { trigger: "item", backgroundColor: "rgba(255,255,255,0.95)", borderColor: "rgba(139,92,246,0.15)", textStyle: { color: "#334155" } },
        series: [{
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          force: { repulsion: 120, gravity: 0.08, edgeLength: [60, 150] },
          data: nodes,
          edges: edges.map(e => ({ ...e, lineStyle: { color: "#E2E8F0", curveness: 0.1 } })),
          emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        }],
      };
    };

    const option = buildProfileGraph();

    return (
      <Flex vertical gap={16}>
        <Flex gap={12} align="center">
          <Button type="primary" onClick={() => { load(); }} loading={loading}>
            {t("refresh_profile")}
          </Button>
          <Text type="secondary">基于 {ltm.entries?.length || 0} 条记忆</Text>
        </Flex>

        {/* 自然语言检索 */}
        <Card size="small" className="glass-card" style={{ overflow: "hidden" }}>
          <Flex gap={8}>
            <Input
              placeholder={t("query_memory_placeholder")}
              value={profileQuery}
              onChange={(e) => setProfileQuery(e.target.value)}
              onPressEnter={handleProfileQuery}
              allowClear
            />
            <Button type="primary" onClick={handleProfileQuery} loading={profileQuerying}>
              {t("search")}
            </Button>
          </Flex>

          {profileQueryResult && profileQueryResult.nodes?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Flex justify="space-between" align="center">
                <Text strong style={{ fontSize: 13, color: "#8B5CF6" }}>
                  命中 {profileQueryResult.nodes.length} 个节点，{profileQueryResult.edges?.length || 0} 条关联
                </Text>
                <Button type="text" size="small" onClick={() => setProfileQueryResult(null)} style={{ color: "#94A3B8" }}>✕</Button>
              </Flex>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {profileQueryResult.nodes.map((n: any, idx: number) => {
                  const key = (n.label || n.id || "").replace(/^(fact:|recall:)/, "").replace(/_/g, " ");
                  const val = n.properties?.value;
                  const valStr = val ? (typeof val === "string" ? val : JSON.stringify(val)) : "";
                  return (
                    <Tag key={idx} color="purple" style={{ borderRadius: 8, padding: "2px 10px", cursor: "default" }}
                      title={valStr}>
                      {key}
                    </Tag>
                  );
                })}
              </div>
              {profileQueryResult.nodes.some((n: any) => n.properties?.value) && (
                <div style={{ marginTop: 10, background: "rgba(139,92,246,0.03)", borderRadius: 10, padding: 12 }}>
                  {profileQueryResult.nodes.filter((n: any) => n.properties?.value).slice(0, 8).map((n: any, idx: number) => {
                    const key = (n.label || "").replace(/^(fact:|recall:)/, "").replace(/_/g, " ");
                    const val = typeof n.properties.value === "string" ? n.properties.value : JSON.stringify(n.properties.value);
                    return (
                      <div key={idx} style={{ marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 12, color: "#8B5CF6" }}>{key}</Text>
                        <Text style={{ fontSize: 12, color: "#475569", marginLeft: 8 }}>{String(val).slice(0, 120)}</Text>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {profileQueryResult && profileQueryResult.nodes?.length === 0 && (
            <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>未找到相关记忆</Text>
              <Button type="text" size="small" onClick={() => setProfileQueryResult(null)} style={{ color: "#94A3B8" }}>✕</Button>
            </Flex>
          )}
        </Card>

        {/* 图谱 */}
        {option ? (
          <div style={{ height: 500, borderRadius: 16, overflow: "hidden", background: "rgba(255,255,255,0.5)" }}>
            <ReactECharts option={option} style={{ height: "100%" }} notMerge />
          </div>
        ) : (
          <Empty description="暂无记忆数据，请先在对话中积累一些记忆" />
        )}
      </Flex>
    );
  };

  const renderForgotten = () => (
    <Flex vertical gap={16}>
      <Button type="primary" onClick={loadForgottenLog} loading={loading}>
        {t("load_log")}
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
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ["10", "20", "50"] }}
          size="small"
        />
      )}
    </Flex>
  );

  const renderExtract = () => (
    <Flex vertical gap={16}>
      <Text>输入文本:</Text>
      <Input.TextArea
        placeholder={t("paste_text")}
        value={extractText}
        onChange={(e) => setExtractText(e.target.value)}
        rows={6}
      />

      <Button type="primary" onClick={extractFacts} loading={loading}>
        {t("extract_facts")}
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
    <Flex gap={16} style={{ height: "100%", padding: "16px", overflow: "hidden", width: "100%" }}>
      {/* 左侧导航 */}
      <Card
        size="small"
        className="glass-card"
        title={
          <Flex align="center" gap={8}>
            <DatabaseOutlined />
            <span>记忆系统</span>
          </Flex>
        }
        style={{ width: 200, height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        styles={{ body: { padding: 0, flex: 1, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" } }}
      >
        <div style={{ padding: "8px 12px", flexShrink: 0 }}>
          <Button
            onClick={load}
            icon={<ReloadOutlined />}
            block
            size="small"
            loading={loading}
          >
            {t("refresh")}
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
        className="glass-card"
        style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
        styles={{ body: { flex: 1, overflowY: "auto", overflowX: "hidden" } }}
      >
        {tabContent[activeTab]?.()}
      </Card>
    </Flex>
  );
}
