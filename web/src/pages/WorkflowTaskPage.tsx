import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Spin,
  Button,
  Space,
  Descriptions,
  Tag,
  Form,
  Input,
  message,
  Typography,
  Empty,
  Row,
  Col,
  Statistic,
  Divider,
  Breadcrumb,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ArrowLeftOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';
import { FormRenderer } from '@/components/form-engine';
import type { RaosFormSchema } from '@/components/form-engine/types';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

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

// ───────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────

const WorkflowTaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const [task, setTask] = useState<WorkflowTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [formPayload, setFormPayload] = useState<TaskFormPayload | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [comment, setComment] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('approve');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  const taskId = parseInt(id || '', 10);

  const fetchTask = useCallback(async () => {
    if (isNaN(taskId)) {
      setError('无效的任务ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflow/tasks?page=1&pageSize=1000`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const found = json.data.find((t: WorkflowTask) => t.id === taskId);
        if (found) {
          setTask(found);
          setComment(found.comment || '');
        } else {
          setError('任务不存在');
        }
      } else {
        setError('获取任务失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, [taskId, token]);

  const loadTaskFormData = useCallback(async () => {
    if (isNaN(taskId)) return;
    setFormLoading(true);
    try {
      const res = await fetch(`/api/workflow/tasks/${taskId}/form`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && json.data) {
        setFormPayload(json.data);
        setFormData(json.data.initialData || {});
      }
    } catch {
      setFormPayload(null);
    } finally {
      setFormLoading(false);
    }
  }, [taskId, token]);

  useEffect(() => {
    fetchTask();
    loadTaskFormData();
  }, [fetchTask, loadTaskFormData]);

  const handleComplete = async () => {
    if (isNaN(taskId)) return;
    setSubmitting(true);
    try {
      const payload: Record<string, any> = { action: selectedAction, comment };
      if (formPayload?.schema) {
        payload.formData = formData;
      }
      const res = await fetch(`/api/workflow/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        message.success('任务已处理');
        fetchTask();
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

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Empty description={error} />
        <Button onClick={() => navigate('/approvals')} style={{ marginTop: 16 }}>
          返回审批中心
        </Button>
      </div>
    );
  }

  if (!task) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Empty description="任务不存在" />
        <Button onClick={() => navigate('/approvals')} style={{ marginTop: 16 }}>
          返回审批中心
        </Button>
      </div>
    );
  }

  const isDone = task.status === 'completed' || task.status === 'cancelled';

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <a onClick={() => navigate('/approvals')}>审批中心</a> },
          { title: '工作流任务' },
          { title: `#${task.id}` },
        ]}
      />

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/approvals')}>
          返回
        </Button>
      </Space>

      <Title level={3}>
        <ClockCircleOutlined style={{ marginRight: 12 }} />
        {task.nodeName || task.nodeId}
      </Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Statistic title="任务ID" value={`#${task.id}`} />
        </Col>
        <Col span={6}>
          <Statistic title="流程实例" value={`#${task.instanceId}`} />
        </Col>
        <Col span={6}>
          <Statistic title="状态" value={statusText[task.status] || task.status} />
        </Col>
        <Col span={6}>
          <Statistic title="任务类型" value={task.taskType} />
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="节点">{task.nodeId}</Descriptions.Item>
          <Descriptions.Item label="任务类型">{task.taskType}</Descriptions.Item>
          <Descriptions.Item label="处理人">{task.assignee || '-'}</Descriptions.Item>
          <Descriptions.Item label="会签组">{task.signGroup || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatTime(task.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="认领时间">{formatTime(task.claimedAt)}</Descriptions.Item>
          {task.dueDate && (
            <Descriptions.Item label="截止时间">{formatTime(task.dueDate)}</Descriptions.Item>
          )}
          <Descriptions.Item label="当前状态">
            <Tag color={statusColor[task.status]}>{statusText[task.status] || task.status}</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Form section */}
      {formLoading ? (
        <Card>
          <Spin />
        </Card>
      ) : formPayload?.schema ? (
        <Card
          title={
            <span>
              <FileTextOutlined style={{ marginRight: 8 }} />
              任务表单
            </span>
          }
          style={{ marginBottom: 16 }}
        >
          <FormRenderer
            schema={formPayload.schema}
            initialData={formPayload.initialData}
            readOnly={isDone}
            onChange={(data) => setFormData(data)}
          />
        </Card>
      ) : task.formData && Object.keys(task.formData).length > 0 ? (
        <Card
          title={
            <span>
              <FileTextOutlined style={{ marginRight: 8 }} />
              已有数据
            </span>
          }
          style={{ marginBottom: 16 }}
        >
          <pre
            style={{
              background: '#f6f8fa',
              padding: 16,
              borderRadius: 8,
              fontSize: 12,
              margin: 0,
            }}
          >
            {JSON.stringify(task.formData, null, 2)}
          </pre>
        </Card>
      ) : null}

      {/* Action section */}
      {!isDone && (
        <Card title="审批操作">
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
            <Form.Item>
              <Button type="primary" loading={submitting} onClick={handleComplete}>
                提交
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {task.comment && (
        <Card style={{ marginTop: 16 }} title="历史备注">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.comment}</pre>
        </Card>
      )}
    </div>
  );
};

export default WorkflowTaskPage;
