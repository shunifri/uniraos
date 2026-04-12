import { Row, Col, Card, Statistic } from "antd";
import { FileTextOutlined, NumberOutlined, DatabaseOutlined, CloudOutlined } from "@ant-design/icons";
import { useI18nStore } from "@/i18n";

interface KBStatsProps {
  stats: {
    documentCount?: number;
    chunkCount?: number;
    totalTokens?: number;
    embeddingProvider?: string;
  };
}

export default function KBStats({ stats }: KBStatsProps) {
  const t = useI18nStore((s) => s.t);

  return (
    <Row gutter={16}>
      <Col span={6}>
        <Card size="small">
          <Statistic title={t("kb_doc_count")} value={stats.documentCount ?? 0} prefix={<FileTextOutlined />} />
        </Card>
      </Col>
      <Col span={6}>
        <Card size="small">
          <Statistic title={t("kb_chunk_count")} value={stats.chunkCount ?? 0} prefix={<NumberOutlined />} />
        </Card>
      </Col>
      <Col span={6}>
        <Card size="small">
          <Statistic title="Tokens" value={stats.totalTokens ?? 0} prefix={<DatabaseOutlined />} />
        </Card>
      </Col>
      <Col span={6}>
        <Card size="small">
          <Statistic
            title={t("kb_vector_status")}
            value={stats.embeddingProvider && stats.embeddingProvider !== "local" ? stats.embeddingProvider : (t("kb_vector_none") as any)}
            prefix={<CloudOutlined />}
          />
        </Card>
      </Col>
    </Row>
  );
}
