import { useState } from "react";
import {
  Card, Button, Radio, Checkbox, Form, Input, InputNumber,
  Select, DatePicker, Space, Typography, Tag, Flex, Divider,
} from "antd";
import {
  CheckCircleOutlined, CloseCircleOutlined,
  FormOutlined, UnorderedListOutlined, QuestionCircleOutlined,
} from "@ant-design/icons";

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Option {
  id: string;
  label: string;
  description?: string;
}

interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "radio" | "checkbox" | "textarea" | "date";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: unknown;
}

interface ConfirmCardProps {
  confirmId: string;
  type: "selection" | "form" | "approval";
  title: string;
  description?: string;
  options?: Option[];
  multiSelect?: boolean;
  fields?: FormField[];
  confirmText?: string;
  cancelText?: string;
  onConfirm: (confirmId: string, response: unknown) => void;
  onCancel: (confirmId: string) => void;
  disabled?: boolean;
}

export default function ConfirmCard({
  confirmId, type, title, description,
  options = [], multiSelect = false, fields = [],
  confirmText = "确定", cancelText = "取消",
  onConfirm, onCancel, disabled = false,
}: ConfirmCardProps) {
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<string[]>([]);
  const [form] = Form.useForm();

  // --- SELECTION MODE ---
  if (type === "selection") {
    if (!multiSelect) {
      // Single select: click to confirm immediately
      return (
        <Card size="small" style={{ maxWidth: 480, margin: "8px 0", borderColor: "#1890ff", borderRadius: 12 }}
          title={<Flex align="center" gap={8}><UnorderedListOutlined style={{ color: "#1890ff" }} /><Text strong>{title}</Text></Flex>}>
          {description && <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>{description}</Text>}
          <Flex vertical gap={8}>
            {options.map((opt) => (
              <Card key={opt.id} size="small" hoverable={!disabled}
                style={{
                  cursor: disabled ? "default" : "pointer",
                  borderColor: selectedSingle === opt.id ? "#1890ff" : undefined,
                  backgroundColor: selectedSingle === opt.id ? "#e6f7ff" : undefined,
                }}
                onClick={() => {
                  if (disabled) return;
                  setSelectedSingle(opt.id);
                  onConfirm(confirmId, { selectedId: opt.id, selectedLabel: opt.label });
                }}>
                <Text strong>{opt.label}</Text>
                {opt.description && <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{opt.description}</Text>}
              </Card>
            ))}
          </Flex>
          {disabled && <Tag color="green" style={{ marginTop: 8 }}><CheckCircleOutlined /> 已选择</Tag>}
        </Card>
      );
    }

    // Multi select: checkboxes + confirm button
    return (
      <Card size="small" style={{ maxWidth: 480, margin: "8px 0", borderColor: "#1890ff", borderRadius: 12 }}
        title={<Flex align="center" gap={8}><UnorderedListOutlined style={{ color: "#1890ff" }} /><Text strong>{title}</Text></Flex>}>
        {description && <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>{description}</Text>}
        <Checkbox.Group disabled={disabled} value={selectedMulti} onChange={(vals) => setSelectedMulti(vals as string[])}>
          <Flex vertical gap={8}>
            {options.map((opt) => (
              <Checkbox key={opt.id} value={opt.id}>
                <Text strong>{opt.label}</Text>
                {opt.description && <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{opt.description}</Text>}
              </Checkbox>
            ))}
          </Flex>
        </Checkbox.Group>
        <Divider style={{ margin: "12px 0" }} />
        <Space>
          <Button type="primary" disabled={disabled || selectedMulti.length === 0}
            onClick={() => {
              const selected = options.filter(o => selectedMulti.includes(o.id));
              onConfirm(confirmId, { selected: selected.map(o => ({ id: o.id, label: o.label })) });
            }}>{confirmText}</Button>
          <Button disabled={disabled} onClick={() => onCancel(confirmId)}>{cancelText}</Button>
        </Space>
        {disabled && <Tag color="green" style={{ marginTop: 8 }}><CheckCircleOutlined /> 已确认</Tag>}
      </Card>
    );
  }

  // --- FORM MODE ---
  if (type === "form") {
    const renderField = (field: FormField) => {
      switch (field.type) {
        case "text": return <Input placeholder={field.placeholder} />;
        case "number": return <InputNumber placeholder={field.placeholder} style={{ width: "100%" }} />;
        case "textarea": return <TextArea placeholder={field.placeholder} rows={3} />;
        case "select": return (
          <Select placeholder={field.placeholder ?? "请选择"}>
            {(field.options ?? []).map(opt => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
          </Select>
        );
        case "radio": return (
          <Radio.Group>
            {(field.options ?? []).map(opt => <Radio key={opt} value={opt}>{opt}</Radio>)}
          </Radio.Group>
        );
        case "checkbox": return (
          <Checkbox.Group options={field.options ?? []} />
        );
        case "date": return <DatePicker style={{ width: "100%" }} />;
        default: return <Input placeholder={field.placeholder} />;
      }
    };

    return (
      <Card size="small" style={{ maxWidth: 520, margin: "8px 0", borderColor: "#722ed1", borderRadius: 12 }}
        title={<Flex align="center" gap={8}><FormOutlined style={{ color: "#722ed1" }} /><Text strong>{title}</Text></Flex>}>
        {description && <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>{description}</Text>}
        <Form form={form} layout="vertical" disabled={disabled} size="small"
          initialValues={fields.reduce((acc, f) => {
            if (f.defaultValue !== undefined) acc[f.key] = f.defaultValue;
            return acc;
          }, {} as Record<string, unknown>)}>
          {fields.map((field) => (
            <Form.Item key={field.key} name={field.key} label={field.label}
              rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : []}>
              {renderField(field)}
            </Form.Item>
          ))}
        </Form>
        <Space>
          <Button type="primary" disabled={disabled}
            onClick={async () => {
              try {
                const values = await form.validateFields();
                onConfirm(confirmId, values);
              } catch { /* validation failed */ }
            }}>{confirmText}</Button>
          <Button disabled={disabled} onClick={() => onCancel(confirmId)}>{cancelText}</Button>
        </Space>
        {disabled && <Tag color="green" style={{ marginTop: 8 }}><CheckCircleOutlined /> 已提交</Tag>}
      </Card>
    );
  }

  // --- APPROVAL MODE ---
  return (
    <Card size="small" style={{ maxWidth: 480, margin: "8px 0", borderColor: "#faad14", borderRadius: 12 }}
      title={<Flex align="center" gap={8}><QuestionCircleOutlined style={{ color: "#faad14" }} /><Text strong>{title}</Text></Flex>}>
      {description && <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>{description}</Text>}
      <Space>
        <Button type="primary" disabled={disabled}
          onClick={() => onConfirm(confirmId, { approved: true })}>{confirmText}</Button>
        <Button danger disabled={disabled}
          onClick={() => onCancel(confirmId)}>{cancelText}</Button>
      </Space>
      {disabled && <Tag color="green" style={{ marginTop: 8 }}><CheckCircleOutlined /> 已确认</Tag>}
    </Card>
  );
}
