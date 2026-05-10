import { useState } from "react";
import {
  Form,
  Input,
  Select,
  Switch,
  Button,
  Flex,
  Card,
  Typography,
  Space,
  Empty,
} from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

export interface ParamProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  default?: unknown;
}

export interface ParamSchema {
  properties: Record<string, ParamProperty>;
  required?: string[];
}

interface Props {
  value: ParamSchema;
  onChange: (value: ParamSchema) => void;
}

const typeOptions = [
  { value: "string", label: "string_type" },
  { value: "number", label: "number_type" },
  { value: "boolean", label: "boolean_type" },
  { value: "array", label: "array_type" },
  { value: "object", label: "object_type" },
];

export default function ParametersTab({ value, onChange }: Props) {
  const t = useI18nStore((s) => s.t);
  const [newParamName, setNewParamName] = useState("");

  const properties = value.properties || {};
  const required = value.required || [];

  const updateParam = (
    name: string,
    partial: Partial<ParamProperty>
  ) => {
    const prop = properties[name];
    if (!prop) return;
    const next = {
      ...value,
      properties: {
        ...properties,
        [name]: { ...prop, ...partial },
      },
    };
    onChange(next);
  };

  const addParam = () => {
    const name = newParamName.trim();
    if (!name || properties[name]) return;
    onChange({
      ...value,
      properties: {
        ...properties,
        [name]: { type: "string", description: "" },
      },
    });
    setNewParamName("");
  };

  const removeParam = (name: string) => {
    const nextProps = { ...properties };
    delete nextProps[name];
    onChange({
      ...value,
      properties: nextProps,
      required: required.filter((r) => r !== name),
    });
  };

  const toggleRequired = (name: string, checked: boolean) => {
    onChange({
      ...value,
      required: checked
        ? [...required, name]
        : required.filter((r) => r !== name),
    });
  };

  const entries = Object.entries(properties);

  return (
    <div>
      <Flex gap={8} style={{ marginBottom: 16 }}>
        <Input
          size="small"
          placeholder={t("parameter_name")}
          value={newParamName}
          onChange={(e) => setNewParamName(e.target.value)}
          onPressEnter={addParam}
          style={{ flex: 1 }}
        />
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={addParam}
        >
          {t("add_parameter")}
        </Button>
      </Flex>

      {entries.length === 0 ? (
        <Empty description={t("no_parameters_defined")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size="small">
          {entries.map(([name, prop]) => (
            <Card
              key={name}
              size="small"
              bodyStyle={{ padding: 12 }}
              title={
                <Flex align="center" justify="space-between">
                  <Text strong code style={{ fontSize: 13 }}>
                    {name}
                  </Text>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeParam(name)}
                  />
                </Flex>
              }
            >
              <Flex gap={12} wrap="wrap">
                <Form.Item
                  label={t("parameter_type")}
                  style={{ marginBottom: 0, minWidth: 120 }}
                >
                  <Select
                    size="small"
                    value={prop.type}
                    onChange={(v) =>
                      updateParam(name, { type: v as ParamProperty["type"] })
                    }
                    options={typeOptions.map((o) => ({
                      value: o.value,
                      label: t(o.label as any),
                    }))}
                  />
                </Form.Item>

                <Form.Item
                  label={t("parameter_required")}
                  style={{ marginBottom: 0 }}
                >
                  <Switch
                    size="small"
                    checked={required.includes(name)}
                    onChange={(checked) => toggleRequired(name, checked)}
                  />
                </Form.Item>

                <Form.Item
                  label={t("parameter_default")}
                  style={{ marginBottom: 0, flex: 1, minWidth: 150 }}
                >
                  <Input
                    size="small"
                    value={
                      prop.default !== undefined
                        ? JSON.stringify(prop.default)
                        : ""
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      try {
                        updateParam(name, {
                          default: val ? JSON.parse(val) : undefined,
                        });
                      } catch {
                        // allow invalid JSON while typing
                      }
                    }}
                    placeholder="{}"
                  />
                </Form.Item>
              </Flex>

              <Form.Item
                label={t("parameter_desc")}
                style={{ marginBottom: 0, marginTop: 8 }}
              >
                <Input
                  size="small"
                  value={prop.description || ""}
                  onChange={(e) =>
                    updateParam(name, { description: e.target.value })
                  }
                  placeholder={t("description")}
                />
              </Form.Item>
            </Card>
          ))}
        </Space>
      )}
    </div>
  );
}
