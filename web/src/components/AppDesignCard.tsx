/**
 * App Design Card — 在 Chat 中展示 app_designer 生成的应用方案
 *
 * 接收 designId，自动调用 preview 获取详情，展示组件清单和快捷操作。
 */

import React, { useState, useEffect } from "react";
import { Card, Button, Tag, Space, Spin, Empty, Collapse, Descriptions, message } from "antd";
import {
  ThunderboltOutlined,
  FormOutlined,
  NodeIndexOutlined,
  BookOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  BuildOutlined,
} from "@ant-design/icons";
import { api } from "@/api";

interface AppDesignCardProps {
  "data-design-id"?: string;
  "data-name"?: string;
  "data-version"?: string;
  "data-action"?: string;
}

interface DesignField {
  name: string;
  title: string;
  type: string;
  required?: boolean;
}

interface DesignComponent {
  type: "skill" | "form" | "workflow" | "knowledgeBase";
  key: string;
  name: string;
  status?: string;
}

interface DesignRelationship {
  from: string;
  to: string;
  type: string;
  description?: string;
}

interface DesignData {
  name: string;
  description: string;
  components: {
    skills: Array<{ name: string; description: string; logic?: string }>;
    forms: Array<{ key: string; name: string; fields: DesignField[] }>;
    workflows: Array<{ key: string; name: string }>;
    knowledgeBases: Array<{ name: string; documentTypes: string[] }>;
  };
  relationships: DesignRelationship[];
}

interface DesignRecord {
  designId: string;
  name: string;
  version: number;
  status: string;
  structured: {
    designJson: DesignData;
    components: DesignComponent[];
  };
}

const typeIcons: Record<string, React.ReactNode> = {
  skill: <ThunderboltOutlined />,
  form: <FormOutlined />,
  workflow: <NodeIndexOutlined />,
  knowledgeBase: <BookOutlined />,
};

const typeColors: Record<string, string> = {
  skill: "blue",
  form: "green",
  workflow: "purple",
  knowledgeBase: "orange",
};

const typeLabels: Record<string, string> = {
  skill: "Skill",
  form: "表单",
  workflow: "工作流",
  knowledgeBase: "知识库",
};

const AppDesignCard: React.FC<AppDesignCardProps> = (props) => {
  const designId = props["data-design-id"];
  const name = props["data-name"];
  const version = props["data-version"];
  const action = props["data-action"];

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<DesignRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!designId) {
      setLoading(false);
      setError("缺少设计方案 ID");
      return;
    }
    loadDesign();
  }, [designId]);

  const loadDesign = async () => {
    try {
      const result = await api.post<any>("/api/execute", {
        skillName: "app_designer",
        params: { action: "preview", designId },
      });
      if (result.success && result.data?.structured) {
        setRecord({
          designId: result.data.designId,
          name: result.data.name,
          version: result.data.version,
          status: result.data.status,
          structured: result.data.structured,
        });
      } else {
        setError(result.error || "加载失败");
      }
    } catch (err: any) {
      setError(err.message || "请求失败");
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <Card size="small" style={{ maxWidth: 600, margin: "8px 0" }}>
        <Spin size="small" /> 加载设计方案...
      </Card>
    );
  }

  if (error || !record) {
    return (
      <Card size="small" style={{ maxWidth: 600, margin: "8px 0" }}>
        <Empty description={error || "加载失败"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  const d = record.structured.designJson;
  const components = record.structured.components;

  const actionLabel =
    action === "create" ? "已创建" : action === "update" ? "已更新" : "预览";

  return (
    <Card
      size="small"
      style={{ maxWidth: 640, margin: "8px 0", borderRadius: 12 }}
      title={
        <Space>
          <BuildOutlined />
          <span>
            {d.name} <Tag>v{record.version}</Tag>
          </span>
          <Tag color={record.status === "applied" ? "green" : "default"}>
            {actionLabel}
          </Tag>
        </Space>
      }
      extra={
        <Button size="small" type="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : "展开详情"}
        </Button>
      }
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item label="描述">{d.description || "-"}</Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 8 }}>
        <Space wrap>
          {components.map((c) => (
            <Tag key={`${c.type}-${c.key}`} color={typeColors[c.type]} icon={typeIcons[c.type]}>
              {typeLabels[c.type]}: {c.name}
            </Tag>
          ))}
        </Space>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <Collapse ghost size="small">
            {d.components.skills.length > 0 && (
              <Collapse.Panel header={`Skills (${d.components.skills.length})`} key="skills">
                {d.components.skills.map((s) => (
                  <div key={s.name} style={{ marginBottom: 8, padding: 8, background: "#f5f5f5", borderRadius: 6 }}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{s.description}</div>
                    {s.logic && (
                      <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>逻辑: {s.logic.slice(0, 100)}...</div>
                    )}
                  </div>
                ))}
              </Collapse.Panel>
            )}

            {d.components.forms.length > 0 && (
              <Collapse.Panel header={`表单 (${d.components.forms.length})`} key="forms">
                {d.components.forms.map((f) => (
                  <div key={f.key} style={{ marginBottom: 8, padding: 8, background: "#f5f5f5", borderRadius: 6 }}>
                    <div style={{ fontWeight: 500 }}>
                      {f.name}{" "}
                      <Button
                        size="small"
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => {
                          window.open(`/forms/designer`, "_blank");
                        }}
                      >
                        设计
                      </Button>
                    </div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      字段: {f.fields.map((field) => `${field.title}(${field.type}${field.required ? "*" : ""})`).join(", ")}
                    </div>
                  </div>
                ))}
              </Collapse.Panel>
            )}

            {d.components.workflows.length > 0 && (
              <Collapse.Panel header={`工作流 (${d.components.workflows.length})`} key="workflows">
                {d.components.workflows.map((w) => (
                  <div key={w.key} style={{ marginBottom: 8, padding: 8, background: "#f5f5f5", borderRadius: 6 }}>
                    <div style={{ fontWeight: 500 }}>
                      {w.name}{" "}
                      <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => window.open(`/workflow`, "_blank")}>
                        查看
                      </Button>
                    </div>
                  </div>
                ))}
              </Collapse.Panel>
            )}

            {d.components.knowledgeBases.length > 0 && (
              <Collapse.Panel header={`知识库 (${d.components.knowledgeBases.length})`} key="kb">
                {d.components.knowledgeBases.map((k) => (
                  <div key={k.name} style={{ marginBottom: 8, padding: 8, background: "#f5f5f5", borderRadius: 6 }}>
                    <div style={{ fontWeight: 500 }}>
                      {k.name}{" "}
                      <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => window.open(`/knowledge`, "_blank")}>
                        上传
                      </Button>
                    </div>
                    <div style={{ fontSize: 12, color: "#666" }}>文档类型: {k.documentTypes.join(", ")}</div>
                  </div>
                ))}
              </Collapse.Panel>
            )}

            {d.relationships.length > 0 && (
              <Collapse.Panel header={`组件关联 (${d.relationships.length})`} key="rels">
                {d.relationships.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                    {r.from} → {r.to} <Tag>{r.type}</Tag>
                    {r.description && <span style={{ color: "#999" }}> ({r.description})</span>}
                  </div>
                ))}
              </Collapse.Panel>
            )}
          </Collapse>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}>
            <Space wrap>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  const input = window.prompt("请输入修改意见：");
                  if (input) {
                    message.info("请在对话中直接说：帮我修改 design_xxx，" + input);
                  }
                }}
              >
                提出修改
              </Button>
              <Button size="small" icon={<FormOutlined />} onClick={() => window.open("/forms", "_blank")}>
                表单中心
              </Button>
              <Button size="small" icon={<NodeIndexOutlined />} onClick={() => window.open("/workflow", "_blank")}>
                工作流
              </Button>
              <Button size="small" icon={<BookOutlined />} onClick={() => window.open("/knowledge", "_blank")}>
                知识库
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Card>
  );
};

export default AppDesignCard;
