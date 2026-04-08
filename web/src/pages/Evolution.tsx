import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Flex,
  Typography,
  Badge,
  Tabs,
  Modal,
  Input,
  List,
  App,
  Descriptions,
  Statistic,
  Row,
  Col,
} from "antd";
import {
  RocketOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { api } from "@/api";

const { Text, Title } = Typography;

interface EngineStatus {
  running: boolean;
  cycleCount: number;
  lastCycleAt?: string;
  pendingActions: number;
  executedActions: number;
  strategies: string[];
  executors: string[];
  config?: any;
}

interface EvolutionAction {
  id: string;
  type: string;
  skillName?: string;
  priority?: number;
  requiresApproval?: boolean;
  executedAt?: string;
  payload?: { reason?: string; [key: string]: any };
  result?: { success?: boolean; message?: string };
}

interface PendingApproval {
  id: string;
  skillName?: string;
  name?: string;
  description?: string;
  generatedBy?: string;
  createdAt?: string;
  [key: string]: any;
}

interface EmergencePattern {
  id?: string;
  type?: string;
  severity?: "critical" | "warning" | "info";
  description?: string;
  [key: string]: any;
}

const severityColor: Record<string, string> = {
  critical: "red",
  warning: "orange",
  info: "blue",
};

export default function EvolutionPage() {
  const { message } = App.useApp();

  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [pendingActions, setPendingActions] = useState<EvolutionAction[]>([]);
  const [executedActions, setExecutedActions] = useState<EvolutionAction[]>([]);
  const [patterns, setPatterns] = useState<EmergencePattern[]>([]);
  const [emergenceReport, setEmergenceReport] = useState<string>("");
  const [runningCycle, setRunningCycle] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string>("");
  const [rejectReason, setRejectReason] = useState("");
  const [actionsTab, setActionsTab] = useState("pending");

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get<EngineStatus>("/api/evolution/engine/status");
      setStatus(data);
    } catch {
      // non-fatal
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    try {
      const data = await api.get<{ approvals: PendingApproval[] }>(
        "/api/evolution/approvals"
      );
      setApprovals(data.approvals ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadActions = useCallback(async () => {
    try {
      const data = await api.get<{
        pending: EvolutionAction[];
        executed: EvolutionAction[];
      }>("/api/evolution/engine/actions");
      setPendingActions(data.pending ?? []);
      setExecutedActions(data.executed ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadEmergence = useCallback(async () => {
    try {
      const data = await api.get<{ patterns: EmergencePattern[]; report?: string }>(
        "/api/evolution/emergence"
      );
      setPatterns(data.patterns ?? []);
      setEmergenceReport(data.report ?? "");
    } catch {
      // non-fatal
    }
  }, []);

  const loadAll = useCallback(() => {
    loadStatus();
    loadApprovals();
    loadActions();
    loadEmergence();
  }, [loadStatus, loadApprovals, loadActions, loadEmergence]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 30000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const runCycle = async () => {
    setRunningCycle(true);
    try {
      await api.post("/api/evolution/engine/cycle");
      message.success("Cycle triggered");
      loadAll();
    } catch (e: any) {
      message.error(e.message);
    }
    setRunningCycle(false);
  };

  const handleApprove = async (id: string) => {
    try {
      await api.post(`/api/evolution/approvals/${id}/approve`);
      message.success("Approved");
      loadApprovals();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const openRejectModal = (id: string) => {
    setRejectTargetId(id);
    setRejectReason("");
    setRejectModalOpen(true);
  };

  const handleReject = async () => {
    try {
      await api.post(`/api/evolution/approvals/${rejectTargetId}/reject`, {
        reason: rejectReason,
      });
      message.success("Rejected");
      setRejectModalOpen(false);
      loadApprovals();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const approvalColumns = [
    {
      title: "Name",
      dataIndex: "skillName",
      key: "skillName",
      render: (v: string, record: PendingApproval) => (
        <Text strong>{v || record.name || record.id}</Text>
      ),
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (v: string) => <Text type="secondary">{v || "-"}</Text>,
    },
    {
      title: "Generated By",
      dataIndex: "generatedBy",
      key: "generatedBy",
      render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: "Created At",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v: string) =>
        v ? new Date(v).toLocaleString() : "-",
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: PendingApproval) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => handleApprove(record.id)}
          >
            Approve
          </Button>
          <Button
            danger
            size="small"
            icon={<CloseOutlined />}
            onClick={() => openRejectModal(record.id)}
          >
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  const pendingActionColumns = [
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: "Skill Name",
      dataIndex: "skillName",
      key: "skillName",
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
    {
      title: "Priority",
      dataIndex: "priority",
      key: "priority",
      render: (v: number) =>
        v != null ? (
          <Tag color={v >= 8 ? "red" : v >= 5 ? "orange" : "default"}>{v}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: "Requires Approval",
      dataIndex: "requiresApproval",
      key: "requiresApproval",
      render: (v: boolean) =>
        v ? <Tag color="orange">Yes</Tag> : <Tag>No</Tag>,
    },
    {
      title: "Reason",
      key: "reason",
      render: (_: any, record: EvolutionAction) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.payload?.reason || "-"}
        </Text>
      ),
    },
  ];

  const executedActionColumns = [
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: "Skill Name",
      dataIndex: "skillName",
      key: "skillName",
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
    {
      title: "Success",
      key: "success",
      render: (_: any, record: EvolutionAction) =>
        record.result?.success != null ? (
          <Badge
            status={record.result.success ? "success" : "error"}
            text={record.result.success ? "Success" : "Failed"}
          />
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: "Message",
      key: "message",
      ellipsis: true,
      render: (_: any, record: EvolutionAction) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.result?.message || "-"}
        </Text>
      ),
    },
    {
      title: "Executed At",
      dataIndex: "executedAt",
      key: "executedAt",
      render: (v: string) => (v ? new Date(v).toLocaleString() : "-"),
    },
  ];

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Section 1: Engine Status */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <RocketOutlined />
            <span>Evolution Engine</span>
            {status && (
              <Badge
                status={status.running ? "success" : "default"}
                text={status.running ? "Running" : "Stopped"}
              />
            )}
          </Flex>
        }
        extra={
          <Space>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadAll}
            >
              Refresh
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              loading={runningCycle}
              onClick={runCycle}
            >
              Run Cycle Now
            </Button>
          </Space>
        }
      >
        {status ? (
          <>
            <Row gutter={[16, 8]} style={{ marginBottom: 12 }}>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Cycle Count"
                  value={status.cycleCount ?? 0}
                  valueStyle={{ fontSize: 20 }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Pending Actions"
                  value={status.pendingActions ?? 0}
                  valueStyle={{ fontSize: 20 }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Executed Actions"
                  value={status.executedActions ?? 0}
                  valueStyle={{ fontSize: 20 }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Last Cycle</Text>
                  <div style={{ marginTop: 4, fontSize: 13 }}>
                    {status.lastCycleAt
                      ? new Date(status.lastCycleAt).toLocaleString()
                      : "Never"}
                  </div>
                </div>
              </Col>
            </Row>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Strategies">
                <Space wrap>
                  {status.strategies?.length > 0
                    ? status.strategies.map((s) => (
                        <Tag key={s} color="geekblue">
                          {s}
                        </Tag>
                      ))
                    : <Text type="secondary">None</Text>}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Executors">
                <Space wrap>
                  {status.executors?.length > 0
                    ? status.executors.map((e) => (
                        <Tag key={e} color="purple">
                          {e}
                        </Tag>
                      ))
                    : <Text type="secondary">None</Text>}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </>
        ) : (
          <Text type="secondary">Loading engine status...</Text>
        )}
      </Card>

      {/* Section 2: Approval Queue */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <span>Approval Queue</span>
            {approvals.length > 0 && (
              <Tag color="orange">{approvals.length} pending</Tag>
            )}
          </Flex>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadApprovals}>
            Refresh
          </Button>
        }
      >
        <Table
          size="small"
          dataSource={approvals}
          columns={approvalColumns}
          rowKey="id"
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          locale={{ emptyText: "No pending approvals" }}
        />
      </Card>

      {/* Section 3: Actions */}
      <Card
        size="small"
        title="Actions"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadActions}>
            Refresh
          </Button>
        }
      >
        <Tabs
          activeKey={actionsTab}
          onChange={setActionsTab}
          size="small"
          items={[
            {
              key: "pending",
              label: (
                <span>
                  Pending
                  {pendingActions.length > 0 && (
                    <Tag
                      color="blue"
                      style={{ marginLeft: 6, fontSize: 11 }}
                    >
                      {pendingActions.length}
                    </Tag>
                  )}
                </span>
              ),
              children: (
                <Table
                  size="small"
                  dataSource={pendingActions}
                  columns={pendingActionColumns}
                  rowKey={(r) => r.id || Math.random().toString()}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  locale={{ emptyText: "No pending actions" }}
                />
              ),
            },
            {
              key: "executed",
              label: (
                <span>
                  Executed
                  {executedActions.length > 0 && (
                    <Tag
                      color="green"
                      style={{ marginLeft: 6, fontSize: 11 }}
                    >
                      {executedActions.length}
                    </Tag>
                  )}
                </span>
              ),
              children: (
                <Table
                  size="small"
                  dataSource={executedActions}
                  columns={executedActionColumns}
                  rowKey={(r) => r.id || Math.random().toString()}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  locale={{ emptyText: "No executed actions" }}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* Section 4: Emergence Patterns */}
      <Card
        size="small"
        title="Emergence Patterns"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadEmergence}>
            Refresh
          </Button>
        }
      >
        {emergenceReport && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              background: "var(--ant-color-fill-quaternary)",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <Text type="secondary">{emergenceReport}</Text>
          </div>
        )}
        {patterns.length === 0 ? (
          <Text type="secondary">No emergence patterns detected</Text>
        ) : (
          <List
            size="small"
            dataSource={patterns}
            renderItem={(p) => (
              <List.Item>
                <Flex align="center" gap={8} style={{ width: "100%" }}>
                  <Tag
                    color={severityColor[p.severity ?? "info"] ?? "blue"}
                    style={{ flexShrink: 0 }}
                  >
                    {p.severity ?? "info"}
                  </Tag>
                  {p.type && (
                    <Tag color="default" style={{ flexShrink: 0 }}>
                      {p.type}
                    </Tag>
                  )}
                  <Text style={{ fontSize: 13 }}>
                    {p.description ?? JSON.stringify(p)}
                  </Text>
                </Flex>
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* Reject Modal */}
      <Modal
        title="Reject Approval"
        open={rejectModalOpen}
        onOk={handleReject}
        onCancel={() => setRejectModalOpen(false)}
        okText="Reject"
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text>Please provide a reason for rejection:</Text>
          <Input.TextArea
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Rejection reason..."
          />
        </Space>
      </Modal>
    </Flex>
  );
}
