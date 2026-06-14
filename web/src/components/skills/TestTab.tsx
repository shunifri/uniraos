import { useState, useMemo } from "react";
import {
  Form,
  Input,
  InputNumber,
  Switch,
  Button,
  Flex,
  Card,
  Typography,
  Space,
  Tag,
  Badge,
  Empty,
} from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import { api } from "@/api";
import type { ParamSchema } from "./ParametersTab";

const { Text } = Typography;

interface Props {
  skillName: string;
  paramSchema: ParamSchema;
}

interface TestResult {
  data: any;
  success: boolean;
  duration: number;
  timestamp: string;
}

export default function TestTab({ skillName, paramSchema }: Props) {
  const t = useI18nStore((s) => s.t);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const properties = paramSchema?.properties || {};
  const required = paramSchema?.required || [];

  const entries = Object.entries(properties);

  const isReady = skillName.trim().length > 0;

  const runTest = async () => {
    if (!isReady) return;
    setLoading(true);
    const start = performance.now();
    try {
      const data = await api.post<any>("/api/execute", {
        skillName,
        params,
      });
      const duration = Math.round(performance.now() - start);
      setResult({
        data,
        success: !data.error,
        duration,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      setResult({
        data: { error: err.message },
        success: false,
        duration,
        timestamp: new Date().toLocaleTimeString(),
      });
    }
    setLoading(false);
  };

  const updateParam = (name: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [name]: value }));
  };

  const renderInput = (name: string, prop: any) => {
    const type = prop.type || "string";
    const val = params[name];

    switch (type) {
      case "boolean":
        return (
          <Switch
            checked={!!val}
            onChange={(checked) => updateParam(name, checked)}
          />
        );
      case "number":
        return (
          <InputNumber
            style={{ width: "100%" }}
            value={typeof val === "number" ? val : undefined}
            onChange={(v) => updateParam(name, v ?? 0)}
          />
        );
      case "array":
      case "object":
        return (
          <Input.TextArea
            value={
              val !== undefined ? JSON.stringify(val, null, 2) : ""
            }
            onChange={(e) => {
              try {
                const parsed = e.target.value
                  ? JSON.parse(e.target.value)
                  : undefined;
                updateParam(name, parsed);
              } catch {
                // ignore parse errors while typing
              }
            }}
            rows={3}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
        );
      default:
        return (
          <Input
            value={typeof val === "string" ? val : ""}
            onChange={(e) => updateParam(name, e.target.value)}
          />
        );
    }
  };

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      <Card
        size="small"
        title={t("test_input")}
        extra={
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={loading}
            onClick={runTest}
            disabled={!isReady}
            size="small"
          >
            {t("run_test")}
          </Button>
        }
      >
        {!isReady ? (
          <Empty description={t("select_skill")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : entries.length === 0 ? (
          <Empty description={t("no_parameters_defined")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Form layout="vertical" size="small">
            {entries.map(([name, prop]: [string, any]) => (
              <Form.Item
                key={name}
                label={
                  <Flex align="center" gap={6}>
                    <Text strong>{name}</Text>
                    <Tag style={{ fontSize: 10, lineHeight: '16px' }}>{prop.type}</Tag>
                    {required.includes(name) && (
                      <Tag color="red" style={{ fontSize: 10, lineHeight: '16px' }}>
                        {t("required")}
                      </Tag>
                    )}
                  </Flex>
                }
              >
                {renderInput(name, prop)}
              </Form.Item>
            ))}
          </Form>
        )}
      </Card>

      {result && (
        <Card size="small" title={t("test_result")}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Flex align="center" gap={12}>
              <Badge
                status={result.success ? "success" : "error"}
                text={result.success ? "Success" : "Failed"}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("execution_time")}: {result.duration}ms
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {result.timestamp}
              </Text>
            </Flex>
            <pre
              style={{
                fontSize: 12,
                maxHeight: 300,
                overflow: "auto",
                margin: 0,
                whiteSpace: "pre-wrap",
                background: "var(--ant-color-bg-container-disabled)",
                padding: 8,
                borderRadius: 4,
              }}
            >
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </Space>
        </Card>
      )}
    </Flex>
  );
}
