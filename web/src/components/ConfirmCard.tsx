import { useState, useEffect } from "react";
import {
  Button, Radio, Checkbox, Form, Input, InputNumber,
  Select, DatePicker, Space, Typography, Flex, Divider,
} from "antd";
import {
  CheckCircleOutlined, CheckOutlined, CloseCircleOutlined,
  FormOutlined, UnorderedListOutlined, QuestionCircleOutlined,
} from "@ant-design/icons";
import DynamicForm from "./DynamicForm";
import type { RaosFormSchema } from "./form-engine/types";

const { Text } = Typography;
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
  options?: { id: string; label: string }[];
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
  schema?: RaosFormSchema;
  submittedData?: any;
}

const glassCardStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: "8px 0",
  padding: "20px",
};

const gradientIconStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  background: "linear-gradient(135deg, #8B5CF6, #EC4899)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function GlassCardHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Flex align="center" gap={8} style={{ marginBottom: 16 }}>
      <span style={gradientIconStyle}>
        {icon}
      </span>
      <Text strong style={{ fontSize: 15 }}>{title}</Text>
    </Flex>
  );
}

interface FormConfirmCardProps {
  confirmId: string;
  title: string;
  description?: string;
  fields: FormField[];
  confirmText: string;
  cancelText: string;
  onConfirm: (confirmId: string, response: unknown) => void;
  onCancel: (confirmId: string) => void;
  disabled?: boolean;
}

function FormConfirmCard({
  confirmId, title, description, fields,
  confirmText, cancelText, onConfirm, onCancel, disabled = false,
}: FormConfirmCardProps) {
  const [form] = Form.useForm();

  const renderField = (field: FormField) => {
    switch (field.type) {
      case "text": return <Input placeholder={field.placeholder} />;
      case "number": return <InputNumber placeholder={field.placeholder} style={{ width: "100%" }} />;
      case "textarea": return <TextArea placeholder={field.placeholder} rows={3} />;
      case "select": {
        const chipStyle = (isSelected: boolean): React.CSSProperties => ({
          padding: "8px 18px",
          borderRadius: 20,
          fontSize: 14,
          fontWeight: 500,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          background: isSelected ? "linear-gradient(135deg, #8B5CF6, #EC4899)" : "rgba(139, 92, 246, 0.06)",
          color: isSelected ? "white" : "#475569",
          border: `1px solid ${isSelected ? "transparent" : "rgba(139, 92, 246, 0.15)"}`,
          boxShadow: isSelected ? "0 2px 12px rgba(139, 92, 246, 0.3)" : "none",
          whiteSpace: "nowrap" as const,
        });

        const [selectedId, setSelectedId] = useState<string | null>(null);

        return (
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(field.options ?? []).map(opt => {
                const isSelected = selectedId === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => { if (disabled) return; setSelectedId(opt.id); form.setFieldValue(field.key, opt.id); }}
                    style={chipStyle(isSelected)}
                    onMouseEnter={(e) => { if (!disabled && !isSelected) { e.currentTarget.style.background = "rgba(139, 92, 246, 0.12)"; e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.3)"; } }}
                    onMouseLeave={(e) => { if (!disabled && !isSelected) { e.currentTarget.style.background = "rgba(139, 92, 246, 0.06)"; e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.15)"; } }}
                  >
                    {opt.label}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
      case "radio": return (
        <Radio.Group>
          {(field.options ?? []).map(opt => <Radio key={opt.id} value={opt.id}>{opt.label}</Radio>)}
        </Radio.Group>
      );
      case "checkbox": return (
        <Checkbox.Group options={(field.options ?? []).map(opt => ({ label: opt.label, value: opt.id }))} />
      );
      case "date": return <DatePicker style={{ width: "100%" }} />;
      default: return <Input placeholder={field.placeholder} />;
    }
  };

  return (
    <div className="glass-card" style={{ ...glassCardStyle, maxWidth: 520 }}>
      <GlassCardHeader
        icon={<FormOutlined style={{ color: "white", fontSize: 14 }} />}
        title={title}
      />
      {description && <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 13 }}>{description}</Text>}
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
        <Button
          type="primary"
          disabled={disabled}
          style={{ background: "linear-gradient(135deg, #8B5CF6, #EC4899)", border: "none", borderRadius: 10, boxShadow: "0 4px 14px rgba(139, 92, 246, 0.3)" }}
          onClick={async () => {
            try {
              const values = await form.validateFields();
              onConfirm(confirmId, values);
            } catch { /* validation failed */ }
          }}>{confirmText}</Button>
        <Button style={{ borderRadius: 10 }} disabled={disabled} onClick={() => onCancel(confirmId)}>{cancelText}</Button>
      </Space>
      {disabled && (
        <Flex align="center" gap={4} style={{ marginTop: 12 }}>
          <CheckCircleOutlined style={{ color: "#10B981" }} />
          <Text style={{ color: "#10B981", fontSize: 12 }}>已提交</Text>
        </Flex>
      )}
    </div>
  );
}

export default function ConfirmCard({
  confirmId, type, title, description,
  options = [], multiSelect = false, fields = [],
  confirmText = "确定", cancelText = "取消",
  onConfirm, onCancel, disabled = false,
  schema,
  submittedData: externalSubmittedData,
}: ConfirmCardProps) {
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<string[]>([]);
  const [submittedData, setSubmittedData] = useState<any>(externalSubmittedData ?? null);

  // 当外部 submittedData 变化时更新内部状态（用于刷新后恢复）
  useEffect(() => {
    if (externalSubmittedData !== undefined) {
      setSubmittedData(externalSubmittedData);
    }
  }, [externalSubmittedData]);

  // --- NEW FORM ENGINE MODE ---
  if (schema) {
    return (
      <div className="glass-card" style={{ ...glassCardStyle, maxWidth: 520 }}>
        <GlassCardHeader
          icon={<FormOutlined style={{ color: "white", fontSize: 14 }} />}
          title={title}
        />
        {description && <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 13 }}>{description}</Text>}
        <DynamicForm
          schema={schema}
          initialData={disabled ? submittedData ?? undefined : undefined}
          readOnly={disabled}
          embedded
          onSubmit={(formData) => {
            setSubmittedData(formData);
            onConfirm(confirmId, formData);
          }}
          onCancel={() => onCancel(confirmId)}
        />
        {disabled && (
          <Flex align="center" gap={4} style={{ marginTop: 12 }}>
            <CheckCircleOutlined style={{ color: "#10B981" }} />
            <Text style={{ color: "#10B981", fontSize: 12 }}>已提交</Text>
          </Flex>
        )}
      </div>
    );
  }

  // --- SELECTION MODE --- 统一横排芯片布局
  if (type === "selection") {
    const chipStyle = (isSelected: boolean): React.CSSProperties => ({
      padding: "8px 18px",
      borderRadius: 20,
      fontSize: 14,
      fontWeight: 500,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.6 : 1,
      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      background: isSelected ? "linear-gradient(135deg, #8B5CF6, #EC4899)" : "rgba(139, 92, 246, 0.06)",
      color: isSelected ? "white" : "#475569",
      border: `1px solid ${isSelected ? "transparent" : "rgba(139, 92, 246, 0.15)"}`,
      boxShadow: isSelected ? "0 2px 12px rgba(139, 92, 246, 0.3)" : "none",
      whiteSpace: "nowrap" as const,
    });

    if (!multiSelect) {
      return (
        <div className="glass-card" style={{ ...glassCardStyle, maxWidth: "100%" }}>
          <GlassCardHeader
            icon={<UnorderedListOutlined style={{ color: "white", fontSize: 14 }} />}
            title={title}
          />
          {description && <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 13 }}>{description}</Text>}
          <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(139, 92, 246, 0.04)", border: "1px solid rgba(139, 92, 246, 0.1)" }}>
            <Text style={{ fontSize: 12, color: "#64748B" }}>
              <span style={{ marginRight: 4 }}>📋</span>
              单选模式：请点击一个选项进行选择
            </Text>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {options.map((opt) => {
              const isSelected = selectedSingle === opt.id;
              return (
                <div
                  key={opt.id}
                  onClick={() => { if (disabled) return; setSelectedSingle(opt.id); onConfirm(confirmId, { selectedId: opt.id, selectedLabel: opt.label }); }}
                  style={chipStyle(isSelected)}
                  title={opt.description}
                  onMouseEnter={(e) => { if (!disabled && !isSelected) { e.currentTarget.style.background = "rgba(139, 92, 246, 0.12)"; e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.3)"; } }}
                  onMouseLeave={(e) => { if (!disabled && !isSelected) { e.currentTarget.style.background = "rgba(139, 92, 246, 0.06)"; e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.15)"; } }}
                >
                  {opt.label}
                </div>
                );
              })}
          </div>

          {disabled && (
            <Flex align="center" gap={4} style={{ marginTop: 12 }}>
              <CheckCircleOutlined style={{ color: "#10B981" }} />
              <Text style={{ color: "#10B981", fontSize: 12 }}>已选择</Text>
            </Flex>
          )}
        </div>
      );
    }

    // Multi select: horizontal chips + confirm button
    return (
      <div className="glass-card" style={{ ...glassCardStyle, maxWidth: "100%" }}>
        <GlassCardHeader
          icon={<UnorderedListOutlined style={{ color: "white", fontSize: 14 }} />}
          title={title}
        />
        {description && <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 13 }}>{description}</Text>}
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(139, 92, 246, 0.04)", border: "1px solid rgba(139, 92, 246, 0.1)" }}>
          <Text style={{ fontSize: 12, color: "#64748B" }}>
            <span style={{ marginRight: 4 }}>☑️</span>
            多选模式：请点击选择多个选项，选择完成后点击「确认」按钮
          </Text>
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, flexWrap: "wrap" }}>
          {options.map((opt) => {
            const isSelected = selectedMulti.includes(opt.id);
            return (
              <div
                key={opt.id}
                onClick={() => {
                  if (disabled) return;
                  setSelectedMulti(prev => isSelected ? prev.filter(v => v !== opt.id) : [...prev, opt.id]);
                }}
                style={chipStyle(isSelected)}
                title={opt.description}
                onMouseEnter={(e) => { if (!disabled && !isSelected) { e.currentTarget.style.background = "rgba(139, 92, 246, 0.12)"; e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.3)"; } }}
                onMouseLeave={(e) => { if (!disabled && !isSelected) { e.currentTarget.style.background = "rgba(139, 92, 246, 0.06)"; e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.15)"; } }}
              >
                {isSelected && <CheckOutlined style={{ fontSize: 10, marginRight: 4 }} />}
                {opt.label}
              </div>
            );
          })}
        </div>
        {selectedMulti.length > 0 && !disabled && (
          <Flex gap={8} style={{ marginTop: 12 }}>
            <Button
              type="primary"
              size="small"
              style={{ background: "linear-gradient(135deg, #8B5CF6, #EC4899)", border: "none", borderRadius: 10 }}
              onClick={() => {
                const selected = options.filter(o => selectedMulti.includes(o.id));
                onConfirm(confirmId, { selected: selected.map(o => ({ id: o.id, label: o.label })) });
              }}>{confirmText} ({selectedMulti.length})</Button>
            <Button size="small" style={{ borderRadius: 10 }} onClick={() => onCancel(confirmId)}>{cancelText}</Button>
          </Flex>
        )}
        {disabled && (
          <Flex align="center" gap={4} style={{ marginTop: 12 }}>
            <CheckCircleOutlined style={{ color: "#10B981" }} />
            <Text style={{ color: "#10B981", fontSize: 12 }}>已确认</Text>
          </Flex>
        )}
      </div>
    );
  }

  // --- FORM MODE ---
  if (type === "form") {
    return (
      <FormConfirmCard
        confirmId={confirmId}
        title={title}
        description={description}
        fields={fields}
        confirmText={confirmText}
        cancelText={cancelText}
        onConfirm={onConfirm}
        onCancel={onCancel}
        disabled={disabled}
      />
    );
  }

  // --- APPROVAL MODE ---
  return (
    <div className="glass-card" style={{ ...glassCardStyle, maxWidth: "100%" }}>
      <GlassCardHeader
        icon={<QuestionCircleOutlined style={{ color: "white", fontSize: 14 }} />}
        title={title}
      />
      {description && <Text type="secondary" style={{ display: "block", marginBottom: 16, fontSize: 13 }}>{description}</Text>}
      <div style={{ display: "flex", gap: 12 }}>
        <div
          onClick={() => { if (!disabled) onConfirm(confirmId, { approved: true }); }}
          style={{
            flex: 1,
            padding: "16px 12px",
            borderRadius: 14,
            textAlign: "center",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            background: "rgba(16, 185, 129, 0.06)",
            border: "2px solid rgba(16, 185, 129, 0.2)",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.12)";
              e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.4)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(16, 185, 129, 0.06)";
            e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.2)";
          }}
        >
          <CheckCircleOutlined style={{ fontSize: 28, color: "#10B981", marginBottom: 8, display: "block" }} />
          <Text strong style={{ color: "#059669", fontSize: 15 }}>{confirmText}</Text>
        </div>
        <div
          onClick={() => { if (!disabled) onCancel(confirmId); }}
          style={{
            flex: 1,
            padding: "16px 12px",
            borderRadius: 14,
            textAlign: "center",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            background: "rgba(239, 68, 68, 0.06)",
            border: "2px solid rgba(239, 68, 68, 0.2)",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.06)";
            e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.2)";
          }}
        >
          <CloseCircleOutlined style={{ fontSize: 28, color: "#EF4444", marginBottom: 8, display: "block" }} />
          <Text strong style={{ color: "#DC2626", fontSize: 15 }}>{cancelText}</Text>
        </div>
      </div>
      {disabled && (
        <Flex align="center" gap={4} style={{ marginTop: 12 }}>
          <CheckCircleOutlined style={{ color: "#10B981" }} />
          <Text style={{ color: "#10B981", fontSize: 12 }}>已确认</Text>
        </Flex>
      )}
    </div>
  );
}
