/**
 * App Design Card — 在 Chat 中展示 app_designer 生成的应用方案
 *
 * 接收 designId，自动调用 preview 获取详情，展示组件清单和快捷操作。
 */

import React, { useState, useEffect } from "react";
import { Card, Button, Tag, Space, Spin, Empty, Collapse, Descriptions, message, Modal, Input, Select } from "antd";
import {
  ThunderboltOutlined,
  FormOutlined,
  NodeIndexOutlined,
  BookOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  BuildOutlined,
  RocketOutlined,
  PlusOutlined,
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
  systemPrompt?: string;
  components: {
    skills: Array<{ name: string; description: string; logic?: string }>;
    forms: Array<{ key: string; name: string; fields: DesignField[] }>;
    workflows: Array<{ key: string; name: string }>;
    knowledgeBases: Array<{ name: string; documentTypes: string[]; collectionId?: string }>;
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
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyInput, setModifyInput] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptInput, setPromptInput] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [creatingKb, setCreatingKb] = useState<string | null>(null);
  const [relEditorOpen, setRelEditorOpen] = useState(false);
  const [relDraft, setRelDraft] = useState<DesignRelationship[]>([]);
  const [savingRels, setSavingRels] = useState(false);

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

  const handleCreateKbCollection = async (kbName: string) => {
    if (!designId) return;
    setCreatingKb(kbName);
    try {
      // 1. 创建知识库集合
      const createRes = await api.post<any>("/api/execute", {
        skillName: "kb_collection_create",
        params: { name: kbName },
      });
      if (!createRes.success) {
        message.error(createRes.error || "创建知识库集合失败");
        setCreatingKb(null);
        return;
      }
      const collectionId = createRes.data?.collection?.id;
      if (!collectionId) {
        message.error("创建知识库集合成功但未返回 ID");
        setCreatingKb(null);
        return;
      }
      // 2. 关联到设计方案
      const linkRes = await api.post<any>("/api/execute", {
        skillName: "app_designer",
        params: { action: "link_kb_collection", designId, kbName, collectionId },
      });
      if (linkRes.success) {
        message.success(`知识库集合「${kbName}」已创建并关联`);
        loadDesign();
      } else {
        message.error(linkRes.error || "关联知识库失败");
      }
    } catch (err: any) {
      message.error(err.message || "请求失败");
    }
    setCreatingKb(null);
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
    <>
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
        <Descriptions.Item label="角色设定">
          {d.systemPrompt ? (
            <div style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#333", background: "#f5f5f5", padding: 8, borderRadius: 6, maxHeight: 120, overflow: "auto" }}>
              {d.systemPrompt}
            </div>
          ) : (
            <span style={{ color: "#999", fontSize: 12 }}>未设置自定义角色提示词</span>
          )}
        </Descriptions.Item>
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
                          window.open(`/forms/designer?key=${encodeURIComponent(f.key)}`, "_blank");
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
                      <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => window.open(`/workflow/designer/${encodeURIComponent(w.key)}`, "_blank")}>
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
                      {k.collectionId ? (
                        <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => window.open(`/knowledge?collectionId=${encodeURIComponent(k.collectionId || "")}`, "_blank")}>
                          去上传
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          type="link"
                          icon={<PlusOutlined />}
                          loading={creatingKb === k.name}
                          onClick={() => handleCreateKbCollection(k.name)}
                        >
                          创建分类
                        </Button>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#666" }}>文档类型: {k.documentTypes.join(", ")}</div>
                    {k.collectionId && <div style={{ fontSize: 11, color: "#999" }}>集合 ID: {k.collectionId}</div>}
                  </div>
                ))}
              </Collapse.Panel>
            )}

            {d.relationships && d.relationships.length > 0 && (
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
                type="primary"
                size="small"
                icon={<RocketOutlined />}
                loading={applying}
                onClick={async () => {
                  if (!designId) return;
                  setApplying(true);
                  try {
                    const result = await api.post<any>("/api/execute", {
                      skillName: "app_designer",
                      params: { action: "apply", designId },
                    });
                    if (result.success) {
                      setApplyResult(result.data);
                      message.success("部署完成");
                      // 刷新设计详情
                      loadDesign();
                    } else {
                      message.error(result.error || "部署失败");
                    }
                  } catch (err: any) {
                    message.error(err.message || "请求失败");
                  }
                  setApplying(false);
                }}
              >
                一键部署
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setModifyInput("");
                  setModifyOpen(true);
                }}
              >
                提出修改
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setPromptInput(d.systemPrompt || "");
                  setPromptOpen(true);
                }}
              >
                {d.systemPrompt ? "编辑角色设定" : "设置角色设定"}
              </Button>
              <Button size="small" icon={<FormOutlined />} onClick={() => window.open("/forms", "_blank")}>
                表单中心
              </Button>
              <Button size="small" icon={<NodeIndexOutlined />} onClick={() => window.open("/workflow/designer", "_blank")}>
                工作流
              </Button>
              <Button size="small" icon={<BookOutlined />} onClick={() => window.open("/knowledge", "_blank")}>
                知识库
              </Button>
              <Button
                size="small"
                icon={<LinkOutlined />}
                onClick={() => {
                  setRelDraft(d.relationships ? [...d.relationships] : []);
                  setRelEditorOpen(true);
                }}
              >
                配置关联
              </Button>
            </Space>
          </div>

          {applyResult && (
            <div style={{ marginTop: 12, padding: 10, background: "#f6ffed", borderRadius: 6, border: "1px solid #b7eb8f" }}>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>🚀 部署结果</div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>{applyResult.summary}</div>
              <Space wrap>
                {applyResult.results?.map((r: any, i: number) => (
                  <Tag key={i} color={r.status === "created" ? "green" : r.status === "exists" ? "blue" : r.status === "skipped" ? "orange" : "red"}>
                    {typeLabels[r.type] || r.type}: {r.name} ({r.status})
                  </Tag>
                ))}
              </Space>
            </div>
          )}
        </div>
      )}
    </Card>
      <Modal
        title="提出修改意见"
        open={modifyOpen}
        onOk={() => {
          if (modifyInput.trim()) {
            message.info("请在对话中直接说：帮我修改 design_xxx，" + modifyInput.trim());
          }
          setModifyOpen(false);
        }}
        onCancel={() => setModifyOpen(false)}
        okText="确认"
        cancelText="取消"
      >
        <Input
          placeholder="请输入修改意见"
          value={modifyInput}
          onChange={(e) => setModifyInput(e.target.value)}
          onPressEnter={() => {
            if (modifyInput.trim()) {
              message.info("请在对话中直接说：帮我修改 design_xxx，" + modifyInput.trim());
            }
            setModifyOpen(false);
          }}
          autoFocus
        />
      </Modal>

      <Modal
        title="编辑角色设定（系统提示词）"
        open={promptOpen}
        confirmLoading={savingPrompt}
        onOk={async () => {
          if (!designId) return;
          setSavingPrompt(true);
          try {
            const result = await api.post<any>("/api/execute", {
              skillName: "app_designer",
              params: { action: "update_system_prompt", designId, systemPrompt: promptInput },
            });
            if (result.success) {
              message.success("角色设定已保存");
              setPromptOpen(false);
              loadDesign();
            } else {
              message.error(result.error || "保存失败");
            }
          } catch (err: any) {
            message.error(err.message || "请求失败");
          }
          setSavingPrompt(false);
        }}
        onCancel={() => setPromptOpen(false)}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <Input.TextArea
          placeholder="请输入自定义角色提示词，例如：你是一名招生顾问，专门解答高等学历继续教育相关问题..."
          value={promptInput}
          onChange={(e) => setPromptInput(e.target.value)}
          rows={8}
          autoFocus
        />
        <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
          提示：此处设置的提示词会在用户与该应用对话时作为系统提示注入，优先级高于默认角色设定。
        </div>
      </Modal>

      <Modal
        title="配置组件关联关系"
        open={relEditorOpen}
        confirmLoading={savingRels}
        onOk={async () => {
          if (!designId) return;
          setSavingRels(true);
          try {
            const result = await api.post<any>("/api/execute", {
              skillName: "app_designer",
              params: { action: "update_relationships", designId, relationships: relDraft },
            });
            if (result.success) {
              message.success("关联关系已保存");
              setRelEditorOpen(false);
              loadDesign();
            } else {
              message.error(result.error || "保存失败");
            }
          } catch (err: any) {
            message.error(err.message || "请求失败");
          }
          setSavingRels(false);
        }}
        onCancel={() => setRelEditorOpen(false)}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <div style={{ marginBottom: 12 }}>
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              setRelDraft([...relDraft, { from: "", to: "", type: "submits_to", description: "" }]);
            }}
          >
            添加关联
          </Button>
        </div>
        {relDraft.map((rel, idx) => (
          <div key={idx} style={{ marginBottom: 16, padding: 12, background: "#fafafa", borderRadius: 8, border: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <Select
                placeholder="来源组件"
                value={rel.from || undefined}
                onChange={(val) => {
                  const next = [...relDraft];
                  next[idx] = { ...rel, from: val };
                  setRelDraft(next);
                }}
                style={{ width: 200 }}
                options={components.map((c) => ({ label: `${typeLabels[c.type]}: ${c.name}`, value: `${c.type}:${c.key}` }))}
                showSearch
                filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              />
              <span style={{ color: "#999" }}>→</span>
              <Select
                placeholder="目标组件"
                value={rel.to || undefined}
                onChange={(val) => {
                  const next = [...relDraft];
                  next[idx] = { ...rel, to: val };
                  setRelDraft(next);
                }}
                style={{ width: 200 }}
                options={components.map((c) => ({ label: `${typeLabels[c.type]}: ${c.name}`, value: `${c.type}:${c.key}` }))}
                showSearch
                filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              />
              <Select
                value={rel.type}
                onChange={(val) => {
                  const next = [...relDraft];
                  next[idx] = { ...rel, type: val };
                  setRelDraft(next);
                }}
                style={{ width: 130 }}
                options={[
                  { label: "submits_to (提交触发)", value: "submits_to" },
                  { label: "triggers (触发)", value: "triggers" },
                  { label: "calls (调用)", value: "calls" },
                  { label: "binds (绑定)", value: "binds" },
                  { label: "queries (查询)", value: "queries" },
                  { label: "reads (读取)", value: "reads" },
                  { label: "updates (更新)", value: "updates" },
                  { label: "notifies (通知)", value: "notifies" },
                  { label: "aggregates (聚合)", value: "aggregates" },
                  { label: "validates (验证)", value: "validates" },
                  { label: "transforms (转换)", value: "transforms" },
                  { label: "filters (过滤)", value: "filters" },
                ]}
              />
              <Button
                size="small"
                danger
                onClick={() => {
                  const next = [...relDraft];
                  next.splice(idx, 1);
                  setRelDraft(next);
                }}
              >
                删除
              </Button>
            </div>
            <Input
              placeholder="关联描述（可选）"
              value={rel.description || ""}
              onChange={(e) => {
                const next = [...relDraft];
                next[idx] = { ...rel, description: e.target.value };
                setRelDraft(next);
              }}
              size="small"
              style={{ width: "100%" }}
            />
          </div>
        ))}
        {relDraft.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联关系" />
        )}
        <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
          提示：选择来源组件和目标组件，类型说明：submits_to-表单提交后触发工作流，triggers-组件触发另一个组件，calls-调用，binds-绑定
        </div>
      </Modal>
    </>
  );
};

export default AppDesignCard;
