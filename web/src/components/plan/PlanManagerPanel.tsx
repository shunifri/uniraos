import { useState, useEffect, useCallback } from "react";
import { Table, Tag, Button, Space, Modal, Progress, message } from "antd";
import { api } from "../../api";
import type { ColumnsType } from "antd/es/table";

interface PlanItem {
  planId: string;
  fileName: string;
  title: string;
  status: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  createdAt: number;
  updatedAt: number;
}

export function PlanManagerPanel() {
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await api.get("/api/agent/plan/list");
      if (res.success) {
        setPlans(res.plans || []);
      }
    } catch (e) {
      message.error("获取计划列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
    const timer = setInterval(fetchPlans, 10000);
    return () => clearInterval(timer);
  }, [fetchPlans]);

  const handleAction = async (fileName: string, action: string) => {
    try {
      const res: any = await api.post(`/api/agent/plan/${action}`, { fileName });
      if (res.success) {
        const actionLabels: Record<string, string> = {
          pause: "暂停",
          resume: "恢复",
          cancel: "取消",
          delete: "删除",
        };
        message.success(`计划已${actionLabels[action] || action}`);
        fetchPlans();
      }
    } catch (e) {
      message.error("操作失败");
    }
  };

  const statusColors: Record<string, string> = {
    running: "blue",
    completed: "green",
    failed: "red",
    paused: "orange",
    cancelled: "default",
    draft: "default",
  };

  const columns: ColumnsType<PlanItem> = [
    { title: "标题", dataIndex: "title", key: "title" },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag color={statusColors[status] || "default"}>{status}</Tag>
      ),
    },
    {
      title: "进度",
      key: "progress",
      render: (_, record) => (
        <Progress percent={record.progress} size="small" style={{ width: 120 }} />
      ),
    },
    {
      title: "步骤",
      key: "steps",
      render: (_, record) => `${record.currentStep} / ${record.totalSteps}`,
    },
    {
      title: "操作",
      key: "action",
      render: (_, record) => (
        <Space>
          {record.status === "running" && (
            <Button size="small" onClick={() => handleAction(record.fileName, "pause")}>暂停</Button>
          )}
          {record.status === "paused" && (
            <Button size="small" type="primary" onClick={() => handleAction(record.fileName, "resume")}>恢复</Button>
          )}
          {(record.status === "running" || record.status === "paused") && (
            <Button size="small" danger onClick={() => handleAction(record.fileName, "cancel")}>取消</Button>
          )}
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "确认删除",
                content: `确定要删除计划「${record.title}」吗？`,
                onOk: () => handleAction(record.fileName, "delete"),
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <h3>📋 计划管理</h3>
      <Table
        dataSource={plans}
        columns={columns}
        rowKey="planId"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />
    </div>
  );
}
