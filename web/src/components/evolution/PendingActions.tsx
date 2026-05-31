import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Flex,
  List,
  Button,
  App,
  Badge,
  Modal,
  Typography,
  Tag,
  Empty,
  Space,
  Input,
  Tabs,
} from "antd";
import {
  ReloadOutlined,
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text, Title } = Typography;

type ApprovalStatus = "pending" | "approved" | "rejected";

interface ApprovalSkill {
  id: string;
  name: string;
  description: string;
  generatedBy: string;
  createdAt: number;
  statusUpdatedAt?: number;
  code?: string;
  status?: string;
}

const statusLabels: Record<ApprovalStatus, string> = {
  pending: "待审核",
  approved: "已审核",
  rejected: "已驳回",
};

const statusIcons: Record<ApprovalStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  approved: <CheckCircleOutlined />,
  rejected: <StopOutlined />,
};

const statusColors: Record<ApprovalStatus, string> = {
  pending: "orange",
  approved: "green",
  rejected: "red",
};

export default function PendingActions() {
  const { message, modal } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [activeTab, setActiveTab] = useState<ApprovalStatus>("pending");
  const [skills, setSkills] = useState<ApprovalSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [counts, setCounts] = useState<Record<ApprovalStatus, number>>({
    pending: 0,
    approved: 0,
    rejected: 0,
  });

  const loadApprovals = useCallback(
    async (status: ApprovalStatus) => {
      try {
        setLoading(true);
        const data = await api.get<any>(`/api/evolution/approvals?status=${status}`);
        setSkills(data.approvals || []);
        // 同时更新所有状态的计数（首次加载时）
        if (counts.pending === 0 && counts.approved === 0 && counts.rejected === 0) {
          const statuses: ApprovalStatus[] = ["pending", "approved", "rejected"];
          const newCounts = { ...counts };
          for (const s of statuses) {
            const d = await api.get<any>(`/api/evolution/approvals?status=${s}`);
            newCounts[s] = (d.approvals || []).length;
          }
          setCounts(newCounts);
        } else {
          setCounts((prev) => ({ ...prev, [status]: (data.approvals || []).length }));
        }
      } catch (e: any) {
        message.error(e.message);
      } finally {
        setLoading(false);
      }
    },
    [counts, message]
  );

  useEffect(() => {
    loadApprovals(activeTab);
  }, [activeTab, loadApprovals]);

  const handleApprove = (skill: ApprovalSkill) => {
    modal.confirm({
      title: "通过审批",
      content: `确认通过技能 "${skill.name}" 的审批？`,
      okText: "通过",
      okType: "primary",
      cancelText: "取消",
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.post(`/api/evolution/approvals/${skill.id}/approve`);
          message.success(`技能 "${skill.name}" 已通过审批`);
          loadApprovals(activeTab);
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleReject = (skill: ApprovalSkill) => {
    modal.confirm({
      title: "驳回审批",
      content: `确认驳回技能 "${skill.name}" 的审批？`,
      okText: "驳回",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.post(`/api/evolution/approvals/${skill.id}/reject`);
          message.success(`技能 "${skill.name}" 已驳回`);
          loadApprovals(activeTab);
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleViewCode = (skill: ApprovalSkill) => {
    modal.info({
      title: `代码: ${skill.name}`,
      width: 800,
      content: (
        <pre
          style={{
            background: "#f5f5f5",
            padding: 12,
            borderRadius: 4,
            maxHeight: 400,
            overflow: "auto",
            fontSize: 11,
            whiteSpace: "pre-wrap",
          }}
        >
          {skill.code || "无代码可用"}
        </pre>
      ),
    });
  };

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase())
  );

  const renderActions = (skill: ApprovalSkill) => {
    if (activeTab === "pending") {
      return (
        <Space size="small">
          <Button size="small" icon={<CodeOutlined />} onClick={() => handleViewCode(skill)}>
            {t("view_code")}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => handleApprove(skill)}
            loading={actionLoading}
          >
            {t("approve")}
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => handleReject(skill)}
            loading={actionLoading}
          >
            {t("reject")}
          </Button>
        </Space>
      );
    }
    return (
      <Space size="small">
        <Button size="small" icon={<CodeOutlined />} onClick={() => handleViewCode(skill)}>
          {t("view_code")}
        </Button>
        <Tag color={statusColors[activeTab]}>
          {activeTab === "approved" ? "已通过" : "已驳回"}
        </Tag>
      </Space>
    );
  };

  const tabItems = [
    {
      key: "pending" as ApprovalStatus,
      label: (
        <span>
          <ClockCircleOutlined /> 待审核
          <Badge count={counts.pending} style={{ marginLeft: 8 }} showZero={false} />
        </span>
      ),
    },
    {
      key: "approved" as ApprovalStatus,
      label: (
        <span>
          <CheckCircleOutlined /> 已审核
          <Badge count={counts.approved} style={{ marginLeft: 8 }} showZero={false} />
        </span>
      ),
    },
    {
      key: "rejected" as ApprovalStatus,
      label: (
        <span>
          <StopOutlined /> 已驳回
          <Badge count={counts.rejected} style={{ marginLeft: 8 }} showZero={false} />
        </span>
      ),
    },
  ];

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as ApprovalStatus)}
        items={tabItems}
        size="small"
      />

      {/* Search Bar */}
      <Flex gap={8}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={`搜索${statusLabels[activeTab]}技能...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="small"
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => loadApprovals(activeTab)}
          loading={loading}
        >
          {t("refresh")}
        </Button>
      </Flex>

      {/* List */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <span>
              {statusLabels[activeTab]} ({filtered.length})
            </span>
          </Flex>
        }
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto" } }}
      >
        {filtered.length === 0 ? (
          <Empty
            description={
              search ? t("no_results_found") : `暂无${statusLabels[activeTab]}的技能`
            }
          />
        ) : (
          <List
            dataSource={filtered}
            size="small"
            renderItem={(skill) => (
              <List.Item>
                <Flex vertical style={{ width: "100%" }} gap={8}>
                  <Flex align="center" justify="space-between">
                    <div style={{ flex: 1 }}>
                      <Text strong>{skill.name}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        创建人: {skill.generatedBy}
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        创建时间:{" "}
                        {skill.createdAt
                          ? new Date(skill.createdAt).toLocaleString()
                          : "N/A"}
                      </Text>
                      {skill.statusUpdatedAt && skill.status !== "pending" && (
                        <>
                          <br />
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {skill.status === "approved" ? "通过" : "驳回"}时间:{" "}
                            {new Date(skill.statusUpdatedAt).toLocaleString()}
                          </Text>
                        </>
                      )}
                    </div>
                  </Flex>

                  {skill.description && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {skill.description}
                    </Text>
                  )}

                  {renderActions(skill)}
                </Flex>
              </List.Item>
            )}
          />
        )}
      </Card>
    </Flex>
  );
}
