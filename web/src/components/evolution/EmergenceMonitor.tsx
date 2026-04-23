import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Table,
  Button,
  Tag,
  Select,
  DatePicker,
  Empty,
  App,
  Badge,
  Typography,
} from "antd";
import {
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";
import dayjs from "dayjs";

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface EmergencePattern {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  detectedAt: string;
  description: string;
  details?: any;
}

export default function EmergenceMonitor() {
  const { message } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [patterns, setPatterns] = useState<EmergencePattern[]>([]);
  const [loading, setLoading] = useState(false);
  const [severity, setSeverity] = useState<string>("all");
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

  const loadPatterns = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (severity !== "all") query.set("severity", severity);
      if (dateRange) {
        query.set("since", String(dateRange[0].valueOf()));
      }
      const queryString = query.toString();
      const url = "/api/evolution/emergence" + (queryString ? "?" + queryString : "");
      const data = await api.get<any>(url);
      setPatterns(data.patterns || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatterns();
  }, []);

  const columns = [
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      width: 120,
    },
    {
      title: "Severity",
      dataIndex: "severity",
      key: "severity",
      width: 100,
      render: (severity: string) => (
        <Badge
          status={
            severity === "high"
              ? "error"
              : severity === "medium"
              ? "warning"
              : "processing"
          }
          text={severity.toUpperCase()}
        />
      ),
    },
    {
      title: "Detected At",
      dataIndex: "detectedAt",
      key: "detectedAt",
      width: 150,
      render: (time: string) => new Date(time).toLocaleString(),
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
  ];

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      {/* Filters */}
      <Card size="small">
        <Flex gap={12} wrap>
          <Select
            placeholder={t("severity")}
            value={severity}
            onChange={setSeverity}
            style={{ width: 120 }}
            options={[
              { label: "All", value: "all" },
              { label: "High", value: "high" },
              { label: "Medium", value: "medium" },
              { label: "Low", value: "low" },
            ]}
            size="small"
          />

          <RangePicker
            size="small"
            value={dateRange}
            onChange={(dates) =>
              setDateRange(dates ? [dates[0]!, dates[1]!] : null)
            }
          />

          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadPatterns}
            loading={loading}
            type="primary"
          >
            {t("filter")}
          </Button>

          <Button
            size="small"
            onClick={() => {
              setSeverity("all");
              setDateRange(null);
            }}
          >
            {t("reset")}
          </Button>
        </Flex>
      </Card>

      {/* Table */}
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <WarningOutlined />
            <span>{t("emergence_patterns")} ({patterns.length})</span>
          </Flex>
        }
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
        styles={{ body: { flex: 1, overflow: "auto" } }}
      >
        {patterns.length === 0 ? (
          <Empty description={t("no_emergence_patterns")} />
        ) : (
          <Table
            dataSource={patterns}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 20 }}
            size="small"
            loading={loading}
            scroll={{ x: 800 }}
          />
        )}
      </Card>
    </Flex>
  );
}
