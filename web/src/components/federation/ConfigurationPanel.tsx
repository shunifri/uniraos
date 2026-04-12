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
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

interface FederationConfig {
  heartbeatInterval: number;
  syncInterval: number;
  minConfidenceThreshold: number;
  enableAutoMigration: boolean;
}

export default function ConfigurationPanel() {
  const { message, modal } = App.useApp();
  const t = useI18nStore((s) => s.t);
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
      message.error(e.message || t("failed_to_load_configuration"));
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
        title: t("confirm_save_config"),
        content: t("confirm_save_config_content"),
        okText: t("confirm"),
        cancelText: t("cancel"),
        onOk: async () => {
          try {
            setSaving(true);
            await api.put("/api/config/federation", values);
            message.success(t("configuration_saved"));
            setConfig(values);
          } catch (e: any) {
            message.error(e.message || t("failed_to_save_configuration"));
          } finally {
            setSaving(false);
          }
        },
      });
    } catch (e: any) {
      message.error(e.message || t("failed_to_validate_configuration"));
    }
  };

  const handleReset = () => {
    if (config) {
      form.setFieldsValue(config);
      message.info(t("configuration_reset"));
    }
  };

  if (!config) {
    return <Empty description={t("loading")} />;
  }

  return (
    <Flex vertical gap={16}>
      <Card size="small" title={t("federation_configuration")}>
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
                <span>{t("heartbeat_interval_seconds")}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("heartbeat_tooltip")}
                </Text>
              </Flex>
            }
            name="heartbeatInterval"
            rules={[
              { required: true, message: t("heartbeat_required") },
              { type: "number", min: 1, max: 300, message: t("must_be_between_1_and_300") },
            ]}
          >
            <InputNumber min={1} max={300} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            label={
              <Flex justify="space-between">
                <span>{t("sync_interval_seconds")}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("sync_tooltip")}
                </Text>
              </Flex>
            }
            name="syncInterval"
            rules={[
              { required: true, message: t("sync_required") },
              { type: "number", min: 1, max: 3600, message: t("must_be_between_1_and_3600") },
            ]}
          >
            <InputNumber min={1} max={3600} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            label={
              <Flex justify="space-between">
                <span>{t("minimum_confidence_threshold")}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("confidence_tooltip")}
                </Text>
              </Flex>
            }
            name="minConfidenceThreshold"
            rules={[
              { required: true, message: t("confidence_required") },
              { type: "number", min: 0, max: 1, message: t("must_be_between_0_and_1") },
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
                <span>{t("enable_auto_migration")}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("auto_migration_desc")}
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
              {t("save_configuration")}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleReset}
              disabled={saving}
            >
              {t("reset")}
            </Button>
          </Flex>
        </Form>
      </Card>

      <Card size="small" title={t("configuration_notes")}>
        <Flex vertical gap={8}>
          <div>
            <Text strong>{t("heartbeat_interval")}:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>{t("heartbeat_interval_desc")}</Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text strong>{t("sync_interval")}:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>{t("sync_interval_desc")}</Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text strong>{t("confidence_threshold")}:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>{t("confidence_threshold_desc")}</Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text strong>{t("auto_migration")}:</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 4 }}>{t("auto_migration_desc")}</Text>
          </div>
        </Flex>
      </Card>
    </Flex>
  );
}
