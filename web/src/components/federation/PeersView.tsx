import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Empty,
  App,
  Badge,
  Tooltip,
  Flex,
  Tag,
} from "antd";
import {
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

interface Peer {
  instanceId: string;
  endpoint: string;
  version: string;
  skillCount: number;
  lastHeartbeat: string;
  status: "online" | "offline" | "unreachable";
}

export default function PeersView() {
  const { message } = App.useApp();
  const [modal] = Modal.useModal();
  const t = useI18nStore((s) => s.t);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [form] = Form.useForm();

  const loadPeers = async () => {
    try {
      setLoading(true);
      const data = await api.get<{ success: boolean; peers: Peer[] }>("/api/federation/peers");
      setPeers(data.peers || []);
    } catch (e: any) {
      message.error(e.message || t("failed_to_load_peers"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPeers();
    const interval = setInterval(loadPeers, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAddPeer = async () => {
    try {
      const values = await form.validateFields();
      await api.post("/api/federation/peers", {
        instanceId: values.instanceId,
        endpoint: values.endpoint,
      });
      message.success(t("peer_added"));
      setIsAddModalVisible(false);
      form.resetFields();
      await loadPeers();
    } catch (e: any) {
      message.error(e.message || t("failed_to_add_peer"));
    }
  };

  const handleRemovePeer = (peerId: string) => {
    modal.confirm({
      title: t("remove_peer"),
      content: t("remove_peer_confirm"),
      okText: t("remove"),
      cancelText: t("cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.del(`/api/federation/peers/${peerId}`);
          message.success(t("peer_removed"));
          await loadPeers();
        } catch (e: any) {
          message.error(e.message || t("failed_to_remove_peer"));
        }
      },
    });
  };

  const handleViewDetails = (peer: Peer) => {
    modal.info({
      title: `${t("peer_details")}: ${peer.instanceId}`,
      content: (
        <div>
          <p>
            <strong>{t("endpoint")}:</strong> {peer.endpoint}
          </p>
          <p>
            <strong>{t("version")}:</strong> {peer.version}
          </p>
          <p>
            <strong>{t("skill_count")}:</strong> {peer.skillCount}
          </p>
          <p>
            <strong>{t("last_heartbeat")}:</strong>{" "}
            {new Date(peer.lastHeartbeat).toLocaleString()}
          </p>
          <p>
            <strong>{t("status")}:</strong> {peer.status}
          </p>
        </div>
      ),
    });
  };

  const columns = [
    {
      title: t("instance_id"),
      dataIndex: "instanceId",
      key: "instanceId",
      render: (text: string) => <span>{text}</span>,
    },
    {
      title: t("endpoint"),
      dataIndex: "endpoint",
      key: "endpoint",
      render: (text: string) => (
        <Tooltip title={text}>
          <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", display: "inline-block" }}>
            {text}
          </span>
        </Tooltip>
      ),
    },
    {
      title: t("version"),
      dataIndex: "version",
      key: "version",
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: t("skills"),
      dataIndex: "skillCount",
      key: "skillCount",
      render: (count: number) => <Badge count={count} />,
    },
    {
      title: t("last_heartbeat"),
      dataIndex: "lastHeartbeat",
      key: "lastHeartbeat",
      render: (text: string) => (
        <span>{new Date(text).toLocaleString()}</span>
      ),
    },
    {
      title: t("status"),
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        let color = "default";
        if (status === "online") color = "success";
        else if (status === "offline") color = "error";
        else if (status === "unreachable") color = "warning";
        return <Badge status={color} text={t(status)} />;
      },
    },
    {
      title: t("actions"),
      key: "actions",
      render: (_: any, record: Peer) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetails(record)}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleRemovePeer(record.instanceId)}
          />
        </Space>
      ),
    },
  ];

  if (peers.length === 0 && !loading) {
    return (
      <Flex vertical gap={16}>
        <Flex gap={8}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsAddModalVisible(true)}
          >
            {t("add_peer")}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadPeers}
            loading={loading}
          >
            {t("refresh")}
          </Button>
        </Flex>
        <Empty description={t("no_peers")} />

        <Modal
          title={t("add_peer")}
          open={isAddModalVisible}
          onOk={handleAddPeer}
          onCancel={() => {
            setIsAddModalVisible(false);
            form.resetFields();
          }}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              label="Instance ID"
              name="instanceId"
              rules={[{ required: true, message: "Please enter instance ID" }]}
            >
              <Input placeholder={t("peer_name_example")} />
            </Form.Item>
            <Form.Item
              label="Endpoint"
              name="endpoint"
              rules={[{ required: true, message: "Please enter endpoint" }]}
            >
              <Input placeholder={t("peer_endpoint_example")} />
            </Form.Item>
          </Form>
        </Modal>
      </Flex>
    );
  }

  return (
    <Flex vertical gap={16}>
      <Flex gap={8}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsAddModalVisible(true)}
        >
          {t("add_peer")}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadPeers}
          loading={loading}
        >
          {t("refresh")}
        </Button>
      </Flex>

      <Table
        columns={columns}
        dataSource={peers.map((p) => ({ ...p, key: p.instanceId }))}
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={t("add_peer")}
        open={isAddModalVisible}
        onOk={handleAddPeer}
        onCancel={() => {
          setIsAddModalVisible(false);
          form.resetFields();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Instance ID"
            name="instanceId"
            rules={[{ required: true, message: "Please enter instance ID" }]}
          >
            <Input placeholder={t("peer_name_example")} />
          </Form.Item>
          <Form.Item
            label="Endpoint"
            name="endpoint"
            rules={[{ required: true, message: "Please enter endpoint" }]}
          >
            <Input placeholder={t("peer_endpoint_example")} />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
