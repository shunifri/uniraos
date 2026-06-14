import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  message,
  Typography,
  Empty,
  Spin,
  Drawer,
  Popconfirm,
  Modal,
  Tabs,
  Input,
  Select,
  Form,
} from "antd";
import {
  BuildOutlined,
  RocketOutlined,
  EyeOutlined,
  ReloadOutlined,
  DeleteOutlined,
  LinkOutlined,
  CopyOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import AppDesignCard from "@/components/AppDesignCard";

const { Title, Text } = Typography;

interface AppDesign {
  id: string;
  name: string;
  version: number;
  status: string;
  updatedAt: number;
}

const AppsPage: React.FC = () => {
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<AppDesign[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDesign, setSelectedDesign] = useState<AppDesign | null>(null);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedDesign, setEmbedDesign] = useState<AppDesign | null>(null);
  const [embedConfig, setEmbedConfig] = useState({
    title: "",
    icon: "",
    position: "bottom-right",
    width: "420",
    height: "640",
    bottom: "20",
    right: "20",
    left: "20",
    top: "20",
  });
  const [activeEmbedTab, setActiveEmbedTab] = useState("script");

  const fetchDesigns = async () => {
    setLoading(true);
    try {
      const res = await api.post<any>("/api/execute", {
        skillName: "app_designer",
        params: { action: "list" },
      });
      if (res.success && res.data?.designs) {
        setDesigns(res.data.designs);
      }
    } catch (e: any) {
      message.error(e.message || "获取应用列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDesigns();
  }, []);

  const handleDelete = async (designId: string) => {
    try {
      const res = await api.post<any>("/api/execute", {
        skillName: "app_designer",
        params: { action: "delete", designId },
      });
      if (res.success) {
        message.success("应用已删除");
        fetchDesigns();
      } else {
        message.error(res.error || "删除失败");
      }
    } catch (e: any) {
      message.error(e.message || "删除失败");
    }
  };

  const openDetail = (design: AppDesign) => {
    setSelectedDesign(design);
    setDrawerOpen(true);
  };

  const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const openEmbed = (design: AppDesign) => {
    setEmbedDesign(design);
    setEmbedConfig({
      title: design.name,
      icon: "",
      position: "bottom-right",
      width: "420",
      height: "640",
      bottom: "20",
      right: "20",
      left: "20",
      top: "20",
    });
    setActiveEmbedTab("script");
    setEmbedOpen(true);
  };

  const generateScriptCode = () => {
    if (!embedDesign) return "";
    const baseUrl = window.location.origin;
    const attrs: string[] = [
      `  data-app="${escapeHtml(embedDesign.id)}"`,
      `  data-title="${escapeHtml(embedConfig.title)}"`,
    ];
    if (embedConfig.icon) attrs.push(`  data-icon="${escapeHtml(embedConfig.icon)}"`);
    attrs.push(`  data-position="${escapeHtml(embedConfig.position)}"`);
    if (embedConfig.position.includes("bottom") && embedConfig.bottom !== "20") attrs.push(`  data-bottom="${escapeHtml(embedConfig.bottom)}"`);
    if (embedConfig.position.includes("top") && embedConfig.top !== "20") attrs.push(`  data-top="${escapeHtml(embedConfig.top)}"`);
    if (embedConfig.position.includes("right") && embedConfig.right !== "20") attrs.push(`  data-right="${escapeHtml(embedConfig.right)}"`);
    if (embedConfig.position.includes("left") && embedConfig.left !== "20") attrs.push(`  data-left="${escapeHtml(embedConfig.left)}"`);
    if (embedConfig.width !== "420") attrs.push(`  data-width="${escapeHtml(embedConfig.width)}"`);
    if (embedConfig.height !== "640") attrs.push(`  data-height="${escapeHtml(embedConfig.height)}"`);
    return `<script src="${escapeHtml(baseUrl)}/widget.js"\n${attrs.join("\n")}\n></script>`;
  };

  const generateIframeCode = () => {
    if (!embedDesign) return "";
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    params.set("app", embedDesign.id);
    params.set("title", embedConfig.title);
    if (embedConfig.icon) params.set("icon", embedConfig.icon);
    const qs = params.toString();
    return `<iframe\n  src="${escapeHtml(baseUrl)}/embed?${escapeHtml(qs)}"\n  width="${escapeHtml(embedConfig.width)}"\n  height="${escapeHtml(embedConfig.height)}"\n  frameborder="0"\n  allow="clipboard-write; fullscreen"\n  style="border: 1px solid rgba(0,0,0,0.06); border-radius: 16px;"\n></iframe>`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  const columns = [
    {
      title: "应用名称",
      dataIndex: "name",
      render: (name: string, record: AppDesign) => (
        <Space>
          <BuildOutlined />
          <Text strong>{name}</Text>
          <Tag>v{record.version}</Tag>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (status: string) => (
        <Tag color={status === "applied" ? "green" : status === "draft" ? "default" : status === "archived" ? "red" : "default"}>
          {status === "applied" ? "已部署" : status === "draft" ? "草稿" : status === "archived" ? "已归档" : status}
        </Tag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      render: (t: number) => (t ? new Date(t).toLocaleString() : "-"),
    },
    {
      title: "操作",
      key: "action",
      render: (_: any, record: AppDesign) => (
        <Space>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetail(record)}
          >
            查看详情
          </Button>
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={() => openEmbed(record)}
          >
            嵌入
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<MessageOutlined />}
            onClick={() => navigate(`/chat?appId=${record.id}`)}
          >
            对话
          </Button>
          <Popconfirm
            title="确认删除？"
            description={`删除后「${record.name}」及其关联的表单、工作流、技能、知识库将全部清理，不可恢复`}
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BuildOutlined /> 应用中心
        </Title>
        <Button icon={<ReloadOutlined />} onClick={fetchDesigns}>
          刷新
        </Button>
      </div>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={designs}
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="暂无应用设计" /> }}
        />
      </Card>

      <Drawer
        title={
          <Space>
            <RocketOutlined />
            <span>{selectedDesign?.name || "应用详情"}</span>
            {selectedDesign && (
              <Tag color={selectedDesign.status === "applied" ? "green" : "default"}>
                {selectedDesign.status === "applied" ? "已部署" : "草稿"}
              </Tag>
            )}
          </Space>
        }
        width={720}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnClose
      >
        {selectedDesign ? (
          <AppDesignCard
            data-design-id={selectedDesign.id}
            data-name={selectedDesign.name}
            data-version={String(selectedDesign.version)}
            data-action="preview"
          />
        ) : (
          <Spin />
        )}
      </Drawer>

      <Modal
        title="嵌入代码"
        open={embedOpen}
        onCancel={() => setEmbedOpen(false)}
        footer={null}
        width={640}
      >
        <Form layout="vertical" style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="窗口标题" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.title}
                onChange={(e) => setEmbedConfig({ ...embedConfig, title: e.target.value })}
                placeholder="RAOS 智能助手"
              />
            </Form.Item>
            <Form.Item label="图标地址" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.icon}
                onChange={(e) => setEmbedConfig({ ...embedConfig, icon: e.target.value })}
                placeholder="https://example.com/icon.png"
              />
            </Form.Item>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Form.Item label="位置" style={{ marginBottom: 8 }}>
              <Select
                value={embedConfig.position}
                onChange={(v) => setEmbedConfig({ ...embedConfig, position: v })}
                options={[
                  { label: "右下角", value: "bottom-right" },
                  { label: "左下角", value: "bottom-left" },
                  { label: "右上角", value: "top-right" },
                  { label: "左上角", value: "top-left" },
                ]}
              />
            </Form.Item>
            {embedConfig.position.includes("bottom") && (
              <Form.Item label="距离底部(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.bottom}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, bottom: e.target.value })}
                />
              </Form.Item>
            )}
            {embedConfig.position.includes("top") && (
              <Form.Item label="距离顶部(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.top}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, top: e.target.value })}
                />
              </Form.Item>
            )}
            {embedConfig.position.includes("right") && (
              <Form.Item label="距离右侧(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.right}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, right: e.target.value })}
                />
              </Form.Item>
            )}
            {embedConfig.position.includes("left") && (
              <Form.Item label="距离左侧(px)" style={{ marginBottom: 8 }}>
                <Input
                  value={embedConfig.left}
                  onChange={(e) => setEmbedConfig({ ...embedConfig, left: e.target.value })}
                />
              </Form.Item>
            )}
            <Form.Item label="宽度(px)" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.width}
                onChange={(e) => setEmbedConfig({ ...embedConfig, width: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="高度(px)" style={{ marginBottom: 8 }}>
              <Input
                value={embedConfig.height}
                onChange={(e) => setEmbedConfig({ ...embedConfig, height: e.target.value })}
              />
            </Form.Item>
          </div>
        </Form>

        <Tabs activeKey={activeEmbedTab} onChange={setActiveEmbedTab} items={[
          {
            key: "script",
            label: "Script 嵌入（浮动按钮）",
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
                  在第三方网站 HTML 底部插入此代码，页面右下角会出现浮动对话图标。
                </Typography.Paragraph>
                <pre
                  style={{
                    background: "#f6f8fa",
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    border: "1px solid #e8e8e8",
                  }}
                >
                  {generateScriptCode()}
                </pre>
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(generateScriptCode())}>
                    复制
                  </Button>
                </div>
              </>
            ),
          },
          {
            key: "iframe",
            label: "Iframe 嵌入（直接嵌入页面）",
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
                  在第三方网站需要显示对话的位置插入此 iframe 代码。
                </Typography.Paragraph>
                <pre
                  style={{
                    background: "#f6f8fa",
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    border: "1px solid #e8e8e8",
                  }}
                >
                  {generateIframeCode()}
                </pre>
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(generateIframeCode())}>
                    复制
                  </Button>
                </div>
              </>
            ),
          },
        ]} />
      </Modal>
    </div>
  );
};

export default AppsPage;
