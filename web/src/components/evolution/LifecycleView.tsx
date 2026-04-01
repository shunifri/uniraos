import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Table,
  Button,
  Badge,
  App,
  Modal,
  Typography,
  Empty,
  Tag,
  Space,
  Select,
} from "antd";
import {
  ReloadOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  WarningOutlined,
  ZoomInOutlined,
} from "@ant-design/icons";
import { api } from "@/api";

const { Text } = Typography;

interface SkillLifecycle {
  name: string;
  status: "active" | "canary" | "deprecated" | "retired";
  lastUsed?: string;
  usageCount?: number;
  createdAt?: string;
  deprecatedAt?: string;
}

const statusConfig: Record<
  string,
  { color: string; badge: "success" | "processing" | "warning" | "default" }
> = {
  active: { color: "#52c41a", badge: "success" },
  canary: { color: "#1677ff", badge: "processing" },
  deprecated: { color: "#faad14", badge: "warning" },
  retired: { color: "#999", badge: "default" },
};

export default function LifecycleView() {
  const { message, modal } = App.useApp();
  const [skills, setSkills] = useState<SkillLifecycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState(false);

  const loadLifecycle = async () => {
    try {
      setLoading(true);
      const data = await api.get<any>("/api/lifecycle", {
        params: statusFilter !== "all" ? { status: statusFilter } : {},
      });
      setSkills(data.skills || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLifecycle();
  }, [statusFilter]);

  const handleCanary = (skill: SkillLifecycle) => {
    modal.confirm({
      title: "Enable Canary",
      content: `Enable canary deployment for "${skill.name}"?`,
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.post(`/api/lifecycle/canary/${skill.name}`);
          message.success(`Canary deployment enabled for "${skill.name}"`);
          loadLifecycle();
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleDeprecate = (skill: SkillLifecycle) => {
    modal.confirm({
      title: "Deprecate Skill",
      content: `Mark "${skill.name}" as deprecated? It will be transitioned to retired.`,
      okType: "warning",
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.post(`/api/lifecycle/deprecate/${skill.name}`);
          message.success(`Skill "${skill.name}" marked as deprecated`);
          loadLifecycle();
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleViewConfig = (skill: SkillLifecycle) => {
    modal.info({
      title: `Configuration: ${skill.name}`,
      width: 700,
      content: (
        <Flex vertical gap={12}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Status
            </Text>
            <br />
            <Badge
              status={statusConfig[skill.status]?.badge}
              text={skill.status.toUpperCase()}
            />
          </div>

          {skill.lastUsed && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Last Used
              </Text>
              <br />
              <Text>{new Date(skill.lastUsed).toLocaleString()}</Text>
            </div>
          )}

          {skill.usageCount !== undefined && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Usage Count
              </Text>
              <br />
              <Text>{skill.usageCount}</Text>
            </div>
          )}

          {skill.createdAt && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Created At
              </Text>
              <br />
              <Text>{new Date(skill.createdAt).toLocaleString()}</Text>
            </div>
          )}

          {skill.deprecatedAt && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Deprecated At
              </Text>
              <br />
              <Text>{new Date(skill.deprecatedAt).toLocaleString()}</Text>
            </div>
          )}
        </Flex>
      ),
    });
  };

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      width: 200,
      ellipsis: true,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: string) => (
        <Badge
          status={statusConfig[status]?.badge}
          text={status.toUpperCase()}
        />
      ),
    },
    {
      title: "Last Used",
      dataIndex: "lastUsed",
      key: "lastUsed",
      width: 150,
      render: (time: string) =>
        time ? new Date(time).toLocaleString() : "-",
    },
    {
      title: "Usage",
      dataIndex: "usageCount",
      key: "usageCount",
      width: 80,
      render: (count: number) => count || 0,
    },
    {
      title: "Actions",
      key: "actions",
      width: 250,
      render: (_, record: SkillLifecycle) => (
        <Space size="small" wrap>
          {record.status === "active" && (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => handleCanary(record)}
              loading={actionLoading}
            >
              Canary
            </Button>
          )}
          {record.status === "active" && (
            <Button
              size="small"
              icon={<WarningOutlined />}
              onClick={() => handleDeprecate(record)}
              loading={actionLoading}
            >
              Deprecate
            </Button>
          )}
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => handleViewConfig(record)}
          >
            Config
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      {/* Filter */}
      <Card size="small">
        <Flex gap={8}>
          <Select
            placeholder="Filter by status"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 150 }}
            options={[
              { label: "All", value: "all" },
              { label: "Active", value: "active" },
              { label: "Canary", value: "canary" },
              { label: "Deprecated", value: "deprecated" },
              { label: "Retired", value: "retired" },
            ]}
            size="small"
          />

          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadLifecycle}
            loading={loading}
            type="primary"
          >
            Refresh
          </Button>
        </Flex>
      </Card>

      {/* Table */}
      <Card
        size="small"
        title="Skill Lifecycle"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto" } }}
      >
        {skills.length === 0 ? (
          <Empty description="No skills found" />
        ) : (
          <Table
            dataSource={skills}
            columns={columns}
            rowKey="name"
            pagination={{ pageSize: 20 }}
            size="small"
            loading={loading}
            scroll={{ x: 1000 }}
          />
        )}
      </Card>
    </Flex>
  );
}
