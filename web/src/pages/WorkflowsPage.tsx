import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Drawer,
  Form,
  Input,
  message,
  Typography,
  Empty,
  Spin,
  Modal,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  BuildOutlined,
  RocketOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';
import { api } from '@/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface WorkflowDefinition {
  id: number;
  key: string;
  name: string;
  description?: string;
  version: number;
  status: string;
  definition: any;
  created_at: string;
  updated_at: string;
}

const WorkflowsPage: React.FC = () => {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const [defs, setDefs] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'view'>('create');
  const [currentDef, setCurrentDef] = useState<WorkflowDefinition | null>(null);
  const [form] = Form.useForm();
  const [jsonText, setJsonText] = useState('');

  const fetchDefinitions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: WorkflowDefinition[] }>('/api/workflow/definitions');
      if (res.success) {
        setDefs(res.data);
      }
    } catch {
      message.error('获取流程列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  const openCreate = () => {
    setDrawerMode('create');
    setCurrentDef(null);
    form.resetFields();
    setJsonText(JSON.stringify({
      nodes: [
        { id: 'start', type: 'start_event', name: '开始' },
        { id: 'end', type: 'end_event', name: '结束' },
      ],
    }, null, 2));
    setDrawerOpen(true);
  };

  const openEdit = (def: WorkflowDefinition) => {
    setDrawerMode('edit');
    setCurrentDef(def);
    form.setFieldsValue({
      key: def.key,
      name: def.name,
      description: def.description,
    });
    setJsonText(JSON.stringify(def.definition, null, 2));
    setDrawerOpen(true);
  };

  const openView = (def: WorkflowDefinition) => {
    setDrawerMode('view');
    setCurrentDef(def);
    form.setFieldsValue({
      key: def.key,
      name: def.name,
      description: def.description,
    });
    setJsonText(JSON.stringify(def.definition, null, 2));
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    let definition: any;
    try {
      definition = JSON.parse(jsonText);
    } catch {
      message.error('Definition JSON 格式错误');
      return;
    }

    const payload = {
      key: values.key,
      name: values.name,
      description: values.description,
      definition,
    };

    try {
      if (drawerMode === 'create') {
        const res = await api.post<{ success: boolean; error?: string }>('/api/workflow/definitions', payload);
        if (res.success) {
          message.success('创建成功');
          setDrawerOpen(false);
          fetchDefinitions();
        } else {
          message.error(res.error || '创建失败');
        }
      } else if (drawerMode === 'edit' && currentDef) {
        const res = await api.put<{ success: boolean; error?: string }>(`/api/workflow/definitions/${currentDef.id}`, payload);
        if (res.success) {
          message.success('更新成功');
          setDrawerOpen(false);
          fetchDefinitions();
        } else {
          message.error(res.error || '更新失败');
        }
      }
    } catch {
      message.error('请求失败');
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后不可恢复，是否继续？',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await api.del<{ success: boolean; error?: string }>(`/api/workflow/definitions/${id}`);
          if (res.success) {
            message.success('删除成功');
            fetchDefinitions();
          } else {
            message.error('删除失败');
          }
        } catch {
          message.error('请求失败');
        }
      },
    });
  };

  const handleTest = async (key: string) => {
    try {
      const res = await api.post<{ success: boolean; data: any; error?: string }>(`/api/workflow/definitions/${key}/test`);
      if (res.success) {
        Modal.success({
          title: '测试运行成功',
          content: (
            <Space direction="vertical">
              <Text>实例 ID: {res.data.instance?.id}</Text>
              <Text>状态: {res.data.instance?.status}</Text>
              {res.data.task && <Text>当前任务: {res.data.task.nodeName || res.data.task.nodeId}</Text>}
            </Space>
          ),
        });
      } else {
        message.error(res.error || '测试运行失败');
      }
    } catch {
      message.error('请求失败');
    }
  };

  const columns = [
    {
      title: '流程名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: WorkflowDefinition) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.key}</Text>
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => (
        <Tag color={s === 'active' ? 'green' : s === 'draft' ? 'default' : 'orange'}>
          {s}
        </Tag>
      ),
    },
    {
      title: '节点数',
      key: 'nodes',
      width: 80,
      render: (_: any, record: WorkflowDefinition) =>
        Array.isArray(record.definition?.nodes) ? record.definition.nodes.length : 0,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (s: string) => new Date(s).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: WorkflowDefinition) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openView(record)}>
            查看
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<BuildOutlined />}
            onClick={() => navigate(`/workflow/designer/${record.key}`)}
          >
            设计器
          </Button>
          <Button size="small" icon={<RocketOutlined />} onClick={() => handleTest(record.key)}>
            测试
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={3}>
        <CodeOutlined style={{ marginRight: 12 }} />
        流程中心
      </Title>

      <Card
        extra={
          <Space>
            <Button
              type="primary"
              icon={<BuildOutlined />}
              onClick={() => navigate('/workflow/designer')}
            >
              流程设计器
            </Button>
            <Button icon={<PlusOutlined />} onClick={openCreate}>
              新建流程
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns as any}
          dataSource={defs}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: <Empty description="暂无流程定义" /> }}
        />
      </Card>

      {/* Create / Edit / View Drawer */}
      <Drawer
        title={drawerMode === 'create' ? '新建流程' : drawerMode === 'edit' ? '编辑流程' : '查看流程'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={window.innerWidth < 768 ? '100%' : 720}
        forceRender
        extra={
          drawerMode !== 'view' && (
            <Button type="primary" onClick={handleSave}>
              保存
            </Button>
          )
        }
      >
        <Form form={form} layout="vertical" disabled={drawerMode === 'view'}>
          <Form.Item
            name="key"
            label="流程标识"
            rules={[{ required: true, message: '请输入流程标识' }]}
          >
            <Input placeholder="如: leave-request" />
          </Form.Item>
          <Form.Item
            name="name"
            label="流程名称"
            rules={[{ required: true, message: '请输入流程名称' }]}
          >
            <Input placeholder="如: 请假申请" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="流程用途描述..." />
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16 }}>
          <Text strong>Definition JSON</Text>
          <TextArea
            rows={20}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            disabled={drawerMode === 'view'}
            style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8 }}
          />
        </div>
      </Drawer>
    </div>
  );
};

export default WorkflowsPage;
