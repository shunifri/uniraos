import { Flex, Card, Input, Typography } from "antd";
import { Upload as AntUpload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";
import type { UploadProps } from "antd";

const Dragger = AntUpload.Dragger;
const Text = Typography.Text;

interface ImportSectionProps {
  importing: boolean;
  importTags: string;
  onImportTagsChange: (tags: string) => void;
  beforeUpload: UploadProps["beforeUpload"];
}

export default function ImportSection({
  importing,
  importTags,
  onImportTagsChange,
  beforeUpload,
}: ImportSectionProps) {
  const t = useI18nStore((s) => s.t);

  return (
    <Card size="small" title={t("kb_import")} className="glass-card">
      <Flex gap={12} align="start">
        <div style={{ flex: 1 }}>
          <Dragger
            accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.txt,.md,.csv,.tsv,.json,.png,.jpg,.jpeg"
            multiple
            customRequest={beforeUpload}
            showUploadList={false}
            disabled={importing}
            style={{ padding: "16px 0" }}
          >
            <p><UploadOutlined style={{ fontSize: 28, color: "#1677ff" }} /></p>
            <p style={{ fontSize: 13 }}>{t("kb_upload_hint")}</p>
          </Dragger>
        </div>
        <div style={{ width: 200 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t("kb_tags")}</Text>
          <Input
            size="small"
            placeholder={t("kb_tags_hint")}
            value={importTags}
            onChange={(e) => onImportTagsChange(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </div>
      </Flex>
    </Card>
  );
}
