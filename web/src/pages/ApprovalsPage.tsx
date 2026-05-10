import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Tabs,
  Table,
  Tag,
  Button,
  Space,
  Drawer,
  Descriptions,
  Empty,
  Spin,
  message,
  Typography,
  Tooltip,
  Input,
  Form,
  Row,
  Col,
  Divider,
  Statistic,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  CodeOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';
import { useNavigate } from 'react-router-dom';
import { FormRenderer } from '@/components/form-engine';
import type { RaosFormSchema } from '@/components/form-engine/types';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

interface PendingApproval {
  id: string;
  name: string;
  description: string;
  code: string;
  capabilities: string[];
  generatedBy: string;
  depth: number;
  createdAt: number;
}

interface WorkflowTask {
  id: number;
  instanceId: number | null;
  nodeId: string;
  nodeName?: string;
  taskType: string;
  assignee?: string;
  candidateUsers?: string[];
  candidateGroups?: string[];
  status: 'pending' | 'claimed' | 'completed' | 'cancelled';
  formData?: Record<string, unknown>;
  comment?: string;
  action?: string;
  dueDate?: number;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  signGroup?: string;
}

interface TaskFormPayload {
  taskId: number;
  schema: RaosFormSchema | null;
  initialData: Record<string, any>;
  binding: any;
  mappingApplied: boolean;
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function formatTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

function timeAgo(ts?: number): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

// ───────────────────────────────────────────────────────────────
// Evolution Approvals List
// ───────────────────────────────────────────────────────────────

const EvolutionApprovalList: React.FC = () => {
  const [data, setData] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PendingApproval | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const token = useAuthStore((s) => s.token);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/evolution/approvals', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.approvals) {
        setData(json.approvals);
      } else if (Array.isArray(json)) {
        setData(json);
      } else {
        setData([]);
      }
    } catch (err) {
      message.error('获取进化审批失败');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/evolution/approve/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        message.success('已通过');
        fetchData();
      } else {
        const json = await res.json().catch(() => ({}));
        message.error(json.error || '审批失败');
      }
    } catch {
      message.error('审批请求失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string, reason?: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/evolution/reject/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: reason || 'Rejected' }),
      });
      if (res.ok) {
        message.success('已拒绝');
        fetchData();
      } else {
        const json = await res.json().catch(() => ({}));
        message.error(json.error || '拒绝失败');
      }
    } catch {
      message.error('拒绝请求失败');
    } finally {
      setActionLoading(null);
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: PendingApproval) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.description}
          </Text>
        </Space>
      ),
    },
    {
      title: '能力',
      dataIndex: 'capabilities',
      key: 'capabilities',
      render: (caps: string[]) => (
        <Space size={4} wrap>
          {caps?.map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '深度',
      dataIndex: 'depth',
      key: 'depth',
      width: 80,
      render: (d: number) => <Tag color="blue">Lv.{d}</Tag>,
    },
    {
      title: '生成者',
      dataIndex: 'generatedBy',
      key: 'generatedBy',
      width: 120,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (ts: number) => (
        <Tooltip title={formatTime(ts)}>
          <span>{timeAgo(ts)}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: PendingApproval) => (
        <Space>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetail(record)}
          >
            查看
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<CheckCircleOutlined />}
            loading={actionLoading === record.id}
            onClick={() => handleApprove(record.id)}
          >
            通过
          </Button>
          <Button
            danger
            size="small"
            icon={<CloseCircleOutlined />}
            loading={actionLoading === record.id}
            onClick={() => handleReject(record.id)}
          >
            拒绝
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns as any}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="暂无待审批的进化请求" /> }}
      />
      <Drawer
        title={detail?.name}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={720}
        extra={
          detail && (
            <Space>
              <Button onClick={() => handleReject(detail.id)} danger loading={actionLoading === detail.id}>
                拒绝
              </Button>
              <Button
                type="primary"
                onClick={() => handleApprove(detail.id)}
                loading={actionLoading === detail.id}
              >
                通过
              </Button>
            </Space>
          )
        }
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="深度">{detail.depth}</Descriptions.Item>
              <Descriptions.Item label="生成者">{detail.generatedBy}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatTime(detail.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="能力" span={2}>
                {detail.capabilities?.map((c) => (
                  <Tag key={c}>{c}</Tag>
                ))}
              </Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {detail.description}
              </Descriptions.Item>
            </Descriptions>
            <div>
              <Title level={5}>
                <CodeOutlined /> 代码
              </Title>
              <pre
                style={{
                  background: '#f6f8fa',
                  padding: 16,
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: 400,
                  fontSize: 12,
                }}
              >
                {detail.code}
              </pre>
            </div>
          </Space>
        )}
      </Drawer>
    </>
  );
};

// ───────────────────────────────────────────────────────────────
// Workflow Task List
// ───────────────────────────────────────────────────────────────

const WorkflowTaskList: React.FC = () => {
  const [data, setData] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<WorkflowTask | null>(null);
  const [formPayload, setFormPayload] = useState<TaskFormPayload | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [comment, setComment] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('approve');
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/tasks?page=1&pageSize=100', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setData(json.data);
      } else {
        setData([]);
      }
    } catch (err) {
      message.error('获取工作流任务失败');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const loadTaskFormData = async (task: WorkflowTask) => {
    setFormLoading(true);
    setFormPayload(null);
    try {
      const res = await fetch(`/api/workflow/tasks/${task.id}/form`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && json.data) {
        setFormPayload(json.data);
      }
    } catch {
      // Task may not have a form binding — that's OK
      setFormPayload(null);
    } finally {
      setFormLoading(false);
    }
  };

  const openDetail = (task: WorkflowTask) => {
    setDetail(task);
    setComment(task.comment || '');
    setSelectedAction('approve');
    loadTaskFormData(task);
  };

  const handleComplete = async (taskId: number, action: string, formData?: Record<string, any>) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workflow/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, comment, formData }),
      });
      if (res.ok) {
        message.success('任务已处理');
        setDetail(null);
        fetchData();
      } else {
        const json = await res.json().catch(() => ({}));
        message.error(json.error || '处理失败');
      }
    } catch {
      message.error('请求失败');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor: Record<string, string> = {
    pending: 'orange',
    claimed: 'blue',
    completed: 'green',
    cancelled: 'default',
  };

  const statusText: Record<string, string> = {
    pending: '待处理',
    claimed: '已认领',
    completed: '已完成',
    cancelled: '已取消',
  };

  const columns = [
    {
      title: '任务',
      dataIndex: 'nodeName',
      key: 'nodeName',
      render: (name: string, record: WorkflowTask) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name || record.nodeId}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            流程实例 #{record.instanceId}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => <Tag color={statusColor[s] || 'default'}>{statusText[s] || s}</Tag>,
    },
    {
      title: '任务类型',
      dataIndex: 'taskType',
      key: 'taskType',
      width: 120,
      render: (t: string) => <Tag>{t}</Tag>,
    },
    {
      title: '处理人',
      dataIndex: 'assignee',
      key: 'assignee',
      width: 120,
      render: (a?: string) => a || <Text type="secondary">未分配</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (ts: number) => (
        <Tooltip title={formatTime(ts)}>
          <span>{timeAgo(ts)}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, record: WorkflowTask) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
            查看
          </Button>
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={() => navigate(`/workflow/tasks/${record.id}`)}
          >
            打开
          </Button>
          {record.status !== 'completed' && record.status !== 'cancelled' && (
            <Button
              type="primary"
              size="small"
              icon={<CheckCircleOutlined />}
              loading={submitting && detail?.id === record.id}
              onClick={() => openDetail(record)}
            >
              处理
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns as any}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="暂无工作流任务" /> }}
      />
      <Drawer
        title={detail ? (detail.nodeName || detail.nodeId) : ''}
        open={!!detail}
        onClose={() => {
          setDetail(null);
          setFormPayload(null);
        }}
        width={840}
        destroyOnClose
        extra={
          detail && detail.status !== 'completed' && detail.status !== 'cancelled' ? (
            <Space>
              <Button onClick={() => setDetail(null)}>关闭</Button>
              <Button
                type="primary"
                loading={submitting}
                onClick={() =>
                  handleComplete(
                    detail.id,
                    selectedAction,
                    formPayload?.schema ? formPayload.initialData : undefined
                  )
                }
              >
                提交
              </Button>
            </Space>
          ) : (
            <Button onClick={() => setDetail(null)}>关闭</Button>
          )
        }
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="任务ID" value={`#${detail.id}`} />
              </Col>
              <Col span={8}>
                <Statistic title="流程实例" value={`#${detail.instanceId}`} />
              </Col>
              <Col span={8}>
                <Statistic title="状态" value={statusText[detail.status] || detail.status} />
              </Col>
            </Row>

            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="节点">{detail.nodeId}</Descriptions.Item>
              <Descriptions.Item label="任务类型">{detail.taskType}</Descriptions.Item>
              <Descriptions.Item label="处理人">{detail.assignee || '-'}</Descriptions.Item>
              <Descriptions.Item label="会签组">{detail.signGroup || '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间" span={2}>
                {formatTime(detail.createdAt)}
              </Descriptions.Item>
              {detail.dueDate && (
                <Descriptions.Item label="截止时间" span={2}>
                  {formatTime(detail.dueDate)}
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* Form section */}
            {formLoading ? (
              <Spin />
            ) : formPayload?.schema ? (
              <>
                <Divider orientation="left">
                  <FileTextOutlined /> 任务表单
                </Divider>
                <FormRenderer
                  schema={formPayload.schema}
                  initialData={formPayload.initialData}
                  onChange={(data) => {
                    if (formPayload) {
                      setFormPayload({ ...formPayload, initialData: data });
                    }
                  }}
                />
              </>
            ) : detail.formData && Object.keys(detail.formData).length > 0 ? (
              <>
                <Divider orientation="left">
                  <FileTextOutlined /> 已有数据
                </Divider>
                <pre
                  style={{
                    background: '#f6f8fa',
                    padding: 16,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(detail.formData, null, 2)}
                </pre>
              </>
            ) : null}

            {/* Action section */}
            {detail.status !== 'completed' && detail.status !== 'cancelled' && (
              <>
                <Divider orientation="left">审批操作</Divider>
                <Form layout="vertical">
                  <Form.Item label="操作">
                    <Space>
                      <Button
                        type={selectedAction === 'approve' ? 'primary' : 'default'}
                        icon={<CheckCircleOutlined />}
                        onClick={() => setSelectedAction('approve')}
                      >
                        通过
                      </Button>
                      <Button
                        type={selectedAction === 'reject' ? 'primary' : 'default'}
                        danger={selectedAction === 'reject'}
                        icon={<CloseCircleOutlined />}
                        onClick={() => setSelectedAction('reject')}
                      >
                        拒绝
                      </Button>
                    </Space>
                  </Form.Item>
                  <Form.Item label="备注">
                    <TextArea
                      rows={3}
                      placeholder="输入备注..."
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </Form.Item>
                </Form>
              </>
            )}

            {detail.comment && (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="历史备注">{detail.comment}</Descriptions.Item>
              </Descriptions>
            )}
          </Space>
        )}
      </Drawer>
    </>
  );
};

// ───────────────────────────────────────────────────────────────
// Main Page
// ───────────────────────────────────────────────────────────────

const ApprovalsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('evolution');

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={3}>
        <ExperimentOutlined style={{ marginRight: 12 }} />
        审批中心
      </Title>
      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'evolution',
              label: (
                <span>
                  <ExperimentOutlined />
                  进化审批
                </span>
              ),
              children: <EvolutionApprovalList />,
            },
            {
              key: 'workflow',
              label: (
                <span>
                  <ClockCircleOutlined />
                  工作流任务
                </span>
              ),
              children: <WorkflowTaskList />,
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default ApprovalsPage;
