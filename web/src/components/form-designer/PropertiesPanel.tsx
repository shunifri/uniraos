/**
 * Form Designer - Properties Panel (Right Drawer)
 */

import React, { useMemo } from "react";
import {
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Collapse,
  Button,
  Space,
  Empty,
  theme,
  Card,
} from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import type { RaosFieldSchema } from "@/components/form-engine/types";
import { useDesigner } from "./DesignerContext";

const { Panel } = Collapse;
const { TextArea } = Input;
const { Option } = Select;

// ─── Options Editor ───

const OptionsEditor: React.FC<{
  options: Array<{ label: string; value: any }>;
  onChange: (options: Array<{ label: string; value: any }>) => void;
}> = ({ options, onChange }) => {
  const { token } = theme.useToken();

  const handleAdd = () => {
    onChange([...options, { label: `选项${options.length + 1}`, value: `option${options.length + 1}` }]);
  };

  const handleRemove = (index: number) => {
    const next = [...options];
    next.splice(index, 1);
    onChange(next);
  };

  const handleChange = (index: number, key: "label" | "value", val: string) => {
    const next = [...options];
    next[index] = { ...next[index], [key]: val };
    onChange(next);
  };

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {options.map((opt, idx) => (
        <Space key={idx} style={{ width: "100%" }}>
          <Input
            size="small"
            placeholder="显示名"
            value={opt.label}
            onChange={(e) => handleChange(idx, "label", e.target.value)}
            style={{ width: 100 }}
          />
          <Input
            size="small"
            placeholder="值"
            value={opt.value}
            onChange={(e) => handleChange(idx, "value", e.target.value)}
            style={{ width: 100 }}
          />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleRemove(idx)} />
        </Space>
      ))}
      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={handleAdd} style={{ width: "100%" }}>
        添加选项
      </Button>
    </Space>
  );
};

// ─── Properties Form ───

export const PropertiesPanel: React.FC = () => {
  const { state, updateField, setFormMeta } = useDesigner();
  const { token } = theme.useToken();

  const selectedKey = state.selectedFieldKey;
  const schema = selectedKey ? state.schema.properties[selectedKey] : null;

  const handleSchemaChange = (updates: Partial<RaosFieldSchema>) => {
    if (!selectedKey || !schema) return;
    updateField(selectedKey, { ...schema, ...updates });
  };

  const widgetName = schema?.["ui:widget"] || "input";

  const hasOptions = useMemo(() => {
    return ["select", "radio", "checkbox"].includes(widgetName);
  }, [widgetName]);

  const isNumber = widgetName === "number";
  const isLayout = widgetName === "divider" || widgetName === "sectionHeader";

  if (!selectedKey || !schema) {
    return (
      <div
        style={{
          width: 280,
          flexShrink: 0,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Empty description="点击字段编辑属性" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  const currentOptions = schema["x-dataSource"]?.options || [];

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        overflowY: "auto",
        height: "100%",
        padding: "16px 12px",
      }}
    >
      <Collapse
        defaultActiveKey={["common", "type", "validation", "layout", "condition"]}
        bordered={false}
        size="small"
      >
        {/* ─── Common ─── */}
        <Panel header="基础属性" key="common">
          <Form layout="vertical" size="small">
            <Form.Item label="字段标题">
              <Input
                value={schema.title || ""}
                onChange={(e) => handleSchemaChange({ title: e.target.value })}
                placeholder="字段显示名称"
              />
            </Form.Item>

            {!isLayout && (
              <>
                <Form.Item label="字段标识">
                  <Input value={selectedKey} disabled />
                </Form.Item>

                <Form.Item label="占位提示">
                  <Input
                    value={schema["ui:placeholder"] || ""}
                    onChange={(e) => handleSchemaChange({ "ui:placeholder": e.target.value })}
                    placeholder="请输入占位提示"
                  />
                </Form.Item>

                <Form.Item label="帮助文本">
                  <Input
                    value={schema["ui:help"] || ""}
                    onChange={(e) => handleSchemaChange({ "ui:help": e.target.value })}
                    placeholder="显示在字段下方的提示"
                  />
                </Form.Item>

                <Form.Item label="默认值">
                  <Input
                    value={schema.default ?? ""}
                    onChange={(e) => handleSchemaChange({ default: e.target.value })}
                    placeholder="默认值"
                  />
                </Form.Item>

                <Form.Item label="必填">
                  <Switch
                    checked={!!schema.required}
                    onChange={(checked) => handleSchemaChange({ required: checked })}
                  />
                </Form.Item>
              </>
            )}
          </Form>
        </Panel>

        {/* ─── Type Specific ─── */}
        {hasOptions && (
          <Panel header="选项配置" key="type">
            <OptionsEditor
              options={currentOptions}
              onChange={(opts) =>
                handleSchemaChange({
                  "x-dataSource": { ...(schema["x-dataSource"] || {}), type: "static", options: opts },
                })
              }
            />
          </Panel>
        )}

        {isNumber && (
          <Panel header="数值配置" key="type">
            <Form layout="vertical" size="small">
              <Form.Item label="最小值">
                <InputNumber
                  style={{ width: "100%" }}
                  value={schema.minimum}
                  onChange={(v) => handleSchemaChange({ minimum: v ?? undefined })}
                />
              </Form.Item>
              <Form.Item label="最大值">
                <InputNumber
                  style={{ width: "100%" }}
                  value={schema.maximum}
                  onChange={(v) => handleSchemaChange({ maximum: v ?? undefined })}
                />
              </Form.Item>
              <Form.Item label="步长">
                <InputNumber
                  style={{ width: "100%" }}
                  value={schema["ui:props"]?.step}
                  onChange={(v) =>
                    handleSchemaChange({
                      "ui:props": { ...(schema["ui:props"] || {}), step: v ?? undefined },
                    })
                  }
                />
              </Form.Item>
              <Form.Item label="精度">
                <InputNumber
                  style={{ width: "100%" }}
                  value={schema["ui:props"]?.precision}
                  onChange={(v) =>
                    handleSchemaChange({
                      "ui:props": { ...(schema["ui:props"] || {}), precision: v ?? undefined },
                    })
                  }
                />
              </Form.Item>
            </Form>
          </Panel>
        )}

        {/* ─── Validation ─── */}
        {!isLayout && (
          <Panel header="校验规则" key="validation">
            <Form layout="vertical" size="small">
              <Form.Item label="最小长度">
                <InputNumber
                  style={{ width: "100%" }}
                  value={schema.minLength}
                  onChange={(v) => handleSchemaChange({ minLength: v ?? undefined })}
                />
              </Form.Item>
              <Form.Item label="最大长度">
                <InputNumber
                  style={{ width: "100%" }}
                  value={schema.maxLength}
                  onChange={(v) => handleSchemaChange({ maxLength: v ?? undefined })}
                />
              </Form.Item>
              <Form.Item label="正则表达式">
                <Input
                  value={schema.pattern || ""}
                  onChange={(e) => handleSchemaChange({ pattern: e.target.value || undefined })}
                  placeholder="^\\d+$"
                />
              </Form.Item>
              <Form.Item label="格式">
                <Select
                  allowClear
                  value={schema.format}
                  onChange={(v) => handleSchemaChange({ format: v })}
                  placeholder="选择格式"
                >
                  <Option value="email">邮箱</Option>
                  <Option value="url">URL</Option>
                  <Option value="date">日期</Option>
                  <Option value="datetime">日期时间</Option>
                  <Option value="time">时间</Option>
                  <Option value="mobile">手机号</Option>
                  <Option value="idCard">身份证号</Option>
                </Select>
              </Form.Item>
            </Form>
          </Panel>
        )}

        {/* ─── Layout ─── */}
        <Panel header="布局" key="layout">
          <Form layout="vertical" size="small">
            <Form.Item label="列宽 (1-24)">
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                max={24}
                value={schema["ui:colSpan"] || 24}
                onChange={(v) => handleSchemaChange({ "ui:colSpan": v ?? undefined })}
              />
            </Form.Item>
          </Form>
        </Panel>

        {/* ─── Condition ─── */}
        {!isLayout && (
          <Panel header="显隐条件" key="condition">
            <Form layout="vertical" size="small">
              <Form.Item label="显示条件">
                <Input
                  value={typeof schema["ui:hidden"] === "string" ? schema["ui:hidden"] : ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleSchemaChange({ "ui:hidden": val ? val : false });
                  }}
                  placeholder="如: {{otherField}} === 'value'"
                />
              </Form.Item>
              <div style={{ fontSize: 11, color: token.colorTextSecondary }}>
                使用 {"{{fieldName}}"} 引用其他字段值
              </div>
            </Form>
          </Panel>
        )}
      </Collapse>
    </div>
  );
};
