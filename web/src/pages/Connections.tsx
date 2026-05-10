import { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  message,
  Popconfirm,
  Typography,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import {
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  type ConnectionItem,
} from '@/api';

const { Title } = Typography;

const CONNECTION_TYPES = [
  { label: 'SMTP', value: 'smtp' },
  { label: 'IMAP', value: 'imap' },
  { label: 'LDAP', value: 'ldap' },
  { label: 'Exchange', value: 'exchange' },
  { label: 'CalDAV', value: 'caldav' },
  { label: '钉钉机器人', value: 'dingtalk' },
  { label: '企微机器人', value: 'wecom' },
  { label: '飞书机器人', value: 'lark' },
  { label: 'Kafka', value: 'kafka' },
  { label: 'MQTT', value: 'mqtt' },
  { label: 'Prometheus', value: 'prometheus' },
  { label: 'Elasticsearch', value: 'elasticsearch' },
  { label: 'FTP', value: 'ftp' },
  { label: 'SFTP', value: 'sftp' },
  { label: '自定义', value: 'custom' },
];

const CONFIG_TEMPLATES: Record<string, Record<string, unknown>> = {
  smtp: { host: 'smtp.company.com', port: 587, secure: true, user: 'user@company.com' },
  imap: { host: 'imap.company.com', port: 993, secure: true, user: 'user@company.com' },
  ldap: { host: 'ldap.company.com', port: 389, baseDN: 'dc=company,dc=com', user: 'cn=admin,dc=company,dc=com' },
  exchange: { baseUrl: 'https://graph.microsoft.com/v1.0', provider: 'graph' },
  caldav: { baseUrl: 'https://caldav.company.com', provider: 'caldav' },
  dingtalk: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN' },
  wecom: { webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY' },
  lark: { webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_KEY' },
  kafka: { brokers: 'localhost:9092', groupId: 'raos-group' },
  mqtt: { host: 'mqtt.company.com', port: 1883, protocol: 'mqtt' },
  prometheus: { url: 'http://localhost:9090' },
  elasticsearch: { url: 'http://localhost:9200', index: '*' },
  ftp: { host: 'ftp.company.com', port: 21, user: 'anonymous', secure: false },
  sftp: { host: 'sftp.company.com', port: 22, user: 'root' },
  custom: {},
};

const TYPE_COLORS: Record<string, string> = {
  smtp: 'blue',
  imap: 'blue',
  ldap: 'purple',
  exchange: 'purple',
  caldav: 'purple',
  dingtalk: 'green',
  wecom: 'green',
  lark: 'green',
  kafka: 'orange',
  mqtt: 'orange',
  prometheus: 'red',
  elasticsearch: 'red',
  ftp: 'cyan',
  sftp: 'cyan',
  custom: 'default',
};

export default function ConnectionsPage() {
  const [items, setItems] = useState<ConnectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionItem | null>(null);
  const [form] = Form.useForm();
  const [testing, setTesting] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listConnections();
      setItems(res.data ?? []);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (values: Record<string, unknown>) => {
    try {
      const payload = {
        name: values.name as string,
        type: values.type as string,
        config: JSON.parse((values.config as string) || '{}'),
        credentials: values.credentials ? String(values.credentials) : undefined,
        isActive: values.isActive as boolean,
      };
      if (editing) {
        await updateConnection(editing.id, payload);
        message.success('更新成功');
      } else {
        await createConnection(payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteConnection(id);
      message.success('删除成功');
      load();
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    try {
      const res = await testConnection(id);
      if (res.data?.success) {
        message.success(res.data.message);
      } else {
        message.error(res.data?.message || '测试失败');
      }
    } catch (e) {
      message.error(String(e));
    } finally {
      setTesting(null);
    }
  };

  const openEdit = (item: ConnectionItem) => {
    setEditing(item);
    form.setFieldsValue({
      name: item.name,
      type: item.type,
      config: JSON.stringify(item.config, null, 2),
      isActive: item.isActive,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, config: '{}' });
    setModalOpen(true);
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag color={TYPE_COLORS[type] || 'default'}>{type.toUpperCase()}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (active: boolean) =>
        active ? (
          <Tag icon={<CheckCircleOutlined />} color="success">启用</Tag>
        ) : (
          <Tag icon={<DisconnectOutlined />} color="default">禁用</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ConnectionItem) => (
        <Space>
          <Tooltip title="测试连接">
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testing === record.id}
              onClick={() => handleTest(record.id)}
            />
          </Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description={`删除连接配置 "${record.name}"？`}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={<Title level={4} style={{ margin: 0 }}>连接配置中心</Title>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增连接
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={items}
          columns={columns}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? '编辑连接' : '新增连接'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={() => form.submit()}
        width={600}
        forceRender
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          onValuesChange={(changedValues) => {
            if ('type' in changedValues && !editing) {
              const tpl = CONFIG_TEMPLATES[changedValues.type as string] ?? {};
              form.setFieldValue('config', JSON.stringify(tpl, null, 2));
            }
          }}
        >
          <Form.Item
            name="name"
            label="连接名称"
            rules={[{ required: true, message: '请输入连接名称' }]}
          >
            <Input placeholder="如：公司 SMTP、钉钉机器人" />
          </Form.Item>

          <Form.Item
            name="type"
            label="连接类型"
            rules={[{ required: true, message: '请选择连接类型' }]}
          >
            <Select options={CONNECTION_TYPES} placeholder="选择类型" />
          </Form.Item>

          <Form.Item
            name="config"
            label="配置 (JSON)"
            rules={[
              { required: true, message: '请输入配置' },
              {
                validator: (_, value) => {
                  try {
                    if (value) JSON.parse(value);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(new Error('无效的 JSON'));
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              rows={8}
              placeholder={`选择连接类型后将自动填充配置模板，或手动输入 JSON`}
            />
          </Form.Item>

          <Form.Item name="credentials" label="凭证 (加密存储)">
            <Input.Password placeholder="密码、Token 等敏感信息" />
          </Form.Item>

          <Form.Item name="isActive" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
