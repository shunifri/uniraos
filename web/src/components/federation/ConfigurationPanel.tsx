import { useState, useEffect } from "react";
import {
  Card,
  Form,
  Input,
  Slider,
  Switch,
  Button,
  Space,
  Empty,
  App,
  Flex,
  InputNumber,
  Typography,
} from "antd";
import { SaveOutlined, ReloadOutlined } from "@ant-design/icons";
import { api } from "@/api";

const { Text } = Typography;

interface FederationConfig {
  heartbeatInterval: number;
  syncInterval: number;
  minConfidenceThreshold: number;
  enableAutoMigration: boolean;
}

export default function ConfigurationPanel() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [config, setConfig] = useState<FederationConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await api.get<FederationConfig>(
        "/api/config/federation"
      );
      setConfig(data);
      form.setFieldsValue(data);
    } catch (e: any) {
      message.error(e.message || "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      modal.confirm({
        title: "确认保存配置",
        content: "确定要保存这些联邦配置更改吗？",
        okText: "确认",
        cancelText: "取消",
        onOk: async () => {
          try {
            setSaving(true);
            await api.put("/api/config/federation", values);
            message.success("Configuration saved successfully");
            setConfig(values);
          } catch (e: any) {
            message.error(e.message || "Failed to save configuration");
          } finally {
            setSaving(false);
          }
        },
      });
    } catch (e: any) {
      message.error(e.message || "Failed to validate configuration");
    }
  };

  const handleReset = () => {
    if (config) {
      form.setFieldsValue(config);
      message.info("Configuration reset to last saved state");
    }
  };

  if (!config) {
    return <Empty description="Loading..." />;
  }

  return (
    <Flex vertical gap={16}>
      <Card size="small" title="Federation Configuration">
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => {
            // Form values changed
          }}
        >
          <Form.Item
            label={
              <Flex justify="space-between">
                <span>Heartbeat Interval (seconds)</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Controls how often the instance sends heartbeats to other peers
                </Text>
              </Flex>
            }
            name="heartbeatInterval"
            rules={[
              { required: true, message: "Heartbeat interval is required" },
              { type: "number", min: 1, max: 300, message: "Must be between 1 and 300" },
            ]}
          >
            <InputNumber min={1} max={300} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            label={
              <Flex justify="space-between">
                <span>Sync Interval (seconds)</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Controls how often the instance synchronizes data with peers
                </Text>
              </Flex>
            }
            name="syncInterval"
            rules={[
              { required: true, message: "Sync interval is required" },
              { type: "number", min: 1, max: 3600, message: "Must be between 1 and 3600" },
            ]}
          >
            <InputNumber min={1} max={3600} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            label={
              <Flex justify="space-between">
                <span>Minimum Confidence Threshold</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Minimum confidence level for accepting recommendations (0-1)
                </Text>
              </Flex>
            }
            name="minConfidenceThreshold"
            rules={[
              { required: true, message: "Confidence threshold is required" },
              { type: "number", min: 0, max: 1, message: "Must be between 0 and 1" },
            ]}
          >
            <Flex gap={16} align="center">
              <Slider
                min={0}
                max={1}
                step={0.01}
                style={{ flex: 1 }}
                value={form.getFieldValue("minConfidenceThreshold") || 0}
                onChange={(value) =>
                  form.setFieldValue("minConfidenceThreshold", value)
                }
              />
              <Text style={{ minWidth: 60 }}>
                {((form.getFieldValue("minConfidenceThreshold") || 0) * 100).toFixed(0)}%
              </Text>
            </Flex>
          </Form.Item>

          <Form.Item
            label={
              <Flex justify="space-between">
                <span>Enable Auto Migration</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Automatically accept recommendations from trusted peers
                </Text>
              </Flex>
            }
            name="enableAutoMigration"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Flex gap={8}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              Save Configuration
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleReset}
              disabled={saving}
            >
              Reset
            </Button>
          </Flex>
        </Form>
      </Card>

      <Card size="small" title="Configuration Notes">
        <Flex vertical gap={8}>
          <div>
            <Text strong>Heartbeat Interval:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
              Lower values increase network traffic but ensure faster detection of peer failures.
            </Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text strong>Sync Interval:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
              Controls how frequently this instance synchronizes skill metrics and recommendations with other peers.
            </Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text strong>Confidence Threshold:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
              Only recommendations with confidence above this threshold will be considered. Higher values are more conservative.
            </Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text strong>Auto Migration:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
              When enabled, high-confidence recommendations will be automatically accepted. Disable for manual review.
            </Text>
          </div>
        </Flex>
      </Card>
    </Flex>
  );
}
