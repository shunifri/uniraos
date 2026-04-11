import { useState, useEffect, useMemo } from "react";
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
  Divider,
  Alert,
  Tooltip,
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
  LockOutlined,
  SearchOutlined,
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
  const [editingUser, setEditingUser] = useState<any>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [depts, setDepts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [usersR, deptsR, rolesR] = await Promise.all([
      api.get<any>("/api/users"),
      api.get<any>("/api/departments"),
      api.get<any>("/api/roles"),
    ]);
    setUsers(usersR.users || []);
    setDepts(deptsR.departments || []);
    setRoles(rolesR.roles || []);
  };

  useEffect(() => { load(); }, []);

  const createUser = async (values: any) => {
    try {
      setLoading(true);
      const data = await api.post<any>("/api/users", values);
      if (data.success) { setShowCreate(false); form.resetFields(); load(); }
      else message.error(data.error);
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  };

  const openEditUser = (user: any) => {
    setEditingUser(user);
    editForm.setFieldsValue({
      displayName: user.displayName,
      phone: user.phone || "",
      email: user.email || "",
      departmentId: user.departmentId,
      roleIds: user.roles?.map((r: any) => r.id) || [],
      status: user.status,
    });
  };

  const editUser = async (values: any) => {
    if (!editingUser) return;
    try {
      setLoading(true);
      const data = await api.put<any>("/api/users/" + editingUser.id, values);
      if (data.success) { setEditingUser(null); editForm.resetFields(); load(); }
      else message.error(data.error);
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
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
          { title: t("phone"), dataIndex: "phone", render: (v: string) => v || "-" },
          { title: t("email"), dataIndex: "email", render: (v: string) => v || "-" },
          {
            title: t("department"),
            dataIndex: "departmentId",
            render: (id: string) => {
              const d = depts.find((dep) => dep.id === id);
              return d ? <Text type="secondary">{d.path}</Text> : "-";
            },
          },
          {
            title: t("roles"),
            dataIndex: "roles",
            render: (roles: any[]) =>
              roles?.length ? roles.map((r: any) => <Tag key={r.id}>{r.name}</Tag>) : "-",
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
                <Space size="small">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditUser(r)}
                  />
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => deleteUser(r.id, r.username)}
                  />
                </Space>
              ) : null,
          },
        ]}
      />

      {/* Create User Modal */}
      <Modal
        title={t("create_user")}
        open={showCreate}
        onCancel={() => { setShowCreate(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={loading}
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
          <Form.Item name="phone" label={t("phone")}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t("email")}>
            <Input />
          </Form.Item>
          <Form.Item name="departmentId" label={t("department")}>
            <Select
              allowClear
              options={depts.map((d) => ({
                label: "\u00A0".repeat(d.level * 2) + d.name,
                value: d.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="roleIds" label={t("roles")}>
            <Select
              mode="multiple"
              allowClear
              placeholder={t("select_roles")}
              options={roles.map((r: any) => ({
                label: r.name,
                value: r.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        title={`编辑用户 "${editingUser?.username}"`}
        open={!!editingUser}
        onCancel={() => { setEditingUser(null); editForm.resetFields(); }}
        onOk={() => editForm.submit()}
        confirmLoading={loading}
      >
        <Form form={editForm} layout="vertical" onFinish={editUser}>
          <Form.Item name="displayName" label={t("display_name")}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t("phone")}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t("email")}>
            <Input />
          </Form.Item>
          <Form.Item name="departmentId" label={t("department")}>
            <Select
              allowClear
              options={depts.map((d) => ({
                label: "\u00A0".repeat(d.level * 2) + d.name,
                value: d.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="roleIds" label={t("roles")}>
            <Select
              mode="multiple"
              allowClear
              options={roles.map((r: any) => ({
                label: r.name,
                value: r.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="status" label={t("status")}>
            <Select
              options={[
                { label: "active", value: "active" },
                { label: "disabled", value: "disabled" },
              ]}
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
  const { message, modal } = App.useApp();
  const [depts, setDepts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingDept, setEditingDept] = useState<any>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const data = await api.get<any>("/api/departments");
    setDepts(data.departments || []);
  };

  useEffect(() => { load(); }, []);

  const createDept = async (values: any) => {
    try {
      setLoading(true);
      const data = await api.post<any>("/api/departments", values);
      if (data.success || data.department) {
        setShowCreate(false);
        createForm.resetFields();
        load();
      } else {
        message.error(data.error || "创建失败");
      }
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  };

  const openEditDept = (dept: any) => {
    setEditingDept(dept);
    editForm.setFieldsValue({
      name: dept.name,
      parentId: dept.parentId,
      description: dept.description,
    });
  };

  const editDept = async (values: any) => {
    if (!editingDept) return;
    try {
      setLoading(true);
      const data = await api.put<any>("/api/departments/" + editingDept.id, values);
      if (data.success || data.department) {
        setEditingDept(null);
        editForm.resetFields();
        load();
      } else {
        message.error(data.error || "更新失败");
      }
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  };

  const deleteDept = (id: string, name: string) => {
    modal.confirm({
      title: `删除部门 "${name}"?`,
      content: "删除后该部门下的子部门和用户将失去关联，请谨慎操作。",
      okType: "danger",
      onOk: async () => {
        try {
          await api.del<any>("/api/departments/" + id);
          load();
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const parentOptions = depts.map((d) => ({
    label: "\u00A0".repeat(d.level * 2) + d.name,
    value: d.id,
  }));

  return (
    <Card size="small">
      <Flex justify="space-between" style={{ marginBottom: 12 }}>
        <Text strong>{t("departments")}</Text>
        <Button icon={<PlusOutlined />} size="small" onClick={() => setShowCreate(true)}>
          新建部门
        </Button>
      </Flex>
      <List
        dataSource={depts}
        renderItem={(d) => (
          <List.Item
            actions={[
              <Button
                key="edit"
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEditDept(d)}
              />,
              <Button
                key="delete"
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => deleteDept(d.id, d.name)}
              />,
            ]}
          >
            <Text style={{ paddingLeft: d.level * 20 }}>
              {d.level > 0 ? "└─ " : ""}
              <Text strong>{d.name}</Text>
            </Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>{d.path}</Text>
          </List.Item>
        )}
      />

      {/* Create Department Modal */}
      <Modal
        title="新建部门"
        open={showCreate}
        onCancel={() => { setShowCreate(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        confirmLoading={loading}
      >
        <Form form={createForm} layout="vertical" onFinish={createDept}>
          <Form.Item name="name" label="部门名称" rules={[{ required: true, message: "请输入部门名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parentId" label="上级部门">
            <Select
              allowClear
              placeholder="无（顶级部门）"
              options={parentOptions}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Department Modal */}
      <Modal
        title={`编辑部门 "${editingDept?.name}"`}
        open={!!editingDept}
        onCancel={() => { setEditingDept(null); editForm.resetFields(); }}
        onOk={() => editForm.submit()}
        confirmLoading={loading}
      >
        <Form form={editForm} layout="vertical" onFinish={editDept}>
          <Form.Item name="name" label="部门名称" rules={[{ required: true, message: "请输入部门名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parentId" label="上级部门">
            <Select
              allowClear
              placeholder="无（顶级部门）"
              options={parentOptions.filter((o) => o.value !== editingDept?.id)}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// ===== Skill Permission Categories =====
const SKILL_CATEGORIES: Record<string, string[]> = {
  "📁 文件操作": ["file_read", "file_write", "file_append", "file_delete", "file_list"],
  "🌐 网络请求": ["http_call", "shell_exec"],
  "🗄️ 数据库": ["db_query", "db_execute", "db_schema", "db_batch", "db_connections", "mysql_query", "mysql_execute"],
  "📚 知识库": ["kb_ingest", "kb_search", "kb_list", "kb_delete", "kb_share", "kb_shared", "kb_stats", "kb_rebuild"],
  "🧠 短期记忆": ["stm_store", "stm_retrieve", "stm_forget"],
  "💾 长期记忆": ["ltm_store", "ltm_search", "ltm_delete", "ltm_list", "ltm_archive", "ltm_restore", "memory_export", "memory_import"],
  "🔗 知识图谱": ["graph_query", "graph_path", "graph_communities", "recall_context", "gc_collect"],
  "📊 图表生成": ["chart_recommend", "chart_generate", "chart_multi"],
  "🔍 网络搜索": ["web_search", "web_fetch", "web_extract_links", "web_screenshot", "web_browse"],
  "📄 文档处理": ["doc_read", "doc_read_csv", "doc_to_markdown", "doc_extract_images"],
  "🎨 多媒体": ["image_generate", "image_understand", "tts_generate", "stt_recognize"],
  "💬 用户交互": ["user_confirm"],
  "⚙️ 元技能": ["skill_compose", "skill_from_description", "skill_from_template", "skill_optimizer", "skill_test", "skill_info", "skill_list_all", "skill_unregister"],
  "📋 任务规划": ["plan_and_execute"],
  "🧬 进化控制": ["skill_generate", "skill_migrate", "skill_deprecate", "evolution_genealogy", "evolution_emergence_report", "evolution_red_lines", "evolution_check"],
  "📝 Prompt 管理": ["prompt_register", "prompt_render", "prompt_delete"],
  "🌍 协议/联邦": ["ws_connect", "ws_send", "ws_receive", "ws_close", "ws_list", "mq_publish", "mq_consume", "mq_channels", "federation_sync", "federation_propose_evolution", "federation_aggregate_metrics", "federation_share_skill", "skill_migrate_pull", "skill_migrate_push", "skill_export_package", "skill_import_package"],
  "📦 API 管理": ["api_import", "api_auth_config", "api_list", "api_delete", "api_test"],
  "🎛️ PPT 主题": ["pptx_list_themes", "pptx_learn_theme", "pptx_delete_theme"],
};

// Build reverse lookup: skillName -> category
const SKILL_TO_CATEGORY: Record<string, string> = {};
for (const [cat, skills] of Object.entries(SKILL_CATEGORIES)) {
  for (const s of skills) SKILL_TO_CATEGORY[s] = cat;
}

// ===== Roles Panel =====
function RolesPanel() {
  const t = useI18nStore((s) => s.t);
  const { message, modal } = App.useApp();
  const [roles, setRoles] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [savePermLoading, setSavePermLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [createLoading, setCreateLoading] = useState(false);
  const [permTab, setPermTab] = useState("module");
  const [skillSearch, setSkillSearch] = useState("");

  const isAdmin = selectedRole?.name === "admin";

  const loadRoles = async () => {
    const d = await api.get<any>("/api/roles");
    setRoles(d.roles || []);
  };

  const [skillDescriptions, setSkillDescriptions] = useState<Record<string, string>>({});

  const loadAllPermissions = async () => {
    try {
      const [permData, skillData] = await Promise.all([
        api.get<any>("/api/permissions"),
        api.get<any>("/api/skills"),
      ]);
      setAllPermissions(permData.permissions || []);
      // 构建 skill 名称→描述映射
      const skills = Array.isArray(skillData) ? skillData : (skillData.skills || []);
      const descMap: Record<string, string> = {};
      for (const s of skills) {
        if (s.name && s.description) {
          // 取描述第一行，截断到60字符
          const firstLine = String(s.description).split("\n")[0].replace(/^[【\[].*?[】\]]\s*/, "").trim();
          descMap[s.name] = firstLine.length > 60 ? firstLine.slice(0, 58) + "..." : firstLine;
        }
      }
      setSkillDescriptions(descMap);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadRoles();
    loadAllPermissions();
  }, []);

  const createRole = async (values: any) => {
    try {
      setCreateLoading(true);
      const data = await api.post<any>("/api/roles", values);
      if (data.success || data.role) {
        setShowCreate(false);
        createForm.resetFields();
        loadRoles();
      } else {
        message.error(data.error || "创建失败");
      }
    } catch (e: any) { message.error(e.message); }
    finally { setCreateLoading(false); }
  };

  const deleteRole = (id: string, name: string) => {
    modal.confirm({
      title: `删除角色 "${name}"?`,
      okType: "danger",
      onOk: async () => {
        try {
          await api.del<any>("/api/roles/" + id);
          if (selectedRole?.id === id) setSelectedRole(null);
          loadRoles();
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const selectRole = async (role: any) => {
    setSelectedRole(role);
    setPermLoading(true);
    try {
      const d = await api.get<any>("/api/roles/" + role.id + "/permissions");
      setRolePermissions((d.permissions || []).map((p: any) => p.id || p));
    } catch { setRolePermissions([]); }
    finally { setPermLoading(false); }
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    try {
      setSavePermLoading(true);
      await api.post<any>("/api/roles/" + selectedRole.id + "/permissions", {
        permissions: rolePermissions,
      });
      message.success("权限已保存");
    } catch (e: any) { message.error(e.message); }
    finally { setSavePermLoading(false); }
  };

  // Categorize permissions into three tabs
  const categorized = useMemo(() => {
    const modulePerms: any[] = [];
    const apiPerms: any[] = [];
    const skillPerms: any[] = [];
    for (const perm of allPermissions) {
      const permName = (perm.name || "") as string;
      if (permName.startsWith("menu:")) {
        modulePerms.push(perm);
      } else if (permName.startsWith("skill:")) {
        skillPerms.push(perm);
      } else {
        apiPerms.push(perm);
      }
    }
    return { modulePerms, apiPerms, skillPerms };
  }, [allPermissions]);

  // Group skill permissions by SKILL_CATEGORIES
  const skillsByCategory = useMemo(() => {
    const result: Record<string, any[]> = {};
    const uncategorized: any[] = [];
    for (const perm of categorized.skillPerms) {
      const permName = (perm.name || "") as string;
      // Extract skill name from "skill:xxx.execute" or "skill:xxx"
      const match = permName.match(/^skill:(.+?)(?:\.execute)?$/);
      const skillName = match ? match[1] : permName.replace("skill:", "");
      const cat = SKILL_TO_CATEGORY[skillName];
      if (cat) {
        if (!result[cat]) result[cat] = [];
        result[cat].push(perm);
      } else {
        uncategorized.push(perm);
      }
    }
    if (uncategorized.length > 0) {
      result["其他"] = uncategorized;
    }
    return result;
  }, [categorized.skillPerms]);

  // Filter skills by search
  const filteredSkillsByCategory = useMemo(() => {
    if (!skillSearch.trim()) return skillsByCategory;
    const q = skillSearch.toLowerCase();
    const result: Record<string, any[]> = {};
    for (const [cat, perms] of Object.entries(skillsByCategory)) {
      const filtered = perms.filter((p: any) => {
        const permId = (p.id || p.name || "") as string;
        return permId.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q);
      });
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [skillsByCategory, skillSearch]);

  const togglePerm = (permId: string, checked: boolean) => {
    if (isAdmin) return;
    if (checked) {
      setRolePermissions((prev) => [...prev, permId]);
    } else {
      setRolePermissions((prev) => prev.filter((id) => id !== permId));
    }
  };

  const toggleCategoryAll = (perms: any[]) => {
    if (isAdmin) return;
    const permIds = perms.map((p: any) => p.id || p.name);
    const allChecked = permIds.every((id: string) => rolePermissions.includes(id));
    if (allChecked) {
      setRolePermissions((prev) => prev.filter((id) => !permIds.includes(id)));
    } else {
      setRolePermissions((prev) => {
        const newPerms = [...prev];
        for (const id of permIds) {
          if (!newPerms.includes(id)) newPerms.push(id);
        }
        return newPerms;
      });
    }
  };

  const renderPermList = (perms: any[]) => {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "4px 16px" }}>
        {perms.map((perm: any) => {
          const permId = perm.id || perm.name;
          const checked = isAdmin || rolePermissions.includes(permId);
          // 显示友好名称
          const permNameStr = (perm.name || "") as string;
          const displayName = permNameStr.replace(/^(skill:|menu:)/, "").replace(/\.(read|write|execute|manage)$/, "");
          // 优先使用 skill 的实际功能描述
          const skillDesc = skillDescriptions[displayName] || skillDescriptions[displayName.replace(/_/g, "")] || "";
          const desc = skillDesc || perm.description || "";
          const shortDesc = desc.length > 25 ? desc.slice(0, 23) + "..." : desc;
          return (
            <Tooltip key={permId} title={desc || displayName} placement="topLeft">
              <Checkbox
                checked={checked}
                disabled={isAdmin}
                onChange={(e) => togglePerm(permId, e.target.checked)}
                style={{ width: "100%", padding: "2px 0" }}
              >
                <Text style={{ fontSize: 12 }}>{displayName}</Text>
                {shortDesc && <Text type="secondary" style={{ fontSize: 10, marginLeft: 6 }}>{shortDesc}</Text>}
              </Checkbox>
            </Tooltip>
          );
        })}
      </div>
    );
  };

  const renderCategorizedSkills = () => (
    <Flex vertical gap={12}>
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索 Skill 权限..."
        size="small"
        value={skillSearch}
        onChange={(e) => setSkillSearch(e.target.value)}
        allowClear
      />
      {Object.keys(filteredSkillsByCategory).length === 0 ? (
        <Empty description="无匹配的 Skill 权限" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        Object.entries(filteredSkillsByCategory).map(([cat, perms]) => {
          const permIds = (perms as any[]).map((p: any) => p.id || p.name);
          const allChecked = isAdmin || permIds.every((id: string) => rolePermissions.includes(id));
          return (
            <div key={cat}>
              <Flex align="center" justify="space-between" style={{ marginBottom: 4 }}>
                <Text strong style={{ fontSize: 12, color: "#666" }}>{cat}</Text>
                <Button
                  type="link"
                  size="small"
                  disabled={isAdmin}
                  onClick={() => toggleCategoryAll(perms as any[])}
                  style={{ fontSize: 11, padding: 0, height: "auto" }}
                >
                  {allChecked ? "取消" : "全选"}
                </Button>
              </Flex>
              <Divider style={{ margin: "4px 0 8px" }} />
              {renderPermList(perms as any[])}
            </div>
          );
        })
      )}
    </Flex>
  );

  return (
    <Flex gap={12}>
      {/* Role List */}
      <Card size="small" style={{ flex: 1, minWidth: 220 }}>
        <Flex justify="space-between" style={{ marginBottom: 12 }}>
          <Text strong>{t("roles")}</Text>
          <Button icon={<PlusOutlined />} size="small" onClick={() => setShowCreate(true)}>
            新建角色
          </Button>
        </Flex>
        <List
          dataSource={roles}
          renderItem={(r) => (
            <List.Item
              style={{
                cursor: "pointer",
                background: selectedRole?.id === r.id ? "rgba(22,119,255,0.08)" : undefined,
                borderRadius: 4,
                padding: "6px 8px",
              }}
              onClick={() => selectRole(r)}
              actions={
                !r.isSystem
                  ? [
                      <Button
                        key="delete"
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); deleteRole(r.id, r.name); }}
                      />,
                    ]
                  : []
              }
            >
              <Flex vertical gap={2}>
                <Space size={4}>
                  <Tag color={r.name === "admin" ? "red" : r.name === "user" ? "green" : "blue"}>
                    {r.name}
                  </Tag>
                  {r.isSystem && <Tag>system</Tag>}
                </Space>
                {r.description && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.description}</Text>
                )}
              </Flex>
            </List.Item>
          )}
        />
      </Card>

      {/* Permission Configuration */}
      <Card
        size="small"
        style={{ flex: 2 }}
        title={
          selectedRole ? (
            <Space>
              <LockOutlined />
              <span>角色权限：{selectedRole.name}</span>
            </Space>
          ) : "权限配置"
        }
        extra={
          selectedRole && !isAdmin && (
            <Button
              size="small"
              type="primary"
              loading={savePermLoading}
              onClick={savePermissions}
            >
              保存权限
            </Button>
          )
        }
      >
        {!selectedRole ? (
          <Empty description="请选择一个角色以配置权限" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : permLoading ? (
          <Text type="secondary">加载中...</Text>
        ) : allPermissions.length === 0 ? (
          <Empty description="暂无可用权限" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Flex vertical gap={12}>
            {isAdmin && (
              <Alert message="管理员角色拥有所有权限" type="info" showIcon style={{ marginBottom: 4 }} />
            )}
            <Tabs
              size="small"
              activeKey={permTab}
              onChange={setPermTab}
              items={[
                {
                  key: "module",
                  label: `模块权限 (${categorized.modulePerms.length})`,
                  children: categorized.modulePerms.length === 0 ? (
                    <Empty description="无模块权限" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <div>
                      <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
                        <Text strong style={{ fontSize: 12, color: "#666" }}>模块权限</Text>
                        <Button
                          type="link"
                          size="small"
                          disabled={isAdmin}
                          onClick={() => toggleCategoryAll(categorized.modulePerms)}
                          style={{ fontSize: 11, padding: 0, height: "auto" }}
                        >
                          {categorized.modulePerms.every((p: any) => isAdmin || rolePermissions.includes(p.id || p.name)) ? "取消" : "全选"}
                        </Button>
                      </Flex>
                      {renderPermList(categorized.modulePerms)}
                    </div>
                  ),
                },
                {
                  key: "api",
                  label: `API 权限 (${categorized.apiPerms.length})`,
                  children: categorized.apiPerms.length === 0 ? (
                    <Empty description="无 API 权限" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <div>
                      <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
                        <Text strong style={{ fontSize: 12, color: "#666" }}>API 权限</Text>
                        <Button
                          type="link"
                          size="small"
                          disabled={isAdmin}
                          onClick={() => toggleCategoryAll(categorized.apiPerms)}
                          style={{ fontSize: 11, padding: 0, height: "auto" }}
                        >
                          {categorized.apiPerms.every((p: any) => isAdmin || rolePermissions.includes(p.id || p.name)) ? "取消" : "全选"}
                        </Button>
                      </Flex>
                      {renderPermList(categorized.apiPerms)}
                    </div>
                  ),
                },
                {
                  key: "skill",
                  label: `Skill 权限 (${categorized.skillPerms.length})`,
                  children: renderCategorizedSkills(),
                },
              ]}
            />
          </Flex>
        )}
      </Card>

      {/* Create Role Modal */}
      <Modal
        title="新建角色"
        open={showCreate}
        onCancel={() => { setShowCreate(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        confirmLoading={createLoading}
      >
        <Form form={createForm} layout="vertical" onFinish={createRole}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
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
