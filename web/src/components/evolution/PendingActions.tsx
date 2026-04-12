import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  List,
  Button,
  App,
  Badge,
  Modal,
  Typography,
  Tag,
  Empty,
  Space,
  Input,
} from "antd";
import {
  ReloadOutlined,
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text, Title } = Typography;

interface PendingSkill {
  id: string;
  name: string;
  description: string;
  creator: string;
  createdAt: string;
  code?: string;
}

export default function PendingActions() {
  const { message, modal } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [skills, setSkills] = useState<PendingSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadPendingSkills = async () => {
    try {
      setLoading(true);
      const data = await api.get<any>("/api/evolution/pending");
      setSkills(data.skills || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPendingSkills();
  }, []);

  const handleApprove = (skill: PendingSkill) => {
    modal.confirm({
      title: "Approve Skill",
      content: `Are you sure you want to approve "${skill.name}"?`,
      okText: "Approve",
      okType: "primary",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.post(`/api/evolution/approve/${skill.id}`);
          message.success(`Skill "${skill.name}" approved`);
          loadPendingSkills();
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleReject = (skill: PendingSkill) => {
    modal.confirm({
      title: "Reject Skill",
      content: `Are you sure you want to reject "${skill.name}"?`,
      okText: "Reject",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          setActionLoading(true);
          await api.post(`/api/evolution/reject/${skill.id}`);
          message.success(`Skill "${skill.name}" rejected`);
          loadPendingSkills();
        } catch (e: any) {
          message.error(e.message);
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleViewCode = (skill: PendingSkill) => {
    modal.info({
      title: `Code: ${skill.name}`,
      width: 800,
      content: (
        <pre
          style={{
            background: "#f5f5f5",
            padding: 12,
            borderRadius: 4,
            maxHeight: 400,
            overflow: "auto",
            fontSize: 11,
            whiteSpace: "pre-wrap",
          }}
        >
          {skill.code || "No code available"}
        </pre>
      ),
    });
  };

  const filtered = skills.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      {/* Search Bar */}
      <Flex gap={8}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search pending skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="small"
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={loadPendingSkills}
          loading={loading}
        >
          {t("refresh")}
        </Button>
      </Flex>

      {/* List */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <span>{t("pending_skills_title")} ({filtered.length})</span>
          </Flex>
        }
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto" } }}
      >
        {filtered.length === 0 ? (
          <Empty description={search ? t("no_results_found") : t("no_pending_skills")} />
        ) : (
          <List
            dataSource={filtered}
            size="small"
            renderItem={(skill) => (
              <List.Item>
                <Flex vertical style={{ width: "100%" }} gap={8}>
                  <Flex align="center" justify="space-between">
                    <div style={{ flex: 1 }}>
                      <Text strong>{skill.name}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Creator: {skill.creator}
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Created: {new Date(skill.createdAt).toLocaleString()}
                      </Text>
                    </div>
                  </Flex>

                  {skill.description && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {skill.description}
                    </Text>
                  )}

                  <Space size="small">
                    <Button
                      size="small"
                      icon={<CodeOutlined />}
                      onClick={() => handleViewCode(skill)}
                    >
                      {t("view_code")}
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={() => handleApprove(skill)}
                      loading={actionLoading}
                    >
                      {t("approve")}
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<CloseOutlined />}
                      onClick={() => handleReject(skill)}
                      loading={actionLoading}
                    >
                      {t("reject")}
                    </Button>
                  </Space>
                </Flex>
              </List.Item>
            )}
          />
        )}
      </Card>
    </Flex>
  );
}
