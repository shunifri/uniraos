import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  Radio,
  Select,
  Table,
  Button,
  Space,
  Flex,
  Typography,
  App,
  Empty,
  Tag,
  Popconfirm,
  Divider,
  Spin,
} from "antd";
import { DeleteOutlined, PlusOutlined, ShareAltOutlined } from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  resourceType: "skill" | "kb_document" | "file";
  resourceId: string;
  resourceName: string;
}

interface ShareRule {
  id: string;
  scope: string;
  targetId?: string;
  targetName?: string;
  permission: string;
  createdAt?: string;
}

const SCOPE_OPTIONS = [
  { label: "全部开放", value: "all" },
  { label: "按角色", value: "role" },
  { label: "按部门", value: "department" },
  { label: "按人员", value: "user" },
];

const PERMISSION_OPTIONS = [
  { label: "只读", value: "read" },
  { label: "可执行", value: "execute" },
  { label: "可编辑", value: "edit" },
];

export default function ShareDialog({
  open,
  onClose,
  resourceType,
  resourceId,
  resourceName,
}: ShareDialogProps) {
  const { message } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [shares, setShares] = useState<ShareRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // New share form state
  const [scope, setScope] = useState<string>("all");
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const [permission, setPermission] = useState<string>("read");

  // Target options
  const [roles, setRoles] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<any>("/api/share/my");
      const allShares: ShareRule[] = data.data || [];
      // Filter by resourceType and resourceId
      const filtered = allShares.filter(
        (s: any) => s.resourceType === resourceType && s.resourceId === resourceId,
      );
      setShares(filtered);
    } catch {
      setShares([]);
    }
    setLoading(false);
  }, [resourceType, resourceId]);

  const loadTargets = useCallback(async () => {
    try {
      const [rolesR, deptsR, usersR] = await Promise.all([
        api.get<any>("/api/roles"),
        api.get<any>("/api/departments"),
        api.get<any>("/api/users"),
      ]);
      setRoles(rolesR.roles || []);
      setDepartments(deptsR.departments || []);
      setUsers(usersR.users || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      loadShares();
      loadTargets();
      // Reset form
      setScope("all");
      setTargetId(undefined);
      setPermission("read");
    }
  }, [open, loadShares, loadTargets]);

  const handleAdd = async () => {
    if (scope !== "all" && !targetId) {
      message.warning("请选择共享目标");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        resourceType,
        resourceId,
        resourceName,
        scope,
        permission,
      };
      if (scope !== "all") {
        payload.targetId = targetId;
      }
      const data = await api.post<any>("/api/share", payload);
      if (data.success || data.share) {
        message.success("共享规则已添加");
        loadShares();
        setScope("all");
        setTargetId(undefined);
        setPermission("read");
      } else {
        message.error(data.error || "添加失败");
      }
    } catch (e: any) {
      message.error(e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (shareId: string) => {
    try {
      const data = await api.del<any>(`/api/share/${shareId}`);
      if (data.success !== false) {
        message.success("已删除");
        loadShares();
      } else {
        message.error(data.error || "删除失败");
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const getTargetOptions = () => {
    switch (scope) {
      case "role":
        return roles.map((r) => ({ label: r.name, value: r.id }));
      case "department":
        return departments.map((d) => ({
          label: "\u00A0".repeat((d.level || 0) * 2) + d.name,
          value: d.id,
        }));
      case "user":
        return users.map((u) => ({
          label: `${u.displayName || u.username} (${u.username})`,
          value: u.id,
        }));
      default:
        return [];
    }
  };

  const scopeLabel = (s: string) => {
    const opt = SCOPE_OPTIONS.find((o) => o.value === s);
    return opt?.label || s;
  };

  const permLabel = (p: string) => {
    const opt = PERMISSION_OPTIONS.find((o) => o.value === p);
    return opt?.label || p;
  };

  const columns = [
    {
      title: "范围",
      dataIndex: "scope",
      key: "scope",
      render: (v: string) => <Tag>{scopeLabel(v)}</Tag>,
    },
    {
      title: "目标",
      key: "target",
      render: (_: any, r: ShareRule) =>
        r.scope === "all" ? (
          <Text type="secondary">-</Text>
        ) : (
          <Text>{r.targetName || r.targetId || "-"}</Text>
        ),
    },
    {
      title: "权限",
      dataIndex: "permission",
      key: "permission",
      render: (v: string) => (
        <Tag color={v === "edit" ? "orange" : v === "execute" ? "blue" : "green"}>
          {permLabel(v)}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 60,
      render: (_: any, r: ShareRule) => (
        <Popconfirm title="确认删除此共享规则?" onConfirm={() => handleDelete(r.id)}>
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <ShareAltOutlined />
          <span>共享：{resourceName}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <Flex vertical gap={16}>
        {/* Existing shares */}
        <div>
          <Text strong style={{ fontSize: 13 }}>当前共享规则</Text>
          {loading ? (
            <Flex justify="center" style={{ padding: 24 }}><Spin /></Flex>
          ) : shares.length === 0 ? (
            <Empty description="暂无共享规则" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: "12px 0" }} />
          ) : (
            <Table
              columns={columns}
              dataSource={shares}
              rowKey="id"
              size="small"
              pagination={false}
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <Divider style={{ margin: 0 }} />

        {/* Add share form */}
        <div>
          <Text strong style={{ fontSize: 13 }}>添加共享</Text>
          <Flex vertical gap={12} style={{ marginTop: 8 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                共享范围
              </Text>
              <Radio.Group
                value={scope}
                onChange={(e) => { setScope(e.target.value); setTargetId(undefined); }}
                optionType="button"
                buttonStyle="solid"
                size="small"
                options={SCOPE_OPTIONS}
              />
            </div>

            {scope !== "all" && (
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  选择目标
                </Text>
                <Select
                  value={targetId}
                  onChange={setTargetId}
                  options={getTargetOptions()}
                  placeholder={`选择${scopeLabel(scope).replace("按", "")}`}
                  size="small"
                  style={{ width: "100%" }}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
                  }
                />
              </div>
            )}

            <div>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                权限
              </Text>
              <Radio.Group
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
                options={PERMISSION_OPTIONS}
              />
            </div>

            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              loading={saving}
              onClick={handleAdd}
              style={{ alignSelf: "flex-start" }}
            >
              {t("add_share_rule")}
            </Button>
          </Flex>
        </div>
      </Flex>
    </Modal>
  );
}
