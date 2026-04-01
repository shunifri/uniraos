import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Table,
  Button,
  Badge,
  App,
  Modal,
  Typography,
  Empty,
  Tag,
  Space,
  Form,
  Input,
  Select,
  Collapse,
  Timeline,
} from "antd";
import {
  ReloadOutlined,
  PlusOutlined,
  ExclamationOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { api } from "@/api";

const { Text } = Typography;

interface Redline {
  id: string;
  name: string;
  description: string;
  type: "blocking" | "warning";
  status: "active" | "disabled";
  violations?: number;
  lastViolation?: string;
  violationHistory?: Array<{
    timestamp: string;
    context: string;
  }>;
}

export default function RedlinesView() {
  const { message, modal } = App.useApp();
  const [redlines, setRedlines] = useState<Redline[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [form] = Form.useForm();

  const loadRedlines = async () => {
    try {
      setLoading(true);
      const data = await api.get<any>("/api/evolution/redlines");
      setRedlines(data.redlines || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRedlines();
  }, []);

  const handleAddRedline = async (values: any) => {
    try {
      setActionLoading(true);
      await api.post("/api/evolution/redlines", values);
      message.success("Redline constraint added");
      setIsAddModalOpen(false);
      form.resetFields();
      loadRedlines();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteRedline = (redline: Redline) => {
    modal.confirm({
      title: "Delete Redline",
      content: `Delete redline constraint "${redline.name}"?`,
      okType: "danger",
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.delete(`/api/evolution/redlines/${redline.id}`);
          message.success(`Redline "${redline.name}" deleted`);
          loadRedlines();
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      width: 150,
      ellipsis: true,
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      width: 100,
      render: (type: string) => (
        <Tag color={type === "blocking" ? "red" : "orange"}>
          {type.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Badge
          status={status === "active" ? "success" : "default"}
          text={status.toUpperCase()}
        />
      ),
    },
    {
      title: "Violations",
      dataIndex: "violations",
      key: "violations",
      width: 80,
      render: (violations: number) => violations || 0,
    },
    {
      title: "Last Violation",
      dataIndex: "lastViolation",
      key: "lastViolation",
      width: 150,
      render: (time: string) =>
        time ? new Date(time).toLocaleString() : "-",
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      render: (_, record: Redline) => (
        <Space size="small">
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteRedline(record)}
            loading={actionLoading}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ];

  const expandedRowRender = (record: Redline) => (
    <Flex vertical gap={12}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Description
        </Text>
        <br />
        <Text>{record.description}</Text>
      </div>

      {record.violationHistory && record.violationHistory.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Violation History
          </Text>
          <Timeline
            items={record.violationHistory.map((v) => ({
              dot: <ExclamationOutlined style={{ color: "#ff4d4f" }} />,
              children: (
                <div>
                  <Text style={{ fontSize: 12 }}>
                    {new Date(v.timestamp).toLocaleString()}
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {v.context}
                  </Text>
                </div>
              ),
            }))}
          />
        </div>
      )}
    </Flex>
  );

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      {/* Add Button */}
      <Flex gap={8}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsAddModalOpen(true)}
          size="small"
        >
          Add Redline
        </Button>

        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={loadRedlines}
          loading={loading}
        >
          Refresh
        </Button>
      </Flex>

      {/* Table */}
      <Card
        size="small"
        title="Redline Constraints"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto" } }}
      >
        {redlines.length === 0 ? (
          <Empty description="No redline constraints" />
        ) : (
          <Table
            dataSource={redlines}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 20 }}
            size="small"
            loading={loading}
            expandable={{
              expandedRowRender,
            }}
            scroll={{ x: 1200 }}
          />
        )}
      </Card>

      {/* Add Modal */}
      <Modal
        title="Add Redline Constraint"
        open={isAddModalOpen}
        onOk={() => form.submit()}
        onCancel={() => {
          setIsAddModalOpen(false);
          form.resetFields();
        }}
        loading={actionLoading}
      >
        <Form
          form={form}
          layout="vertical"
          size="small"
          onFinish={handleAddRedline}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter name" }]}
          >
            <Input placeholder="Constraint name" />
          </Form.Item>

          <Form.Item
            label="Type"
            name="type"
            rules={[{ required: true, message: "Please select type" }]}
            initialValue="warning"
          >
            <Select
              options={[
                { label: "Warning", value: "warning" },
                { label: "Blocking", value: "blocking" },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Description"
            name="description"
            rules={[{ required: true, message: "Please enter description" }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="Describe the constraint..."
            />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
