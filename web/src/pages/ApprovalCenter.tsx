import { useState, useEffect, useCallback } from "react";
import { Card, List, Button, Input, Space, Tag, Empty, Spin, message, Typography, Divider, Badge, Flex } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, RollbackOutlined, SwapOutlined, AuditOutlined, ClockCircleOutlined } from "@ant-design/icons";
import FormRenderer from "@/components/form-engine/core/FormRenderer";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface WorkflowTask {
  id: number; nodeName: string; nodeId: string; instanceId: number;
  status: string; createdAt: number; assignee?: string; comment?: string;
}

interface TaskFormData {
  taskId: number; schema: any; initialData: Record<string, any>;
  binding: any; mappingApplied: boolean;
}

export default function ApprovalCenter() {
  const t = useI18nStore((s) => s.t);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormData | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [comment, setComment] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingForm, setLoadingForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.get("/workflow/tasks") as any;
      setTasks(res.data || []);
    } catch (e: any) {
      message.error(e.message || t("error"));
    } finally {
      setLoadingList(false);
    }
  }, [t]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const handleSelectTask = useCallback(async (taskId: number) => {
    setSelectedTaskId(taskId);
    setLoadingForm(true);
    setTaskForm(null);
    setComment("");
    try {
      const res = await api.get(`/workflow/tasks/${taskId}/form`) as any;
      setTaskForm(res.data);
      setFormData(res.data.initialData || {});
    } catch (e: any) {
      message.error(e.message || t("error"));
      setTaskForm(null);
    } finally {
      setLoadingForm(false);
    }
  }, [t]);

  const handleAction = async (action: string) => {
    if (!selectedTaskId) return;
    setSubmitting(true);
    try {
      await api.post(`/workflow/tasks/${selectedTaskId}/complete`, { action, comment, formData });
      message.success(t("success"));
      setTasks((prev) => prev.filter((t) => t.id !== selectedTaskId));
      setSelectedTaskId(null);
      setTaskForm(null);
    } catch (e: any) {
      message.error(e.message || t("error"));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <Flex style={{ height: "calc(100vh - 112px)", gap: 16 }}>
      <Card
        title={
          <Space>
            <AuditOutlined />
            <span>{t("nav_approvals")}</span>
            <Badge count={tasks.length} style={{ backgroundColor: "#1677ff" }} />
          </Space>
        }
        style={{ width: 320, flexShrink: 0, overflow: "auto" }}
        styles={{ body: { padding: 0 } }}
      >
        <Spin spinning={loadingList}>
          {tasks.length === 0 ? (
            <Empty description={t("approval_empty")} style={{ marginTop: 40 }} />
          ) : (
            <List
              dataSource={tasks}
              renderItem={(task) => (
                <List.Item
                  style={{
                    cursor: "pointer",
                    padding: "12px 16px",
                    background: selectedTaskId === task.id ? "#e6f4ff" : undefined,
                    borderLeft: selectedTaskId === task.id ? "3px solid #1677ff" : "3px solid transparent",
                  }}
                  onClick={() => handleSelectTask(task.id)}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>{task.nodeName || task.nodeId}</Text>
                        <Tag color={task.status === "claimed" ? "orange" : "blue"}>
                          {task.status === "claimed" ? (t("approval_claimed") || "Claimed") : (t("approval_pending") || "Pending")}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space size={4}>
                        <ClockCircleOutlined style={{ fontSize: 12 }} />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {new Date(task.createdAt).toLocaleString()}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Card>

      <Card style={{ flex: 1, overflow: "auto" }} styles={{ body: { padding: 24 } }}>
        {!selectedTaskId ? (
          <Empty description={t("approval_select_task") || "Select a task"} style={{ marginTop: 120 }} />
        ) : loadingForm ? (
          <Flex justify="center" align="center" style={{ height: "100%" }}>
            <Spin size="large" tip={t("loading")} />
          </Flex>
        ) : taskForm ? (
          <>
            <Flex justify="space-between" align="center">
              <Title level={4} style={{ margin: 0 }}>
                {selectedTask?.nodeName || selectedTask?.nodeId}
              </Title>
              <Tag color="blue">{t("approval_task_id") || "Task"} #{selectedTaskId}</Tag>
            </Flex>
            <Divider />
            <div style={{ marginBottom: 24 }}>
              <FormRenderer schema={taskForm.schema} initialData={taskForm.initialData} onChange={setFormData} />
            </div>
            <Card size="small" title={t("approval_comment") || "Comment"} style={{ marginBottom: 16 }}>
              <TextArea rows={3} placeholder={t("approval_comment_placeholder") || "Enter comment..."} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Card>
            <Flex gap={12} justify="flex-end">
              <Button icon={<RollbackOutlined />} onClick={() => handleAction("return")} loading={submitting}>
                {t("approval_return") || "Return"}
              </Button>
              <Button icon={<SwapOutlined />} onClick={() => handleAction("transfer")} loading={submitting}>
                {t("approval_transfer") || "Transfer"}
              </Button>
              <Button danger icon={<CloseCircleOutlined />} onClick={() => handleAction("reject")} loading={submitting}>
                {t("approval_reject") || "Reject"}
              </Button>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => handleAction("approve")} loading={submitting}>
                {t("approval_approve") || "Approve"}
              </Button>
            </Flex>
          </>
        ) : (
          <Empty description={t("error")} style={{ marginTop: 120 }} />
        )}
      </Card>
    </Flex>
  );
}
