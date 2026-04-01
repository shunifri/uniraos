import { useState, useEffect } from "react";
import {
  Tabs,
  Card,
  Table,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Flex,
  Typography,
  Descriptions,
  Empty,
  Collapse,
  Badge,
  Switch,
  Checkbox,
  Tree,
  List,
  Statistic,
  App,
} from "antd";
import {
  UserAddOutlined,
  TeamOutlined,
  SafetyOutlined,
  AppstoreOutlined,
  RocketOutlined,
  ShopOutlined,
  CodeOutlined,
  CloudServerOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { api } from "@/api";

const { Text } = Typography;

export default function AdminPage() {
  const t = useI18nStore((s) => s.t);
  const { message, modal } = App.useApp();

  return (
    <Tabs
      type="card"
      size="small"
      items={[
        { key: "users", label: <><UserAddOutlined /> {t("users")}</>, children: <UsersPanel /> },
        { key: "departments", label: <><TeamOutlined /> {t("departments")}</>, children: <DepartmentsPanel /> },
        { key: "roles", label: <><SafetyOutlined /> {t("roles")}</>, children: <RolesPanel /> },
        { key: "resources", label: <><AppstoreOutlined /> {t("resources")}</>, children: <ResourcesPanel /> },
        { key: "evolution", label: <><RocketOutlined /> {t("evolution")}</>, children: <EvolutionPanel /> },
        { key: "lifecycle", label: <>{t("lifecycle")}</>, children: <LifecyclePanel /> },
        { key: "marketplace", label: <><ShopOutlined /> {t("marketplace")}</>, children: <MarketplacePanel /> },
        { key: "federation", label: <><CloudServerOutlined /> {t("federation")}</>, children: <FederationPanel /> },
        { key: "plugins", label: <><CodeOutlined /> {t("plugins")}</>, children: <PluginsPanel /> },
        { key: "tasks", label: <>{t("tasks")}</>, children: <TasksPanel /> },
      ]}
    />
  );
}

// ===== Users Panel =====
function UsersPanel() {
  const t = useI18nStore((s) => s.t);
  const { message, modal } = App.useApp();
  const [users, setUsers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form] = Form.useForm();
  const [depts, setDepts] = useState<any[]>([]);

  const load = async () => {
    const [usersR, deptsR] = await Promise.all([
      api.get<any>("/api/users"),
      api.get<any>("/api/departments"),
    ]);
    setUsers(usersR.users || []);
    setDepts(deptsR.departments || []);
  };

  useEffect(() => { load(); }, []);

  const createUser = async (values: any) => {
    try {
      const data = await api.post<any>("/api/users", values);
      if (data.success) { setShowCreate(false); form.resetFields(); load(); }
      else message.error(data.error);
    } catch (e: any) { message.error(e.message); }
  };

  const deleteUser = (id: string, username: string) => {
    modal.confirm({
      title: `${t("delete")} "${username}"?`,
      type: "warning",
      onOk: async () => {
        await api.del<any>("/api/users/" + id);
        load();
      },
    });
  };

  return (
    <Card size="small">
      <Flex justify="space-between" style={{ marginBottom: 12 }}>
        <Text strong>{t("users")}</Text>
        <Button icon={<PlusOutlined />} onClick={() => setShowCreate(true)} size="small">
          {t("create")}
        </Button>
      </Flex>
      <Table
        dataSource={users}
        rowKey="id"
        size="small"
        pagination={false}
        columns={[
          { title: t("username"), dataIndex: "username", render: (v: string) => <Text strong>{v}</Text> },
          { title: t("display_name"), dataIndex: "displayName" },
          {
            title: t("department"),
            dataIndex: "departmentId",
            render: (id: string) => {
              const d = depts.find((dep) => dep.id === id);
              return d ? <Text type="secondary">{d.path}</Text> : "-";
            },
          },
          {
            title: t("status"),
            dataIndex: "status",
            render: (s: string) => (
              <Tag color={s === "active" ? "success" : "error"}>{s}</Tag>
            ),
          },
          {
            title: t("actions"),
            render: (_: any, r: any) =>
              r.username !== "admin" ? (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => deleteUser(r.id, r.username)}
                />
              ) : null,
          },
        ]}
      />
      <Modal
        title={t("create_user")}
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={createUser}>
          <Form.Item name="username" label={t("username")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t("password")} rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="displayName" label={t("display_name")}>
            <Input />
          </Form.Item>
          <Form.Item name="departmentId" label={t("department")}>
            <Select
              options={depts.map((d) => ({
                label: "\u00A0".repeat(d.level * 2) + d.name,
                value: d.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// ===== Departments Panel =====
function DepartmentsPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [depts, setDepts] = useState<any[]>([]);

  const load = async () => {
    const data = await api.get<any>("/api/departments");
    setDepts(data.departments || []);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card size="small">
      <List
        dataSource={depts}
        renderItem={(d) => (
          <List.Item>
            <Text style={{ paddingLeft: d.level * 20 }}>
              {d.level > 0 ? "└─ " : ""}
              <Text strong>{d.name}</Text>
            </Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>{d.path}</Text>
          </List.Item>
        )}
      />
    </Card>
  );
}

// ===== Roles Panel =====
function RolesPanel() {
  const t = useI18nStore((s) => s.t);
  const [roles, setRoles] = useState<any[]>([]);

  useEffect(() => {
    api.get<any>("/api/roles").then((d) => setRoles(d.roles || []));
  }, []);

  return (
    <Card size="small">
      <List
        dataSource={roles}
        renderItem={(r) => (
          <List.Item>
            <Tag color={r.name === "admin" ? "red" : r.name === "user" ? "green" : "blue"}>
              {r.name}
            </Tag>
            <Text>{r.description}</Text>
            {r.isSystem && <Tag style={{ marginLeft: 8 }}>system</Tag>}
          </List.Item>
        )}
      />
    </Card>
  );
}

// ===== Resources Panel =====
function ResourcesPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [resources, setResources] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    const data = await api.get<any>("/api/resources");
    setResources(data.resources || []);
  };

  useEffect(() => { load(); }, []);

  const filtered = filter === "all" ? resources : resources.filter((r) => r.type === filter);

  return (
    <Card
      size="small"
      extra={
        <Space>
          {["all", "api", "skill"].map((f) => (
            <Button key={f} size="small" type={filter === f ? "primary" : "default"} onClick={() => setFilter(f)}>
              {f.toUpperCase()}
            </Button>
          ))}
          <Button size="small" onClick={() => api.post<any>("/api/resources/sync", {}).then(load)}>
            Sync
          </Button>
        </Space>
      }
    >
      <Table
        dataSource={filtered}
        rowKey="id"
        size="small"
        pagination={false}
        columns={[
          { title: t("name"), dataIndex: "name", render: (v: string) => <Text strong>{v}</Text> },
          { title: t("type"), dataIndex: "type", render: (v: string) => <Tag>{v}</Tag> },
          { title: t("description"), dataIndex: "description", ellipsis: true },
        ]}
      />
    </Card>
  );
}

// ===== Evolution Panel =====
function EvolutionPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [config, setConfig] = useState<any>({});
  const [pending, setPending] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    try {
      const [cfgR, pendR, histR] = await Promise.all([
        api.get<any>("/api/evolution/config"),
        api.get<any>("/api/evolution/pending"),
        api.get<any>("/api/evolution/history"),
      ]);
      setConfig(cfgR.config || {});
      setPending(pendR.pending || []);
      setHistory(histR.history || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const approve = async (id: string) => {
    try {
      const data = await api.post<any>("/api/evolution/approve/" + id, {});
      if (data.success) { message.success(t("approved")); load(); }
      else message.error(data.error);
    } catch (e: any) { message.error(e.message); }
  };

  return (
    <Flex vertical gap={16}>
      <Flex gap={16}>
        <Card size="small" title={t("evolution_config")} style={{ flex: 1 }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Max Depth">{config.maxGenerationDepth}</Descriptions.Item>
            <Descriptions.Item label="Max/Hour">{config.maxGenerationsPerHour}</Descriptions.Item>
            <Descriptions.Item label="Human Approval">
              <Tag color={config.requireHumanApproval ? "success" : "warning"}>
                {config.requireHumanApproval ? "Required" : "Auto"}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card size="small" title={`${t("pending")} (${pending.length})`} style={{ flex: 1 }}>
          {pending.length === 0 ? (
            <Empty description={t("no_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            pending.map((p) => (
              <Card key={p.id} size="small" style={{ marginBottom: 8 }}>
                <Text strong>{p.name}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>{p.description}</Text>
                <br />
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" type="primary" onClick={() => approve(p.id)}>
                    {t("approve")}
                  </Button>
                  <Button size="small" danger>{t("reject")}</Button>
                </Space>
              </Card>
            ))
          )}
        </Card>
      </Flex>
      <Card size="small" title={t("generation_history")}>
        <Table
          dataSource={history}
          rowKey="name"
          size="small"
          pagination={false}
          columns={[
            { title: t("name"), dataIndex: "name" },
            { title: "Generated By", dataIndex: "generatedBy" },
            { title: "Depth", dataIndex: "depth" },
            {
              title: t("time"),
              dataIndex: "timestamp",
              render: (v: number) => new Date(v).toLocaleString(),
            },
            {
              title: t("approved"),
              dataIndex: "approved",
              render: (v: boolean) => <Tag color={v ? "success" : "error"}>{v ? "Yes" : "No"}</Tag>,
            },
          ]}
        />
      </Card>
    </Flex>
  );
}

// ===== Lifecycle Panel =====
function LifecyclePanel() {
  const t = useI18nStore((s) => s.t);
  const [skills, setSkills] = useState<any[]>([]);

  useEffect(() => {
    api.get<any>("/api/lifecycle").then((d) => setSkills(d.skills || [])).catch(() => {});
  }, []);

  const stateColors: Record<string, string> = {
    active: "success", canary: "warning", deprecated: "default", retired: "error",
  };

  return (
    <Card size="small">
      <Table
        dataSource={skills}
        rowKey="name"
        size="small"
        pagination={false}
        columns={[
          { title: t("skill"), dataIndex: "name", render: (v: string) => <Text strong>{v}</Text> },
          {
            title: t("state"),
            dataIndex: "state",
            render: (v: string) => <Tag color={stateColors[v]}>{v}</Tag>,
          },
          {
            title: t("created"),
            dataIndex: "createdAt",
            render: (v: string) => new Date(v).toLocaleString(),
          },
          {
            title: t("last_used"),
            dataIndex: "lastUsedAt",
            render: (v: string) => new Date(v).toLocaleString(),
          },
        ]}
      />
    </Card>
  );
}

// ===== Marketplace Panel =====
function MarketplacePanel() {
  const t = useI18nStore((s) => s.t);
  const [packages, setPackages] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  const load = async () => {
    const data = await api.get<any>("/api/marketplace" + (search ? "?q=" + encodeURIComponent(search) : ""));
    setPackages(data.packages || []);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card size="small">
      <Flex gap={8} style={{ marginBottom: 12 }}>
        <Input
          placeholder={t("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={load}
          style={{ flex: 1 }}
          size="small"
        />
        <Button size="small" onClick={load}>{t("search")}</Button>
      </Flex>
      {packages.length === 0 ? (
        <Empty description={t("no_data")} />
      ) : (
        <List
          dataSource={packages}
          renderItem={(p) => (
            <List.Item>
              <List.Item.Meta
                title={<><Text strong>{p.name}</Text> <Tag>v{p.version}</Tag></>}
                description={p.description}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

// ===== Federation Panel =====
function FederationPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [status, setStatus] = useState<any>({});

  const load = async () => {
    try {
      setStatus(await api.get<any>("/api/federation/status"));
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const runCycle = async () => {
    try {
      await api.post<any>("/api/execute", { skillName: "evolution_run", params: {} });
      message.success(t("done"));
      load();
    } catch (e: any) { message.error(e.message); }
  };

  return (
    <Flex vertical gap={16}>
      <Flex gap={16}>
        <Card size="small" title={t("federation_status")} style={{ flex: 1 }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Instance ID">
              <Text code>{status.instanceId}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={t("peers")}>
              {status.federation?.peers ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label={t("recommendations")}>
              {status.federation?.recommendations ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label={t("migration_history")}>
              {status.migration?.historyCount ?? 0}
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card size="small" title={t("evolution_engine")} style={{ flex: 1 }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t("running")}>
              <Tag color={status.evolution?.running ? "success" : "default"}>
                {status.evolution?.running ? "Yes" : "No"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("strategies")}>
              {(status.evolution?.strategies || []).join(", ") || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("pending")}>
              {status.evolution?.pendingCount ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label={t("executed")}>
              {status.evolution?.executedCount ?? 0}
            </Descriptions.Item>
          </Descriptions>
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={runCycle}
            style={{ marginTop: 8 }}
          >
            {t("run_cycle")}
          </Button>
        </Card>
      </Flex>
    </Flex>
  );
}

// ===== Plugins Panel =====
function PluginsPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [plugins, setPlugins] = useState<any[]>([]);

  const load = async () => {
    try {
      const data = await api.get<any>("/api/plugins");
      setPlugins(data.plugins || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  return (
    <Card
      size="small"
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={async () => {
            await api.post<any>("/api/plugins/reload", {});
            load();
            message.success(t("reloaded"));
          }}
        >
          {t("reload")}
        </Button>
      }
    >
      {plugins.length === 0 ? (
        <Empty description={t("no_plugins")} />
      ) : (
        <List
          dataSource={plugins}
          renderItem={(p) => (
            <List.Item>
              <List.Item.Meta
                title={<><Text strong>{p.name}</Text> <Tag>v{p.version}</Tag></>}
                description={`${p.skills?.length || 0} skills - ${p.description || ""}`}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

// ===== Tasks Panel =====
function TasksPanel() {
  const t = useI18nStore((s) => s.t);
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  const load = async (status?: string) => {
    const s = status || filter;
    const url = s !== "all" ? "/api/tasks?status=" + s : "/api/tasks";
    try {
      const data = await api.get<any>(url);
      setTasks(data.tasks || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const statusColors: Record<string, string> = {
    PENDING: "warning", RUNNING: "processing", COMPLETED: "success", FAILED: "error", CANCELLED: "default",
  };

  return (
    <Card
      size="small"
      extra={
        <Space>
          {["all", "running", "completed", "failed"].map((f) => (
            <Button
              key={f}
              size="small"
              type={filter === f ? "primary" : "default"}
              onClick={() => { setFilter(f); load(f); }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
          <Button size="small" icon={<ReloadOutlined />} onClick={() => load()} />
        </Space>
      }
    >
      <Table
        dataSource={tasks}
        rowKey={(r) => r.taskId || r.id}
        size="small"
        pagination={false}
        columns={[
          {
            title: "Task ID",
            render: (_, r) => <Text code style={{ fontSize: 11 }}>{(r.taskId || r.id || "").slice(0, 8)}...</Text>,
          },
          {
            title: t("status"),
            dataIndex: "status",
            render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag>,
          },
          {
            title: t("progress"),
            dataIndex: "progress",
            render: (v: number | null) => v != null ? v + "%" : "-",
          },
          {
            title: t("created"),
            dataIndex: "createdAt",
            render: (v: string) => v ? new Date(v).toLocaleString() : "-",
          },
        ]}
      />
    </Card>
  );
}
