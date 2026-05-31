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
  Badge,
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
  CheckOutlined,
  StopOutlined,
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
  status?: string;
  statusUpdatedAt?: number;
}

interface WorkflowTask {
  id: number;
  instanceId: number | null;
  nodeId: string;
  nodeName?: string;
  name?: string;
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
  instanceStatus?: string;
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
// Evolution Approvals List (with status tabs)
// ───────────────────────────────────────────────────────────────

type EvoStatus = 'pending' | 'approved' | 'rejected';

const evoStatusConfig: Record<EvoStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待审核', color: 'orange', icon: <ClockCircleOutlined /> },
  approved: { label: '已审核', color: 'green', icon: <CheckCircleOutlined /> },
  rejected: { label: '已驳回', color: 'red', icon: <StopOutlined /> },
};

const EvolutionApprovalList: React.FC = () => {
  const [activeStatus, setActiveStatus] = useState<EvoStatus>('pending');
  const [data, setData] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PendingApproval | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<EvoStatus, number>>({ pending: 0, approved: 0, rejected: 0 });
  const token = useAuthStore((s) => s.token);

  const fetchData = useCallback(async (status: EvoStatus) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/evolution/approvals?status=${status}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      const approvals = json.approvals || [];
      setData(approvals);
      setCounts(prev => ({ ...prev, [status]: approvals.length }));
    } catch (err) {
      message.error('获取进化审批失败');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchAllCounts = useCallback(async () => {
    const statuses: EvoStatus[] = ['pending', 'approved', 'rejected'];
    const newCounts = { pending: 0, approved: 0, rejected: 0 };
    for (const s of statuses) {
      try {
        const res = await fetch(`/api/evolution/approvals?status=${s}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await res.json();
        newCounts[s] = (json.approvals || []).length;
      } catch { /* ignore */ }
    }
    setCounts(newCounts);
  }, [token]);

  // 只在组件 mount 时获取所有计数，tab 切换时只获取当前 tab 数据
  useEffect(() => {
    fetchData(activeStatus);
  }, [activeStatus, fetchData]);

  useEffect(() => {
    fetchAllCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        fetchData(activeStatus);
        fetchAllCounts();
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
        fetchData(activeStatus);
        fetchAllCounts();
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
      width: 200,
      render: (_: any, record: PendingApproval) => {
        if (activeStatus === 'pending') {
          return (
            <Space>
              <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)}>
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
          );
        }
        return (
          <Space>
            <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)}>
              查看
            </Button>
            <Tag color={evoStatusConfig[activeStatus].color}>
              {evoStatusConfig[activeStatus].label}
            </Tag>
          </Space>
        );
      },
    },
  ];

  const tabItems = (['pending', 'approved', 'rejected'] as EvoStatus[]).map((s) => ({
    key: s,
    label: (
      <span>
        {evoStatusConfig[s].icon} {evoStatusConfig[s].label}
        <Badge count={counts[s]} style={{ marginLeft: 8 }} showZero={false} />
      </span>
    ),
  }));

  return (
    <>
      <Tabs activeKey={activeStatus} onChange={(k) => setActiveStatus(k as EvoStatus)} items={tabItems} size="small" />
      <Table
        columns={columns as any}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description={`暂无${evoStatusConfig[activeStatus].label}的进化请求`} /> }}
      />
      <Drawer
        title={detail?.name}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={720}
        extra={
          detail && activeStatus === 'pending' ? (
            <Space>
              <Button onClick={() => handleReject(detail.id)} danger loading={actionLoading === detail.id}>
                拒绝
              </Button>
              <Button type="primary" onClick={() => handleApprove(detail.id)} loading={actionLoading === detail.id}>
                通过
              </Button>
            </Space>
          ) : null
        }
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="深度">{detail.depth}</Descriptions.Item>
              <Descriptions.Item label="生成者">{detail.generatedBy}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatTime(detail.createdAt)}</Descriptions.Item>
              {detail.statusUpdatedAt && (
                <Descriptions.Item label="处理时间">{formatTime(detail.statusUpdatedAt)}</Descriptions.Item>
              )}
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
// Workflow Task List (with status tabs)
// ───────────────────────────────────────────────────────────────

type WfTab = 'pending' | 'done' | 'finished' | 'cancelled';

const wfTabConfig: Record<WfTab, { label: string; color: string }> = {
  pending: { label: '待办', color: 'orange' },
  done: { label: '已办', color: 'blue' },
  finished: { label: '办结', color: 'green' },
  cancelled: { label: '已取消', color: 'default' },
};

const wfStatusConfig: Record<WfTab | 'claimed' | 'completed', { label: string; color: string }> = {
  pending: { label: '待办', color: 'orange' },
  claimed: { label: '已认领', color: 'blue' },
  completed: { label: '已办', color: 'green' },
  done: { label: '已办', color: 'blue' },
  finished: { label: '办结', color: 'green' },
  cancelled: { label: '已取消', color: 'default' },
};

const WorkflowTaskList: React.FC = () => {
  const [allData, setAllData] = useState<WorkflowTask[]>([]);
  const [activeTab, setActiveTab] = useState<WfTab>('pending');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<WorkflowTask | null>(null);
  const [formPayload, setFormPayload] = useState<TaskFormPayload | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [comment, setComment] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('approve');
  const [counts, setCounts] = useState<Record<WfTab, number>>({ pending: 0, done: 0, finished: 0, cancelled: 0 });
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const fetchData = useCallback(async (tab: WfTab) => {
    setLoading(true);
    try {
      // done/finished 都需要获取 completed 任务，由前端根据 instanceStatus 过滤
      const statusParam = tab === 'pending' ? 'pending,claimed' : tab === 'cancelled' ? 'cancelled' : 'completed';
      const res = await fetch(`/api/workflow/tasks?page=1&pageSize=1000&status=${statusParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setAllData(json.data);
      } else {
        setAllData([]);
      }
    } catch (err) {
      message.error('获取工作流任务失败');
      setAllData([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchAllCounts = useCallback(async () => {
    const tabs: WfTab[] = ['pending', 'done', 'finished', 'cancelled'];
    const newCounts = { pending: 0, done: 0, finished: 0, cancelled: 0 };
    for (const t of tabs) {
      try {
        const statusParam = t === 'pending' ? 'pending,claimed' : t === 'cancelled' ? 'cancelled' : 'completed';
        const res = await fetch(`/api/workflow/tasks?page=1&pageSize=1000&status=${statusParam}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          if (t === 'done') {
            newCounts[t] = json.data.filter((task: WorkflowTask) => task.instanceStatus === 'running' || task.instanceStatus === 'active').length;
          } else if (t === 'finished') {
            newCounts[t] = json.data.filter((task: WorkflowTask) => ['completed', 'terminated', 'error'].includes(task.instanceStatus || '')).length;
          } else {
            newCounts[t] = json.data.length;
          }
        }
      } catch { /* ignore */ }
    }
    setCounts(newCounts);
  }, [token]);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  useEffect(() => {
    fetchAllCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredData = allData.filter((t) => {
    if (activeTab === 'pending') return t.status === 'pending' || t.status === 'claimed';
    if (activeTab === 'done') return t.status === 'completed' && (t.instanceStatus === 'running' || t.instanceStatus === 'active');
    if (activeTab === 'finished') return t.status === 'completed' && ['completed', 'terminated', 'error'].includes(t.instanceStatus || '');
    if (activeTab === 'cancelled') return t.status === 'cancelled';
    return false;
  });

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
        fetchData(activeTab);
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

  const columns = [
    {
      title: '任务',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: WorkflowTask) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name || record.nodeName || record.nodeId}</Text>
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
      render: (s: string) => <Tag color={wfStatusConfig[s as WfTab | 'claimed']?.color || 'default'}>{wfStatusConfig[s as WfTab | 'claimed']?.label || s}</Tag>,
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
          {(record.status === 'pending' || record.status === 'claimed') && (
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

  const tabItems = (['pending', 'done', 'finished', 'cancelled'] as WfTab[]).map((t) => ({
    key: t,
    label: (
      <span>
        {wfTabConfig[t].label}
        <Badge count={counts[t]} style={{ marginLeft: 8 }} showZero={false} />
      </span>
    ),
  }));

  return (
    <>
      <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as WfTab)} items={tabItems} size="small" />
      <Table
        columns={columns as any}
        dataSource={filteredData}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description={`暂无${wfTabConfig[activeTab].label}任务`} /> }}
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
                <Statistic title="状态" value={wfStatusConfig[detail.status as WfTab | 'claimed']?.label || detail.status} />
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
