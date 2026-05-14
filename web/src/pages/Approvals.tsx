import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Button,
  Drawer,
  Space,
  Typography,
  Empty,
  Spin,
  message,
  Divider,
  Input,
} from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { getWorkflowTasks, getWorkflowTaskForm, completeWorkflowTask } from "@/api";
import { FormRenderer } from "@/components/form-engine";
import type { RaosFormSchema } from "@/components/form-engine/types";

const { Title, Text } = Typography;

interface WorkflowTask {
  id: number;
  name: string;
  definitionKey: string;
  nodeId: string;
  status: "pending" | "claimed" | "completed";
  assignee?: string;
  createdAt: number;
  completedAt?: number;
}

const ApprovalsPage: React.FC = () => {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [taskForm, setTaskForm] = useState<{ schema: RaosFormSchema; initialData: any } | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await getWorkflowTasks();
      if (res.success) {
        setTasks(res.data || []);
      }
    } catch (e) {
      console.error("[Approvals] fetch tasks failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleOpenTask = async (task: WorkflowTask) => {
    setSelectedTask(task);
    setDrawerOpen(true);
    setFormLoading(true);
    setFormData({});
    setComment("");
    try {
      const res: any = await getWorkflowTaskForm(task.id);
      if (res.success && res.data) {
        setTaskForm({
          schema: res.data.schema,
          initialData: res.data.initialData || {},
        });
      } else {
        message.error("加载表单失败");
      }
    } catch (e) {
      message.error("加载表单失败");
    } finally {
      setFormLoading(false);
    }
  };

  const handleSubmit = async (action: string) => {
    if (!selectedTask) return;
    setSubmitting(true);
    try {
      const res: any = await completeWorkflowTask(selectedTask.id, {
        action,
        comment,
        formData,
      });
      if (res.success) {
        message.success(action === "approve" ? "已通过" : action === "reject" ? "已驳回" : "已提交");
        setDrawerOpen(false);
        fetchTasks();
      } else {
        message.error(res.error || "提交失败");
      }
    } catch (e: any) {
      message.error(e.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: "任务名称",
      dataIndex: "name",
      key: "name",
      render: (text: string) => <Text strong>{text || "未命名任务"}</Text>,
    },
    {
      title: "流程",
      dataIndex: "definitionKey",
      key: "definitionKey",
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        if (status === "pending")
          return <Tag icon={<ClockCircleOutlined />} color="warning">待处理</Tag>;
        if (status === "claimed")
          return <Tag icon={<ClockCircleOutlined />} color="processing">处理中</Tag>;
        return <Tag color="default">{status}</Tag>;
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (ts: number) => (ts ? new Date(ts).toLocaleString() : "-"),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      fixed: "right" as const,
      render: (_: any, record: WorkflowTask) => (
        <Button type="primary" size="small" onClick={() => handleOpenTask(record)}>
          处理
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <Title level={3}>审批中心</Title>
      <Card>
        <Spin spinning={loading}>
          {tasks.length === 0 ? (
            <Empty description="暂无待审批任务" style={{ marginTop: 40 }} />
          ) : (
            <Table
              dataSource={tasks}
              columns={columns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
            />
          )}
        </Spin>
      </Card>

      <Drawer
        title={selectedTask?.name || "审批详情"}
        width={640}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button danger loading={submitting} onClick={() => handleSubmit("reject")}>
              <CloseCircleOutlined /> 驳回
            </Button>
            <Button type="primary" loading={submitting} onClick={() => handleSubmit("approve")}>
              <CheckCircleOutlined /> 通过
            </Button>
          </Space>
        }
      >
        <Spin spinning={formLoading}>
          {taskForm ? (
            <>
              <FormRenderer
                schema={taskForm.schema}
                initialData={taskForm.initialData}
                onChange={(data) => setFormData(data)}
              />
              <Divider />
              <div>
                <Text type="secondary">审批意见（可选）</Text>
                <Input.TextArea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="请输入审批意见..."
                  rows={3}
                  style={{ marginTop: 8 }}
                />
              </div>
            </>
          ) : (
            <Empty description="无表单数据" />
          )}
        </Spin>
      </Drawer>
    </div>
  );
};

export default ApprovalsPage;
