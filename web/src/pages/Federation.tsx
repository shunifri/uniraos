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
  Alert,
  Descriptions,
  App,
  Modal,
  Form,
  Input,
} from "antd";
import {
  GlobalOutlined,
  ReloadOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { api, addPeer, getFederationConfig } from "@/api";

const { Text } = Typography;

interface FederationPeer {
  instanceId: string;
  url: string;
  lastHeartbeat?: string;
  status?: string;
  [key: string]: any;
}

interface FederationStatus {
  instanceId: string;
  peers: FederationPeer[];
  syncStatus?: string;
  [key: string]: any;
}

interface FederationConfig {
  enabled: boolean;
  instanceId?: string;
  peers?: FederationPeer[];
  [key: string]: any;
}

export default function FederationPage() {
  const { message } = App.useApp();

  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [config, setConfig] = useState<FederationConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [addPeerModalOpen, setAddPeerModalOpen] = useState(false);
  const [addPeerLoading, setAddPeerLoading] = useState(false);
  const [form] = Form.useForm();

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get<FederationStatus>("/api/federation/status");
      setStatus(data);
    } catch {
      // non-fatal — federation may be disabled
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await getFederationConfig() as FederationConfig;
      setConfig(data);
    } catch {
      // non-fatal
    }
  }, []);

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([loadStatus(), loadConfig()]).finally(() => setLoading(false));
  }, [loadStatus, loadConfig]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 30000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await api.post("/api/federation/sync");
      message.success("Sync triggered");
      loadStatus();
    } catch (e: any) {
      message.error(e.message ?? "Sync failed");
    }
    setSyncing(false);
  };

  const handleAddPeer = async () => {
    try {
      const values = await form.validateFields();
      setAddPeerLoading(true);
      await addPeer(values);
      message.success("Peer added");
      form.resetFields();
      setAddPeerModalOpen(false);
      loadAll();
    } catch (e: any) {
      if (e.message) {
        message.error(e.message);
      }
      // validation errors are shown inline
    }
    setAddPeerLoading(false);
  };

  const federationEnabled = config?.enabled ?? false;
  const peers: FederationPeer[] = status?.peers ?? config?.peers ?? [];

  const peerColumns = [
    {
      title: "Instance ID",
      dataIndex: "instanceId",
      key: "instanceId",
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v || "-"}</Text>,
    },
    {
      title: "URL",
      dataIndex: "url",
      key: "url",
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v || "-"}
        </Text>
      ),
    },
    {
      title: "Last Heartbeat",
      dataIndex: "lastHeartbeat",
      key: "lastHeartbeat",
      render: (v: string) =>
        v ? new Date(v).toLocaleString() : <Text type="secondary">-</Text>,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v: string) => {
        if (!v) return <Text type="secondary">-</Text>;
        const color =
          v === "online" || v === "connected"
            ? "success"
            : v === "offline" || v === "disconnected"
            ? "error"
            : "warning";
        return <Badge status={color} text={v} />;
      },
    },
  ];

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Section 1: Instance Info */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <GlobalOutlined />
            <span>Federation</span>
            <Badge
              status={federationEnabled ? "success" : "default"}
              text={federationEnabled ? "Enabled" : "Disabled"}
            />
          </Flex>
        }
        extra={
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>
              Refresh
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={handleSyncNow}
              loading={syncing}
              disabled={!federationEnabled}
            >
              Sync Now
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setAddPeerModalOpen(true)}
              disabled={!federationEnabled}
            >
              Add Peer
            </Button>
          </Space>
        }
      >
        {!federationEnabled && (
          <Alert
            type="info"
            message="Federation is disabled"
            description="Enable federation in the configuration to connect this instance to a network of peers."
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Instance ID">
            {status?.instanceId || config?.instanceId ? (
              <Text code style={{ fontSize: 12 }}>
                {status?.instanceId || config?.instanceId}
              </Text>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Sync Status">
            {status?.syncStatus ? (
              <Tag>{status.syncStatus}</Tag>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Section 2: Peers Table */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <span>Connected Peers</span>
            {peers.length > 0 && <Tag color="blue">{peers.length}</Tag>}
          </Flex>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadStatus}>
            Refresh
          </Button>
        }
      >
        <Table
          size="small"
          dataSource={peers}
          columns={peerColumns}
          rowKey={(r) => r.instanceId || r.url || Math.random().toString()}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: federationEnabled ? "No peers connected" : "Federation is disabled" }}
        />
      </Card>

      {/* Section 3: Federation Config */}
      <Card
        size="small"
        title="Federation Configuration"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadConfig}>
            Refresh
          </Button>
        }
      >
        {config ? (
          <Descriptions column={2} size="small">
            <Descriptions.Item label="Enabled">
              <Tag color={config.enabled ? "green" : "default"}>
                {config.enabled ? "Yes" : "No"}
              </Tag>
            </Descriptions.Item>
            {config.instanceId && (
              <Descriptions.Item label="Instance ID">
                <Text code style={{ fontSize: 12 }}>{config.instanceId}</Text>
              </Descriptions.Item>
            )}
            {Object.entries(config)
              .filter(([k]) => !["enabled", "instanceId", "peers"].includes(k))
              .map(([k, v]) => (
                <Descriptions.Item key={k} label={k}>
                  <Text style={{ fontSize: 12 }}>
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </Text>
                </Descriptions.Item>
              ))}
          </Descriptions>
        ) : (
          <Text type="secondary">Loading configuration...</Text>
        )}
      </Card>

      {/* Add Peer Modal */}
      <Modal
        title="Add Peer"
        open={addPeerModalOpen}
        onOk={handleAddPeer}
        onCancel={() => {
          setAddPeerModalOpen(false);
          form.resetFields();
        }}
        okText="Add"
        confirmLoading={addPeerLoading}
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item
            label="Instance ID"
            name="instanceId"
            rules={[{ required: true, message: "Please enter instance ID" }]}
          >
            <Input placeholder="e.g. raos-node-2" />
          </Form.Item>
          <Form.Item
            label="URL"
            name="url"
            rules={[
              { required: true, message: "Please enter peer URL" },
              { type: "url", message: "Please enter a valid URL" },
            ]}
          >
            <Input placeholder="e.g. https://peer.example.com" />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
