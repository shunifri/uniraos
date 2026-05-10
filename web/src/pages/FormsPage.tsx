import React, { useState, useEffect, useCallback } from 'react';
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
  Tabs,
  Descriptions,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  FormOutlined,
  BuildOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';
import { FormRenderer } from '@/components/form-engine';
import type { RaosFormSchema } from '@/components/form-engine/types';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { TabPane } = Tabs;

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

interface FormDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  category_id?: string;
  schema_json: RaosFormSchema;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface FormInstance {
  id: string;
  definition_id: string;
  definition_version: number;
  data_json: Record<string, any>;
  status: string;
  submitted_by?: string;
  created_at: string;
  updated_at: string;
}

// ───────────────────────────────────────────────────────────────
// Form Center Page
// ───────────────────────────────────────────────────────────────

const FormsPage: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  // List state
  const [defs, setDefs] = useState<FormDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'view'>('create');
  const [currentDef, setCurrentDef] = useState<FormDefinition | null>(null);

  // Form state
  const [form] = Form.useForm();
  const [schemaText, setSchemaText] = useState('');

  // Preview / Fill state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSchema, setPreviewSchema] = useState<RaosFormSchema | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, any>>({});
  const [filling, setFilling] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);

  const fetchDefs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/form/definitions?page=1&pageSize=100', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setDefs(json.data);
      }
    } catch {
      message.error('获取表单列表失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDefs();
  }, [fetchDefs]);

  const openCreate = () => {
    setDrawerMode('create');
    setCurrentDef(null);
    form.resetFields();
    setSchemaText(JSON.stringify({
      type: 'object',
      title: '新建表单',
      properties: {
        name: { type: 'string', title: '姓名' },
      },
    }, null, 2));
    setDrawerOpen(true);
  };

  const openEdit = (def: FormDefinition) => {
    setDrawerMode('edit');
    setCurrentDef(def);
    form.setFieldsValue({
      key: def.key,
      name: def.name,
      description: def.description,
    });
    setSchemaText(JSON.stringify(def.schema_json, null, 2));
    setDrawerOpen(true);
  };

  const openView = (def: FormDefinition) => {
    setDrawerMode('view');
    setCurrentDef(def);
    form.setFieldsValue({
      key: def.key,
      name: def.name,
      description: def.description,
    });
    setSchemaText(JSON.stringify(def.schema_json, null, 2));
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    let schema: RaosFormSchema;
    try {
      schema = JSON.parse(schemaText);
    } catch {
      message.error('Schema JSON 格式错误');
      return;
    }

    const payload = {
      ...values,
      schemaJson: schema,
    };

    try {
      if (drawerMode === 'create') {
        const res = await fetch('/api/form/definitions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
          message.success('创建成功');
          setDrawerOpen(false);
          fetchDefs();
        } else {
          message.error(json.error || '创建失败');
        }
      } else if (drawerMode === 'edit' && currentDef) {
        const res = await fetch(`/api/form/definitions/${currentDef.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
          message.success('更新成功');
          setDrawerOpen(false);
          fetchDefs();
        } else {
          message.error(json.error || '更新失败');
        }
      }
    } catch {
      message.error('请求失败');
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后不可恢复，是否继续？',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await fetch(`/api/form/definitions/${id}`, {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            message.success('删除成功');
            fetchDefs();
          } else {
            message.error('删除失败');
          }
        } catch {
          message.error('请求失败');
        }
      },
    });
  };

  const openPreview = (def: FormDefinition) => {
    setPreviewSchema(def.schema_json);
    setPreviewData({});
    setInstanceId(null);
    setPreviewOpen(true);
  };

  const handlePreviewSubmit = async (data: Record<string, any>) => {
    setPreviewData(data);
    message.success('表单验证通过（预览模式，未保存）');
  };

  const handleFillAndSubmit = async (data: Record<string, any>) => {
    if (!previewSchema || !currentDef) return;
    setFilling(true);
    try {
      // 1. Create instance
      const createRes = await fetch('/api/form/instances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          definitionId: currentDef.id,
          dataJson: data,
        }),
      });
      const createJson = await createRes.json();
      if (!createJson.success) {
        message.error(createJson.error || '创建实例失败');
        return;
      }
      const instId = createJson.data.id;
      setInstanceId(instId);

      // 2. Submit instance
      const submitRes = await fetch(`/api/form/instances/${instId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const submitJson = await submitRes.json();
      if (submitJson.success) {
        message.success('提交成功');
        setPreviewOpen(false);
      } else {
        message.error(submitJson.error || '提交失败');
      }
    } catch {
      message.error('请求失败');
    } finally {
      setFilling(false);
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: FormDefinition) => (
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s}</Tag>,
    },
    {
      title: '字段数',
      key: 'fields',
      width: 100,
      render: (_: any, record: FormDefinition) =>
        Object.keys(record.schema_json?.properties || {}).length,
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
      render: (_: any, record: FormDefinition) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openView(record)}>
            查看
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" icon={<BuildOutlined />} onClick={() => navigate(`/forms/designer/${record.id}`)}>
            设计
          </Button>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => openPreview(record)}>
            预览
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
        <FormOutlined style={{ marginRight: 12 }} />
        表单中心
      </Title>

      <Card
        extra={
          <Space>
            <Button icon={<BuildOutlined />} onClick={() => navigate('/forms/designer')}>
              可视化设计
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建表单
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
          locale={{ emptyText: <Empty description="暂无表单定义" /> }}
        />
      </Card>

      {/* Create / Edit / View Drawer */}
      <Drawer
        title={drawerMode === 'create' ? '新建表单' : drawerMode === 'edit' ? '编辑表单' : '查看表单'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
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
            label="表单标识"
            rules={[{ required: true, message: '请输入表单标识' }]}
          >
            <Input placeholder="如: leave-request" />
          </Form.Item>
          <Form.Item
            name="name"
            label="表单名称"
            rules={[{ required: true, message: '请输入表单名称' }]}
          >
            <Input placeholder="如: 请假申请" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="表单用途描述..." />
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16 }}>
          <Text strong>Schema JSON</Text>
          <TextArea
            rows={20}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            disabled={drawerMode === 'view'}
            style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8 }}
          />
        </div>
      </Drawer>

      {/* Preview / Fill Modal */}
      <Modal
        title="表单预览"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={800}
        footer={[
          <Button key="close" onClick={() => setPreviewOpen(false)}>
            关闭
          </Button>,
          <Button
            key="fill"
            type="primary"
            loading={filling}
            disabled={!currentDef}
            onClick={() => {
              // Trigger form submit via FormRenderer
              // FormRenderer handles onSubmit internally when user clicks its own submit button
              // For fill mode, we'll show a separate submit button in the modal body
            }}
            style={{ display: 'none' }}
          >
            提交
          </Button>,
        ]}
      >
        {previewSchema ? (
          <Tabs defaultActiveKey="preview">
            <TabPane tab="预览" key="preview">
              <FormRenderer
                schema={previewSchema}
                initialData={previewData}
                onChange={setPreviewData}
                onSubmit={handlePreviewSubmit}
              />
            </TabPane>
            <TabPane tab="填写并提交" key="fill">
              <FormRenderer
                schema={previewSchema}
                initialData={{}}
                onSubmit={handleFillAndSubmit}
              />
            </TabPane>
          </Tabs>
        ) : (
          <Empty description="无法加载表单" />
        )}
      </Modal>
    </div>
  );
};

export default FormsPage;
