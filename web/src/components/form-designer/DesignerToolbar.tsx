/**
 * Form Designer - Toolbar
 */

import React, { useState } from "react";
import {
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  theme,
} from "antd";
import {
  PlusOutlined,
  SaveOutlined,
  EyeOutlined,
  ImportOutlined,
  ExportOutlined,
  CheckCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { RaosFormSchema } from "@/components/form-engine/types";
import { useDesigner } from "./DesignerContext";

const { Option } = Select;
const { TextArea } = Input;

interface DesignerToolbarProps {
  onPreview: () => void;
  onJsonToggle: () => void;
  onSave: () => void;
  onNew: () => void;
  jsonOpen: boolean;
}

export const DesignerToolbar: React.FC<DesignerToolbarProps> = ({
  onPreview,
  onJsonToggle,
  onSave,
  onNew,
  jsonOpen,
}) => {
  const { state, setFormMeta, setSchema } = useDesigner();
  const { token } = theme.useToken();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState("");

  const handleImport = () => {
    try {
      const schema: RaosFormSchema = JSON.parse(importText);
      if (!schema.type || schema.type !== "object" || !schema.properties) {
        message.error("无效的 Schema 格式");
        return;
      }
      setSchema(schema);
      if (schema.title) {
        setFormMeta({ name: schema.title });
      }
      message.success("导入成功");
      setImportOpen(false);
      setImportText("");
    } catch {
      message.error("JSON 格式错误");
    }
  };

  const handleExport = () => {
    const schema: RaosFormSchema = {
      ...state.schema,
      title: state.formMeta.name || state.schema.title,
    };
    setExportText(JSON.stringify(schema, null, 2));
    setExportOpen(true);
  };

  const handleValidate = () => {
    try {
      const schema = state.schema;
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        message.warning("表单没有任何字段");
        return;
      }
      // Check for duplicate keys or invalid schemas
      for (const [key, fieldSchema] of Object.entries(schema.properties)) {
        if (!fieldSchema.type) {
          message.error(`字段 "${key}" 缺少 type`);
          return;
        }
        if (!fieldSchema.title && fieldSchema["ui:widget"] !== "divider") {
          message.warning(`字段 "${key}" 缺少标题`);
        }
      }
      message.success("Schema 验证通过");
    } catch (err: any) {
      message.error(`验证失败: ${err.message}`);
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <Space>
          <Button icon={<PlusOutlined />} onClick={onNew}>
            新建
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={state.isLoading}>
            保存
          </Button>
        </Space>

        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {state.formMeta.name || "未命名表单"}
          {state.isDirty && <span style={{ color: token.colorWarning, marginLeft: 8 }}>*</span>}
        </div>

        <Space>
          <Button icon={<EyeOutlined />} onClick={onPreview}>
            预览
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
            导入
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出
          </Button>
          <Button icon={<CheckCircleOutlined />} onClick={handleValidate}>
            验证
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
          <Button type={jsonOpen ? "primary" : "default"} onClick={onJsonToggle}>
            JSON
          </Button>
        </Space>
      </div>

      {/* Form Settings Modal */}
      <Modal
        title="表单设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={() => setSettingsOpen(false)}
        width={560}
      >
        <Form layout="vertical">
          <Form.Item label="表单名称">
            <Input
              value={state.formMeta.name}
              onChange={(e) => setFormMeta({ name: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="表单标识">
            <Input
              value={state.formMeta.key}
              onChange={(e) => setFormMeta({ key: e.target.value })}
              placeholder="如: leave-request"
            />
          </Form.Item>
          <Form.Item label="描述">
            <TextArea
              rows={2}
              value={state.formMeta.description}
              onChange={(e) => setFormMeta({ description: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="布局方式">
            <Select
              value={state.schema.layout?.type || "vertical"}
              onChange={(v) =>
                setSchema({
                  ...state.schema,
                  layout: { ...(state.schema.layout || {}), type: v },
                })
              }
            >
              <Option value="vertical">垂直</Option>
              <Option value="horizontal">水平</Option>
              <Option value="inline">行内</Option>
              <Option value="grid">网格</Option>
            </Select>
          </Form.Item>
          <Form.Item label="标签宽度">
            <InputNumber
              style={{ width: "100%" }}
              value={(state.schema.layout as any)?.labelWidth}
              onChange={(v) =>
                setSchema({
                  ...state.schema,
                  layout: { ...(state.schema.layout || {}), labelWidth: v ?? undefined } as any,
                })
              }
              placeholder="如: 120"
            />
          </Form.Item>
          <Form.Item label="提交按钮文字">
            <Input
              value={state.schema.actions?.find((a) => a.type === "submit")?.label || "提交"}
              onChange={(e) => {
                const actions = [...(state.schema.actions || [])];
                const idx = actions.findIndex((a) => a.type === "submit");
                if (idx >= 0) {
                  actions[idx] = { ...actions[idx], label: e.target.value };
                } else {
                  actions.push({ type: "submit", label: e.target.value, primary: true });
                }
                setSchema({ ...state.schema, actions });
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Import Modal */}
      <Modal
        title="导入 JSON Schema"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={handleImport}
        width={640}
      >
        <TextArea
          rows={16}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="粘贴 JSON Schema 到此处..."
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
      </Modal>

      {/* Export Modal */}
      <Modal
        title="导出 JSON Schema"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={[
          <Button key="close" onClick={() => setExportOpen(false)}>
            关闭
          </Button>,
        ]}
        width={640}
      >
        <TextArea
          rows={16}
          value={exportText}
          readOnly
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
      </Modal>
    </>
  );
};
