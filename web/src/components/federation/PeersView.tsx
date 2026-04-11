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

interface Peer {
  instanceId: string;
  endpoint: string;
  version: string;
  skillCount: number;
  lastHeartbeat: string;
  status: "online" | "offline" | "unreachable";
}

export default function PeersView() {
  const { message, modal } = App.useApp();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [form] = Form.useForm();

  const loadPeers = async () => {
    try {
      setLoading(true);
      const data = await api.get<Peer[]>("/api/federation/peers");
      setPeers(data);
    } catch (e: any) {
      message.error(e.message || "Failed to load peers");
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
      message.success("Peer added successfully");
      setIsAddModalVisible(false);
      form.resetFields();
      await loadPeers();
    } catch (e: any) {
      message.error(e.message || "Failed to add peer");
    }
  };

  const handleRemovePeer = (peerId: string) => {
    modal.confirm({
      title: "Remove Peer",
      content: "Are you sure you want to remove this peer?",
      okText: "Remove",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.del(`/api/federation/peers/${peerId}`);
          message.success("Peer removed successfully");
          await loadPeers();
        } catch (e: any) {
          message.error(e.message || "Failed to remove peer");
        }
      },
    });
  };

  const handleViewDetails = (peer: Peer) => {
    modal.info({
      title: `Peer Details: ${peer.instanceId}`,
      content: (
        <div>
          <p>
            <strong>Endpoint:</strong> {peer.endpoint}
          </p>
          <p>
            <strong>Version:</strong> {peer.version}
          </p>
          <p>
            <strong>Skill Count:</strong> {peer.skillCount}
          </p>
          <p>
            <strong>Last Heartbeat:</strong>{" "}
            {new Date(peer.lastHeartbeat).toLocaleString()}
          </p>
          <p>
            <strong>Status:</strong> {peer.status}
          </p>
        </div>
      ),
    });
  };

  const columns = [
    {
      title: "Instance ID",
      dataIndex: "instanceId",
      key: "instanceId",
      render: (text: string) => <span>{text}</span>,
    },
    {
      title: "Endpoint",
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
      title: "Version",
      dataIndex: "version",
      key: "version",
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: "Skills",
      dataIndex: "skillCount",
      key: "skillCount",
      render: (count: number) => <Badge count={count} />,
    },
    {
      title: "Last Heartbeat",
      dataIndex: "lastHeartbeat",
      key: "lastHeartbeat",
      render: (text: string) => (
        <span>{new Date(text).toLocaleString()}</span>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        let color = "default";
        if (status === "online") color = "success";
        else if (status === "offline") color = "error";
        else if (status === "unreachable") color = "warning";
        return <Badge status={color} text={status} />;
      },
    },
    {
      title: "Actions",
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
            Add Peer
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadPeers}
            loading={loading}
          >
            Refresh
          </Button>
        </Flex>
        <Empty description="No peers found" />

        <Modal
          title="Add Peer"
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
              <Input placeholder="e.g., instance-001" />
            </Form.Item>
            <Form.Item
              label="Endpoint"
              name="endpoint"
              rules={[{ required: true, message: "Please enter endpoint" }]}
            >
              <Input placeholder="e.g., http://localhost:8000" />
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
          Add Peer
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadPeers}
          loading={loading}
        >
          Refresh
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
        title="Add Peer"
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
            <Input placeholder="e.g., instance-001" />
          </Form.Item>
          <Form.Item
            label="Endpoint"
            name="endpoint"
            rules={[{ required: true, message: "Please enter endpoint" }]}
          >
            <Input placeholder="e.g., http://localhost:8000" />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
